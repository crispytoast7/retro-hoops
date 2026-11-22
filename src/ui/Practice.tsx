// Hands-on tutorial for the on-court controls: nine short drills against a passive defense.
// A new coach must finish it before his first game; after that it is optional practice.
import { useEffect, useRef, useState } from 'preact/hooks';
import { VIEW_H } from '../game/render';
import { Arcade, ArcadeResult, Guide, Phase, Scenario } from '../game/arcade';
import { courtStyle, markTip, prog, tutorialNeeded } from '../core/org/progress';
import { sfx } from '../audio/sfx';
import { DESKTOP, setTutorialDone } from '../state/device';
import { getSave, touch } from '../state/store';
import { Btn } from './kit';
import { back, reset } from './router';

interface Drill {
  title: string;
  /** One short sentence shown before the drill starts. */
  brief: string;
  /** One optional small line under it. */
  hint?: string;
  /** The same lesson for a computer: keys and mouse in place of fingers. Anything left out is shared. */
  pc?: { brief?: string; hint?: string; say?: Partial<Record<Phase, string>> & { live: string }; retry?: string | ((r: ArcadeResult) => string) };
  /** What to do, shown on the court while playing. Keyed by possession phase where it changes. */
  say: Partial<Record<Phase, string>> & { live: string };
  guide: Guide;
  scenario?: Scenario;
  done: (r: ArcadeResult) => boolean;
  retry: string | ((r: ArcadeResult) => string);
}
const shot = (r: ArcadeResult) => r.outcome.events.find(e => e.t === 'shot') as { type: string; made: boolean } | undefined;
const ftMade = (r: ArcadeResult) => (r.outcome.events.find(e => e.t === 'ft') as { made: number } | undefined)?.made ?? 0;
export const DRILLS: Drill[] = [
  { title: 'MOVE', brief: 'Drag anywhere on the court. Your player follows.', pc: { brief: 'Move with WASD or the arrow keys.', hint: 'Dragging with the mouse works too.', say: { live: 'WASD or ARROWS: go to the yellow spot' }, retry: 'Hold the keys until he reaches the yellow spot.' },
    say: { live: 'DRAG to the yellow spot' }, guide: { target: { x: 62, y: 150 }, demo: 'drag' },
    done: r => r.reached, retry: 'Keep your finger down and drag toward the yellow spot.' },
  { title: 'SHOOT', brief: 'Hold SHOOT. Let go when the crosshair is on the rim.', hint: 'Green is a swish. Gold is good.', pc: { brief: 'Hold SPACE. Let go when the crosshair is on the rim.', say: { live: 'HOLD SPACE', charge: 'LET GO when the crosshair is on the rim', shot: 'Green crosshair = swish' },
      retry: r => (shot(r) ? 'Let go a little sooner or later: only when the crosshair is ON the rim.' : 'Hold SPACE until the crosshair is on the rim, then let go.') },
    say: { live: 'HOLD the SHOOT button', charge: 'LET GO when the crosshair is on the rim', shot: 'Green crosshair = swish' }, guide: { demo: 'hold' },
    done: r => { const s = shot(r); return !!s && (s.type === 'three' || s.type === 'mid') && r.quality >= 2; },
    retry: r => (shot(r) ? 'Let go a little sooner or later: only when the crosshair is ON the rim.' : 'Hold SHOOT until the crosshair is on the rim, then let go.') },
  { title: 'SHOT CLOCK', brief: 'You have 24 seconds to shoot. The clock is above the basket.', hint: 'It also drains around the SHOOT button. Zero means you lose the ball.',
    pc: { hint: 'It also drains around the SHOOT button. Zero means you lose the ball.' },
    say: { live: 'Watch the clock above the basket. SHOOT before zero.', charge: 'LET GO when the crosshair is on the rim' }, guide: { clock: 12 },
    done: r => !!shot(r) && !r.highlights.includes('tov'),
    retry: r => (r.highlights.includes('tov') ? 'The clock above the basket hit zero, so you lost the ball. Shoot before it does.' : 'Take a shot before the clock above the basket hits zero.') },
  { title: 'NO SHOT', brief: 'Changed your mind? Slide your finger off SHOOT, then let go.', pc: { brief: 'Changed your mind? Keep SPACE down and press ESC.', say: { live: 'HOLD SPACE, then press ESC', charge: 'Press ESC before you let go of SPACE' }, retry: 'You let go of SPACE, so he shot. Press ESC first.' },
    say: { live: 'HOLD SHOOT, then SLIDE OFF it', charge: 'SLIDE your finger OFF the button' }, guide: { demo: 'slide', endOnCancel: true },
    done: r => r.cancels > 0, retry: 'You let go on the button, so he shot. Slide off it first, then let go.' },
  { title: 'PUMP FAKE', brief: 'Tap SHOOT. Your defender jumps. Then shoot.', hint: 'A quick tap, not a hold.', pc: { brief: 'Tap SPACE. Your defender jumps. Then shoot.', say: { live: 'TAP SPACE. He jumps. Then HOLD SPACE.', charge: 'LET GO when the crosshair is on the rim' }, retry: 'That was a hold, so he shot. Tap SPACE quickly first. When he jumps, hold it and shoot.' },
    say: { live: 'TAP SHOOT. He jumps. Then HOLD SHOOT.', charge: 'LET GO when the crosshair is on the rim' }, guide: { tight: true, demo: 'faketap' },
    done: r => r.highlights.includes('fake'), retry: 'That was a hold, so he shot. Tap SHOOT quickly first. When he jumps, hold it and shoot.' },
  { title: 'PASS', brief: 'Tap a teammate. He gets the ball.', pc: { brief: 'Press a teammate\'s number, 1 to 4. He gets the ball.', hint: 'Clicking him works too.', say: { live: 'Press the NUMBER of the teammate with the yellow ring', pass: 'The ball is on its way' }, retry: 'Press the number shown above the teammate with the ring.' },
    say: { live: 'TAP the teammate with the yellow ring', pass: 'The ball is on its way' }, guide: { mate: 1, demo: 'tap', endOnCatch: true },
    done: r => r.passes > 0, retry: 'Tap right on the teammate with the ring.' },
  { title: 'DRIVE', brief: 'Drag to the basket and keep going. He scores at the rim by himself.',
    pc: { brief: 'Run at the basket and keep going. He scores at the rim by himself.', say: { live: 'Hold W or UP toward the basket', finish: 'He finishes by himself' }, retry: 'Do not shoot. Keep running at the rim until he jumps.' },
    say: { live: 'DRAG toward the basket and keep going', finish: 'He finishes by himself' }, guide: { demo: 'drag' },
    done: r => { const s = shot(r); return !!s && (s.type === 'layup' || s.type === 'dunk'); }, retry: 'Do not shoot. Keep dragging toward the rim until he jumps.' },
  { title: 'CROSSOVER', brief: 'Defender in your way? Flick sideways. Then score.', hint: 'A flick is a short, fast swipe.', pc: { brief: 'Defender in your way? Hold A or D and press SHIFT. Then score.', hint: 'The move goes the way you are moving.', say: { live: 'Hold A or D, press SHIFT. Then score.', charge: 'LET GO when the crosshair is on the rim' },
      retry: r => (r.beats > 0 ? 'Good move. Now finish: run to the rim or hold SPACE.' : 'Hold A or D first, then press SHIFT while your defender is right in front of you.') },
    say: { live: 'FLICK sideways past him. Then score.', charge: 'LET GO when the crosshair is on the rim' }, guide: { tight: true, demo: 'flick' },
    done: r => r.beats > 0 && !!shot(r),
    retry: r => (r.beats > 0 ? 'Good move. Now finish: drive to the rim or hold SHOOT.' : r.moves > 0 ? 'Do it right next to your defender, so the move beats him.' : 'A flick is a quick swipe and release, not a slow drag.') },
  { title: 'FREE THROWS', brief: 'Fouled? Two shots. Hold SHOOT, let go on the rim.', hint: 'A quick tap does nothing here.', pc: { brief: 'Fouled? Two shots. Hold SPACE, let go on the rim.', say: { live: 'HOLD SPACE, let go on the rim', charge: 'LET GO when the crosshair is on the rim' } },
    say: { live: 'HOLD SHOOT, let go on the rim', charge: 'LET GO when the crosshair is on the rim' }, guide: { demo: 'hold' }, scenario: 'freethrows',
    done: r => ftMade(r) >= 1, retry: 'Make at least one of the two. Hold, watch the crosshair, let go on the rim.' },
];
/** The drill as this device should read it. */
function forDevice(d: Drill): Drill { return DESKTOP && d.pc ? { ...d, ...d.pc } : d; }
/** Failed tries on one drill before a new coach may move on without passing it. */
const SKIP_AFTER = 3;

