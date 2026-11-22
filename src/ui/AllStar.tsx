// All-Star weekend, played by hand: a three-point contest and a dunk contest, each alone on the floor.
import { useEffect, useRef, useState } from 'preact/hooks';
import { VIEW_H } from '../game/render';
import { Arcade } from '../game/arcade';
import type { Contest } from '../game/arcade';
import { BALLS, DUNKS, DUNK_TRIES, JUDGES, RACKS, THREE_MAX, allStarState, finishAllStar, judgeDunk } from '../core/org/allstar';
import type { AllStarState, ContestRow, DunkChoice } from '../core/org/allstar';
import { courtStyle } from '../core/org/progress';
import { Rng } from '../core/rng';
import type { Player } from '../core/types';
import { sfx } from '../audio/sfx';
import { DESKTOP } from '../state/device';
import { act, getSave } from '../state/store';
import { Btn, short } from './kit';
import { back } from './router';

/** Where the racks stand, corner to corner around the arc. */
const SPOTS: [number, number][] = [[14, 62], [44, 150], [120, 190], [196, 150], [226, 62]];
const SPOT_NAMES = ['LEFT CORNER', 'LEFT WING', 'TOP OF THE ARC', 'RIGHT WING', 'RIGHT CORNER'];
/** Where a contest dunk takes off from. */
const RUNWAY = { x: 120, y: 112 };

