// Camp shootaround: a quick drill on the real court. One of your players gets five open looks,
// and every one he makes is XP in his pocket.
import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { CAMP_SHOTS, campDrillXp, finishCampDrill } from '../core/offseason/offseason';
import { courtStyle, perk } from '../core/org/progress';
import type { Player, Save } from '../core/types';
import { Arcade } from '../game/arcade';
import { VIEW_H } from '../game/render';
import { act } from '../state/store';
import { Btn } from './kit';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const lastName = (p: Player): string => p.name.split(' ').pop() ?? p.name;

export function CampDrill({ save, playerId, onClose }: { save: Save; playerId: number; onClose: () => void }) {
  const me = save.teams[save.userTeamId];
  const opp = save.teams[(save.userTeamId + 1) % save.teams.length];
  const shooter = save.players[playerId];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const arcade = useRef<Arcade | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<'brief' | 'play' | 'done'>('brief');
  const [marks, setMarks] = useState<boolean[]>([]);
  const [result, setResult] = useState<{ xp: number; levels: number } | null>(null);

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
    arcade.current = new Arcade(canvas.current!, { paint: me.colors.primary, accent: me.colors.secondary, banners: me.titles.length, crowdA: me.colors.primary, crowdB: me.colors.secondary, wood: courtStyle(save) });
    return () => { alive.current = false; ro.disconnect(); arcade.current?.destroy(); };
  }, []);

  // the shooter and four teammates: his own position's starter steps aside for him
  const five = me.lineup.map(id => save.players[id]).filter((p): p is Player => !!p);
  if (!five.some(p => p.id === playerId)) {
    const i = five.findIndex(p => p.pos === shooter.pos);
    five[i >= 0 ? i : five.length - 1] = shooter;
  }
  // the open look goes to the best shooter on the floor, so for this drill the others cannot shoot a lick
  const offense = five.map(p => (p.id === playerId ? p : { ...p, ratings: { ...p.ratings, sht: 1 } }));
  const defense = opp.lineup.map(id => save.players[id]).filter((p): p is Player => !!p);

  const run = async () => {
    setState('play');
    const got: boolean[] = [];
    for (let k = 0; k < CAMP_SHOTS; k++) {
      const r = await arcade.current!.play({
        poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: offense.map(p => p.id), defense: defense.map(p => p.id), clutch: false, lastShot: false, crowd: 40 },
        offense, defense, offColors: me.colors, defColors: opp.colors,
        ocStars: me.staff.oc?.stars ?? 0, difficulty: save.settings.difficulty,
        perks: { shooting: perk(save, 'shooting'), handles: perk(save, 'handles'), passing: perk(save, 'passing'), rim: perk(save, 'rim') },
        scenario: 'open',
      });
      if (!alive.current) return;
      const ok = r.shots.some(sh => sh.by === playerId && sh.made);
      got.push(ok);
      setMarks(got.slice());
      await sleep(350);
      if (!alive.current) return;
    }
    const makes = got.filter(Boolean).length;
    const res = act(sv => finishCampDrill(sv, playerId, makes));
    setResult(res);
    setState('done');
    if (res.levels > 0) sfx.fanfare(); else if (makes >= 3) sfx.good(); else sfx.bad();
  };

  const makes = marks.filter(Boolean).length;
  return (
    <div class="game ox-drill">
      <div class="scorebar">
        <div class="side"><span>{lastName(shooter).toUpperCase()}</span></div>
        <div class="mid">CAMP SHOOTAROUND<b>{state === 'done' ? `${makes} / ${CAMP_SHOTS}` : `${Math.min(CAMP_SHOTS, marks.length + 1)} / ${CAMP_SHOTS}`}</b></div>
        <div class="side r"><span class="pts">{makes}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} />
        {state === 'brief' && (
          <div class="overlay dimmed">
            <div class="bigcall">SHOOTAROUND</div>
            <div class="panel col" style={{ maxWidth: '330px', fontSize: '20px', textAlign: 'left', gap: '6px' }}>
              <div>{shooter.name} gets <span class="gold">{CAMP_SHOTS} open looks</span>. His man is closing out and the shot clock is short.</div>
              <div>Hold the <span class="gold">SHOOT</span> button and let go when the crosshair is on the rim.</div>
              <div class="dim" style={{ fontSize: '17px' }}>Only his baskets count. 12 XP a make, {campDrillXp(CAMP_SHOTS) - 12 * CAMP_SHOTS} more for a perfect five.</div>
            </div>
            <Btn kind="primary big" onClick={() => { void run(); }}>Start</Btn>
          </div>
        )}
        {state === 'done' && result && (
          <div class="overlay dimmed">
            <div class="bigcall" style={{ color: makes >= 4 ? 'var(--good)' : makes >= 2 ? 'var(--gold)' : 'var(--bad)' }}>{makes} OF {CAMP_SHOTS}</div>
            <div class="panel col" style={{ maxWidth: '330px', fontSize: '20px', gap: '6px' }}>
              <div>{makes === CAMP_SHOTS ? 'Perfect. The gym went quiet.' : makes >= 4 ? 'He could not miss.' : makes >= 2 ? 'A solid morning.' : 'One to forget.'}</div>
              <div class="gold">{result.xp > 0 ? `${shooter.name} +${result.xp} XP` : 'No XP this time.'}</div>
              {result.levels > 0 && <div class="head gold">LEVEL UP! SPEND THE POINT ON HIS PAGE.</div>}
            </div>
            <Btn kind="primary big" onClick={onClose}>Done</Btn>
          </div>
        )}
      </div>
      <div class="ticker">
        <div class="ox-marks">
          {Array.from({ length: CAMP_SHOTS }, (_, i) => <i class={i < marks.length ? (marks[i] ? 'hit' : 'miss') : i === marks.length && state === 'play' ? 'now' : ''} />)}
        </div>
        <div class="lines"><div class="dim" style={{ whiteSpace: 'normal' }}>Drag: move · Hold SHOOT, let go on the rim</div></div>
      </div>
    </div>
  );
}
