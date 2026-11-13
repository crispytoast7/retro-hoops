import { useEffect, useRef, useState } from 'preact/hooks';
import { REG_WEEKS } from '../core/constants';
import { Rng } from '../core/rng';
import { finishUserGame, startLiveGame, PostGame } from '../core/season/flow';
import type { PossessionResult } from '../core/sim/api';
import { Arcade } from '../game/arcade';
import { setCrowd, sfx, stopCrowd } from '../audio/sfx';
import { act, getSave } from '../state/store';
import { Btn, Stars, short } from './kit';
import { ROUND_NAME } from './Hub';
import { replace } from './router';

const fmtClock = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const HINT_KEY = 'retro-hoops-hints-seen';

interface Line { text: string; cls: string }
type Overlay =
  | { kind: 'intro' } | { kind: 'ball'; text: string; sub: string } | { kind: 'period'; text: string } | { kind: 'final'; post: PostGame } | null;

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
  const ctl = useRef({ fast: false, skip: false, started: null as null | (() => void), cancel: false });
  const [fast, setFast] = useState(false);

  // keep the 8:9 court as large as the space allows
  useEffect(() => {
    const fit = () => {
      const w = wrap.current, c = canvas.current;
      if (!w || !c) return;
      const k = Math.min(w.clientWidth / 240, w.clientHeight / 270);
      c.style.width = `${Math.floor(240 * k)}px`; c.style.height = `${Math.floor(270 * k)}px`;
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
    };
    const run = async () => {
      await new Promise<void>(res => { c.started = res; });
      sfx.whistle();
      while (!c.cancel) {
        const step = live.next();
        if (step.kind === 'possession') {
          push(step.result);
          if (!c.skip) {
            if (step.result.points > 0 && !c.fast) (step.result.offense === me.id ? sfx.swish : sfx.rim)();
            await sleep(c.fast ? 70 : 420);
          }
        } else if (step.kind === 'user') {
          if (c.skip) { push(live.simUser()); continue; }
          const s = step.setup;
          setOverlay({ kind: 'ball', text: s.lastShot ? 'LAST SHOT' : s.clutch ? 'CLUTCH TIME' : 'YOUR BALL', sub: `${s.userScore}-${s.oppScore} · Q${s.quarter > 4 ? 'OT' : s.quarter} ${fmtClock(s.clock)}` });
          sfx.select();
          await sleep(750);
          if (c.cancel) break;
          setOverlay(null); setPlaying(true);
          const res = await arcade.play({
            poss: s, offense: s.offense.map(id => save.players[id]), defense: s.defense.map(id => save.players[id]),
            offColors: me.colors, defColors: (iAmHome ? away : home).colors,
            ocStars: me.staff.oc?.stars ?? 0, difficulty: save.settings.difficulty,
          });
          if (c.cancel) break;
          setPlaying(false);
          highlights.push(...res.highlights);
          push(live.resolveUser(res.outcome));
          await sleep(200);
        } else if (step.kind === 'period') {
          if (!c.skip) {
            sfx.buzzer();
            setOverlay({ kind: 'period', text: step.ot ? 'END OF OVERTIME' : step.ended === 2 ? 'HALFTIME' : step.ended === 4 ? 'END OF REGULATION' : `END OF Q${step.ended}` });
            await sleep(c.fast ? 500 : 1300);
            setOverlay(null);
          }
        } else break;
      }
      if (c.cancel) return;
      const result = live.result();
      const post = act((s, rng) => finishUserGame(s, s.schedule.find(x => x.id === g.id)!, result, highlights, rng));
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
          <div class="overlay dimmed">
            <div class="head dim">{g.playoff ? ROUND_NAME[g.week - REG_WEEKS].toUpperCase() : `WEEK ${g.week}`}</div>
            <div class="bigcall">{away.name.toUpperCase()}<br />AT<br />{home.name.toUpperCase()}</div>
            <div class="panel" style={{ maxWidth: '330px', fontSize: '19px', textAlign: 'left' }}>
              {seen ? <div class="dim">You play about a dozen of your possessions. The rest is simulated.</div> : (
                <div class="col" style={{ gap: '4px' }}>
                  <div><span class="gold">DRAG</span> to dribble and drive</div>
                  <div><span class="gold">FLICK</span> for a crossover</div>
                  <div><span class="gold">TAP A TEAMMATE</span> to pass</div>
                  <div><span class="gold">HOLD STILL, RELEASE IN THE GREEN</span> to shoot</div>
                  <div><span class="gold">DRIVE AT THE RIM</span> for a layup or dunk</div>
                  <div class="dim">You play about a dozen possessions. The rest is simulated.</div>
                </div>
              )}
            </div>
            <Btn kind="primary big" onClick={start}>Tip Off</Btn>
          </div>
        )}
        {overlay?.kind === 'ball' && <div class="overlay"><div class="bigcall">{overlay.text}</div><div class="head">{overlay.sub}</div></div>}
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
              <tr><td><span class="tag pos">{pl.pos}</span> {short(pl.name)}</td><td><Stars v={pl.ratings.sht} /></td><td><Stars v={pl.ratings.hnd} /></td><td><Stars v={pl.ratings.fin} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="ticker">
        <div class="row">
          <span class="head dim">CROWD</span>
          <div class="crowdbar"><div style={{ width: `${crowd}%` }} /></div>
          {!playing && overlay?.kind !== 'final' && overlay?.kind !== 'intro' && (
            <>
              <Btn kind="small" class={fast ? 'on' : ''} onClick={() => { ctl.current.fast = !fast; setFast(!fast); }}>{fast ? 'Fast ✓' : 'Fast'}</Btn>
              <Btn kind="small" onClick={() => { ctl.current.skip = true; }}>Sim rest</Btn>
            </>
          )}
        </div>
        <div class="lines">
          {playing && lines.length === 0 ? <div class="dim">Drag to move · hold to shoot · tap a teammate to pass</div> : lines.slice(-3).map(l => <div class={l.cls}>{l.text}</div>)}
        </div>
      </div>
    </div>
  );
}
