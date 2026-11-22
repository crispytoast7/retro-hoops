// You won it all. Stop everything and celebrate.
import { useEffect, useRef } from 'preact/hooks';
import { setCrowd, sfx, stopCrowd } from '../audio/sfx';
import { markTip } from '../core/org/progress';
import type { Moment } from '../core/season/bracket';
import { ROUND_NAMES } from '../core/season/calendar';
import { touch, useSave } from '../state/store';
import { Btn, Panel, Sprite, fullName, recordStr } from './kit';
import { nav, reset } from './router';

/** A gold cup, 22 x 24 pixels, as rows of [x, width] runs. */
const CUP: [number, number, string][][] = [
  [[4, 14, 'r']], [[3, 16, 'g']], [[0, 3, 'g'], [3, 16, 'l'], [19, 3, 'g']], [[0, 1, 'g'], [3, 16, 'g'], [21, 1, 'g']],
  [[0, 1, 'g'], [3, 2, 'l'], [5, 14, 'g'], [21, 1, 'g']], [[0, 1, 'g'], [3, 2, 'l'], [5, 14, 'g'], [21, 1, 'g']],
  [[0, 2, 'g'], [3, 2, 'l'], [5, 14, 'g'], [20, 2, 'g']], [[1, 2, 'g'], [3, 2, 'l'], [5, 14, 'g'], [19, 2, 'g']],
  [[2, 18, 'g']], [[4, 2, 'l'], [6, 12, 'g']], [[4, 14, 'd']], [[5, 12, 'g']], [[6, 10, 'g']], [[7, 8, 'd']],
  [[9, 4, 'g']], [[9, 4, 'g']], [[9, 4, 'd']], [[9, 4, 'g']], [[7, 8, 'g']], [[5, 12, 'g']],
  [[4, 14, 'k']], [[4, 14, 'k']], [[3, 16, 'k']], [[3, 16, 'd']],
];
const CUP_COL: Record<string, string> = { g: '#ffd23c', l: '#fff3b0', d: '#c8921a', r: '#ffe98a', k: '#3a2a14' };

export function ChampionScreen({ params }: { params: Record<string, any> }) {
  const save = useSave();
  const m = params.moment as Moment | undefined;
  const me = save.teams[save.userTeamId];
  const confetti = useRef<HTMLCanvasElement>(null);
  const cup = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (m) touch(s => markTip(s, m.id));
    sfx.fanfare(); sfx.cheer(true); setCrowd(100);
    const again = setTimeout(() => { sfx.fanfare(); sfx.cheer(true); }, 1400);
    // the cup
    const cg = cup.current!.getContext('2d')!;
    CUP.forEach((row, y) => row.forEach(([x, w, c]) => { cg.fillStyle = CUP_COL[c]; cg.fillRect(x, y, w, 1); }));
    // confetti in the team's colours, falling for as long as the screen is up
    const c = confetti.current!, g = c.getContext('2d')!;
    const W = 120, H = 220;
    c.width = W; c.height = H;
    const cols = [me.colors.primary, me.colors.secondary, '#ffd23c', '#ffffff'];
    const bits = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: -Math.random() * H, vy: 22 + Math.random() * 38, sway: Math.random() * 6.28, col: cols[Math.floor(Math.random() * cols.length)], w: Math.random() < 0.5 ? 2 : 1 }));
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      g.clearRect(0, 0, W, H);
      for (const b of bits) {
        b.y += b.vy * dt; b.sway += dt * 3;
        if (b.y > H) { b.y = -4; b.x = Math.random() * W; }
        g.fillStyle = b.col;
        g.fillRect(Math.round(b.x + Math.sin(b.sway) * 3), Math.round(b.y), b.w, 2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(again); stopCrowd(); };
  }, []);

  const po = save.playoffs;
  const run = (po?.series ?? []).filter(s => s.winnerId === me.id).sort((a, b) => a.round - b.round).map(s => {
    const g = save.schedule.find(x => x.id === s.gameId);
    const opp = save.teams[s.highId === me.id ? s.lowId : s.highId];
    const mine = g ? (g.homeId === me.id ? g.homeScore : g.awayScore) : undefined, theirs = g ? (g.homeId === me.id ? g.awayScore : g.homeScore) : undefined;
    // a series is told by its games won; a one-off by its score
    const w = s.highId === me.id ? s.highW : s.lowW, l = s.highId === me.id ? s.lowW : s.highW;
    return { round: ROUND_NAMES[s.round], opp: opp.name, score: w + l > 1 ? `${w}-${l} in games` : mine != null && theirs != null ? `${mine}-${theirs}` : '' };
  });
  const hist = save.history.find(h => h.year === save.year);
  const fmvp = hist?.awards.find(a => a.award === 'Finals MVP');
  const hero = fmvp ? save.players[fmvp.playerId] : null;
  const nth = me.titles.length;

  return (
    <div class="screen champ" style={{ '--c1': me.colors.primary, '--c2': me.colors.secondary } as any}>
      <canvas class="champ-confetti" ref={confetti} />
      <div class="body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div class="champ-year">SEASON {save.year}</div>
        <canvas class="champ-cup" ref={cup} width={22} height={24} />
        <div class="champ-title">CHAMPIONS!</div>
        <div class="champ-team">{fullName(me).toUpperCase()}</div>
        <div class="dim">{recordStr(me)} in the regular season{nth > 1 ? ` · title number ${nth}` : ' · your first title with the club'}</div>
        <Panel title="THE RUN" class="champ-panel">
          <div class="list">
            {run.map(r => <div class="item" style={{ minHeight: 0 }}><span class="grow" style={{ textAlign: 'left' }}>{r.round}<br /><span class="dim">beat the {r.opp}</span></span><span class="head gold">{r.score}</span></div>)}
          </div>
        </Panel>
        {fmvp && hero && (
          <Panel title="FINALS MVP" class="champ-panel">
            <div class="row tap" onClick={() => nav('player', { id: hero.id })}>
              <Sprite player={hero} team={me} scale={2} />
              <div class="grow" style={{ textAlign: 'left' }}><div class="gold">{hero.name}</div><div class="dim">{fmvp.line}</div></div>
            </div>
          </Panel>
        )}
        <Panel title="WHAT IT BRINGS" class="champ-panel">
          <div class="list">
            <div class="item" style={{ minHeight: 0 }}><span class="grow" style={{ textAlign: 'left' }}>Championship bonus</span><span class="gold">◉ +15</span></div>
            <div class="item" style={{ minHeight: 0 }}><span class="grow" style={{ textAlign: 'left' }}>A banner in the rafters</span><span class="gold">{'▮'.repeat(Math.min(8, nth))}</span></div>
            <div class="item" style={{ minHeight: 0 }}><span class="grow" style={{ textAlign: 'left' }}>Owner, fans and your reputation</span><span class="good">WAY UP</span></div>
          </div>
        </Panel>
      </div>
      <div class="footer"><Btn kind="primary big" class="grow" onClick={() => reset('hub')}>On to the offseason</Btn></div>
    </div>
  );
}