type Stage = 'intro' | 'three' | 'threeDone' | 'pick' | 'dunk' | 'cards' | 'done';

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
  const arcade = useRef<Arcade | null>(null);
  const alive = useRef(true);
  const [stage, setStage] = useState<Stage>(st0?.open ? 'intro' : 'done');
  const [result, setResult] = useState<AllStarState | null>(st0 && !st0.open ? st0 : null);
  const [three, setThree] = useState(0);
  const [ball, setBall] = useState({ rack: 0, ball: 0 });
  const [dunks, setDunks] = useState<{ name: string; cards: number[]; total: number; made: boolean }[]>([]);
  const dice = useRef(new Rng((Date.now() ^ 0x5f3759df) >>> 0));

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
    arcade.current = new Arcade(canvas.current!, { paint: me.colors.primary, accent: me.colors.secondary, banners: me.titles.length, crowdA: '#ffd23c', crowdB: '#ffffff', wood: courtStyle(save) });
    return () => { alive.current = false; ro.disconnect(); arcade.current?.destroy(); };
  }, []);

  if (!st0) return <div class="game"><div class="overlay"><div class="panel">No All-Star weekend right now.</div><Btn onClick={back}>Back</Btn></div></div>;
  const shooter = save.players[st0.shooterId], dunker = save.players[st0.dunkerId];
  const attempt = (who: Player, contest: Contest) => {
    const mates = me.roster.map(id => save.players[id]).filter(p => p && p.id !== who.id).slice(0, 4);
    return arcade.current!.play({
      poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: me.lineup, defense: opp.lineup, clutch: false, lastShot: false, crowd: 85 },
      offense: [who, ...mates], defense: opp.lineup.map(id => save.players[id]),
      offColors: me.colors, defColors: opp.colors, ocStars: 0, difficulty: save.settings.difficulty, keys: DESKTOP, contest,
    });
  };

  const runThree = async () => {
    setStage('three'); setThree(0);
    let score = 0;
    for (let rack = 0; rack < RACKS; rack++) {
      for (let b = 0; b < BALLS; b++) {
        setBall({ rack, ball: b });
        const money = b === BALLS - 1;
        const r = await attempt(shooter, { kind: 'three', x: SPOTS[rack][0], y: SPOTS[rack][1], money });
        if (!alive.current) return;
        if (r.shots[0]?.made) { score += money ? 2 : 1; setThree(score); }
      }
    }
    sfx.good();
    setStage('threeDone');
  };
  const runDunk = async (d: DunkChoice) => {
    setStage('dunk');
    const r = await attempt(dunker, { kind: 'dunk', x: RUNWAY.x, y: RUNWAY.y, style: d.style, amp: d.amp });
    if (!alive.current) return;
    const made = r.quality >= 2;
    const cards = judgeDunk(d.style, r.quality, dice.current);
    if (made) sfx.fanfare(); else sfx.groan();
    setDunks(list => [...list, { name: d.name, cards, total: cards.reduce((s, v) => s + v, 0), made }]);
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
  const myPlace = (rows?: ContestRow[]) => (rows ? rows.findIndex(r => r.mine) : -1);

  return (
    <div class="game">
      <div class="scorebar">
        <div class="side">{!playing && <Btn kind="small" onClick={back}>&lt;</Btn>}</div>
        <div class="mid">ALL-STAR WEEKEND<b>{stage === 'three' || stage === 'threeDone' ? 'THREE-POINT CONTEST' : stage === 'intro' ? `SEASON ${save.year}` : stage === 'done' ? 'RESULTS' : 'DUNK CONTEST'}</b></div>
        <div class="side r"><span class="pts">{stage === 'three' || stage === 'threeDone' ? three : stage === 'pick' || stage === 'dunk' || stage === 'cards' ? dunkTotal : ''}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} />
        {stage === 'three' && <div class="coachline">{SPOT_NAMES[ball.rack]} · BALL {ball.ball + 1} OF {BALLS}{ball.ball === BALLS - 1 ? ' · MONEY BALL' : ''}</div>}
        {stage === 'dunk' && <div class="coachline">{DESKTOP ? 'HOLD SPACE' : 'HOLD SHOOT'}. LET GO when the crosshair is on the rim to take off.</div>}
        {!playing && (
          <div class="overlay dimmed scroll">
            {stage === 'intro' && (
              <>
                <div class="bigcall">ALL-STAR WEEKEND</div>
                <div class="panel tutcard">
                  <div class="tutline"><b class="gold">Three-point contest:</b> {short(shooter.name)}. Five racks, two balls each.</div>
                  <div class="tutline"><b class="gold">Dunk contest:</b> {short(dunker.name)}. Two dunks, five judges.</div>
                  <div class="tutline dim">Win one: 3 credits, happier fans and a trophy.</div>
                </div>
                <Btn kind="primary big" onClick={runThree}>Start</Btn>
                <Btn onClick={() => finish({})}>Skip: let them play without me</Btn>
              </>
            )}
            {stage === 'threeDone' && (
              <>
                <div class="bigcall">{three} OF {THREE_MAX}</div>
                <div class="panel tutcard"><div>{short(shooter.name)} put up {three}. The others shoot while you get ready to dunk.</div></div>
                <Btn kind="primary big" onClick={() => setStage('pick')}>On to the dunk contest</Btn>
              </>
            )}
            {stage === 'pick' && (
              <>
                <div class="bigcall">DUNK {dunks.length + 1} OF {DUNK_TRIES}</div>
                <div class="panel col as-pick">
                  <div class="dim" style={{ fontSize: '17px' }}>Pick {short(dunker.name)}'s dunk. Harder dunks score more and are harder to time.</div>
                  {DUNKS.map(d => (
                    <Btn class="opt" onClick={() => void runDunk(d)}>
                      <span>{d.name}</span><span class="fx gold">up to {Math.round(d.perfect * JUDGES)}</span>
                    </Btn>
                  ))}
                </div>
              </>
            )}
            {stage === 'cards' && last && (
              <>
                <div class="bigcall">{last.made ? last.name.toUpperCase() : 'MISSED IT'}</div>
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
        {stage === 'three' ? `Score ${three}. A ball not shot in time is lost.` : stage === 'dunk' ? 'Timing is everything: on the rim he flies, off it he clangs.' : 'The league stops for a weekend. The season picks up after it.'}
      </div></div></div>
    </div>
  );
}
