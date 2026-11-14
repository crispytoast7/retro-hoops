// Hands-on tutorial for the on-court controls: four short drills against a passive defense.
import { useEffect, useRef, useState } from 'preact/hooks';
import { VIEW_H } from '../game/render';
import { Arcade, ArcadeResult, Guide, Phase } from '../game/arcade';
import { courtStyle } from '../core/org/progress';
import { sfx } from '../audio/sfx';
import { markTip } from '../core/org/progress';
import { getSave, touch } from '../state/store';
import { Btn } from './kit';
import { back } from './router';

interface Drill {
  title: string;
  /** One line shown before the drill starts. */
  brief: string;
  /** What to do, shown on the court while playing. Keyed by possession phase where it changes. */
  say: Partial<Record<Phase, string>> & { live: string };
  guide: Guide;
  done: (r: ArcadeResult) => boolean;
  retry: string;
}
const shot = (r: ArcadeResult) => r.outcome.events.find(e => e.t === 'shot') as { type: string; made: boolean } | undefined;
const DRILLS: Drill[] = [
  { title: 'MOVE', brief: 'Put a finger on the court (not on your player) and drag. The player with the yellow ring follows.',
    say: { live: 'DRAG on the court toward the yellow spot' }, guide: { target: { x: 62, y: 150 }, demo: 'drag' },
    done: r => r.reached, retry: 'Start your drag on empty court and keep your finger down until he reaches the yellow spot.' },
  { title: 'SHOOT', brief: 'Touch YOUR PLAYER and pull back, away from the basket, like a slingshot. An arc shows where the ball will go. A crosshair drifts around the rim: let go when it is over the rim.',
    say: { live: 'TOUCH your player and PULL BACK from the basket', charge: 'LET GO when the crosshair is over the rim (green)', shot: 'Green crosshair = swish' }, guide: { demo: 'hold' },
    done: r => { const s = shot(r); return !!s && (s.type === 'three' || s.type === 'mid') && r.quality >= 2; }, retry: 'Pull back until the arc reaches the basket, wait for the crosshair to turn green or gold, then let go.' },
  { title: 'PASS', brief: 'Tap a teammate to pass him the ball. You then control him.',
    say: { live: 'TAP the teammate with the yellow ring', pass: 'The ball is on its way' }, guide: { mate: 1, demo: 'tap', endOnCatch: true },
    done: r => r.passes > 0, retry: 'Tap right on the teammate with the ring.' },
  { title: 'AIM A PASS', brief: 'You can also aim a pass like a shot: touch your player and pull back, away from a teammate. A ring lights up on him. Aim into open space and the nearest teammate runs onto it.',
    say: { live: 'TOUCH your player, PULL BACK away from a teammate, let go', charge: 'A green ring means he is the target. LET GO.', pass: 'Then pull back toward the basket to shoot' }, guide: { mate: 2 },
    done: r => r.passes > 0 && !!shot(r), retry: 'Pull back in the opposite direction from the teammate you want, release, then take a shot.' },
  { title: 'DRIVE', brief: 'Dribble all the way to the basket. Close to the rim he lays it in or dunks by himself.',
    say: { live: 'DRAG toward the basket and keep going', finish: 'He finishes at the rim by himself' }, guide: { demo: 'drag' },
    done: r => { const s = shot(r); return !!s && (s.type === 'layup' || s.type === 'dunk'); }, retry: 'Keep dragging toward the rim until he jumps.' },
  { title: 'CROSSOVER', brief: 'A defender in your way? Flick your finger on the court: a short, fast swipe. A good ball-handler leaves him standing. Flick away from the basket for a step-back.',
    say: { live: 'Get near your defender, then FLICK sideways. Then score.' }, guide: { demo: 'flick' },
    done: r => r.moves > 0 && !!shot(r), retry: 'A flick is a quick swipe and release, not a slow drag. Then go and score.' },
];

export function PracticeScreen(_p: { params: Record<string, any> }) {
  const save = getSave();
  const me = save.teams[save.userTeamId];
  const opp = save.teams[(save.userTeamId + 1) % save.teams.length];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const arcade = useRef<Arcade | null>(null);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<'brief' | 'play' | 'retry' | 'done'>('brief');
  const [phase, setPhase] = useState<Phase>('live');
  const alive = useRef(true);

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
    arcade.current.onPhase = ph => { if (alive.current) setPhase(ph); };
    return () => { alive.current = false; ro.disconnect(); arcade.current?.destroy(); };
  }, []);

  const run = async () => {
    setState('play');
    const r = await arcade.current!.play({
      poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: me.lineup, defense: opp.lineup, clutch: false, lastShot: false, crowd: 40 },
      offense: me.lineup.map(id => save.players[id]), defense: opp.lineup.map(id => save.players[id]),
      offColors: me.colors, defColors: opp.colors, ocStars: 0, difficulty: 'easy', practice: true, guide: DRILLS[step].guide,
    });
    if (!alive.current) return;
    if (DRILLS[step].done(r)) { sfx.good(); if (step + 1 >= DRILLS.length) { touch(sv => markTip(sv, 'practice_done')); setState('done'); } else { setStep(step + 1); setState('brief'); } }
    else { sfx.bad(); setState('retry'); }
  };
  const d = DRILLS[step];
  return (
    <div class="game">
      <div class="scorebar">
        <div class="side"><Btn kind="small" onClick={back}>&lt;</Btn></div>
        <div class="mid">PRACTICE<b>{state === 'done' ? 'DONE' : `${step + 1} / ${DRILLS.length}`}</b></div>
        <div class="side r"><span>{d.title}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} />
        {state === 'play' && <div class="coachline">{d.say[phase] ?? d.say.live}</div>}
        {state !== 'play' && (
          <div class="overlay dimmed">
            {state === 'done' ? (
              <>
                <div class="bigcall">READY TO PLAY</div>
                <div class="panel" style={{ maxWidth: '330px', fontSize: '19px', textAlign: 'left' }}>
                  <div>In real games there is a shot clock, defenders reach for the ball, and passes can be picked off.</div>
                  <div class="dim" style={{ marginTop: '6px' }}>Missed shots can be rebounded by your big men for a second chance.</div>
                </div>
                <Btn kind="primary big" onClick={back}>Done</Btn>
              </>
            ) : (
              <>
                <div class="bigcall">{d.title}</div>
                <div class="panel col" style={{ maxWidth: '330px', fontSize: '21px', textAlign: 'left', gap: '6px' }}>
                  {state === 'retry' ? <div class="gold">{d.retry}</div> : <div>{d.brief}</div>}
                  <div class="dim" style={{ fontSize: '17px' }}>A hand on the court will show you the motion.</div>
                </div>
                <div class="row"><Btn kind="primary big" onClick={run}>{state === 'retry' ? 'Try again' : 'Try it'}</Btn>{state === 'retry' && <Btn onClick={() => { if (step + 1 >= DRILLS.length) setState('done'); else { setStep(step + 1); setState('brief'); } }}>Skip</Btn>}</div>
              </>
            )}
          </div>
        )}
      </div>
      <div class="ticker"><div class="lines"><div style={{ whiteSpace: 'normal' }}>No shot clock and no steals in practice. Take your time.</div></div></div>
    </div>
  );
}
