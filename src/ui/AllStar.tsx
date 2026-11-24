// All-Star weekend, played by hand: a three-point contest against the clock and a dunk contest on the timing.
import { useEffect, useRef, useState } from 'preact/hooks';
import { VIEW_H } from '../game/render';
import { Arcade } from '../game/arcade';
import type { Contest } from '../game/arcade';
import { DunkShow } from '../game/dunkshow';
import { BALLS, DUNKS, DUNK_TRIES, JUDGES, RACKS, THREE_BALLS, THREE_CLOCK, allStarState, finishAllStar, judgeDunk, threePoints } from '../core/org/allstar';
import type { AllStarState, ContestRow, DunkChoice } from '../core/org/allstar';
import { courtStyle } from '../core/org/progress';
import { Rng } from '../core/rng';
import type { Player } from '../core/types';
import { sfx } from '../audio/sfx';
import { DESKTOP } from '../state/device';
import { act, getSave } from '../state/store';
import { Btn, short } from './kit';
import { back } from './router';

/** Where the racks stand, corner to corner around the arc, and the spot at the logo for the last ball. */
const SPOTS: [number, number][] = [[14, 62], [44, 150], [120, 190], [196, 150], [226, 62]];
const SPOT_NAMES = ['LEFT CORNER', 'LEFT WING', 'TOP OF THE ARC', 'RIGHT WING', 'RIGHT CORNER'];
const LOGO: [number, number] = [120, 224];

type Stage = 'intro' | 'three' | 'threeDone' | 'pick' | 'dunk' | 'retry' | 'cards' | 'done';

function Table({ rows, title, save }: { rows: ContestRow[]; title: string; save: ReturnType<typeof getSave> }) {
  return (
    <div class="as-table">
      <div class="head gold">{title}</div>
      {rows.map((r, i) => (
        <div class={`as-row ${r.mine ? 'me' : ''}`}>
          <span class="as-place">{i + 1}</span>
          <span class="grow nowrap">{short(r.name)} <span class="dim">{save.teams[r.teamId]?.abbr ?? ''}</span></span>
          <span class="as-score">{r.score}</span>
        </div>
      ))}
    </div>
  );
}

