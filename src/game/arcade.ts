// The hand-played possession: input, movement, defender AI, pull-back aiming, passes, drives,
// rebounds. Reads player ratings, returns a list of PlayEvents for the sim to score.
import type { Difficulty, Player } from '../core/types';
import type { PlayEvent, ShotType, UserPossessionOutcome, UserPossessionSetup } from '../core/sim/api';
import { STAR_OVR } from '../core/org/xp';
import { ovr } from '../core/ratings';
import { POSITIONS } from '../core/types';
import { sfx } from '../audio/sfx';
import { drawText } from './font';
import {
  BASE_Y, H, HOOP, PAL, RIM_Z, SIDE_L, SIDE_R, TOP, VIEW_H, W, drawBall, drawCrowd, drawHoop, drawPlayer, isThree, makeCourt, spriteHeight,
} from './render';
import type { Pose } from './render';

export interface ArcadeSetup {
  poss: UserPossessionSetup;
  offense: Player[];
  defense: Player[];
  offColors: { primary: string; secondary: string };
  defColors: { primary: string; secondary: string };
  ocStars: number;
  difficulty: Difficulty;
  /** Coach perk ranks that change how possessions play. */
  perks?: { shooting?: number; handles?: number; passing?: number; rim?: number };
  /** Practice mode: no shot clock, no steals or interceptions, slower defenders. */
  practice?: boolean;
  /** Tutorial aids drawn on the court. */
  guide?: Guide;
  scenario?: Scenario;
  /** Consecutive makes this game by player id: hot hands aim steadier and draw a double team. */
  hot?: Record<number, number>;
  /** Adaptive difficulty, 1 = baseline. Higher: wilder crosshair, quicker hands, faster closeouts. */
  challenge?: number;
}
/** The situation a key moment starts from. */
export type Scenario = 'halfcourt' | 'fastbreak' | 'pnr' | 'post' | 'iso' | 'open' | 'lateclock' | 'freethrows';
export const SCENARIOS: Record<Scenario, { name: string; hint: string }> = {
  halfcourt: { name: 'HALF COURT', hint: 'Run the offense. Find the open man.' },
  fastbreak: { name: 'FAST BREAK', hint: 'Numbers! Push it before the defense gets back.' },
  pnr: { name: 'PICK AND ROLL', hint: 'Use the screen, then hit the roller or pull up.' },
  post: { name: 'POST UP', hint: 'Your big man has it on the block. Score or kick it out.' },
  iso: { name: 'ISOLATION', hint: 'Clear out. Your star, one on one.' },
  open: { name: 'OPEN LOOK', hint: 'He is open. Shoot it before the defender arrives.' },
  lateclock: { name: 'SHOT CLOCK DOWN', hint: 'Seven seconds. Make something happen.' },
  freethrows: { name: 'AT THE LINE', hint: 'Two shots. Hold, then let go when the crosshair is on the rim.' },
};
export interface Guide {
  /** A spot to dribble to; the possession ends when the ball-handler gets there. */
  target?: { x: number; y: number };
  /** Teammate (lineup slot 1-4) to highlight as the pass target. */
  mate?: number;
  /** End the possession as soon as a pass is caught. */
  endOnCatch?: boolean;
  /** Animated finger showing the gesture. */
  demo?: 'hold' | 'drag' | 'tap' | 'flick' | 'faketap';
  /** Practice only: his defender stands right on him (for the pump-fake drill). */
  tight?: boolean;
}
export interface ArcadeResult {
  outcome: UserPossessionOutcome;
  /** Great plays for credits and crowd: 'dunk' 'three' 'perfect' 'buzzer' 'andone' 'ankles' 'oreb' */
  highlights: string[];
  points: number;
  passes: number;
  moves: number;
  /** Reached the tutorial target spot. */
  reached: boolean;
  /** Field goals in this moment, in order: who shot and whether it went in. */
  shots: { by: number; made: boolean }[];
  /** Timing of the last jump shot: 3 perfect, 2 good, 1 early/late, 0 way off, -1 none taken. */
  quality: number;
}
export interface ArcadeTheme { paint: string; accent: string; banners: number; crowdA: string; crowdB: string; wood?: { wood: string; wood2: string; grain: string } }

// ---- tuning -------------------------------------------------------------------------
/** Game-clock seconds per real second. */
const TIME_SCALE = 1.6;
const DIFF: Record<Difficulty, { aim: number; lag: number; steal: number; dspd: number; make: number; move: number }> = {
  easy:   { aim: 0.78, lag: 0.30, steal: 0.6, dspd: 0.93, make: 0.04, move: 0.1 },
  normal: { aim: 1.0, lag: 0.20, steal: 1.0, dspd: 1.0, make: 0, move: 0 },
  hard:   { aim: 1.25, lag: 0.13, steal: 1.3, dspd: 1.05, make: -0.03, move: -0.08 },
};
// Pull-back aiming: touch your player, drag away from the target, release.
const AIM_TOUCH = 15;     // how near the ball-handler a touch must start (a touch anywhere else moves him)
const AIM_MIN = 8;        // px of pull before an aim counts
const AIM_GAIN = 3.3;     // court px thrown per px pulled
const SNAP_HOOP = 24;     // an aim this close to the rim is a shot
const SNAP_MATE = 18;     // an aim this close to a teammate is a pass to him
const SHOT_CONE = 0.82;   // cos 35deg: a pull this well lined up with the hoop is a shot, however long it is
const MATE_CONE = 0.92;   // cos 23deg: a pull lined up with a teammate is the start of a pass
const LEAD_REACH = 26;    // a pass to a spot needs a teammate who will be this close to it
const AIM_QUICK = 0.18;   // a flick off your player this fast is a move, not a shot
const PUTBACK_RANGE = 42;  // an offensive board this close to the rim can go straight back up
const PUTBACK_TIME = 0.9;   // seconds (real time) the chance stays open
const AIM_HOLD = 0.22;     // the SHOOT button has to be held this long: a tap is not a shot
const AMP_FLOOR = 9.5;     // the crosshair never swings less than this, so letting go blind is a bad bet for anyone
const FT_HOLD = 0.3;      // a free throw has to be held this long: a tap does not shoot
const R_SWISH = 3.0;      // reticle this close to the rim's centre: nothing but net
const R_RIM = 7.2;        // inside this it may roll in
const R_IRON = 11.5;      // inside this it hits iron; beyond is an airball
const AIM_SLOW = 0.32;    // time slows while you aim...
const AIM_SLOW_T = 1.5;   // ...for this many real seconds
const DRAG_START = 6;         // px before a press becomes a drag
const SWIPE_TIME = 0.24;      // a drag shorter than this, released, is a handles move
const SWIPE_DIST = 16;
const STICK_MAX = 22;         // px of drag for full speed
const MATE_PICK_R = 18;
/** The on-screen shoot button: hold it to aim, let go to shoot. It works from anywhere, corners included. */
const BTN = { x: W - 27, y: H - 27, r: 21 };
const RIM_ZONE = 25;          // auto layup/dunk distance
const BODY = 7;               // handler/defender collision distance

// Named places on the floor the offense uses.
const SLOT = {
  TOP: [120, 165], LS: [70, 160], RS: [170, 160], LW: [38, 120], RW: [202, 120], LC: [18, 46], RC: [222, 46],
  LE: [92, 100], RE: [148, 100], HP: [120, 112], LB: [96, 64], RB: [144, 64], DL: [100, 52], DR: [140, 52],
} as const;
type SlotName = keyof typeof SLOT;
const PERIMETER: SlotName[] = ['TOP', 'LS', 'RS', 'LW', 'RW', 'LC', 'RC'];
const INSIDE: SlotName[] = ['LB', 'RB', 'LE', 'RE', 'HP'];
const PAINT_L = 84, PAINT_R = 156;
/** Starting alignments, by lineup slot PG, SG, SF, PF, C. One is picked each possession. */
const SETS: SlotName[][] = [
  ['TOP', 'RW', 'LW', 'RC', 'LC'],   // five out
  ['TOP', 'RW', 'LW', 'RC', 'LB'],   // four out, one in
  ['TOP', 'RC', 'LC', 'RE', 'LE'],   // horns
  ['RS', 'RC', 'LW', 'HP', 'RB'],    // triangle, right side
  ['LS', 'LW', 'LC', 'HP', 'LB'],    // triangle, left side
  ['TOP', 'RB', 'LB', 'RE', 'LE'],   // box: wings start inside and pop out
  ['TOP', 'RC', 'LC', 'LW', 'HP'],   // spread, big at the high post
  ['RS', 'LS', 'LC', 'RC', 'RB'],    // two-guard front
];
/** A leg of an off-ball route. */
interface Leg { x: number; y: number; speed: number; hold?: number; screen?: boolean }
const CALLS = {
  move: ['ANKLES!', 'SHOOK!', 'CROSSED UP!', 'SEE YA!'],
  swish: ['SWISH!', 'SPLASH!', 'NOTHING BUT NET!', 'WET!'],
  made: ['BUCKET!', 'GOT IT!', 'COUNT IT!', 'MONEY!'],
  three: ['FROM DEEP!', 'BANG!', 'THREE!', 'DOWNTOWN!'],
  dunk: ['SLAM!', 'THROWDOWN!', 'BOOM!', 'POSTER!'],
  layup: ['LAYUP!', 'TWO!', 'EASY!', 'FINGER ROLL!'],
  miss: ['CLANK!', 'NO GOOD', 'RIMMED OUT', 'OFF THE IRON'],
  air: ['AIRBALL!', 'WAY OFF!', 'NOTHING BUT AIR'],
  glass: ['OFF THE BACKBOARD', 'TOO STRONG!', 'BRICK!'],
  block: ['BLOCKED!', 'REJECTED!', 'SWATTED!'],
  steal: ['STOLEN!', 'PICKED!', 'STRIPPED!'],
  pick: ['INTERCEPTED!', 'PICKED OFF!'],
  board: ['BOARD!', 'SECOND CHANCE!', 'OFFENSIVE BOARD!'],
};
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Ent {
  p: Player; slot: number; off: boolean;
  x: number; y: number; vx: number; vy: number;
  tx: number; ty: number;
  stun: number; slow: number; run: number; face: number;
  armsUp: number; lift: number;
  /** Off-ball: where he lives when idle, the route he is running, and timers. */
  home: SlotName; route: Leg[]; leg: number; holdT: number; screen: number; wait: number; jitter: number;
}
export type Phase = 'idle' | 'live' | 'pass' | 'charge' | 'shot' | 'finish' | 'rebound' | 'over' | 'ftwait';
interface Popup { text: string; color: string; t: number; scale: number; y: number }

export class Arcade {
  private canvas: HTMLCanvasElement;
  private out: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private court: HTMLCanvasElement;
  private theme: ArcadeTheme;
  private raf = 0;
  private last = 0;
  private time = 0;
  private crowd = 50;
  private dead = false;