export function PracticeScreen(_p: { params: Record<string, any> }) {
  const save = getSave();
  const me = save.teams[save.userTeamId];
  const opp = save.teams[(save.userTeamId + 1) % save.teams.length];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const arcade = useRef<Arcade | null>(null);
  // a new coach has to finish this before anything else; he picks up where he left off
  const required = useRef(tutorialNeeded(save)).current;
  const [step, setStep] = useState(() => { if (!required) return 0; const seen = prog(save).seen; const i = DRILLS.findIndex((_d, k) => !seen.includes(`tut_${k}`)); return i < 0 ? 0 : i; });
  const [state, setState] = useState<'brief' | 'play' | 'retry' | 'done'>('brief');
  const [phase, setPhase] = useState<Phase>('live');
  const [fails, setFails] = useState(0);
  const [why, setWhy] = useState('');
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

  const next = () => {
    if (required) touch(sv => markTip(sv, `tut_${step}`));
    setFails(0);
    if (step + 1 >= DRILLS.length) { touch(sv => markTip(sv, 'practice_done')); setTutorialDone(); setState('done'); }
    else { setStep(step + 1); setState('brief'); }
  };
  const run = async () => {
    setState('play'); setPhase('live');
    const dr = forDevice(DRILLS[step]);
    const r = await arcade.current!.play({
      poss: { quarter: 1, clock: 600, userScore: 0, oppScore: 0, offense: me.lineup, defense: opp.lineup, clutch: false, lastShot: false, crowd: 40 },
      offense: me.lineup.map(id => save.players[id]), defense: opp.lineup.map(id => save.players[id]),
      offColors: me.colors, defColors: opp.colors, ocStars: 0, difficulty: 'easy', practice: true, guide: dr.guide, scenario: dr.scenario, keys: DESKTOP,
    });
    if (!alive.current) return;
    if (dr.done(r)) { sfx.good(); next(); }
    else { sfx.bad(); setWhy(typeof dr.retry === 'string' ? dr.retry : dr.retry(r)); setFails(f => f + 1); setState('retry'); }
  };
  const leave = () => { if (required) reset('hub'); else back(); };
  // on a computer every card answers to Enter or Space (not straight away: Space was just the shoot key)
  const shown = useRef(0);
  useEffect(() => { shown.current = performance.now(); }, [state, step]);
  const act = useRef<() => void>(() => {});
  act.current = () => { if (state === 'done') leave(); else if (state !== 'play') void run(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== 'Enter' && e.key !== ' ') || performance.now() - shown.current < 450) return;
      if (document.querySelector('.modal')) return;
      e.preventDefault(); act.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const d = forDevice(DRILLS[step]);
  const canSkip = state === 'retry' && fails >= (required ? SKIP_AFTER : 1);
  return (
    <div class="game">
      <div class="scorebar">
        <div class="side">{!required && <Btn kind="small" onClick={back}>&lt;</Btn>}</div>
        <div class="mid">{required ? 'TUTORIAL' : 'PRACTICE'}<b>{state === 'done' ? 'DONE' : `${step + 1} / ${DRILLS.length}`}</b></div>
        <div class="side r"><span>{state === 'done' ? '' : d.title}</span></div>
      </div>
      <div class="courtwrap" ref={wrap}>
        <canvas ref={canvas} />
        {state === 'play' && <div class="coachline">{d.say[phase] ?? d.say.live}</div>}
        {state !== 'play' && (
          <div class="overlay dimmed">
            {state === 'done' ? (
              <>
                <div class="bigcall">READY TO PLAY</div>
                <div class="panel tutcard">
                  <div class="tutline"><b class="gold">Real games</b> have a shot clock, and defenders steal.</div>
                  <div class="tutline"><b class="gold">Rebound at the rim?</b> The button says PUT BACK. {DESKTOP ? 'Press SPACE.' : 'Press it.'}</div>
                  <div class="tutline dim">Come back any time: Practice, on your team page.</div>
                </div>
                <Btn kind="primary big" onClick={leave}>{required ? 'Meet my team' : 'Done'}</Btn>
              </>
            ) : (
              <>
                <div class="tutstep">{step + 1} OF {DRILLS.length}</div>
                <div class="bigcall">{d.title}</div>
                <div class="panel tutcard">
                  {state === 'retry' ? <div class="gold">{why}</div> : <div>{d.brief}</div>}
                  {state !== 'retry' && d.hint && <div class="dim tuthint">{d.hint}</div>}
                </div>
                <div class="row">
                  <Btn kind="primary big" onClick={run}>{state === 'retry' ? 'Try again' : 'Try it'}{DESKTOP ? ' (Enter)' : ''}</Btn>
                  {canSkip && <Btn onClick={next}>Skip</Btn>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div class="ticker"><div class="lines"><div style={{ whiteSpace: 'normal' }}>{required ? `${DRILLS.length} quick drills, then your first game.` : 'No shot clock and no steals in practice. Take your time.'}</div></div></div>
    </div>
  );
}