export function AllStarScreen(_p: { params: Record<string, any> }) {
  const save = getSave();
  const me = save.teams[save.userTeamId];
  const opp = save.teams[(save.userTeamId + 1) % save.teams.length];
  const st0 = allStarState(save);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage2 = useRef<HTMLCanvasElement>(null);
  const arcade = useRef<Arcade | null>(null);
  const show = useRef<DunkShow | null>(null);
  const alive = useRef(true);
  const [stage, setStage] = useState<Stage>(st0?.open ? 'intro' : 'done');
  const [result, setResult] = useState<AllStarState | null>(st0 && !st0.open ? st0 : null);
  const [three, setThree] = useState(0);
  const [made, setMade] = useState(0);
  const [ball, setBall] = useState({ rack: 0, ball: 0, hot: false });
  const [dunks, setDunks] = useState<{ name: string; cards: number[]; total: number; made: boolean }[]>([]);
  const [again, setAgain] = useState<DunkChoice | null>(null);
  const dice = useRef(new Rng((Date.now() ^ 0x5f3759df) >>> 0));

  useEffect(() => {
    const fit = () => {
      const w = wrap.current;
      if (!w) return;
      const k = Math.min(w.clientWidth / 240, w.clientHeight / VIEW_H);
      for (const c of [canvas.current, stage2.current]) if (c) { c.style.width = `${Math.floor(240 * k)}px`; c.style.height = `${Math.floor(VIEW_H * k)}px`; }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current!);
    arcade.current = new Arcade(canvas.current!, { paint: me.colors.primary, accent: me.colors.secondary, banners: me.titles.length, crowdA: '#ffd23c', crowdB: '#ffffff', wood: courtStyle(save) });
    show.current = new DunkShow(stage2.current!);
    return () => { alive.current = false; ro.disconnect(); arcade.current?.destroy(); show.current?.destroy(); };
  }, []);

  if (!st0) return <div class="game"><div class="overlay"><div class="panel">No All-Star weekend right now.</div><Btn onClick={back}>Back</Btn></div></div>;
  const shooter = save.players[st0.shooterId], dunker = save.players[st0.dunkerId];
  const mates = (who: Player) => me.roster.map(id => save.players[id]).filter(p => p && p.id !== who.id);
  const attempt = (who: Player, contest: Contest) => arcade.current!.play({
    poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: me.lineup, defense: opp.lineup, clutch: false, lastShot: false, crowd: 85 },
    offense: [who, ...mates(who).slice(0, 4)], defense: opp.lineup.map(id => save.players[id]),
    offColors: me.colors, defColors: opp.colors, ocStars: 0, difficulty: save.settings.difficulty, keys: DESKTOP, contest,
  });

  const runThree = async () => {
    setStage('three'); setThree(0); setMade(0);
    let score = 0, hits = 0, streak = 0, clock = THREE_CLOCK;
    let pos = { x: SPOTS[0][0], y: SPOTS[0][1] };
    // every ball in order: three on each rack, then the one from the logo
    const balls: { rack: number; b: number; spot: [number, number]; money: boolean; deep: boolean }[] = [];
    for (let rack = 0; rack < RACKS; rack++) for (let b = 0; b < BALLS; b++) balls.push({ rack, b, spot: SPOTS[rack], money: b === BALLS - 1, deep: false });
    balls.push({ rack: RACKS, b: 0, spot: LOGO, money: false, deep: true });
    for (const it of balls) {
      const hot = streak >= 2;
      setBall({ rack: it.rack, ball: it.b, hot });
      // the first ball of a rack starts where the last shot left him; the rest are shot from the rack
      const from = it.b === 0 ? pos : { x: it.spot[0], y: it.spot[1] };
      const r = await attempt(shooter, { kind: 'three', x: from.x, y: from.y, rack: { x: it.spot[0], y: it.spot[1] }, clock, money: it.money, deep: it.deep, left: it.deep ? 1 : BALLS - it.b, hot });
      if (!alive.current) return;
      clock -= r.elapsed; pos = r.at;
      if (r.timeUp || clock <= 0) break;
      if (r.shots[0]?.made) { streak++; hits++; score += threePoints({ money: it.money, deep: it.deep, swish: r.quality === 3, streak }); setThree(score); setMade(hits); }
      else streak = 0;
    }
    sfx.good();
    setStage('threeDone');
  };
  const runDunk = async (d: DunkChoice, retry = false) => {
    setStage('dunk'); setAgain(null);
    const r = await show.current!.play({ player: dunker, mate: mates(dunker)[0], colors: me.colors, dunk: d, keys: DESKTOP, label: `DUNK ${dunks.length + 1} OF ${DUNK_TRIES}${retry ? ' · SECOND TRY' : ''}` });
    if (!alive.current) return;
    // a miss gets one more go at it, as in the real thing
    if (!r.made && !retry) { setAgain(d); setStage('retry'); return; }
    const cards = judgeDunk(d.style, r, dice.current, retry);
    if (r.made) sfx.fanfare(); else sfx.groan();
    setDunks(list => [...list, { name: d.name, cards, total: cards.reduce((s, v) => s + v, 0), made: r.made }]);
    setStage('cards');
  };
  const dunkTotal = dunks.reduce((s, d) => s + d.total, 0);
  const finish = (mine: { three?: number; dunk?: number }) => {
    const out = act(s => finishAllStar(s, mine));
    setResult(out ? { ...out } : null);
    if (out?.three?.[0]?.mine || out?.dunk?.[0]?.mine) sfx.fanfare();
    setStage('done');
  };
  const last = dunks[dunks.length - 1];
  const playing = stage === 'three' || stage === 'dunk';
  const onCourt = stage === 'intro' || stage === 'three' || stage === 'threeDone';
  const myPlace = (rows?: ContestRow[]) => (rows ? rows.findIndex(r => r.mine) : -1);

  return (
    <div class="game">
      <div class="scorebar">
        <div class="side">{!playing && <Btn kind="small" onClick={back}>&lt;</Btn>}</div>
        <div class="mid">ALL-STAR WEEKEND<b>{stage === 'three' || stage === 'threeDone' ? 'THREE-POINT CONTEST' : stage === 'intro' ? `SEASON ${save.year}` : stage === 'done' ? 'RESULTS' : 'DUNK CONTEST'}</b></div>
        <div class="side r"><span class="pts">{stage === 'three' || stage === 'threeDone' ? three : stage === 'intro' || stage === 'done' ? '' : dunkTotal}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} style={{ display: onCourt ? undefined : 'none' }} />
        <canvas ref={stage2} style={{ display: onCourt ? 'none' : undefined, touchAction: 'none' }} />
        {stage === 'three' && <div class="coachline">{ball.rack >= RACKS ? 'FROM THE LOGO · WORTH 3' : `${SPOT_NAMES[ball.rack]} · BALL ${ball.ball + 1} OF ${BALLS}${ball.ball === BALLS - 1 ? ' · MONEY BALL' : ''}`}{ball.hot ? ' · ON FIRE +1' : ''}</div>}
        {!playing && (
          <div class="overlay dimmed scroll">
            {stage === 'intro' && (
              <>
                <div class="bigcall">ALL-STAR WEEKEND</div>
                <div class="panel tutcard">
                  <div class="tutline"><b class="gold">Three-point contest:</b> {short(shooter.name)}. Five racks and {THREE_CLOCK} seconds: run to each one.</div>
                  <div class="tutline"><b class="gold">Dunk contest:</b> {short(dunker.name)}. Two dunks: time the jump, the trick and the slam.</div>
                  <div class="tutline dim">Win one: 3 credits, happier fans and a trophy.</div>
                </div>
                <Btn kind="primary big" onClick={runThree}>Start</Btn>
                <Btn onClick={() => finish({})}>Skip: let them play without me</Btn>
              </>
            )}
            {stage === 'threeDone' && (
              <>
                <div class="bigcall">{three} POINTS</div>
                <div class="panel tutcard"><div>{short(shooter.name)} made {made} of {THREE_BALLS}. The others shoot while you get ready to dunk.</div></div>
                <Btn kind="primary big" onClick={() => setStage('pick')}>On to the dunk contest</Btn>
              </>
            )}
            {stage === 'pick' && (
              <>
                <div class="bigcall">DUNK {dunks.length + 1} OF {DUNK_TRIES}</div>
                <div class="panel col as-pick">
                  <div class="dim" style={{ fontSize: '17px' }}>Pick {short(dunker.name)}'s dunk. The hard ones score more and forgive less.</div>
                  {DUNKS.map(d => (
                    <Btn class="opt" onClick={() => void runDunk(d)}>
                      <span>{d.name}</span><span class="fx">{d.blurb} · <span class="gold">up to {Math.round(d.perfect * JUDGES)}</span></span>
                    </Btn>
                  ))}
                </div>
              </>
            )}
            {stage === 'retry' && again && (
              <>
                <div class="bigcall">MISSED IT</div>
                <div class="panel tutcard"><div>Everybody gets a second try. It costs half a point with the judges.</div></div>
                <Btn kind="primary big" onClick={() => void runDunk(again, true)}>Go again</Btn>
              </>
            )}
            {stage === 'cards' && last && (
              <>
                <div class="bigcall">{last.made ? last.name.toUpperCase() : 'NO GOOD'}</div>
                <div class="as-cards">{last.cards.map(c => <span class={`as-card ${c >= 10 ? 'ten' : ''}`}>{c}</span>)}</div>
                <div class="panel tutcard"><div>{last.total} of {JUDGES * 10}. Total: {dunkTotal}.</div></div>
                {dunks.length < DUNK_TRIES
                  ? <Btn kind="primary big" onClick={() => setStage('pick')}>Next dunk</Btn>
                  : <Btn kind="primary big" onClick={() => finish({ three, dunk: dunkTotal })}>See the results</Btn>}
              </>
            )}
            {stage === 'done' && result && (
              <>
                <div class="bigcall">{myPlace(result.three) === 0 || myPlace(result.dunk) === 0 ? 'CHAMPION!' : 'RESULTS'}</div>
                <div class="panel col as-results">
                  {result.three && <Table rows={result.three} title={`THREE-POINT CONTEST${myPlace(result.three) === 0 ? ' · YOU WIN' : ''}`} save={save} />}
                  {result.dunk && <Table rows={result.dunk} title={`DUNK CONTEST${myPlace(result.dunk) === 0 ? ' · YOU WIN' : ''}`} save={save} />}
                  <div class="dim" style={{ fontSize: '17px' }}>A win pays 3 credits. Second place pays 1.</div>
                </div>
                <Btn kind="primary big" onClick={back}>Back to the season</Btn>
              </>
            )}
          </div>
        )}
      </div>
      <div class="ticker"><div class="lines"><div style={{ whiteSpace: 'normal' }}>
        {stage === 'three' ? 'Dead centre is a bonus point. Make three in a row and every make after it is worth one more.'
          : stage === 'dunk' ? `${DESKTOP ? 'Press Space' : 'Tap'} on each beat: the green strip to jump, then when each ring closes.`
            : 'The league stops for a weekend. The season picks up after it.'}
      </div></div></div>
    </div>
  );
}