  // possession state
  private phase: Phase = 'idle';
  private s!: ArcadeSetup;
  private diff = DIFF.normal;
  private off: Ent[] = [];
  private def: Ent[] = [];
  private handler = 0;
  private ball = { x: 0, y: 0, z: 0 };
  private lag = { x: 0, y: 0 };
  private clock = 0;
  private startClock = 0;
  private shotClock = 24;
  private periodEnds = false;
  private events: PlayEvent[] = [];
  private highlights: string[] = [];
  private points = 0;
  private passes = 0;
  private moves = 0;
  private pk = { shooting: 0, handles: 0, passing: 0, rim: 0 };
  private practice = false;
  private guide: Guide | null = null;
  private reached = false;
  private lastQuality = -1;
  private hang = 0;
  private lastPhase: Phase = 'idle';
  /** Called whenever the possession moves to a new phase (for tutorial prompts). */
  onPhase: ((phase: Phase) => void) | null = null;
  private popups: Popup[] = [];
  private shake = 0;
  private netKick = 0;
  private dropping = false;
  private playT = 0;
  private driveReacted = false;
  private scenario: Scenario = 'halfcourt';
  /** Free throws: shots left and made. */
  private ft = { left: 0, made: 0 };
  /** The pass in the air is a lob for a finish at the rim. */
  private lob = false;
  /** Pump fakes thrown this possession (each one fools them less) and the wait before the next. */
  private fakes = 0;
  private fakeCd = 0;
  /** Seconds left to put an offensive rebound straight back up; 0 when there is no chance on. */
  private putback = 0;
  private ftPause = 0;
  private rimShake = 0;
  private rimGlow = 0;
  private sparks: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
  private dropT = 0;
  private flash = 0;
  private resolve: ((r: ArcadeResult) => void) | null = null;
  private overT = 0;
  private grace = 0;
  private dribbleT = 0;
  private assist: { id: number; t: number } | null = null;
  private dash = { t: 0, cd: 0, x: 0, y: 0 };
  // pass
  private pass = { from: 0, to: 0, x0: 0, y0: 0, x1: 0, y1: 0, t: 0, dur: 0, checked: new Set<number>(), stolenBy: -1 };
  // shot
  private aim = { on: false, t: 0, kb: false, ph: 0, kind: 'none' as 'none' | 'shot' | 'pass' | 'lead', mate: -1, tx: 0, ty: 0, wx: 0, wy: 0, amp: 0, armed: false };
  private realDt = 0;
  /** Consecutive makes by each player this game (from earlier key moments). */
  private hot: Record<number, number> = {};
  private doubled = false;
  private chal = 1;
  private shot = { t: 0, dur: 0, x0: 0, y0: 0, made: false, type: 'mid' as ShotType, quality: 0, blockBy: -1, foul: false, pts: 2, text: '', buzzer: false, x1: 0, y1: 0, arc: 30, z0: 30 };
  private reb = { t: 0, dur: 0.6, x0: 0, y0: 0, x1: 0, y1: 0, winner: null as Ent | null };
  private slowmo = 1;
  // input
  /** The finger on the shoot button, tracked apart from the one that moves the player. */
  private btn = { down: false, id: -1 };
  private ptr = { down: false, id: -1, x0: 0, y0: 0, x: 0, y: 0, t0: 0, mode: 'none' as 'none' | 'press' | 'drag' | 'mate' | 'aim', mate: -1 };
  private keys = new Set<string>();
  private usedKeys = false;
  private mv = { x: 0, y: 0 };
  onClock: ((clock: number, shotClock: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, theme: ArcadeTheme) {
    this.canvas = canvas;
    this.out = canvas.getContext('2d')!;
    this.buf = document.createElement('canvas');
    this.buf.width = W; this.buf.height = VIEW_H;
    this.g = this.buf.getContext('2d')!;
    this.theme = theme;
    this.court = makeCourt(theme.paint, theme.accent, theme.banners, theme.wood);
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    if (import.meta.env.DEV) (window as unknown as { arcade: Arcade }).arcade = this; // for test scripts
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('contextmenu', this.noMenu);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setCrowd(level: number): void { this.crowd = level; }

  /** Play one possession. Resolves when it is over. */
  play(setup: ArcadeSetup): Promise<ArcadeResult> {
    this.s = setup;
    this.diff = DIFF[setup.difficulty];
    this.crowd = setup.poss.crowd;
    this.pk = { shooting: 0, handles: 0, passing: 0, rim: 0, ...setup.perks };
    this.practice = !!setup.practice;
    this.guide = setup.guide ?? null;
    this.hot = setup.hot ?? {};
    this.chal = this.practice ? 1 : clamp(setup.challenge ?? 1, 0.5, 2.6);
    this.doubled = false;
    this.aim.on = false;
    this.reached = false; this.lastQuality = -1; this.hang = 0;
    this.passes = 0; this.moves = 0; this.fakes = 0; this.fakeCd = 0;
    const mk = (p: Player, slot: number, off: boolean): Ent => ({
      p, slot, off, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, stun: 0, slow: 0, run: -1, face: 0,
      armsUp: 0, lift: 0, home: 'TOP', route: [], leg: 0, holdT: 0, screen: 0, wait: 0, jitter: Math.random() * 6,
    });
    this.off = setup.offense.slice(0, 5).map((p, i) => mk(p, i, true));
    this.def = setup.defense.slice(0, 5).map((p, i) => mk(p, i, false));
    // a different alignment every trip; practice keeps the simple one so targets stay put
    const set = this.practice ? SETS[0] : SETS[Math.floor(Math.random() * SETS.length)];
    this.off.forEach((e, i) => { e.home = set[i]; const sp = SLOT[e.home]; e.x = sp[0]; e.y = sp[1]; e.tx = e.x; e.ty = e.y; });
    this.playT = 0.5 + Math.random() * 0.8;
    this.driveReacted = false;
    this.handler = 0;
    const h = this.off[0];
    h.x = 120; h.y = 208;
    this.lag = { x: h.x, y: h.y };
    this.def.forEach((d, i) => { const t = this.defTarget(i); d.x = t.x; d.y = t.y; });
    this.ball = { x: h.x, y: h.y, z: 6 };
    this.clock = setup.poss.clock;
    this.startClock = this.clock;
    this.periodEnds = !this.practice && (setup.poss.lastShot || this.clock <= 24);
    this.shotClock = Math.min(24, this.clock);
    this.events = []; this.highlights = []; this.points = 0;
    this.dropping = false;
    this.popups = []; this.assist = null; this.dribbleT = 0;
    this.dash = { t: 0, cd: 0, x: 0, y: 0 };
    this.grace = 0.9;
    this.slowmo = 1;
    this.ptr.down = false; this.ptr.mode = 'none';
    this.mv = { x: 0, y: 0 };
    this.phase = 'live';
    this.setupScenario(this.practice ? 'halfcourt' : setup.scenario ?? 'halfcourt');
    if (setup.poss.lastShot) this.popup('LAST SHOT!', PAL.yellow, 2);
    else if (setup.poss.clutch) this.popup('CLUTCH TIME', PAL.yellow, 2);
    return new Promise(res => { this.resolve = res; });
  }

  // ---- input ------------------------------------------------------------------------
  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * VIEW_H - TOP };
  }
  private noMenu = (e: Event) => e.preventDefault();
  private onDown = (e: PointerEvent) => {
    const p = this.toLogical(e);
    if (!this.btn.down && (this.phase === 'live' || this.phase === 'charge') && Math.hypot(p.x - BTN.x, p.y - BTN.y) <= BTN.r + 3) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      this.btn = { down: true, id: e.pointerId };
      if (this.phase === 'live' && this.putback > 0) this.doPutback();
      else if (this.phase === 'live') this.startAim(true);
      return;
    }
    if (this.ptr.down) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    Object.assign(this.ptr, { down: true, id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: this.time, mode: 'press', mate: -1 });
    if (this.phase === 'live') {
      const hh = this.off[this.handler];
      // a touch that starts on your player is an aim: pull back to throw or shoot
      if (this.ftMode || Math.hypot(p.x - hh.x, p.y - (hh.y - 12)) < AIM_TOUCH) { this.ptr.mode = 'aim'; this.startAim(false); return; }
      let best = -1, bd = MATE_PICK_R;
      this.off.forEach((m, i) => {
        if (i === this.handler) return;
        const d = Math.hypot(p.x - m.x, p.y - (m.y - 12));
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) { this.ptr.mode = 'mate'; this.ptr.mate = best; }
    }
  };
  private onMove = (e: PointerEvent) => {
    if (!this.ptr.down || e.pointerId !== this.ptr.id) return;
    const p = this.toLogical(e);
    this.ptr.x = p.x; this.ptr.y = p.y;
    const moved = Math.hypot(p.x - this.ptr.x0, p.y - this.ptr.y0);
    if (this.ptr.mode === 'press' && this.phase === 'live' && moved > DRAG_START) this.ptr.mode = 'drag';
  };
  private onUp = (e: PointerEvent) => {
    if (this.btn.down && e.pointerId === this.btn.id) {
      this.btn.down = false;
      if (this.phase === 'charge' && this.aim.kb) this.releaseAim();
      return;
    }
    if (!this.ptr.down || e.pointerId !== this.ptr.id) return;
    const pt = this.ptr;
    pt.down = false;
    const dx = pt.x - pt.x0, dy = pt.y - pt.y0, d = Math.hypot(dx, dy);
    if (this.phase === 'charge') { if (!this.aim.kb) this.releaseAim(); } // a button or key aim ends with its own release
    else if (this.phase === 'live') {
      if (this.ftMode) { /* only the shot */ }
      else if (pt.mode === 'mate' && pt.mate >= 0) this.startPass(pt.mate);
      else if (pt.mode === 'drag' && this.time - pt.t0 < SWIPE_TIME && d > SWIPE_DIST) this.startDash(dx / d, dy / d);
    }
    pt.mode = 'none';
  };
  private onKey = (e: KeyboardEvent) => {
    if (this.phase === 'idle') return;
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.usedKeys = true;
    this.keys.add(k);
    if (this.phase !== 'live') return;
    if (this.ftMode && k !== ' ') return;
    if (k === ' ' && this.putback > 0) this.doPutback();
    else if (k === ' ') this.startAim(true);
    else if (k === 'shift' || k === 'x') {
      const m = this.keyVec();
      if (m.x || m.y) this.startDash(m.x, m.y);
    } else if (k >= '1' && k <= '4') {
      const mates = this.off.map((_, i) => i).filter(i => i !== this.handler);
      this.startPass(mates[Number(k) - 1]);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === ' ' && this.phase === 'charge') this.releaseAim();
  };
  private keyVec(): { x: number; y: number } {
    const K = this.keys;
    let x = 0, y = 0;
    if (K.has('arrowleft') || K.has('a')) x -= 1;
    if (K.has('arrowright') || K.has('d')) x += 1;
    if (K.has('arrowup') || K.has('w')) y -= 1;
    if (K.has('arrowdown') || K.has('s')) y += 1;
    const d = Math.hypot(x, y);
    return d ? { x: x / d, y: y / d } : { x: 0, y: 0 };
  }

