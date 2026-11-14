// Hands-on tutorial for the on-court controls: four short drills against a passive defense.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Arcade, ArcadeResult } from '../game/arcade';
import { courtStyle } from '../core/org/progress';
import { sfx } from '../audio/sfx';
import { getSave } from '../state/store';
import { Btn } from './kit';
import { back } from './router';

interface Drill { title: string; how: string[]; done: (r: ArcadeResult) => boolean; retry: string }
const shot = (r: ArcadeResult) => r.outcome.events.find(e => e.t === 'shot') as { type: string; made: boolean } | undefined;
const DRILLS: Drill[] = [
  { title: 'SHOOT', how: ['Press and HOLD STILL anywhere on the court. A meter rises next to your player.', 'RELEASE when the marker is in the GREEN zone.', 'Better shooters get a bigger green zone. Defenders shrink it.'],
    done: r => { const s = shot(r); return !!s && (s.type === 'three' || s.type === 'mid') && (s.made || r.highlights.includes('perfect')); }, retry: 'Hold still, then let go in the green. Try again.' },
  { title: 'DRIBBLE & DRIVE', how: ['DRAG in any direction to dribble. Drag further to go faster.', 'Drive all the way to the RIM. With a lane open, your player lays it in or dunks by himself.', 'Stay inside the lines.'],
    done: r => { const s = shot(r); return !!s && (s.type === 'layup' || s.type === 'dunk'); }, retry: 'Keep dragging toward the basket until he goes up. Try again.' },
  { title: 'PASS', how: ['TAP a teammate to pass to him. A green label means he is open.', 'In real games a defender standing in the passing lane can pick it off.', 'Pass, then shoot or drive with the new player.'],
    done: r => r.passes > 0 && !!shot(r), retry: 'Tap a teammate first, then take a shot. Try again.' },
  { title: 'CROSSOVER', how: ['Next to your defender, FLICK quickly in any direction: a short, fast swipe.', 'A good ball-handler freezes his man and gets a free lane. A poor one can lose the ball.', 'Flick past your defender, then score.'],
    done: r => r.moves > 0 && !!shot(r), retry: 'Make a short, quick swipe near the defender, then go score. Try again.' },
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
  const alive = useRef(true);

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
    arcade.current = new Arcade(canvas.current!, { paint: me.colors.primary, accent: me.colors.secondary, banners: me.titles.length, crowdA: me.colors.primary, crowdB: me.colors.secondary, wood: courtStyle(save) });
    return () => { alive.current = false; ro.disconnect(); arcade.current?.destroy(); };
  }, []);

  const run = async () => {
    setState('play');
    const r = await arcade.current!.play({
      poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: me.lineup, defense: opp.lineup, clutch: false, lastShot: false, crowd: 40 },
      offense: me.lineup.map(id => save.players[id]), defense: opp.lineup.map(id => save.players[id]),
      offColors: me.colors, defColors: opp.colors, ocStars: 0, difficulty: 'easy', practice: true,
    });
    if (!alive.current) return;
    if (DRILLS[step].done(r)) { sfx.good(); if (step + 1 >= DRILLS.length) setState('done'); else { setStep(step + 1); setState('brief'); } }
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
                <div class="panel col" style={{ maxWidth: '330px', fontSize: '19px', textAlign: 'left', gap: '6px' }}>
                  {state === 'retry' && <div class="bad">{d.retry}</div>}
                  {d.how.map(h => <div>{h}</div>)}
                </div>
                <div class="row"><Btn kind="primary big" onClick={run}>{state === 'retry' ? 'Try again' : 'Go'}</Btn>{state === 'retry' && <Btn onClick={() => { if (step + 1 >= DRILLS.length) setState('done'); else { setStep(step + 1); setState('brief'); } }}>Skip</Btn>}</div>
              </>
            )}
          </div>
        )}
      </div>
      <div class="ticker"><div class="lines"><div style={{ whiteSpace: 'normal' }}>{state === 'play' ? d.how[0] : 'No shot clock and no steals in practice. Take your time.'}</div></div></div>
    </div>
  );
}
