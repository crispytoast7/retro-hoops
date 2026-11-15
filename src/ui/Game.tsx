import { useEffect, useRef, useState } from 'preact/hooks';
import { cal, ROUND_NAMES } from '../core/season/calendar';
import { Objective, offerObjectives } from '../core/org/objectives';
import { adaptChallenge, challenge, courtStyle, perk } from '../core/org/progress';
import { edgeFor, intel, withForm } from '../core/org/week';
import { Rng } from '../core/rng';
import { finishUserGame, startLiveGame, PostGame } from '../core/season/flow';
import type { PossessionResult } from '../core/sim/api';
import { VIEW_H } from '../game/render';
import { Arcade, SCENARIOS, Scenario } from '../game/arcade';
import type { UserPossessionSetup } from '../core/sim/api';
import { setCrowd, sfx, stopCrowd } from '../audio/sfx';
import { act, getSave } from '../state/store';
import { Btn, FormTag, Stars, short } from './kit';
import { replace } from './router';

const fmtClock = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const HINT_KEY = 'retro-hoops-hints-seen';

/** Choose the situation for the next key moment: varied, never the same twice running. */
type Adjust = 'rim' | 'shoot' | 'lock';
const ADJUST: Record<Adjust, { label: string; effect: string }> = {
  rim: { label: 'Attack the rim', effect: 'Layups and dunks +8%, more breaks and post-ups' },
  shoot: { label: 'Let it fly', effect: 'Steadier aim, more open looks' },
  lock: { label: 'Lock down', effect: 'They shoot worse in simulated play' },
};

function pickScenario(s: UserPossessionSetup, momentum: number, used: Scenario[], adjust: Adjust | null): Scenario {
  if (s.lastShot) return Math.random() < 0.55 ? 'iso' : 'halfcourt';
  const last = used[used.length - 1], prev = used[used.length - 2];
  const w: [Scenario, number][] = [
    ['halfcourt', 1.6], ['pnr', 2], ['post', adjust === 'rim' ? 2.6 : 1.6], ['iso', 1.6], ['open', adjust === 'shoot' ? 3 : 1.6], ['lateclock', 1],
    ['fastbreak', (momentum > 15 ? 3.2 : 1.6) * (adjust === 'rim' ? 1.5 : 1)],
    ['freethrows', used.length >= 2 && used.filter(u => u === 'freethrows').length < 2 ? (s.clutch ? 1.6 : 0.9) : 0],
  ];
  const pool = w.filter(([k]) => k !== last && (k !== prev || Math.random() < 0.4));
  let r = Math.random() * pool.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of pool) { r -= v; if (r < 0) return k; }
  return 'halfcourt';
}

interface Line { text: string; cls: string }
type Overlay =
  | { kind: 'intro' } | { kind: 'ball'; text: string; sub: string; hint: string; run: string; timeout: boolean } | { kind: 'half' } | { kind: 'period'; text: string } | { kind: 'final'; post: PostGame } | null;