  // ---- helpers ----------------------------------------------------------------------
  private popup(text: string, color: string, scale = 2, y = 128): void {
    for (const p of this.popups) p.y -= 14;
    this.popups.push({ text, color, t: 0, scale, y });
  }
  private speed(e: Ent): number { return 30 + 30 * (e.p.ratings.spd / 100); }
  private nearestDef(x: number, y: number, live = true): { d: number; e: Ent | null } {
    let bd = 1e9, be: Ent | null = null;
    for (const d of this.def) {
      if (live && d.stun > 0) continue;
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bd) { bd = dd; be = d; }
    }
    return { d: bd, e: be };
  }
  /** 0 = wide open, 1 = smothered. Counts only defenders roughly between shooter and hoop or very close. */
  private contestAt(e: Ent): { c: number; by: Ent | null } {
    let c = 0, by: Ent | null = null;
    for (const d of this.def) {
      if (d.stun > 0) continue;
      const dist = Math.hypot(d.x - e.x, d.y - e.y);
      if (dist > 28) continue;
      const v = clamp(1 - (dist - 7) / 19, 0, 1) * (0.55 + 0.45 * d.p.ratings.def / 100);
      if (v > c) { c = v; by = d; }
    }
    return { c, by };
  }
  private defTarget(i: number): { x: number; y: number } {
    const man = this.off[i];
    const h = this.off[this.handler];
    if (i === this.handler && this.phase !== 'pass') {
      const dx = HOOP.x - this.lag.x, dy = HOOP.y - this.lag.y, d = Math.hypot(dx, dy) || 1;
      // in practice he stands off so the first shots are open
      const gap = Math.min(this.practice && !this.guide?.tight ? 26 : 13, d * 0.6);
      return { x: this.lag.x + (dx / d) * gap, y: this.lag.y + (dy / d) * gap };
    }
    // a hot hand draws a second defender, which leaves somebody open
    if (this.phase !== 'pass' && !this.practice && (this.hot[h.p.id] ?? 0) >= 2 && this.doubler() === i) {
      const dx = this.def[i].x - h.x, dy = this.def[i].y - h.y, d = Math.hypot(dx, dy) || 1;
      if (!this.doubled && d < 40) { this.doubled = true; this.popup('DOUBLE TEAM!', PAL.red, 2); }
      return { x: h.x + (dx / d) * 9, y: h.y + (dy / d) * 9 };
    }
    // off ball: sag toward the hoop and a little toward the ball
    let x = man.x + (HOOP.x - man.x) * 0.26 + (this.ball.x - man.x) * 0.1;
    let y = man.y + (HOOP.y - man.y) * 0.26 + (this.ball.y - man.y) * 0.1;
    const hd = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    if (this.phase !== 'pass' && hd < 85) {
      // help: on-ball defender beaten or stunned -> nearest help steps into the lane
      const on = this.def[this.handler];
      const beaten = on.stun > 0 || Math.hypot(on.x - HOOP.x, on.y - HOOP.y) > hd + 4;
      if (beaten && this.helper() === i) {
        const dx = HOOP.x - h.x, dy = HOOP.y - h.y, d = Math.hypot(dx, dy) || 1;
        const step = Math.min(16, d * 0.55);
        return { x: h.x + (dx / d) * step, y: h.y + (dy / d) * step };
      }
      if (i === 4 && hd < 60) { // rim protector shades over
        x = x * 0.45 + (HOOP.x + (h.x - HOOP.x) * 0.3) * 0.55;
        y = y * 0.45 + (HOOP.y + (h.y - HOOP.y) * 0.3 + 4) * 0.55;
      }
    }
    return { x, y };
  }
  /** The off-ball defender nearest the ball: the one who comes to double. */
  private doubler(): number {
    const h = this.off[this.handler];
    let best = -1, bd = 1e9;
    this.def.forEach((d, i) => {
      if (i === this.handler || d.stun > 0) return;
      const dd = Math.hypot(d.x - h.x, d.y - h.y);
      if (dd < bd) { bd = dd; best = i; }
    });
    return bd < 90 ? best : -1;
  }
  private helper(): number {
    const h = this.off[this.handler];
    const px = h.x + (HOOP.x - h.x) * 0.5, py = h.y + (HOOP.y - h.y) * 0.5;
    let best = -1, bd = 1e9;
    this.def.forEach((d, i) => {
      if (i === this.handler || d.stun > 0) return;
      const dd = Math.hypot(d.x - px, d.y - py);
      if (dd < bd) { bd = dd; best = i; }
    });
    return bd < 60 ? best : -1;
  }

  // ---- actions ----------------------------------------------------------------------
  private startDash(dx: number, dy: number): void {
    if (this.dash.cd > 0 || this.phase !== 'live') return;
    const h = this.off[this.handler];
    const hnd = h.p.ratings.hnd / 100;
    this.dash = { t: 0.2, cd: 0.85, x: dx, y: dy };
    this.moves++;
    sfx.move();
    const on = this.nearestDef(h.x, h.y);
    if (on.e && on.d < 24) {
      const p = clamp(0.3 + 0.6 * hnd - 0.28 * (on.e.p.ratings.def / 100) + this.diff.move + 0.06 * this.pk.handles + (this.practice ? 0.5 : 0), 0.1, 0.95);
      if (Math.random() < p) {
        on.e.stun = 0.5 + 0.5 * hnd;
        const away = (dx * (HOOP.x - h.x) + dy * (HOOP.y - h.y)) / (Math.hypot(HOOP.x - h.x, HOOP.y - h.y) || 1) < -0.45;
        this.popup(away ? 'STEP BACK!' : pick(CALLS.move), PAL.yellow, 2);
        this.highlights.push('ankles');
        this.crowd = Math.min(100, this.crowd + 4);
      } else {
        h.slow = 0.45;
        this.dash.t = 0.1;
        if (!this.practice && on.d < 12 && this.grace <= 0 && Math.random() < (0.08 + 0.3 * (1 - hnd)) * this.diff.steal * (1 - 0.06 * this.pk.handles)) this.turnover('steal', on.e);
      }
    }
  }

  private startPass(to: number): void {
    if (this.phase !== 'live' || to === undefined || to < 0 || to === this.handler) return;
    const from = this.off[this.handler], tgt = this.off[to];
    const pas = from.p.ratings.pas / 100;
    const spd = (105 + 115 * pas) * (1 + 0.03 * this.s.ocStars) * (1 + 0.08 * this.pk.passing);
    this.passes++;
    this.afterPass(from);
    // a pass to a man cutting at the rim is a lob
    this.lob = Math.hypot(tgt.x - HOOP.x, tgt.y - HOOP.y) < 46 && Math.hypot(from.x - HOOP.x, from.y - HOOP.y) > 58 && (tgt.route.length > 0 || Math.hypot(tgt.vx, tgt.vy) > 12);
    const dist = Math.hypot(tgt.x - from.x, tgt.y - from.y);
    const dur = Math.max(0.12, dist / spd);
    // lead the receiver, with a little error for poor passers
    const err = (1 - pas) * dist * 0.06;
    const x1 = tgt.x + tgt.vx * dur * 0.8 + (Math.random() - 0.5) * err;
    const y1 = tgt.y + tgt.vy * dur * 0.8 + (Math.random() - 0.5) * err;
    this.pass = { from: this.handler, to, x0: from.x, y0: from.y, x1, y1, t: 0, dur, checked: new Set(), stolenBy: -1 };
    this.phase = 'pass';
    sfx.pass();
  }

  // ---- pull-back aiming --------------------------------------------------------------
  /** A tap on SHOOT: he shows the ball. A defender close enough to care may leave his feet. */
  private pumpFake(): void {
    if (this.phase !== 'live' || this.fakeCd > 0) return;
    const h = this.off[this.handler];
    this.fakeCd = 0.8; this.fakes++; this.moves++;
    h.armsUp = 0.32; h.lift = 2; h.vx = 0; h.vy = 0; h.slow = Math.max(h.slow, 0.2);
    sfx.move();
    const on = this.nearestDef(h.x, h.y);
    if (!on.e || on.d > 26) return; // nobody near enough to fool
    // shooters sell it, good defenders stay down, and the same trick works less each time
    const p = clamp(0.58 + 0.4 * (h.p.ratings.sht / 100) - 0.4 * (on.e.p.ratings.def / 100) - (this.practice ? 0 : 0.22 * (this.fakes - 1)) + this.diff.move + (this.practice ? 0.4 : 0), 0.06, 0.85) / Math.sqrt(this.chal);
    if (Math.random() < p) {
      on.e.stun = 0.75; on.e.lift = 9; on.e.armsUp = 0.5;
      this.popup('SENT FLYING!', PAL.green, 2); sfx.good();
      this.highlights.push('fake'); this.crowd = Math.min(100, this.crowd + 3);
    } else this.popup('NOT FOOLED', '#c8c8d8', 1, 150);
  }
  /** Straight back up off an offensive rebound: a dunk for a finisher, a tip-in for anyone else. */
  private doPutback(): void {
    if (this.phase !== 'live' || this.putback <= 0) return;
    this.putback = 0; this.slowmo = 1;
    this.popup('PUTBACK!', PAL.yellow, 2); this.highlights.push('putback');
    this.finishAtRim(true);
  }
  private startAim(kb: boolean): void {
    if (this.phase !== 'live') return;
    this.putback = 0;
    const h = this.off[this.handler];
    h.vx = 0; h.vy = 0;
    // it starts out wide, left or right, so an instant release is a miss and the shot has to be timed
    this.aim = { on: true, t: 0, kb, ph: (Math.random() < 0.5 ? 0.5 : 1.5) * Math.PI + (Math.random() - 0.5) * 0.9, kind: 'none', mate: -1, tx: h.x, ty: h.y, wx: 0, wy: 0, amp: 0, armed: false };
    this.phase = 'charge';
  }
  /** How far the reticle wanders: steadier for good shooters, wilder from deep or under pressure. */
  private aimWobble(h: Ent): { amp: number; w: number } {
    const sht = h.p.ratings.sht / 100;
    const k = Math.pow(this.chal, 0.9), kw = 1 + 0.3 * (this.chal - 1);
    // wide enough that letting go without looking misses more often than not, slow enough to time
    if (this.ftMode) return { amp: Math.max(AMP_FLOOR, 11 * (1.45 - 0.85 * sht)) * this.diff.aim * k, w: (3.4 + 2.6 * (1 - sht)) * kw };
    const dist = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    const distK = dist > 135 ? 2 : isThree(h.x, h.y) ? 1.25 : dist < 45 ? 0.8 : 1;
    const { c } = this.contestAt(h);
    const heat = this.hot[h.p.id] ?? 0;
    // ratings, perks and a hot hand tighten the swing, but only down to the floor; past that they slow it
    const ease = (1 - 0.07 * this.pk.shooting) * (1 - 0.03 * this.s.ocStars) * (heat >= 3 ? 0.7 : heat === 2 ? 0.85 : 1);
    const raw = 10.5 * distK * (1.45 - 0.9 * sht) * (1 + c) * ease;
    const amp = Math.max(AMP_FLOOR, raw) * this.diff.aim * k * (this.practice ? 0.6 : 1);
    const slow = raw < AMP_FLOOR ? 0.75 + 0.25 * (raw / AMP_FLOOR) : 1;
    return { amp, w: (4 + 4.5 * (1 - sht)) * (1 + 0.35 * c) * kw * slow };
  }
  /** Work out what the current pull is aimed at. Runs every frame while aiming, in real time. */
  private updateAim(): void {
    const a = this.aim, h = this.off[this.handler];
    a.t += this.realDt;
    this.slowmo = a.t < AIM_SLOW_T / Math.max(1, this.chal) ? AIM_SLOW : 1;
    let kind: typeof a.kind = 'none', tx = h.x, ty = h.y, mate = -1;
    if (a.kb || this.ftMode) { kind = 'shot'; tx = HOOP.x; ty = HOOP.y; }
    else {
      const px = this.ptr.x0 - this.ptr.x, py = this.ptr.y0 - this.ptr.y, pull = Math.hypot(px, py);
      if (pull >= AIM_MIN) {
        tx = h.x + px * AIM_GAIN; ty = h.y + py * AIM_GAIN;
        // how well the pull lines up with the hoop, and with the best-placed teammate
        const lined = (x: number, y: number) => { const d = Math.hypot(x - h.x, y - h.y) || 1; return (px * (x - h.x) + py * (y - h.y)) / (pull * d); };
        const atHoop = lined(HOOP.x, HOOP.y);
        if (!a.armed) {
          // first read of the gesture: a drag that points at nothing was meant as a dribble
          const atMate = this.off.reduce((best, m, i) => (i === this.handler ? best : Math.max(best, lined(m.x, m.y))), -1);
          if (atHoop < SHOT_CONE && atMate < MATE_CONE) {
            a.on = false; this.slowmo = 1; this.phase = 'live'; this.ptr.mode = 'drag';
            return;
          }
          a.armed = true;
        }
        if (Math.hypot(tx - HOOP.x, ty - HOOP.y) < SNAP_HOOP) { kind = 'shot'; tx = HOOP.x; ty = HOOP.y; }
        else {
          const pas = h.p.ratings.pas / 100, spd = 105 + 115 * pas;
          let bd = SNAP_MATE, reach = 1e9;
          this.off.forEach((m, i) => {
            if (i === this.handler) return;
            const tf = Math.hypot(m.x - h.x, m.y - h.y) / spd;
            const d = Math.hypot(tx - (m.x + m.vx * tf * 0.8), ty - (m.y + m.vy * tf * 0.8));
            if (d < bd) { bd = d; mate = i; }
            reach = Math.min(reach, d);
          });
          const inBounds = tx > SIDE_L + 4 && tx < SIDE_R - 4 && ty > BASE_Y + 4;
          if (mate >= 0) kind = 'pass';
          // a spot someone can run onto is a lead pass; anything else lined up with the hoop is a shot,
          // whether the pull was short or long; and a pull at nothing throws nothing
          // (straight at the hoop it stays a shot, unless the spot is at the rim: that is a lob)
          else if (reach < LEAD_REACH && inBounds && (atHoop < 0.94 || Math.hypot(tx - HOOP.x, ty - HOOP.y) < 40)) kind = 'lead';
          else if (atHoop >= SHOT_CONE) { kind = 'shot'; tx = HOOP.x; ty = HOOP.y; }
          else { kind = 'none'; tx = h.x; ty = h.y; }
        }
      }
    }
    a.kind = kind; a.mate = mate; a.tx = tx; a.ty = ty;
    if (kind === 'shot') {
      const wob = this.aimWobble(h);
      a.amp = wob.amp;
      // a defender in your face also drags the whole pattern off the rim, so even perfect timing
      // on a smothered shot usually finds iron, not the centre
      const push = this.ftMode ? 0 : this.contestAt(h).c * 5;
      a.wx = wob.amp * Math.sin(wob.w * a.t + a.ph) + push * Math.cos(0.9 * a.t + a.ph);
      a.wy = wob.amp * 0.62 * Math.sin(wob.w * 1.63 * a.t + 1.3 + a.ph) + push * 0.62 * Math.sin(0.9 * a.t + a.ph);
    } else { a.wx = 0; a.wy = 0; }
  }
  private releaseAim(): void {
    if (this.phase !== 'charge') return;
    const a = this.aim;
    a.on = false;
    this.slowmo = 1;
    if (a.kind === 'none') { this.phase = 'live'; return; }
    if (a.kb && !this.ftMode && a.t < AIM_HOLD) { this.phase = 'live'; this.pumpFake(); return; } // a tap is a shot fake
    if (this.ftMode && a.t < FT_HOLD) { this.phase = 'live'; this.popup('HOLD, THEN LET GO', PAL.white, 1, 150); return; }
    if (!a.kb && !this.ftMode && a.t < AIM_QUICK) {
      // too fast to have been aimed: it was a flick, so make the move in the direction he flicked
      this.phase = 'live';
      const dx = this.ptr.x - this.ptr.x0, dy = this.ptr.y - this.ptr.y0, d = Math.hypot(dx, dy);
      if (d > SWIPE_DIST) this.startDash(dx / d, dy / d);
      return;
    }
    if (a.kind === 'shot') { this.shootAimed(); return; }
    this.phase = 'live';
    if (a.kind === 'pass') this.startPass(a.mate);
    else this.startLead(a.tx, a.ty);
  }
  /** The shot goes where the reticle was. No dice: on the centre is a swish, on the rim may roll in. */
  private shootAimed(): void {
    const a = this.aim, h = this.off[this.handler];
    const d = Math.hypot(a.wx, a.wy);
    const q = d <= R_SWISH ? 3 : d <= R_RIM ? 2 : d <= R_IRON ? 1 : 0;
    this.lastQuality = q;
    let made = q === 3 || (q === 2 && Math.random() < 1 - 0.8 * ((d - R_SWISH) / (R_RIM - R_SWISH)));
    if (q === 3) { sfx.perfect(); this.highlights.push('perfect'); }
    this.popup(['WAY OFF', 'OFF THE MARK', 'ON THE RIM', 'DEAD CENTRE!'][q], [PAL.red, '#ffa04d', PAL.white, PAL.green][q], 1, h.y - 46);
    if (this.ftMode) { this.launch(h, made, 'mid', 1, q, -1, false, a.wx, a.wy); return; }
    const three = isThree(h.x, h.y);
    const { c, by } = this.contestAt(h);
    let blockBy = -1, foul = false;
    // smothered shots can be swatted, whatever the aim
    if (by && c > 0.78 && Math.random() < 0.08 + 0.2 * (by.p.ratings.def / 100)) { blockBy = by.p.id; made = false; }
    if (by && c > 0.6 && blockBy < 0 && Math.random() < 0.05) foul = true;
    this.launch(h, made, three ? 'three' : 'mid', three ? 3 : 2, q, blockBy, foul, a.wx, a.wy);
  }
  /** A pass thrown to a spot: the nearest teammate runs onto it. */
  private startLead(x: number, y: number): void {
    if (this.phase !== 'live') return;
    const from = this.off[this.handler];
    const pas = from.p.ratings.pas / 100;
    const spd = (105 + 115 * pas) * (1 + 0.03 * this.s.ocStars) * (1 + 0.08 * this.pk.passing);
    const dur = Math.max(0.12, Math.hypot(x - from.x, y - from.y) / spd);
    let to = -1, bd = 1e9;
    this.off.forEach((m, i) => {
      if (i === this.handler) return;
      const d = Math.hypot(x - (m.x + m.vx * dur * 0.6), y - (m.y + m.vy * dur * 0.6));
      if (d < bd) { bd = d; to = i; }
    });
    if (to < 0) return;
    this.passes++;
    this.afterPass(from);
    const tgt = this.off[to];
    tgt.route = []; tgt.screen = 0;
    this.lob = Math.hypot(x - HOOP.x, y - HOOP.y) < 34 && Math.hypot(from.x - HOOP.x, from.y - HOOP.y) > 58;
    this.pass = { from: this.handler, to, x0: from.x, y0: from.y, x1: x, y1: y, t: 0, dur, checked: new Set(), stolenBy: -1 };
    this.phase = 'pass';
    sfx.pass();
  }

  private launch(h: Ent, made: boolean, type: ShotType, pts: number, quality: number, blockBy: number, foul: boolean, offX?: number, offY?: number): void {
    const dist = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    h.armsUp = 0.6; h.lift = 5;
    let x1 = HOOP.x, y1 = HOOP.y;
    this.shot.text = '';
    if (!made && offX !== undefined && offY !== undefined) {
      // the ball goes where it was aimed: just off the rim, or nowhere near it
      const d = Math.hypot(offX, offY) || 1;
      if (quality > 0) {
        // on the iron: it comes down on the rim itself
        const r = Math.max(5, Math.min(8, d));
        x1 += (offX / d) * r; y1 += (offY / d) * r * 0.6;
      } else if (offY < -0.35 * d && Math.abs((offX / d) * Math.min(16, d)) <= 13) {
        // long and on line: it bangs off the glass
        x1 += (offX / d) * Math.min(16, d); y1 -= 5;
        this.shot.text = 'glass';
      } else {
        // short or wide: it touches nothing, and lands clear of the rim and the board
        const r = Math.max(13, Math.min(20, d));
        x1 += (offX / d) * r; y1 += Math.abs(offY / d) * r * 0.9 + 4;
        if (offY < 0) x1 = HOOP.x + Math.sign(offX || 1) * Math.max(18, Math.abs(x1 - HOOP.x));
        this.shot.text = 'air';
      }
    } else if (!made) {
      const a = Math.random() * Math.PI * 2;
      x1 += Math.cos(a) * 5; y1 += Math.sin(a) * 3;
    }
    this.shot = {
      t: 0, dur: type === 'three' || type === 'mid' ? 0.55 + dist / 240 : type === 'dunk' ? 0.62 : 0.52, x0: h.x, y0: h.y, z0: spriteHeight(h.p) + 6, made, type, quality, blockBy, foul, pts,
      text: !made ? this.shot.text : '', buzzer: false, x1, y1, arc: 20 + dist * 0.14,
    };
    if (blockBy >= 0) { this.shot.dur = type === 'three' || type === 'mid' ? 0.16 : 0.34; this.shot.x1 = h.x + (HOOP.x - h.x) * 0.15; this.shot.y1 = h.y + (HOOP.y - h.y) * 0.15; }
    if (this.periodEnds && this.clock <= 2.5) { this.shot.buzzer = true; this.slowmo = 0.45; }
    this.phase = 'shot';
  }

  private finishAtRim(oop = false): void {
    const h = this.off[this.handler];
    const fin = h.p.ratings.fin / 100;
    const near = this.def.filter(d => d.stun <= 0).map(d => ({ d, dist: Math.hypot(d.x - h.x, d.y - h.y) })).filter(o => o.dist < 17).sort((a, b) => a.dist - b.dist);
    const cv = (o?: { d: Ent; dist: number }) => (o ? (1 - o.dist / 17) * (0.4 + 0.6 * o.d.p.ratings.def / 100) + 0.15 : 0);
    const c1 = cv(near[0]), c2 = cv(near[1]);
    const open = near.length === 0 || near[0].dist > 13;
    const dunk = oop ? h.p.ratings.fin >= 55 : h.p.ratings.fin >= 68 && (open || (h.p.ratings.fin >= 86 && c1 < 0.6));
    let p = dunk
      ? (open ? 0.96 : 0.6 + 0.3 * fin - 0.3 * c1)
      : 0.6 + 0.38 * fin - 0.3 * c1 - 0.12 * c2;
    p = clamp(p + this.diff.make + 0.04 * this.pk.rim + (oop ? 0.08 : 0), 0.08, 0.97);
    const made = Math.random() < p;
    const foul = !open && Math.random() < 0.09 + 0.1 * c1;
    let blockBy = -1;
    if (!made && !foul && near[0] && c1 > 0.5 && Math.random() < 0.15 + 0.3 * (near[0].d.p.ratings.def / 100)) blockBy = near[0].d.p.id;
    this.shot.text = '';
    this.launch(h, made, dunk ? 'dunk' : 'layup', 2, 2, blockBy, foul);
    // glide to the rim
    const dx = h.x - HOOP.x, dy = h.y - HOOP.y, d = Math.hypot(dx, dy) || 1;
    // take off toward a spot just in front of the rim
    h.tx = HOOP.x + (dx / d) * 5; h.ty = Math.max(HOOP.y + 3, HOOP.y + (dy / d) * 6 + 3);
    this.phase = 'finish';
  }

  private turnover(kind: 'steal' | 'oob' | 'shotclock' | 'intercept', by: Ent | null, label?: string): void {
    const h = this.off[this.phase === 'pass' ? this.pass.from : this.handler];
    this.events.push({ t: 'tov', by: h.p.id, kind, ...(by ? { stealBy: by.p.id } : {}) });
    if (kind === 'steal') { this.popup(pick(CALLS.steal), PAL.red, 2); sfx.steal(); if (by) { this.ball.x = by.x; this.ball.y = by.y; } }
    else if (kind === 'intercept') { this.popup(pick(CALLS.pick), PAL.red, 2); sfx.steal(); }
    else if (kind === 'oob') { this.popup(label ?? 'OUT OF BOUNDS', PAL.red, 2); sfx.whistle(); }
    else { this.popup('SHOT CLOCK!', PAL.red, 2); sfx.buzzer(); }
    this.crowd = Math.max(0, this.crowd - 6);
    this.highlights.push('tov');
    this.end(1.2);
  }

  private end(delay: number): void {
    this.phase = 'over';
    this.overT = delay;
  }

  private freeThrows(shooter: Ent, n: number): void {
    const p = 0.5 + 0.4 * (shooter.p.ratings.sht / 100);
    let made = 0;
    for (let i = 0; i < n; i++) if (Math.random() < p) made++;
    this.events.push({ t: 'ft', by: shooter.p.id, made, att: n });
    this.points += made;
    this.popup(`FREE THROWS ${made}/${n}`, made ? PAL.white : PAL.red, 1, 150);
  }

  private resolveShot(): void {
    const sh = this.shot;
    const h = this.off[this.handler];
    if (this.ftMode) {
      this.ft.left--;
      if (sh.made) {
        this.ft.made++; this.points++;
        this.netKick = 1; this.rimGlow = 0.4;
        this.ball.x = HOOP.x; this.ball.y = HOOP.y; this.ball.z = RIM_Z + 1; this.dropping = true; this.dropT = 0;
        this.popup('GOOD!', PAL.green, 2); sfx.swish();
        this.crowd = Math.min(100, this.crowd + 3);
      } else { this.popup('NO GOOD', '#c8c8d8', 2); sfx.rim(); this.rimShake = 0.5; this.dropping = false; }
      if (this.ft.left > 0) { this.ftPause = 1.1; this.phase = 'ftwait'; }
      else { this.ft.left = 0; this.events.push({ t: 'ft', by: h.p.id, made: this.ft.made, att: 2 }); this.end(1.2); }
      return;
    }
    const assist = this.assist && this.time - this.assist.t < 2.4 && this.assist.id !== h.p.id ? this.assist.id : undefined;
    const buzzer = sh.buzzer || (this.periodEnds && this.clock <= 0);
    if (sh.made) {
      this.events.push({ t: 'shot', by: h.p.id, type: sh.type, made: true, ...(assist !== undefined ? { assist } : {}) });
      this.points += sh.pts;
      this.netKick = 1;
      this.dropping = true; this.dropT = 0;
      this.ball.x = HOOP.x; this.ball.y = HOOP.y; this.ball.z = RIM_Z + 1;
      // make it unmistakable: rim flashes, sparks fly, and the points pop up at the basket
      this.rimGlow = 0.5;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.sparks.push({ x: HOOP.x, y: HOOP.y - RIM_Z + 2, vx: Math.cos(a) * (18 + Math.random() * 14), vy: Math.sin(a) * 10 - 14, t: 0 }); }
      this.popups.push({ text: `+${sh.pts}`, color: PAL.green, t: 0, scale: 2, y: HOOP.y - RIM_Z + 42 });
      if (sh.type === 'dunk') { this.rimShake = 1; this.hang = 0.45; }
      if (sh.type === 'dunk') {
        this.popup(pick(CALLS.dunk), PAL.yellow, 3); sfx.dunk(); sfx.cheer(true); this.shake = 0.5; this.flash = 0.25;
        this.highlights.push('dunk'); this.crowd = Math.min(100, this.crowd + 14);
      } else if (sh.type === 'layup') {
        this.popup(pick(CALLS.layup), PAL.white, 2); sfx.swish(); sfx.cheer();
        this.crowd = Math.min(100, this.crowd + 6);
      } else {
        const three = sh.type === 'three';
        this.popup(sh.quality === 3 ? pick(CALLS.swish) : three ? pick(CALLS.three) : pick(CALLS.made), sh.quality === 3 ? PAL.green : PAL.yellow, three ? 3 : 2);
        sfx.swish(); sfx.cheer(three);
        if (three) { this.highlights.push('three'); this.shake = 0.2; }
        this.crowd = Math.min(100, this.crowd + (three ? 12 : 7));
      }
      if (buzzer) {
        this.popup('BUZZER BEATER!', PAL.yellow, 2, 100); this.highlights.push('buzzer');
        this.shake = 0.8; this.flash = 0.5; sfx.buzzer(); sfx.cheer(true); this.crowd = 100;
      }
      if (sh.foul) {
        this.popup('AND-ONE!', PAL.green, 2, 150); sfx.whistle(); this.highlights.push('andone');
        this.freeThrows(h, 1);
      }
      this.end(buzzer ? 2.2 : 1.3);
      return;
    }
    // miss
    if (sh.foul) {
      // fouled on a miss: no shot attempt recorded, free throws instead
      this.popup('FOUL!', PAL.white, 2); sfx.whistle();
      this.freeThrows(h, sh.pts === 3 ? 3 : 2);
      this.end(1.4);
      return;
    }
    this.events.push({ t: 'shot', by: h.p.id, type: sh.type, made: false, ...(sh.blockBy >= 0 ? { blockBy: sh.blockBy } : {}) });
    if (sh.blockBy >= 0) { this.popup(pick(CALLS.block), PAL.red, 2); sfx.block(); this.shake = 0.25; }
    else if (sh.text === 'air') { this.popup(pick(CALLS.air), PAL.red, 2); sfx.groan(); }
    else if (sh.text === 'glass') { this.popup(pick(CALLS.glass), PAL.red, 2, 120); sfx.rim(); this.rimShake = 0.7; }
    else { this.popup(pick(CALLS.miss), '#c8c8d8', 2, 120); sfx.rim(); this.rimShake = 0.5; }
    if (this.periodEnds && this.clock <= 0) { sfx.buzzer(); this.end(1.3); return; }
    // rebound
    const a = Math.PI * (0.12 + Math.random() * 0.76);
    const r = 14 + Math.random() * 30;
    const x1 = clamp(HOOP.x + Math.cos(a) * r, SIDE_L + 6, SIDE_R - 6), y1 = HOOP.y + Math.sin(a) * r;
    const ws: number[] = [], all = [...this.off, ...this.def];
    for (const e of all) {
      const d = Math.hypot(e.x - x1, e.y - y1);
      const rb = e.p.ratings.reb / 100;
      ws.push(rb * rb * (1 / (1 + (d / 24) ** 2)) * (e.off ? 1 : 2.1) * (e.stun > 0 ? 0.3 : 1) + 0.002);
    }
    let roll = Math.random() * ws.reduce((s, v) => s + v, 0), wi = 0;
    for (; wi < ws.length - 1; wi++) { roll -= ws[wi]; if (roll < 0) break; }
    this.reb = { t: 0, dur: 0.6, x0: this.ball.x, y0: this.ball.y, x1, y1, winner: all[wi] };
    this.phase = 'rebound';
  }

  // ---- update -----------------------------------------------------------------------
  private frame = (now: number) => {
    if (this.dead) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.realDt = dt;
    if (this.putback > 0) {
      this.putback = this.phase === 'live' ? this.putback - dt : 0;
      if (this.putback <= 0) { this.putback = 0; if (this.phase === 'live') this.slowmo = 1; }
      else this.slowmo = 0.3;
    }
    this.update(dt * this.slowmo);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    for (const p of this.popups) p.t += dt / Math.max(0.5, this.slowmo);
    this.popups = this.popups.filter(p => p.t < 1.25);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.netKick = Math.max(0, this.netKick - dt * 1.5);
    this.rimShake = Math.max(0, this.rimShake - dt * 2);
    this.rimGlow = Math.max(0, this.rimGlow - dt);
    for (const sp of this.sparks) { sp.t += dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 60 * dt; }
    this.sparks = this.sparks.filter(sp => sp.t < 0.45);
    this.hang = Math.max(0, this.hang - dt);
    if (this.phase !== this.lastPhase) { this.lastPhase = this.phase; this.onPhase?.(this.phase); }
    if (this.phase === 'idle') return;
    if (this.phase === 'over') {
      this.overT -= dt;
      if (this.dropping) {
        this.dropT += dt;
        // slow through the net, then fall and take one small bounce on the floor
        if (this.ball.z > 0.01 && this.dropT < 5) { const inNet = this.ball.z > RIM_Z - 12; this.ball.z = Math.max(0, this.ball.z - dt * (inNet ? 26 : 95)); if (this.ball.z <= 0) this.dropT = 10; }
        else if (this.dropT >= 10) { const k = (this.dropT - 10) / 0.28; this.ball.z = k < 1 ? Math.sin(k * Math.PI) * 5 : 0; this.ball.y = HOOP.y + Math.min(1, k) * 4; }
        this.ball.x += (HOOP.x - this.ball.x) * 0.3;
      }
      this.moveAll(dt, true);
      if (this.overT <= 0) {
        this.phase = 'idle';
        this.slowmo = 1;
        const seconds = clamp(Math.round(this.startClock - this.clock), 2, Math.max(2, Math.round(this.startClock)));
        const r = this.resolve; this.resolve = null;
        r?.({ outcome: { events: this.events, seconds }, highlights: this.highlights, points: this.points, passes: this.passes, moves: this.moves, reached: this.reached, quality: this.lastQuality,
          shots: this.events.filter(e => e.t === 'shot').map(e => ({ by: (e as { by: number }).by, made: (e as { made: boolean }).made })) });
      }
      return;
    }
    // clocks
    const live = this.phase === 'live' || this.phase === 'pass' || this.phase === 'charge';
    if (!this.practice && !this.ftMode) this.clock = Math.max(0, this.clock - dt * TIME_SCALE);
    if (live && !this.practice && !this.ftMode) this.shotClock = Math.max(0, this.shotClock - dt * TIME_SCALE);
    this.onClock?.(this.clock, this.periodEnds ? -1 : this.shotClock);
    this.grace = Math.max(0, this.grace - dt);
    this.dash.cd = Math.max(0, this.dash.cd - dt);
    this.fakeCd = Math.max(0, this.fakeCd - dt);
    if (live && this.shotClock <= 0) {
      if (this.periodEnds) { this.popup('TIME!', PAL.white, 2); sfx.buzzer(); this.end(1.2); }
      else this.turnover('shotclock', null);
      return;
    }
    const h = this.off[this.handler];

    if (this.phase === 'live') {
      // (shots and passes start from an aim: see startAim)
    }
    if (this.phase === 'live') {
      // movement intent
      let mx = 0, my = 0;
      if (this.ptr.down && this.ptr.mode === 'drag') {
        const dx = this.ptr.x - this.ptr.x0, dy = this.ptr.y - this.ptr.y0, d = Math.hypot(dx, dy);
        if (d > 2) { const m = Math.min(1, d / STICK_MAX); mx = (dx / d) * m; my = (dy / d) * m; }
      } else { const k = this.keyVec(); mx = k.x; my = k.y; }
      if (this.ftMode) { mx = 0; my = 0; }
      this.mv = { x: mx, y: my };
      let sp = this.speed(h) * (0.8 + 0.2 * h.p.ratings.hnd / 100);
      if (h.slow > 0) sp *= 0.45;
      let tvx = mx * sp, tvy = my * sp;
      if (this.dash.t > 0) {
        this.dash.t -= dt;
        const m = sp * (1.7 + 0.8 * h.p.ratings.hnd / 100);
        tvx = this.dash.x * m; tvy = this.dash.y * m;
      }
      const acc = 1 - Math.exp(-dt * 14);
      h.vx += (tvx - h.vx) * acc; h.vy += (tvy - h.vy) * acc;
      h.x += h.vx * dt; h.y += h.vy * dt;
      h.y = Math.min(h.y, H - 6);
      const moving = Math.hypot(h.vx, h.vy) > 6;
      if (moving) this.dribbleT += dt;
      const tg = this.guide?.target;
      if (tg && !this.reached && Math.hypot(h.x - tg.x, h.y - tg.y) < 12) { this.reached = true; this.popup('THAT IS IT!', PAL.green, 2); sfx.good(); this.end(0.9); return; }
      // bodies
      for (const d of this.def) {
        if (d.stun > 0) continue;
        const dx = h.x - d.x, dy = h.y - d.y, dd = Math.hypot(dx, dy);
        if (dd < BODY && dd > 0.01) {
          const push = BODY - dd;
          h.x += (dx / dd) * push * 0.65; h.y += (dy / dd) * push * 0.65;
          d.x -= (dx / dd) * push * 0.35; d.y -= (dy / dd) * push * 0.35;
        }
        // reach-in steals
        if (dd < 9 && this.grace <= 0 && !this.practice && !this.ftMode) {
          let rate = clamp(0.12 + 0.4 * (d.p.ratings.def / 100) - 0.42 * (h.p.ratings.hnd / 100), 0.03, 0.5) * this.diff.steal * (1 - 0.06 * this.pk.handles) * (1 + 0.35 * (this.chal - 1));
          if (this.dash.t > 0) rate *= 0.3;
          if (Math.random() < rate * dt) { this.turnover('steal', d); return; }
        }
      }
      if (this.practice) { h.x = clamp(h.x, SIDE_L + 3, SIDE_R - 3); h.y = Math.max(h.y, BASE_Y + 3); } // no stepping out in practice
      else if (h.x < SIDE_L + 1 || h.x > SIDE_R - 1 || h.y < BASE_Y + 1) { this.turnover('oob', null); return; }
      // drive to the rim
      const hx = HOOP.x - h.x, hy = HOOP.y - h.y, hd = Math.hypot(hx, hy);
      if (hd < RIM_ZONE && h.y > HOOP.y - 6) {
        const toward = (mx * hx + my * hy) / (hd || 1);
        if (toward > 0.3 || (this.dash.t > 0 && (this.dash.x * hx + this.dash.y * hy) / (hd || 1) > 0.3)) { this.finishAtRim(); }
      }
    } else if (this.phase === 'charge') {
      this.updateAim();
      h.armsUp = this.aim.kind === 'shot' ? 0.1 : 0;
      h.vx = 0; h.vy = 0;
    } else if (this.phase === 'pass') {
      const ps = this.pass;
      ps.t += dt;
      const k = Math.min(1, ps.t / ps.dur);
      this.ball.x = ps.x0 + (ps.x1 - ps.x0) * k;
      this.ball.y = ps.y0 + (ps.y1 - ps.y0) * k;
      this.ball.z = 13 + Math.sin(k * Math.PI) * (this.lob ? 22 : 4) + (this.lob ? k * 12 : 0);
      const from = this.off[ps.from];
      const travelled = Math.hypot(this.ball.x - ps.x0, this.ball.y - ps.y0);
      const left = Math.hypot(ps.x1 - this.ball.x, ps.y1 - this.ball.y);
      if (travelled > 12 && left > 9) {
        for (const d of this.def) {
          if (this.practice || d.stun > 0 || ps.checked.has(d.p.id)) continue;
          if (this.lob && Math.hypot(d.x - ps.x1, d.y - ps.y1) > 16) continue; // a lob goes over everyone but the man at the rim
          if (Math.hypot(d.x - this.ball.x, d.y - 4 - this.ball.y) < 6.5) {
            ps.checked.add(d.p.id);
            const p = clamp(0.32 + 0.5 * (d.p.ratings.def / 100) - 0.5 * (from.p.ratings.pas / 100) + (this.diff.steal - 1) * 0.2 - 0.05 * this.pk.passing, 0.06, 0.8);
            if (Math.random() < p) { this.ball.x = d.x; this.ball.y = d.y; this.turnover('intercept', d); return; }
          }
        }
      }
      if (this.ball.x < SIDE_L - 2 || this.ball.x > SIDE_R + 2 || this.ball.y < BASE_Y - 2) { this.turnover('oob', null); return; }
      if (k >= 1) {
        const to = this.off[ps.to];
        if (Math.hypot(to.x - ps.x1, to.y - ps.y1) > 14) { // nobody got to it
          this.turnover('oob', null, 'BAD PASS'); return;
        }
        this.assist = { id: from.p.id, t: this.time };
        this.handler = ps.to;
        this.off[ps.to].route = []; this.off[ps.to].screen = 0;
        if (this.lob && Math.hypot(to.x - HOOP.x, to.y - HOOP.y) < 40) {
          // caught at the rim: finish it in the air
          this.lob = false;
          this.popup('ALLEY-OOP!', PAL.yellow, 2); this.highlights.push('oop');
          this.lag = { x: to.x, y: to.y }; this.phase = 'live';
          this.finishAtRim(true);
          return;
        }
        this.lob = false;
        if (this.guide?.endOnCatch) { this.popup('GOOD PASS!', PAL.green, 2); sfx.good(); this.phase = 'live'; this.end(0.9); return; }
        this.def[ps.to].slow = 0.45; // the closeout arrives a beat late: catch-and-shoot is worth it
        this.dribbleT = 0;
        this.grace = 0.35;
        this.lag = { x: to.x, y: to.y };
        this.phase = 'live';
        // a press held through the catch goes straight into a shot
        if (this.ptr.down) { this.ptr.mode = 'press'; this.ptr.x0 = this.ptr.x; this.ptr.y0 = this.ptr.y; this.ptr.t0 = this.time; }
      }
    } else if (this.phase === 'finish') {
      // layup or dunk: gather, rise, then the ball leaves the hand (layup) or is thrown down (dunk)
      const sh = this.shot;
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      const glide = 1 - Math.exp(-dt * 12);
      h.x += (h.tx - h.x) * glide; h.y += (h.ty - h.y) * glide;
      const dunk = sh.type === 'dunk';
      const reach = spriteHeight(h.p) + 4; // hand height above his feet
      const peak = dunk ? Math.max(8, RIM_Z - reach + 6) : Math.max(5, RIM_Z - reach);
      const rise = dunk ? 0.8 : 0.6;
      h.lift = peak * Math.sin(Math.min(1, k / rise) * Math.PI * 0.5);
      h.armsUp = 0.2;
      const handZ = h.lift + reach;
      if (k < rise) { this.ball.x = h.x + 2; this.ball.y = h.y; this.ball.z = handZ; }
      else {
        const j = (k - rise) / (1 - rise);
        this.ball.x = h.x + 2 + (sh.x1 - h.x - 2) * j;
        this.ball.y = h.y + (sh.y1 - h.y) * j;
        this.ball.z = handZ + (RIM_Z + 1 - handZ) * j + (dunk ? 0 : Math.sin(j * Math.PI) * 5);
      }
      if (k >= 1) { this.slowmo = 1; this.resolveShot(); }
    } else if (this.phase === 'shot') {
      const sh = this.shot;
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      this.ball.x = sh.x0 + (sh.x1 - sh.x0) * k;
      this.ball.y = sh.y0 + (sh.y1 - sh.y0) * k;
      this.ball.z = sh.z0 + Math.sin(k * Math.PI) * sh.arc + k * (RIM_Z + 1 - sh.z0);
      if (k >= 1) { this.slowmo = 1; this.resolveShot(); }
    } else if (this.phase === 'ftwait') {
      // between free throws: the ball comes back to the shooter
      this.ftPause -= dt;
      if (this.dropping && this.ball.z > 0) this.ball.z = Math.max(0, this.ball.z - dt * 60);
      if (this.ftPause <= 0) { this.dropping = false; this.ball.x = h.x; this.ball.y = h.y; this.ball.z = 8; this.phase = 'live'; if (this.ptr.down) { this.ptr.mode = 'aim'; this.ptr.x0 = this.ptr.x; this.ptr.y0 = this.ptr.y; this.startAim(false); } else this.ptr.mode = 'none'; }
    } else if (this.phase === 'rebound') {
      const rb = this.reb;
      rb.t += dt;
      const k = Math.min(1, rb.t / rb.dur);
      this.ball.x = rb.x0 + (rb.x1 - rb.x0) * k;
      this.ball.y = rb.y0 + (rb.y1 - rb.y0) * k;
      this.ball.z = (RIM_Z + 2) * Math.abs(Math.cos(k * Math.PI * 1.5)) * (1 - k * 0.5);
      if (k >= 1) {
        const w = rb.winner!;
        this.ball.x = w.x; this.ball.y = w.y;
        if (w.off && this.clock > 0.5) {
          this.events.push({ t: 'oreb', by: w.p.id });
          // close to the rim, the board can go straight back up: a short window, in slow motion
          const close = !this.practice && Math.hypot(w.x - HOOP.x, w.y - HOOP.y) < PUTBACK_RANGE;
          this.putback = close ? PUTBACK_TIME : 0;
          this.popup(close ? 'PUT IT BACK!' : pick(CALLS.board), close ? PAL.yellow : PAL.green, 2); sfx.good();
          this.highlights.push('oreb');
          this.handler = this.off.indexOf(w);
          w.route = []; w.screen = 0;
          for (const e of this.off) if (e !== w) { e.route = []; e.screen = 0; e.home = this.openSlot(e.slot >= 3 ? INSIDE : PERIMETER, e); }
          this.shotClock = Math.min(Math.max(this.shotClock, 14), this.clock);
          this.assist = null; this.grace = 0.5; this.dribbleT = 0;
          this.lag = { x: w.x, y: w.y };
          this.ptr.mode = this.ptr.down ? 'drag' : 'none'; this.ptr.x0 = this.ptr.x; this.ptr.y0 = this.ptr.y;
          this.phase = 'live';
        } else {
          this.end(0.9);
        }
      }
    }
    this.moveAll(dt, false);
    if (this.phase === 'live' || this.phase === 'charge') {
      const hh = this.off[this.handler];
      const bounce = Math.abs(Math.sin(this.time * 9));
      const moving = Math.hypot(hh.vx, hh.vy) > 4;
      const charge = this.phase === 'charge';
      this.ball.x = charge ? hh.x : hh.x + (hh.face >= 0 ? 8 : -8);
      this.ball.y = hh.y + 1;
      this.ball.z = charge ? spriteHeight(hh.p) + 4 : moving || this.dribbleT > 0 ? bounce * 9 : 8;
      if (this.phase === 'live' && Math.sin(this.time * 9) * Math.sin((this.time - dt) * 9) < 0) sfx.bounce();
    }
  }

  /** Move everyone who is not directly controlled. */
  private moveAll(dt: number, over: boolean): void {
    const h = this.off[this.handler];
    const lagK = 1 - Math.exp(-dt / Math.max(0.05, this.diff.lag * (1.25 - 0.5 * this.def[this.handler].p.ratings.def / 100)));
    this.lag.x += (h.x - this.lag.x) * lagK; this.lag.y += (h.y - this.lag.y) * lagK;
    const rebounding = this.phase === 'rebound';
    if (!over && (this.phase === 'live' || this.phase === 'charge' || this.phase === 'pass')) this.directOffense(dt);
    this.off.forEach((e, i) => {
      e.stun = Math.max(0, e.stun - dt); e.slow = Math.max(0, e.slow - dt);
      e.armsUp = Math.max(0, e.armsUp - dt);
      if (this.phase !== 'finish' && !(this.hang > 0 && i === this.handler)) e.lift = Math.max(0, e.lift - dt * 30);
      const controlled = i === this.handler && (this.phase === 'live' || this.phase === 'charge' || this.phase === 'finish' || this.phase === 'shot');
      if (!controlled) {
        if (rebounding && Math.hypot(e.x - this.reb.x1, e.y - this.reb.y1) < 60) { e.tx = this.reb.x1; e.ty = this.reb.y1 + 3; }
        else if (this.phase === 'pass' && i === this.pass.to) { e.tx = this.pass.x1; e.ty = this.pass.y1; }
        else if (!over && !this.ftMode) this.followRoute(e, dt);
        const leg = e.route[e.leg];
        this.steer(e, e.tx, e.ty, this.speed(e) * (leg && e.wait <= 0 ? leg.speed : 0.85), dt);
      }
      const sp = Math.hypot(e.vx, e.vy);
      e.run = sp > 5 ? (e.run < 0 ? 0 : e.run + dt * 5) : -1;
      if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
      else if (sp < 4) e.face = 0;
    });
    this.def.forEach((d, i) => {
      d.armsUp = Math.max(0, d.armsUp - dt);
      d.lift = Math.max(0, d.lift - dt * 22);
      if (d.stun > 0) { d.stun -= dt; d.vx = 0; d.vy = 0; d.run = -1; return; }
      let t = this.ftMode || this.phase === 'ftwait' ? { x: d.x, y: d.y } : this.defTarget(i);
      if (rebounding && Math.hypot(d.x - this.reb.x1, d.y - this.reb.y1) < 60) t = { x: this.reb.x1, y: this.reb.y1 - 3 };
      if (this.phase === 'pass' && i === this.pass.to) {
        // close out on the receiver
        const m = this.off[i];
        t = { x: m.x + (HOOP.x - m.x) * 0.12, y: m.y + (HOOP.y - m.y) * 0.12 };
      }
      const closing = (this.phase === 'charge' || this.phase === 'shot') && i === this.handler;
      if (closing) { const m = this.off[i]; t = { x: m.x + (HOOP.x - m.x) * 0.07, y: m.y + (HOOP.y - m.y) * 0.07 }; if (Math.hypot(d.x - m.x, d.y - m.y) < 14) { d.armsUp = 0.2; if (this.phase === 'shot') d.lift = 6; } }
      d.slow = Math.max(0, d.slow - dt);
      // sliding with the ball is slower than sprinting, so a quicker handler can turn the corner
      this.steer(d, t.x, t.y, this.speed(d) * this.diff.dspd * (i === this.handler ? 0.9 : 0.9) * (d.slow > 0 ? 0.45 : 1) * (this.practice ? 0.7 : 1) * Math.min(1.12, 1 + 0.06 * (this.chal - 1)), dt);
      // a set screen is a wall: any defender but the screener's own man gets hung up on it
      for (let k = 0; k < this.off.length; k++) {
        const sc = this.off[k];
        if (sc.screen <= 0 || k === i) continue;
        const dx = d.x - sc.x, dy = d.y - sc.y, dd = Math.hypot(dx, dy);
        if (dd < 8.5 && dd > 0.01) { d.x += (dx / dd) * (8.5 - dd); d.y += (dy / dd) * (8.5 - dd); d.slow = Math.max(d.slow, 0.3); }
      }
      const sp = Math.hypot(d.vx, d.vy);
      d.run = sp > 5 ? (d.run < 0 ? 0 : d.run + dt * 5) : -1;
      d.face = Math.abs(d.vx) > 4 ? (d.vx > 0 ? 1 : -1) : 0;
    });
  }

  // ---- off-ball offense -------------------------------------------------------------
  private slotXY(n: SlotName): { x: number; y: number } { return { x: SLOT[n][0], y: SLOT[n][1] }; }
  /** The candidate slot with the most room around it (from teammates' destinations and the ball). */
  private openSlot(cands: SlotName[], who: Ent): SlotName {
    const h = this.off[this.handler];
    let best = cands[0], bv = -1;
    for (const n of cands) {
      const p = this.slotXY(n);
      let room = Math.hypot(p.x - h.x, p.y - h.y) * 0.8;
      for (const o of this.off) {
        if (o === who || o === h) continue;
        const dest = o.route.length ? o.route[o.route.length - 1] : this.slotXY(o.home);
        room = Math.min(room, Math.hypot(p.x - dest.x, p.y - dest.y));
      }
      room += Math.random() * 14; // not always the same answer
      if (room > bv) { bv = room; best = n; }
    }
    return best;
  }
  private send(e: Ent, legs: Leg[], home: SlotName, wait = 0): void {
    const end = this.slotXY(home);
    e.route = [...legs, { x: end.x, y: end.y, speed: 0.9 }];
    e.leg = 0; e.holdT = 0; e.screen = 0; e.wait = wait; e.home = home;
  }
  private followRoute(e: Ent, dt: number): void {
    if (e.wait > 0) { e.wait -= dt; return; }
    const leg = e.route[e.leg];
    if (!leg) {
      // idle: stand at home, shifting a step now and then so nobody looks frozen
      const hm = this.slotXY(e.home);
      e.jitter += dt;
      e.tx = hm.x + Math.round(Math.sin(e.jitter * 0.9 + e.slot) * 3);
      e.ty = hm.y + Math.round(Math.cos(e.jitter * 0.7 + e.slot * 2) * 2);
      e.screen = 0;
      return;
    }
    e.tx = leg.x; e.ty = leg.y;
    if (Math.hypot(e.x - leg.x, e.y - leg.y) < 4) {
      if (leg.hold && e.holdT < leg.hold) { e.holdT += dt; e.screen = leg.screen ? 1 : 0; return; }
      e.holdT = 0; e.screen = 0; e.leg++;
      if (e.leg >= e.route.length) { e.route = []; e.leg = 0; }
    }
  }
  /** Calls an action every couple of seconds, and reacts to drives. */
  private directOffense(dt: number): void {
    if (this.practice || this.ftMode) return;
    const h = this.off[this.handler];
    const hd = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    const mates = this.off.filter(e => e !== h);
    const idle = mates.filter(e => e.route.length === 0 && e.wait <= 0);
    // drive: bigs dive to the dunker spot away from the ball, shooters drift to open threes, one man gets back
    if (hd < 82 && h.vy < -12 && !this.driveReacted) {
      this.driveReacted = true;
      let safety = false;
      for (const e of mates) {
        if (e.slot >= 3) this.send(e, [], h.x < HOOP.x ? 'DR' : 'DL');
        else if (!safety && e.y > 130) { safety = true; this.send(e, [], this.openSlot(['TOP', 'LS', 'RS'], e)); }
        else this.send(e, [], this.openSlot(e.x < HOOP.x ? ['LC', 'LW', 'LS'] : ['RC', 'RW', 'RS'], e));
      }
      this.playT = 1.6;
      return;
    }
    if (hd > 105) this.driveReacted = false;
    this.playT -= dt;
    if (this.playT > 0 || !idle.length) return;
    this.playT = 1.3 + Math.random() * 1.6;
    const bigs = idle.filter(e => e.slot >= 3), wings = idle.filter(e => e.slot < 3);
    const pickOne = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const r = Math.random();
    const onD = this.def[this.handler];
    if (r < 0.26 && bigs.length && hd > 70) {
      this.callBallScreen(pickOne(bigs));
    } else if (r < 0.44 && bigs.length && wings.length) {
      // pin-down: a big screens a wing's defender, the wing comes off it to the top or flares to the corner
      const wing = pickOne(wings), big = pickOne(bigs);
      const wd = this.def[this.off.indexOf(wing)];
      this.send(big, [{ x: wd.x, y: wd.y + 5, speed: 1, hold: 1.3, screen: true }], this.openSlot(INSIDE, big));
      const curl = Math.random() < 0.6;
      this.send(wing, [], this.openSlot(curl ? ['TOP', 'LS', 'RS'] : wing.x < HOOP.x ? ['LC', 'LW'] : ['RC', 'RW'], wing), 0.5);
    } else if (r < 0.6 && wings.length) {
      // backdoor when his man is playing up on him, otherwise a V-cut to get open
      const wing = pickOne(wings);
      const wd = this.def[this.off.indexOf(wing)];
      const tight = Math.hypot(wd.x - wing.x, wd.y - wing.y) < 16;
      const sgn = wing.x < HOOP.x ? -1 : 1;
      if (tight || Math.random() < 0.35) this.send(wing, [{ x: HOOP.x + sgn * 12, y: HOOP.y + 16, speed: 1.1, hold: 0.6 }], this.openSlot(sgn < 0 ? ['RC', 'RW', 'LC'] : ['LC', 'LW', 'RC'], wing));
      else this.send(wing, [{ x: wing.x + (HOOP.x - wing.x) * 0.35, y: wing.y + (HOOP.y - wing.y) * 0.35, speed: 0.9 }], this.openSlot(PERIMETER, wing));
    } else if (r < 0.74 && wings.length >= 2) {
      // exchange: two perimeter players swap places
      const a = wings[0], b = wings[1];
      const ha = a.home, hb = b.home;
      this.send(a, [], hb); this.send(b, [], ha);
    } else if (r < 0.86 && bigs.length) {
      // post up on the ball side, or flash to the high post
      const big = pickOne(bigs);
      this.send(big, [], Math.random() < 0.6 ? (h.x < HOOP.x ? 'LB' : 'RB') : this.openSlot(['HP', 'LE', 'RE'], big));
    } else {
      const e = pickOne(idle);
      this.send(e, [], this.openSlot(e.slot >= 3 && e.p.ratings.sht < 62 ? INSIDE : PERIMETER, e));
    }
  }
  /** Ball screen, then roll to the rim (finishers) or pop to a three (shooters). */
  private callBallScreen(big: Ent): void {
    const h = this.off[this.handler], onD = this.def[this.handler];
    const hx = HOOP.x - h.x, hy = HOOP.y - h.y, hl = Math.hypot(hx, hy) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const sx = clamp(onD.x + (-hy / hl) * 9 * side, SIDE_L + 8, SIDE_R - 8), sy = onD.y + (hx / hl) * 9 * side;
    const roll = big.p.ratings.fin >= big.p.ratings.sht;
    if (roll) this.send(big, [{ x: sx, y: sy, speed: 1.05, hold: 1.5, screen: true }, { x: HOOP.x + side * 10, y: HOOP.y + 18, speed: 1.05, hold: 0.8 }], side > 0 ? 'RB' : 'LB');
    else this.send(big, [{ x: sx, y: sy, speed: 1.05, hold: 1.5, screen: true }], this.openSlot(['LW', 'RW', 'TOP', 'LS', 'RS'], big));
  }

  /** Arrange the floor for the situation this key moment starts from. */
  private setupScenario(sc: Scenario): void {
    this.scenario = sc;
    this.ft = { left: 0, made: 0 };
    this.lob = false;
    const best = (f: (e: Ent) => number, pool = this.off): number => this.off.indexOf(pool.reduce((a, b) => (f(b) > f(a) ? b : a)));
    const place = (e: Ent, x: number, y: number) => { e.x = x; e.y = y; e.tx = x; e.ty = y; e.vx = 0; e.vy = 0; };
    const putHome = (e: Ent, n: SlotName) => { e.home = n; const q = SLOT[n]; place(e, q[0], q[1]); };
    const setBall = (i: number) => { this.handler = i; const h = this.off[i]; this.lag = { x: h.x, y: h.y }; this.ball.x = h.x; this.ball.y = h.y; };
    const resetDef = () => this.def.forEach((d, i) => { const t = this.defTarget(i); place(d, t.x, t.y); d.slow = 0; });
    const clockTo = (sec: number) => { if (!this.periodEnds) this.shotClock = Math.min(sec, this.clock); };
    if (sc === 'fastbreak') {
      const hi = best(e => e.p.ratings.spd + e.p.ratings.hnd, this.off.slice(0, 3));
      const rest = this.off.map((_, i) => i).filter(i => i !== hi).sort((a, b) => this.off[b].p.ratings.spd - this.off[a].p.ratings.spd);
      const [w1, w2, t1, t2] = rest;
      place(this.off[hi], 120, 214);
      const side = Math.random() < 0.5 ? 1 : -1;
      place(this.off[w1], 120 - side * 62, 196); place(this.off[w2], 120 + side * 62, 196);
      place(this.off[t1], 96, 252); place(this.off[t2], 146, 254);
      // one wing runs to the rim for the lob, the other spots up in the corner
      this.send(this.off[w1], [{ x: HOOP.x - side * 13, y: HOOP.y + 18, speed: 1.1, hold: 1.4 }], side > 0 ? 'LC' : 'RC');
      this.send(this.off[w2], [], side > 0 ? 'RC' : 'LC');
      this.send(this.off[t1], [], 'LS', 1.0); this.send(this.off[t2], [], 'RS', 1.2);
      setBall(hi);
      // only two defenders are back; the rest trail the play
      place(this.def[hi], 120, 132);
      place(this.def[w1], HOOP.x, HOOP.y + 28);
      place(this.def[w2], 120 + side * 52, 250); this.def[w2].slow = 1.8;
      place(this.def[t1], 62, 264); this.def[t1].slow = 2.6;
      place(this.def[t2], 178, 266); this.def[t2].slow = 2.8;
      this.playT = 99; this.driveReacted = true;
      clockTo(10);
    } else if (sc === 'pnr') {
      const al = SETS[6];
      this.off.forEach((e, i) => putHome(e, al[i]));
      place(this.off[0], 120, 196);
      setBall(0); resetDef();
      this.callBallScreen(this.off[4]);
      this.playT = 3;
    } else if (sc === 'post') {
      const bi = best(e => e.p.ratings.fin + e.p.ratings.reb * 0.3, this.off.slice(3));
      const side = Math.random() < 0.5 ? -1 : 1;
      const al: SlotName[] = side < 0 ? ['RS', 'RW', 'LW', 'RC', 'TOP'] : ['LS', 'LW', 'RW', 'LC', 'TOP'];
      let k = 0;
      this.off.forEach((e, i) => { if (i !== bi) putHome(e, al[k++]); });
      this.off[bi].home = side < 0 ? 'LB' : 'RB';
      place(this.off[bi], HOOP.x + side * 34, HOOP.y + 30);
      setBall(bi); resetDef();
      this.grace = 1.4; this.playT = 2.5;
      clockTo(12);
    } else if (sc === 'iso') {
      const si = best(e => e.p.ratings.hnd + e.p.ratings.sht + e.p.ratings.fin);
      const side = Math.random() < 0.5 ? -1 : 1;
      // everyone else clears to the far side
      const far: SlotName[] = side < 0 ? ['RC', 'RW', 'RS', 'RB'] : ['LC', 'LW', 'LS', 'LB'];
      let k = 0;
      this.off.forEach((e, i) => { if (i !== si) putHome(e, far[k++]); });
      this.off[si].home = side < 0 ? 'LW' : 'RW';
      place(this.off[si], HOOP.x + side * 66, 138);
      setBall(si); resetDef();
      this.playT = 99; this.driveReacted = true;
      clockTo(12);
    } else if (sc === 'open') {
      const si = best(e => e.p.ratings.sht);
      const spot = (['RW', 'LW', 'RC', 'LC', 'TOP'] as SlotName[])[Math.floor(Math.random() * 5)];
      const others = PERIMETER.filter(n => n !== spot);
      let k = 0;
      this.off.forEach((e, i) => { if (i !== si) putHome(e, e.slot >= 3 ? (k++ % 2 ? 'LB' : 'RB') : others[(k++ * 2) % others.length]); });
      putHome(this.off[si], spot);
      setBall(si); resetDef();
      // his man is late: he starts well off and closes out
      const h = this.off[si], d = this.def[si];
      const dx = HOOP.x - h.x, dy = HOOP.y - h.y, dl = Math.hypot(dx, dy) || 1;
      place(d, h.x + (dx / dl) * 40, h.y + (dy / dl) * 40); d.slow = 0.5;
      this.lag = { x: d.x, y: d.y };
      clockTo(6);
    } else if (sc === 'lateclock') {
      clockTo(7);
    } else if (sc === 'freethrows') {
      const si = best(e => e.p.ratings.fin + e.p.ratings.hnd * 0.5);
      const lane: [number, number][] = [[PAINT_L - 6, 62], [PAINT_R + 6, 62], [PAINT_L - 6, 84], [150, 150]];
      let k = 0;
      this.off.forEach((e, i) => { if (i !== si) { const q = lane[k++]; place(e, q[0], q[1]); e.home = 'TOP'; e.route = []; } });
      place(this.off[si], HOOP.x, 106);
      setBall(si);
      const dl: [number, number][] = [[PAINT_L - 6, 50], [PAINT_R + 6, 50], [PAINT_R + 6, 74], [PAINT_L - 6, 96], [100, 150]];
      this.def.forEach((d, i) => place(d, dl[i][0], dl[i][1]));
      this.ft = { left: 2, made: 0 };
      this.playT = 99; this.driveReacted = true;
    }
    this.ball.z = 8;
  }
  private get ftMode(): boolean { return this.ft.left > 0; }

  /** The passer does not stand and watch: give-and-go to the rim, or fill an open spot. */
  private afterPass(from: Ent): void {
    if (this.practice) return;
    const sgn = from.x < HOOP.x ? -1 : 1;
    const farFromRim = Math.hypot(from.x - HOOP.x, from.y - HOOP.y) > 70;
    if (farFromRim && Math.random() < 0.5) this.send(from, [{ x: HOOP.x + sgn * 9, y: HOOP.y + 16, speed: 1.1, hold: 0.7 }], this.openSlot(sgn < 0 ? ['RC', 'RW'] : ['LC', 'LW'], from));
    else this.send(from, [], this.openSlot(from.slot >= 3 ? [...INSIDE, 'TOP'] : PERIMETER, from), 0.2);
    this.playT = Math.max(this.playT, 0.9);
  }

  private steer(e: Ent, tx: number, ty: number, sp: number, dt: number): void {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    let vx = 0, vy = 0;
    if (d > 1.5) { const m = Math.min(sp, d * 8); vx = (dx / d) * m; vy = (dy / d) * m; }
    const acc = 1 - Math.exp(-dt * 10);
    e.vx += (vx - e.vx) * acc; e.vy += (vy - e.vy) * acc;
    e.x += e.vx * dt; e.y += e.vy * dt;
  }

  // ---- render -----------------------------------------------------------------------
  private render(): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.court, 0, 0);
    g.translate(0, TOP);
    drawCrowd(g, this.time, this.crowd, this.theme.crowdA, this.theme.crowdB, this.theme.banners ? 6 + Math.min(this.theme.banners, 12) * 10 : 0);
    if (this.shake > 0) g.translate(Math.round((Math.random() - 0.5) * this.shake * 10), Math.round((Math.random() - 0.5) * this.shake * 10));
    if (this.off.length) {
      const s = this.s;
      const clash = colorDist(s.offColors.primary, s.defColors.primary) < 110;
      const dj = clash ? s.defColors.secondary : s.defColors.primary;
      const dt = clash ? s.defColors.primary : s.defColors.secondary;
      const live = this.phase === 'live' || this.phase === 'charge';
      const ents = [...this.off, ...this.def].sort((a, b) => a.y - b.y);
      // pass aim line
      if (this.ptr.down && this.ptr.mode === 'mate' && this.phase === 'live') {
        const m = this.off[this.ptr.mate], h = this.off[this.handler];
        g.fillStyle = PAL.white;
        const n = Math.floor(Math.hypot(m.x - h.x, m.y - h.y) / 5);
        for (let i = 1; i < n; i++) g.fillRect(Math.round(h.x + ((m.x - h.x) * i) / n), Math.round(h.y - 12 + ((m.y - h.y) * i) / n), 1, 1);
      }
      this.drawGuideFloor();
      let hoopDrawn = false;
      for (const e of ents) {
        if (!hoopDrawn && e.y >= HOOP.y - 3) { drawHoop(g, this.netKick, this.rimShake, this.time, this.rimGlow); hoopDrawn = true; }
        const isH = e.off && this.off[this.handler] === e;
        drawPlayer(g, {
          x: e.x, y: e.y, player: e.p, jersey: e.off ? s.offColors.primary : dj, trim: e.off ? s.offColors.secondary : dt,
          run: e.run, face: e.face, lift: e.lift, pose: this.poseOf(e, isH), up: e.off ? e.vy < 14 : e.vy < -14,
          ring: isH && this.phase !== 'pass' && this.phase !== 'idle' ? PAL.yellow : this.ptr.mode === 'mate' && e.off && this.off[this.ptr.mate] === e ? PAL.white : undefined,
          dizzy: e.stun > 0 ? this.time : 0,
        });
      }
      if (!hoopDrawn) drawHoop(g, this.netKick, this.rimShake, this.time, this.rimGlow);
      // a player on fire
      for (const e of this.off) {
        if ((this.hot[e.p.id] ?? 0) < 3) continue;
        for (let k = 0; k < 5; k++) {
          const fy = ((this.time * 28 + k * 5) % 14);
          g.fillStyle = k % 2 ? '#ff8a3c' : PAL.yellow;
          g.fillRect(Math.round(e.x - 5 + k * 2.5 + Math.sin(this.time * 9 + k) * 1.5), Math.round(e.y - e.lift - spriteHeight(e.p) - 2 - fy), 2, 2);
        }
      }
      // star players wear a small gold star over their heads
      for (const e of ents) {
        if (ovr(e.p) < STAR_OVR) continue;
        const sx = Math.round(e.x), sy = Math.round(e.y - e.lift - spriteHeight(e.p) - (e.off && this.off[this.handler] !== e && live ? 16 : 7));
        g.fillStyle = PAL.ink; g.fillRect(sx - 3, sy - 1, 7, 3); g.fillRect(sx - 1, sy - 3, 3, 7);
        g.fillStyle = PAL.yellow; g.fillRect(sx - 2, sy, 5, 1); g.fillRect(sx, sy - 2, 1, 5); g.fillRect(sx - 1, sy - 1, 3, 3);
      }
      // labels
      if (live) {
        let n = 0;
        this.off.forEach((e, i) => {
          if (i === this.handler) return;
          n++;
          const open = this.nearestDef(e.x, e.y).d > 20;
          const top = e.y - spriteHeight(e.p) - 9;
          drawText(g, this.usedKeys ? String(n) : POSITIONS[e.slot], e.x, top, open ? PAL.green : '#e8e0d0', { align: 'center', outline: PAL.ink });
        });
      }
      if (this.phase !== 'idle') drawBall(g, this.ball.x, this.ball.y, this.ball.z);
      for (const sp of this.sparks) { g.fillStyle = sp.t < 0.2 ? PAL.white : PAL.yellow; g.fillRect(Math.round(sp.x), Math.round(sp.y), 2, 2); }
      if (this.phase === 'charge') this.drawAim();
      this.drawGuideOver();
      // joystick
      if (this.ptr.down && this.ptr.mode === 'drag' && this.phase === 'live') {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        const { x0, y0 } = this.ptr;
        for (let a = 0; a < 16; a++) g.fillRect(Math.round(x0 + Math.cos((a / 16) * 6.283) * 10), Math.round(y0 + Math.sin((a / 16) * 6.283) * 10), 1, 1);
        const dx = this.ptr.x - x0, dy = this.ptr.y - y0, d = Math.hypot(dx, dy) || 1, m = Math.min(10, d);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(Math.round(x0 + (dx / d) * m) - 1, Math.round(y0 + (dy / d) * m) - 1, 3, 3);
      }
      // shot clock
      if (this.phase !== 'over' && this.phase !== 'idle' && !this.periodEnds && !this.practice) {
        const sc = Math.ceil(this.shotClock);
        // above the baseline, clear of anyone standing in the corner
        g.fillStyle = PAL.ink; g.fillRect(W - 23, BASE_Y - 21, 19, 14);
        drawText(g, String(sc).padStart(2, '0'), W - 21, BASE_Y - 19, sc <= 5 ? PAL.red : PAL.yellow, { scale: 2 });
      }
    }
    if (!this.off.length) drawHoop(g, this.netKick, 0, this.time);
    g.setTransform(1, 0, 0, 1, 0, TOP);
    for (const p of this.popups) {
      const rise = Math.min(1, p.t * 6);
      const y = p.y - p.t * 10 + (1 - rise) * 6;
      if (p.t > 1.05 && Math.floor(p.t * 30) % 2) continue;
      drawText(g, p.text, W / 2, y, p.color, { scale: p.scale, align: 'center', outline: PAL.ink });
    }
    if (this.phase === 'live' || this.phase === 'charge') this.drawShootButton();
    if (this.flash > 0) { g.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash * 2)})`; g.fillRect(0, -TOP, W, VIEW_H); }
    // blit, crisp
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(c.clientWidth * dpr)), ch = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    this.out.imageSmoothingEnabled = false;
    this.out.drawImage(this.buf, 0, 0, cw, ch);
  }

  private drawShootButton(): void {
    const g = this.g, held = this.btn.down && this.phase === 'charge';
    const disc = (r: number, col: string) => {
      g.fillStyle = col;
      for (let y = -r; y <= r; y++) { const half = Math.floor(Math.sqrt(r * r - y * y)); g.fillRect(BTN.x - half, BTN.y + y, half * 2 + 1, 1); }
    };
    disc(BTN.r, held ? 'rgba(255,138,60,0.95)' : 'rgba(20,18,31,0.55)');
    disc(BTN.r - 2, held ? 'rgba(255,170,90,0.95)' : 'rgba(255,138,60,0.72)');
    const put = this.putback > 0 && !held;
    if (put && Math.floor(this.time * 10) % 2) disc(BTN.r - 2, 'rgba(255,210,60,0.95)');
    drawText(g, held ? 'LET GO' : put ? 'PUT BACK' : 'SHOOT', BTN.x + 1, BTN.y - 2, held || put ? PAL.ink : PAL.white, { align: 'center', outline: held || put ? undefined : PAL.ink });
  }

  private poseOf(e: Ent, isHandler: boolean): Pose {
    if (isHandler) {
      if (this.phase === 'finish' || this.hang > 0) return 'jump';
      if (this.phase === 'charge' || e.armsUp > 0) return 'shoot';
      if (this.phase === 'live') return 'dribble';
      return 'stand';
    }
    if (e.lift > 1) return 'jump';
    if (e.armsUp > 0) return 'shoot';
    if (this.phase === 'rebound' && Math.hypot(e.x - this.reb.x1, e.y - this.reb.y1) < 16) return 'shoot';
    if (!e.off && this.def[this.handler] === e && (this.phase === 'live' || this.phase === 'charge') && e.stun <= 0) return 'defend';
    return 'stand';
  }

  /** Tutorial marks that lie on the floor, under the players. */
  private drawGuideFloor(): void {
    const gd = this.guide, g = this.g;
    if (!gd || this.phase !== 'live') return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    if (gd.target) {
      const { x, y } = gd.target, r = 11 + pulse * 2;
      g.fillStyle = 'rgba(255,210,60,0.22)';
      for (let yy = -8; yy <= 8; yy++) { const half = Math.floor(Math.sqrt(64 - yy * yy) * 1.3); g.fillRect(Math.round(x - half), Math.round(y + yy * 0.6), half * 2, 1); }
      g.fillStyle = PAL.yellow;
      for (let a = 0; a < 20; a++) { if ((a + Math.floor(this.time * 6)) % 2) continue; g.fillRect(Math.round(x + Math.cos((a / 20) * 6.283) * r * 1.3), Math.round(y + Math.sin((a / 20) * 6.283) * r * 0.6), 2, 1); }
      drawText(g, 'GO HERE', x, y - 20, PAL.yellow, { align: 'center', outline: PAL.ink });
    }
    if (gd.mate !== undefined && this.off[gd.mate] && gd.mate !== this.handler) {
      const m = this.off[gd.mate], r = 9 + pulse * 3;
      g.fillStyle = PAL.yellow;
      for (let a = 0; a < 18; a++) g.fillRect(Math.round(m.x + Math.cos((a / 18) * 6.283) * r), Math.round(m.y - 1 + Math.sin((a / 18) * 6.283) * r * 0.5), 2, 1);
    }
  }

  /** Tutorial marks on top of everything: labels and the demo finger. */
  private drawGuideOver(): void {
    const gd = this.guide, g = this.g;
    if (!gd || this.phase !== 'live') return;
    const h = this.off[this.handler];
    if (gd.mate !== undefined && this.off[gd.mate] && gd.mate !== this.handler) {
      const m = this.off[gd.mate];
      drawText(g, 'TAP HIM', m.x, m.y - spriteHeight(m.p) - 18, PAL.yellow, { align: 'center', outline: PAL.ink });
    }
    if (!gd.demo || this.ptr.down) return;
    const t = this.time % 1.6;
    let fx = 0, fy = 0, pressed = true, label = '';
    if (gd.demo === 'hold') {
      // press the shoot button, hold it, lift off
      pressed = t < 1.25;
      fx = BTN.x + 4; fy = BTN.y - 6 - (pressed ? 0 : 6);
      drawText(g, pressed ? 'HOLD THIS' : 'LET GO', BTN.x, BTN.y - BTN.r - 10, PAL.yellow, { align: 'center', outline: PAL.ink });
    } else if (gd.demo === 'faketap') {
      // a quick tap on the shoot button: down and straight back up
      pressed = t % 0.8 < 0.18;
      fx = BTN.x + 4; fy = BTN.y - 6 - (pressed ? 0 : 6);
      drawText(g, 'TAP, DO NOT HOLD', BTN.x - 14, BTN.y - BTN.r - 10, PAL.yellow, { align: 'center', outline: PAL.ink });
    } else if (gd.demo === 'drag') {
      const tx = gd.target?.x ?? HOOP.x, ty = gd.target?.y ?? HOOP.y;
      const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, t / 1.1);
      const sx = clamp(h.x + 34, 20, W - 20), sy = Math.min(H - 20, h.y + 26);
      fx = sx + (dx / d) * 26 * k; fy = sy + (dy / d) * 26 * k; label = 'DRAG';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 6; i++) { const kk = (i / 6) * k; g.fillRect(Math.round(sx + (dx / d) * 26 * kk), Math.round(sy + (dy / d) * 26 * kk), 1, 1); }
    } else if (gd.demo === 'tap') {
      const m = this.off[gd.mate ?? 1] ?? h;
      pressed = t % 0.8 < 0.35;
      fx = m.x + 5; fy = m.y - 10 + (pressed ? 0 : 5); label = '';
    } else {
      const k = Math.min(1, t / 0.22);
      pressed = t < 0.3;
      fx = h.x - 16 + 32 * k; fy = h.y + 26 - 8 * k; label = 'FLICK';
      if (pressed) { g.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 6; i++) g.fillRect(Math.round(h.x - 16 + 32 * k * (i / 6)), Math.round(h.y + 26 - 8 * k * (i / 6)), 1, 1); }
    }
    // a little pointing hand
    const X = Math.round(fx), Y = Math.round(fy);
    g.fillStyle = PAL.ink; g.fillRect(X - 2, Y - 1, 5, 9); g.fillRect(X - 4, Y + 3, 9, 8);
    g.fillStyle = pressed ? PAL.yellow : PAL.white; g.fillRect(X - 1, Y, 3, 7); g.fillRect(X - 3, Y + 4, 7, 6);
    g.fillStyle = PAL.ink; g.fillRect(X - 1, Y + 7, 1, 2); g.fillRect(X + 1, Y + 7, 1, 2);
    if (label) drawText(g, label, X, Y + 13, PAL.white, { align: 'center', outline: PAL.ink });
  }

  /** The aim: a dotted arc from the player to where the ball will come down, and a reticle there. */
  private drawAim(): void {
    const g = this.g, a = this.aim, h = this.off[this.handler];
    const { c } = this.contestAt(h);
    if (!this.ftMode) {
      if (c > 0.3) drawText(g, 'CONTESTED', h.x, h.y + 6, PAL.red, { align: 'center', outline: PAL.ink });
      else if (c < 0.08) drawText(g, 'OPEN', h.x, h.y + 6, PAL.green, { align: 'center', outline: PAL.ink });
    }
    if (a.kind === 'none') {
      // touching him but not pulled yet: show which way to drag
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 12; i++) g.fillRect(Math.round(h.x + Math.cos((i / 12) * 6.283) * 11), Math.round(h.y - 10 + Math.sin((i / 12) * 6.283) * 11), 1, 1);
      return;
    }
    const shot = a.kind === 'shot';
    const ex = a.tx + a.wx, ey = a.ty + a.wy;
    const d = Math.hypot(a.wx, a.wy);
    let col = shot ? (d <= R_SWISH ? PAL.green : d <= R_RIM ? PAL.yellow : PAL.white) : a.kind === 'pass' ? PAL.green : PAL.white;
    if (a.kind === 'lead' && (ex < SIDE_L || ex > SIDE_R || ey < BASE_Y)) col = PAL.red;
    // arc: a shot comes down on the rim, a pass stays low
    const sx = h.x, sy = h.y, zs = spriteHeight(h.p) + 4, ze = shot ? RIM_Z : 12;
    const arc = shot ? 20 + Math.hypot(ex - sx, ey - sy) * 0.14 : 5;
    const n = Math.max(6, Math.floor(Math.hypot(ex - sx, ey - sy) / 6));
    g.fillStyle = col;
    for (let i = 1; i < n; i++) {
      if ((i + Math.floor(this.time * 10)) % 2) continue;
      const k = i / n;
      g.fillRect(Math.round(sx + (ex - sx) * k), Math.round(sy + (ey - sy) * k - (zs + (ze - zs) * k + Math.sin(k * Math.PI) * arc)), 2, 2);
    }
    if (shot) {
      // the reticle sits at rim height: get it over the rim, then let go
      const rx = Math.round(ex), ry = Math.round(ey - RIM_Z + 2);
      g.fillStyle = PAL.ink;
      g.fillRect(rx - 5, ry - 2, 11, 5); g.fillRect(rx - 2, ry - 5, 5, 11);
      g.fillStyle = col;
      g.fillRect(rx - 4, ry, 3, 1); g.fillRect(rx + 2, ry, 3, 1); g.fillRect(rx, ry - 4, 1, 3); g.fillRect(rx, ry + 2, 1, 3);
      g.fillRect(rx, ry, 1, 1);
    } else if (a.kind === 'pass' && this.off[a.mate]) {
      const m = this.off[a.mate];
      for (let i = 0; i < 16; i++) g.fillRect(Math.round(m.x + Math.cos((i / 16) * 6.283) * 10), Math.round(m.y - 1 + Math.sin((i / 16) * 6.283) * 5), 2, 1);
    } else {
      const rx = Math.round(ex), ry = Math.round(ey);
      g.fillRect(rx - 3, ry, 7, 1); g.fillRect(rx, ry - 2, 1, 5);
    }
  }
}

function colorDist(a: string, b: string): number {
  const p = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