export function GameScreen({ params }: { params: Record<string, any> }) {
  const save = getSave();
  const g = save.schedule.find(x => x.id === params.gameId)!;
  const me = save.teams[save.userTeamId];
  const home = save.teams[g.homeId], away = save.teams[g.awayId];
  const iAmHome = g.homeId === me.id;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clockEl = useRef<HTMLElement>(null);
  const [score, setScore] = useState({ home: 0, away: 0, q: 1 });
  const [lines, setLines] = useState<Line[]>([]);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'intro' });
  const [playing, setPlaying] = useState(false);
  const [crowd, setCrowdLevel] = useState(50);
  const [mom, setMom] = useState(0);
  const [swing, setSwing] = useState<string | null>(null);
  const ctl = useRef({ fast: false, skip: false, started: null as null | (() => void), cancel: false, go: null as null | (() => void), objective: null as Objective | null, timeouts: 2, callTimeout: null as null | (() => void), adjust: null as null | ((a: Adjust) => void) });
  const [timeouts, setTimeouts] = useState(2);
  const offers = useRef<Objective[]>(offerObjectives(save, g.id)).current;
  // read once: the edge is spent when the game ends
  const edge = useRef(edgeFor(save)).current;
  const info = useRef(intel(save, g)).current;
  const [fast, setFast] = useState(false);

  // keep the 8:9 court as large as the space allows
  useEffect(() => {
    const fit = () => {
      const w = wrap.current, c = canvas.current;
      if (!w || !c) return;
      const k = Math.min(w.clientWidth / 240, w.clientHeight / VIEW_H);
      c.style.width = `${Math.floor(240 * k)}px`; c.style.height = `${Math.floor(VIEW_H * k)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (g.played) { replace('hub'); return; }
    const c = ctl.current;
    const arcade = new Arcade(canvas.current!, {
      paint: home.colors.primary, accent: home.colors.secondary, banners: home.titles.length,
      crowdA: home.colors.primary, crowdB: home.colors.secondary,
      wood: iAmHome ? courtStyle(save) : undefined,
    });
    arcade.onClock = clock => { if (clockEl.current) clockEl.current.textContent = fmtClock(clock); };
    const live = startLiveGame(save, g, new Rng((save.rng ^ (g.id * 2654435761)) >>> 0));
    const highlights: string[] = [];
    const userCrowd = () => (iAmHome ? live.crowd : 100 - live.crowd);
    const push = (r: PossessionResult) => {
      const mine = r.offense === me.id;
      setLines(ls => [...ls.slice(-5), { text: r.text, cls: r.points > 0 ? (mine ? 'mine' : 'theirs') : '' }]);
      setScore({ home: r.homeScore, away: r.awayScore, q: r.quarter });
      if (clockEl.current) clockEl.current.textContent = fmtClock(r.clockEnd);
      arcade.setCrowd(live.crowd); setCrowdLevel(userCrowd()); setCrowd(live.crowd);
      setMom(live.momentum);
    };
    const used: Scenario[] = [];
    const hot: Record<number, number> = {};
    let myRun = 0, oppRun = 0, moments = 0;
    let adjust: Adjust | null = null;
    let scored = 0;
    const run = async () => {
      await new Promise<void>(res => { c.started = res; });
      sfx.whistle();
      while (!c.cancel) {
        const step = live.next();
        if (step.kind === 'possession') {
          push(step.result);
          if (step.result.offense === me.id) myRun += step.result.points; else oppRun += step.result.points;
          if (!c.skip) await sleep(c.fast ? 12 : 55);
        } else if (step.kind === 'user') {
          if (c.skip) { push(live.simUser()); continue; }
          const s = step.setup;
          const sc = pickScenario(s, live.momentum, used, adjust);
          used.push(sc); moments++;
          const info = SCENARIOS[sc];
          const isRun = Math.abs(myRun - oppRun) >= 6 && Math.min(myRun, oppRun) <= Math.max(myRun, oppRun) * 0.6;
          const run = moments === 1 ? '' : !isRun ? `Since your last play: you ${myRun}, them ${oppRun}` : myRun > oppRun ? `Your team went on a ${myRun}-${oppRun} run` : `They went on a ${oppRun}-${myRun} run`;
          setOverlay({ kind: 'ball', text: s.lastShot ? 'LAST SHOT' : s.clutch ? `CLUTCH: ${info.name}` : info.name, sub: `${s.userScore}-${s.oppScore} · ${s.quarter > 4 ? 'OT' : `Q${s.quarter}`} ${fmtClock(s.clock)}`, hint: info.hint, run, timeout: c.timeouts > 0 && oppRun - myRun >= 6 && live.momentum < 0 });
          c.callTimeout = () => { if (c.timeouts <= 0) return; c.timeouts--; setTimeouts(c.timeouts); live.timeout(); setMom(live.momentum); sfx.whistle(); c.callTimeout = null; setOverlay(o => (o && o.kind === 'ball' ? { ...o, timeout: false, run: 'Timeout. Their run is over.' } : o)); };
          sfx.select();
          // read the situation, then tap (or wait) to play it
          await Promise.race([sleep(c.fast ? 1400 : 3200), new Promise<void>(res => { c.go = res; })]);
          c.go = null; c.callTimeout = null;
          if (c.cancel) break;
          setOverlay(null); setPlaying(true);
          const res = await arcade.play({
            poss: s, offense: s.offense.map(id => withForm(save.players[id])), defense: s.defense.map(id => save.players[id]),
            offColors: me.colors, defColors: (iAmHome ? away : home).colors,
            ocStars: me.staff.oc?.stars ?? 0, difficulty: save.settings.difficulty,
            perks: { shooting: perk(save, 'shooting') + (adjust === 'shoot' ? 2 : 0) + (edge?.kind === 'shoot' ? 1 : 0), handles: perk(save, 'handles'), passing: perk(save, 'passing'), rim: perk(save, 'rim') + (adjust === 'rim' ? 2 : 0) },
            scenario: sc, hot: { ...hot }, challenge: challenge(save),
          });
          if (c.cancel) break;
          setPlaying(false);
          highlights.push('played', ...res.highlights);
          if (res.points > 0) scored++;
          let fire = '';
          for (const sh of res.shots) {
            hot[sh.by] = sh.made ? (hot[sh.by] ?? 0) + 1 : 0;
            if (sh.made && hot[sh.by] === 2) fire = `${save.players[sh.by]?.name.split(' ').pop()} IS HEATING UP`;
            if (sh.made && hot[sh.by] >= 3) fire = `${save.players[sh.by]?.name.split(' ').pop()} IS ON FIRE!`;
          }
          const before = live.momentum;
          push(live.resolveUser(res.outcome));
          myRun = 0; oppRun = 0;
          setSwing(fire || (live.momentum > before ? 'MOMENTUM!' : 'MOMENTUM LOST'));
          await sleep(fire ? 1100 : 650);
          setSwing(null);
        } else if (step.kind === 'period') {
          if (!c.skip && step.ended === 2 && !step.ot) {
            sfx.buzzer();
            setOverlay({ kind: 'half' });
            adjust = await new Promise<Adjust>(res => { c.adjust = res; });
            c.adjust = null;
            if (adjust === 'lock') live.tightenDefense(0.035);
            setOverlay(null);
          } else if (!c.skip) {
            sfx.buzzer();
            setOverlay({ kind: 'period', text: step.ot ? 'END OF OVERTIME' : step.ended === 2 ? 'HALFTIME' : step.ended === 4 ? 'END OF REGULATION' : `END OF Q${step.ended}` });
            await sleep(c.fast ? 500 : 1300);
            setOverlay(null);
          }
        } else break;
      }
      if (c.cancel) return;
      const result = live.result();
      const post = act((s, rng) => { adaptChallenge(s, scored, moments); return finishUserGame(s, s.schedule.find(x => x.id === g.id)!, result, highlights, rng, c.objective); });
      setScore(sc => ({ ...sc, home: result.homeScore, away: result.awayScore }));
      sfx.buzzer(); if (post.won) { sfx.cheer(true); sfx.fanfare(); } else sfx.groan();
      setOverlay({ kind: 'final', post });
    };
    void run();
    return () => { c.cancel = true; arcade.destroy(); stopCrowd(); };
  }, []);

  const start = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* fine */ } setOverlay(null); ctl.current.started?.(); };
  let seen = false;
  try { seen = !!localStorage.getItem(HINT_KEY); } catch { /* fine */ }
  const q = score.q > 4 ? `OT${score.q - 4 > 1 ? score.q - 4 : ''}` : `Q${score.q}`;
  const myScore = iAmHome ? score.home : score.away, oppScore = iAmHome ? score.away : score.home;

  return (
    <div class="game">
      <div class="scorebar">
        <div class="side"><span class="swatch" style={{ background: away.colors.primary }} /><span>{away.abbr}</span><span class="pts">{score.away}</span></div>
        <div class="mid">{g.playoff ? 'PLAYOFFS' : `WEEK ${g.week}`} · {q}<b ref={clockEl as any}>6:00</b></div>
        <div class="side r"><span class="swatch" style={{ background: home.colors.primary }} /><span>{home.abbr}</span><span class="pts">{score.home}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} />
        {overlay?.kind === 'intro' && (
          <div class="overlay dimmed scroll">
            <div class="head dim">{g.playoff ? ROUND_NAMES[g.week - cal(save).regWeeks].toUpperCase() : `WEEK ${g.week}`}</div>
            <div class="bigcall">{away.name.toUpperCase()}<br />AT<br />{home.name.toUpperCase()}</div>
            {info.rival && <div class="head gold">RIVALRY GAME</div>}
            {edge && <div class="good" style={{ maxWidth: '330px' }}>EDGE · {edge.label}</div>}
            <div class="panel" style={{ maxWidth: '330px', fontSize: '19px', textAlign: 'left' }}>
              <div class="dim">You play the key moments. Score, and your team goes on a run. Waste one, and the other side does.</div>
              {!seen && <div style={{ marginTop: '6px' }}><span class="gold">Drag</span> the court to move. <span class="gold">Hold SHOOT</span> and let go when the crosshair is on the rim. <span class="gold">Tap a teammate</span> to pass. <span class="gold">Flick</span> for a move.</div>}
            </div>
            <div class="panel col" style={{ maxWidth: '330px', gap: '6px', textAlign: 'left' }}>
              <div class="head gold">PICK A CHALLENGE</div>
              {offers.map(o => (
                <Btn class="opt" onClick={() => { ctl.current.objective = o; start(); }} silent>
                  <span>{o.text}</span><span class="fx gold">{o.reward}</span>
                </Btn>
              ))}
            </div>
            <div class="row"><Btn onClick={start}>No challenge: tip off</Btn>{!seen && <Btn onClick={() => replace('practice')}>Practice first</Btn>}</div>
          </div>
        )}
        {overlay?.kind === 'ball' && (
          <div class="overlay dimmed" onClick={e => { if (!(e.target as HTMLElement).closest('.btn')) ctl.current.go?.(); }}>
            <div class="head dim">KEY MOMENT</div>
            <div class="bigcall">{overlay.text}</div>
            <div class="head">{overlay.sub}</div>
            <div class="panel" style={{ maxWidth: '300px', fontSize: '20px' }}>{overlay.hint}</div>
            {overlay.run && <div class={overlay.run.startsWith('They') ? 'bad' : overlay.run.startsWith('Your') || overlay.run.startsWith('Timeout') ? 'good' : 'dim'}>{overlay.run}</div>}
            {overlay.timeout && <Btn kind="danger" onClick={() => ctl.current.callTimeout?.()}>Timeout: stop their run ({timeouts} left)</Btn>}
            <div class="head dim">TAP TO PLAY</div>
          </div>
        )}
        {overlay?.kind === 'half' && (
          <div class="overlay dimmed">
            <div class="bigcall">HALFTIME</div>
            <div class="head">{away.abbr} {score.away} · {home.abbr} {score.home}</div>
            <div class="panel col" style={{ maxWidth: '330px', gap: '6px', textAlign: 'left' }}>
              <div class="head gold">SECOND-HALF ADJUSTMENT</div>
              {(Object.keys(ADJUST) as Adjust[]).map(k => (
                <Btn class="opt" onClick={() => ctl.current.adjust?.(k)}>
                  <span>{ADJUST[k].label}</span><span class="fx">{ADJUST[k].effect}</span>
                </Btn>
              ))}
            </div>
          </div>
        )}
        {swing && <div class="overlay"><div class="bigcall" style={{ color: swing === 'MOMENTUM LOST' ? 'var(--bad)' : swing === 'MOMENTUM!' ? 'var(--good)' : 'var(--gold)' }}>{swing}</div></div>}
        {overlay?.kind === 'period' && <div class="overlay dimmed"><div class="bigcall">{overlay.text}</div><div class="head">{away.abbr} {score.away} · {home.abbr} {score.home}</div></div>}
        {overlay?.kind === 'final' && (
          <div class="overlay dimmed">
            <div class="bigcall" style={{ color: overlay.post.won ? 'var(--good)' : 'var(--bad)' }}>{overlay.post.won ? 'VICTORY!' : 'DEFEAT'}</div>
            <div class="head">{myScore} - {oppScore}</div>
            <Btn kind="primary big" onClick={() => replace('postgame', { post: overlay.post })}>Continue</Btn>
          </div>
        )}
      </div>
      <div class="floor">
        <table class="tbl">
          <thead><tr><th>ON THE FLOOR</th><th>SHOOT</th><th>HANDLE</th><th>FINISH</th></tr></thead>
          <tbody>
            {me.lineup.map(id => save.players[id]).filter(Boolean).map(pl => (
              <tr><td><span class="tag pos">{pl.pos}</span> {short(pl.name)} <FormTag player={pl} /></td><td><Stars v={pl.ratings.sht} /></td><td><Stars v={pl.ratings.hnd} /></td><td><Stars v={pl.ratings.fin} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="ticker">
        <div class="row">
          <span class="head dim">MOMENTUM</span>
          <div class="mombar" title={`Crowd ${Math.round(crowd)}`}>
            <div class="mid" />
            <div class={mom >= 0 ? 'fill up' : 'fill down'} style={mom >= 0 ? { left: '50%', width: `${Math.min(50, mom / 2)}%` } : { right: '50%', width: `${Math.min(50, -mom / 2)}%` }} />
          </div>
          {!playing && overlay?.kind !== 'final' && overlay?.kind !== 'intro' && (
            <>
              <Btn kind="small" class={fast ? 'on' : ''} onClick={() => { ctl.current.fast = !fast; setFast(!fast); }}>{fast ? 'Fast ✓' : 'Fast'}</Btn>
              <Btn kind="small" onClick={() => { ctl.current.skip = true; }}>Sim rest</Btn>
            </>
          )}
        </div>
        <div class="lines">
          {playing ? <div class="dim">Drag: move · Hold SHOOT, let go on the rim · Tap SHOOT: fake · Tap a teammate: pass</div> : lines.slice(-3).map(l => <div class={l.cls}>{l.text}</div>)}
        </div>
      </div>
    </div>
  );
}
