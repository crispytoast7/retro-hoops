// The hand-played possession: input, movement, defender AI, shot meter, passes, drives,
// rebounds. Reads player ratings, returns a list of PlayEvents for the sim to score.
import type { Difficulty, Player } from '../core/types';
import type { PlayEvent, ShotType, UserPossessionOutcome, UserPossessionSetup } from '../core/sim/api';
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
}
export interface Guide {
  /** A spot to dribble to; the possession ends when the ball-handler gets there. */
  target?: { x: number; y: number };
  /** Teammate (lineup slot 1-4) to highlight as the pass target. */
  mate?: number;
  /** End the possession as soon as a pass is caught. */
  endOnCatch?: boolean;
  /** Animated finger showing the gesture. */
  demo?: 'hold' | 'drag' | 'tap' | 'flick';
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
  /** Timing of the last jump shot: 3 perfect, 2 good, 1 early/late, 0 way off, -1 none taken. */
  quality: number;
}
export interface ArcadeTheme { paint: string; accent: string; banners: number; crowdA: string; crowdB: string; wood?: { wood: string; wood2: string; grain: string } }

// ---- tuning -------------------------------------------------------------------------
/** Game-clock seconds per real second. */
const TIME_SCALE = 1.6;
const DIFF: Record<Difficulty, { window: number; lag: number; steal: number; dspd: number; make: number; move: number }> = {
  easy:   { window: 1.3, lag: 0.30, steal: 0.6, dspd: 0.93, make: 0.04, move: 0.1 },
  normal: { window: 1.0, lag: 0.20, steal: 1.0, dspd: 1.0, make: 0, move: 0 },
  hard:   { window: 0.8, lag: 0.13, steal: 1.3, dspd: 1.05, make: -0.03, move: -0.08 },
};
const HOLD_TO_SHOOT = 0.16;   // seconds of still press before the meter starts
const DRAG_START = 6;         // px before a press becomes a drag
const SWIPE_TIME = 0.24;      // a drag shorter than this, released, is a handles move
const SWIPE_DIST = 16;
const STICK_MAX = 22;         // px of drag for full speed
const MATE_PICK_R = 18;
const RIM_ZONE = 25;          // auto layup/dunk distance
const BODY = 7;               // handler/defender collision distance
const METER_CENTER = 0.8;

const SPOTS: number[][][] = [
  [[120, 165], [92, 172], [148, 172]],
  [[204, 118], [223, 46], [178, 150]],
  [[36, 118], [17, 46], [62, 150]],
  [[160, 96], [146, 60], [120, 114]],
  [[94, 60], [104, 86], [88, 48]],
];
const CALLS = {
  move: ['ANKLES!', 'SHOOK!', 'CROSSED UP!', 'SEE YA!'],
  swish: ['SWISH!', 'SPLASH!', 'NOTHING BUT NET!', 'WET!'],
  made: ['BUCKET!', 'GOT IT!', 'COUNT IT!', 'MONEY!'],
  three: ['FROM DEEP!', 'BANG!', 'THREE!', 'DOWNTOWN!'],
  dunk: ['SLAM!', 'THROWDOWN!', 'BOOM!', 'POSTER!'],
  layup: ['LAYUP!', 'TWO!', 'EASY!', 'FINGER ROLL!'],
  miss: ['CLANK!', 'NO GOOD', 'RIMMED OUT', 'OFF THE IRON'],
  air: ['AIRBALL!', 'BRICK!'],
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
  relocate: number; spot: number; cut: number;
}
export type Phase = 'idle' | 'live' | 'pass' | 'charge' | 'shot' | 'finish' | 'rebound' | 'over';
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
  private rimShake = 0;
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
  private meter = { v: 0, dur: 0.7, hw: 0.1, three: false, contest: 0 };
  private shot = { t: 0, dur: 0, x0: 0, y0: 0, made: false, type: 'mid' as ShotType, quality: 0, blockBy: -1, foul: false, pts: 2, text: '', buzzer: false, x1: 0, y1: 0, arc: 30, z0: 30 };
  private reb = { t: 0, dur: 0.6, x0: 0, y0: 0, x1: 0, y1: 0, winner: null as Ent | null };
  private slowmo = 1;
  // input
  private ptr = { down: false, id: -1, x0: 0, y0: 0, x: 0, y: 0, t0: 0, mode: 'none' as 'none' | 'press' | 'drag' | 'mate', mate: -1 };
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
    this.reached = false; this.lastQuality = -1; this.hang = 0;
    this.passes = 0; this.moves = 0;
    const mk = (p: Player, slot: number, off: boolean): Ent => ({
      p, slot, off, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, stun: 0, slow: 0, run: -1, face: 0,
      armsUp: 0, lift: 0, relocate: 1.5 + Math.random() * 2.5, spot: 0, cut: 0,
    });
    this.off = setup.offense.slice(0, 5).map((p, i) => mk(p, i, true));
    this.def = setup.defense.slice(0, 5).map((p, i) => mk(p, i, false));
    this.off.forEach((e, i) => { const sp = SPOTS[i][0]; e.x = sp[0]; e.y = sp[1]; e.tx = e.x; e.ty = e.y; });
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
    if (this.ptr.down) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const p = this.toLogical(e);
    Object.assign(this.ptr, { down: true, id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: this.time, mode: 'press', mate: -1 });
    if (this.phase === 'live') {
      let best = -1, bd = MATE_PICK_R;
      this.off.forEach((m, i) => {
        if (i === this.handler) return;
        const d = Math.hypot(p.x - m.x, p.y - (m.y - 12));
        if (d < bd) { bd = d; best = i; }
      });
      // A press on the handler himself always controls the handler.
      const hh = this.off[this.handler];
      if (best >= 0 && Math.hypot(p.x - hh.x, p.y - (hh.y - 12)) > bd) { this.ptr.mode = 'mate'; this.ptr.mate = best; }
    }
  };
  private onMove = (e: PointerEvent) => {
    if (!this.ptr.down || e.pointerId !== this.ptr.id) return;
    const p = this.toLogical(e);
    this.ptr.x = p.x; this.ptr.y = p.y;
    const moved = Math.hypot(p.x - this.ptr.x0, p.y - this.ptr.y0);
    if (this.ptr.mode === 'press' && this.phase === 'live' && moved > DRAG_START) this.ptr.mode = 'drag';
    // dragging away early in the meter cancels the shot (a pump fake) and goes back to dribbling
    else if (this.ptr.mode === 'press' && this.phase === 'charge' && moved > 12 && this.meter.v < 0.5) { this.phase = 'live'; this.ptr.mode = 'drag'; }
  };
  private onUp = (e: PointerEvent) => {
    if (!this.ptr.down || e.pointerId !== this.ptr.id) return;
    const pt = this.ptr;
    pt.down = false;
    const dx = pt.x - pt.x0, dy = pt.y - pt.y0, d = Math.hypot(dx, dy);
    if (this.phase === 'charge') this.release();
    else if (this.phase === 'live') {
      if (pt.mode === 'mate' && pt.mate >= 0) this.startPass(pt.mate);
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
    if (k === ' ') this.startCharge();
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
    if (k === ' ' && this.phase === 'charge') this.release();
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
      const gap = Math.min(this.practice ? 26 : 13, d * 0.6);
      return { x: this.lag.x + (dx / d) * gap, y: this.lag.y + (dy / d) * gap };
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
        this.popup(pick(CALLS.move), PAL.yellow, 2);
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

  private startCharge(): void {
    if (this.phase !== 'live') return;
    const h = this.off[this.handler];
    const sht = h.p.ratings.sht / 100;
    const three = isThree(h.x, h.y);
    const dist = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    const distM = dist > 135 ? 0.55 : three ? 0.8 : 1;
    this.meter = {
      v: 0, three, contest: 0,
      dur: (0.55 + 0.25 * sht) * (three ? 0.94 : 1),
      hw: 0.085 * (0.55 + 0.9 * sht) * distM * this.diff.window * (1 + 0.05 * this.s.ocStars) * (1 + 0.08 * this.pk.shooting) * (this.practice ? 1.3 : 1),
    };
    h.vx = 0; h.vy = 0;
    this.phase = 'charge';
  }

  private release(): void {
    if (this.phase !== 'charge') return;
    const h = this.off[this.handler];
    const sht = h.p.ratings.sht / 100;
    const { c, by } = this.contestAt(h);
    const hw = this.meter.hw * (1 - 0.45 * c);
    const off = Math.abs(this.meter.v - METER_CENTER);
    const late = this.meter.v >= 1;
    const q = late ? 0 : off <= hw ? 3 : off <= hw * 2.2 ? 2 : off <= hw * 4 ? 1 : 0;
    this.lastQuality = q;
    const three = this.meter.three;
    const dist = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    let p = (three ? 0.19 + 0.29 * sht : 0.28 + 0.29 * sht) + [-0.22, -0.08, 0.05, 0.21][q];
    if (dist > 135) p -= 0.12 + (dist - 135) * 0.004;
    if (dist < 40) p += 0.06;
    p -= 0.17 * c;
    if (c < 0.08) p += 0.05;
    p += 0.01 * this.s.ocStars + this.diff.make;
    p = clamp(p, 0.03, 0.95);
    const made = Math.random() < p;
    let blockBy = -1, foul = false;
    if (by && c > 0.7 && !made && Math.random() < 0.06 + 0.16 * (by.p.ratings.def / 100)) blockBy = by.p.id;
    if (by && c > 0.6 && blockBy < 0 && Math.random() < 0.05) foul = true;
    if (q === 3) { sfx.perfect(); this.highlights.push('perfect'); }
    const label = ['WAY OFF', q === 1 && this.meter.v < METER_CENTER ? 'EARLY' : 'LATE', 'GOOD', 'PERFECT!'][q];
    this.popup(late ? 'TOO LATE' : label, [PAL.red, '#ffa04d', PAL.white, PAL.green][q], 1, h.y - 46);
    this.launch(h, made, three ? 'three' : 'mid', three ? 3 : 2, q, blockBy, foul);
  }

  private launch(h: Ent, made: boolean, type: ShotType, pts: number, quality: number, blockBy: number, foul: boolean): void {
    const dist = Math.hypot(h.x - HOOP.x, h.y - HOOP.y);
    h.armsUp = 0.6; h.lift = 5;
    let x1 = HOOP.x, y1 = HOOP.y;
    if (!made) {
      const air = quality === 0 && type !== 'layup' && type !== 'dunk' && Math.random() < 0.3;
      const a = Math.random() * Math.PI * 2, r = air ? 11 : 5;
      x1 += Math.cos(a) * r; y1 += Math.sin(a) * r * 0.6;
      if (air) this.shot.text = 'air';
    }
    this.shot = {
      t: 0, dur: type === 'three' || type === 'mid' ? 0.55 + dist / 240 : type === 'dunk' ? 0.62 : 0.52, x0: h.x, y0: h.y, z0: spriteHeight(h.p) + 6, made, type, quality, blockBy, foul, pts,
      text: !made && this.shot.text === 'air' ? 'air' : '', buzzer: false, x1, y1, arc: 20 + dist * 0.14,
    };
    if (blockBy >= 0) { this.shot.dur = type === 'three' || type === 'mid' ? 0.16 : 0.34; this.shot.x1 = h.x + (HOOP.x - h.x) * 0.15; this.shot.y1 = h.y + (HOOP.y - h.y) * 0.15; }
    if (this.periodEnds && this.clock <= 2.5) { this.shot.buzzer = true; this.slowmo = 0.45; }
    this.phase = 'shot';
  }

  private finishAtRim(): void {
    const h = this.off[this.handler];
    const fin = h.p.ratings.fin / 100;
    const near = this.def.filter(d => d.stun <= 0).map(d => ({ d, dist: Math.hypot(d.x - h.x, d.y - h.y) })).filter(o => o.dist < 17).sort((a, b) => a.dist - b.dist);
    const cv = (o?: { d: Ent; dist: number }) => (o ? (1 - o.dist / 17) * (0.4 + 0.6 * o.d.p.ratings.def / 100) + 0.15 : 0);
    const c1 = cv(near[0]), c2 = cv(near[1]);
    const open = near.length === 0 || near[0].dist > 13;
    const dunk = h.p.ratings.fin >= 68 && (open || (h.p.ratings.fin >= 86 && c1 < 0.6));
    let p = dunk
      ? (open ? 0.96 : 0.6 + 0.3 * fin - 0.3 * c1)
      : 0.6 + 0.38 * fin - 0.3 * c1 - 0.12 * c2;
    p = clamp(p + this.diff.make + 0.04 * this.pk.rim, 0.08, 0.97);
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

  private turnover(kind: 'steal' | 'oob' | 'shotclock' | 'intercept', by: Ent | null): void {
    const h = this.off[this.phase === 'pass' ? this.pass.from : this.handler];
    this.events.push({ t: 'tov', by: h.p.id, kind, ...(by ? { stealBy: by.p.id } : {}) });
    if (kind === 'steal') { this.popup(pick(CALLS.steal), PAL.red, 2); sfx.steal(); if (by) { this.ball.x = by.x; this.ball.y = by.y; } }
    else if (kind === 'intercept') { this.popup(pick(CALLS.pick), PAL.red, 2); sfx.steal(); }
    else if (kind === 'oob') { this.popup('OUT OF BOUNDS', PAL.red, 2); sfx.whistle(); }
    else { this.popup('SHOT CLOCK!', PAL.red, 2); sfx.buzzer(); }
    this.crowd = Math.max(0, this.crowd - 6);
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
    const assist = this.assist && this.time - this.assist.t < 2.4 && this.assist.id !== h.p.id ? this.assist.id : undefined;
    const buzzer = sh.buzzer || (this.periodEnds && this.clock <= 0);
    if (sh.made) {
      this.events.push({ t: 'shot', by: h.p.id, type: sh.type, made: true, ...(assist !== undefined ? { assist } : {}) });
      this.points += sh.pts;
      this.netKick = 1;
      this.dropping = true;
      this.ball.x = HOOP.x; this.ball.y = HOOP.y; this.ball.z = RIM_Z + 1;
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
    else { this.popup(pick(CALLS.miss), '#c8c8d8', 1, 120); sfx.rim(); }
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
    this.update(dt * this.slowmo);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    for (const p of this.popups) p.t += dt / Math.max(0.5, this.slowmo);
    this.popups = this.popups.filter(p => p.t < 1.25);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.netKick = Math.max(0, this.netKick - dt * 2.2);
    this.rimShake = Math.max(0, this.rimShake - dt * 2);
    this.hang = Math.max(0, this.hang - dt);
    if (this.phase !== this.lastPhase) { this.lastPhase = this.phase; this.onPhase?.(this.phase); }
    if (this.phase === 'idle') return;
    if (this.phase === 'over') {
      this.overT -= dt;
      if (this.dropping && this.ball.z > 0) { this.ball.z = Math.max(0, this.ball.z - dt * 42); this.ball.x += (HOOP.x - this.ball.x) * 0.3; }
      this.moveAll(dt, true);
      if (this.overT <= 0) {
        this.phase = 'idle';
        this.slowmo = 1;
        const seconds = clamp(Math.round(this.startClock - this.clock), 2, Math.max(2, Math.round(this.startClock)));
        const r = this.resolve; this.resolve = null;
        r?.({ outcome: { events: this.events, seconds }, highlights: this.highlights, points: this.points, passes: this.passes, moves: this.moves, reached: this.reached, quality: this.lastQuality });
      }
      return;
    }
    // clocks
    const live = this.phase === 'live' || this.phase === 'pass' || this.phase === 'charge';
    if (!this.practice) this.clock = Math.max(0, this.clock - dt * TIME_SCALE);
    if (live && !this.practice) this.shotClock = Math.max(0, this.shotClock - dt * TIME_SCALE);
    this.onClock?.(this.clock, this.periodEnds ? -1 : this.shotClock);
    this.grace = Math.max(0, this.grace - dt);
    this.dash.cd = Math.max(0, this.dash.cd - dt);
    if (live && this.shotClock <= 0) {
      if (this.periodEnds) { this.popup('TIME!', PAL.white, 2); sfx.buzzer(); this.end(1.2); }
      else this.turnover('shotclock', null);
      return;
    }
    const h = this.off[this.handler];

    if (this.phase === 'live') {
      // start the shot meter on a still hold
      if (this.ptr.down && this.ptr.mode === 'press' && this.time - this.ptr.t0 > HOLD_TO_SHOOT) { this.startCharge(); }
    }
    if (this.phase === 'live') {
      // movement intent
      let mx = 0, my = 0;
      if (this.ptr.down && this.ptr.mode === 'drag') {
        const dx = this.ptr.x - this.ptr.x0, dy = this.ptr.y - this.ptr.y0, d = Math.hypot(dx, dy);
        if (d > 2) { const m = Math.min(1, d / STICK_MAX); mx = (dx / d) * m; my = (dy / d) * m; }
      } else { const k = this.keyVec(); mx = k.x; my = k.y; }
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
        if (dd < 9 && this.grace <= 0 && !this.practice) {
          let rate = clamp(0.12 + 0.4 * (d.p.ratings.def / 100) - 0.42 * (h.p.ratings.hnd / 100), 0.03, 0.5) * this.diff.steal * (1 - 0.06 * this.pk.handles);
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
      this.meter.v += dt / this.meter.dur;
      h.armsUp = 0.1;
      h.vx = 0; h.vy = 0;
      if (this.meter.v >= 1) { this.meter.v = 1; this.release(); }
    } else if (this.phase === 'pass') {
      const ps = this.pass;
      ps.t += dt;
      const k = Math.min(1, ps.t / ps.dur);
      this.ball.x = ps.x0 + (ps.x1 - ps.x0) * k;
      this.ball.y = ps.y0 + (ps.y1 - ps.y0) * k;
      this.ball.z = 13 + Math.sin(k * Math.PI) * 4;
      const from = this.off[ps.from];
      const travelled = Math.hypot(this.ball.x - ps.x0, this.ball.y - ps.y0);
      const left = Math.hypot(ps.x1 - this.ball.x, ps.y1 - this.ball.y);
      if (travelled > 12 && left > 9) {
        for (const d of this.def) {
          if (this.practice || d.stun > 0 || ps.checked.has(d.p.id)) continue;
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
        if (Math.hypot(to.x - ps.x1, to.y - ps.y1) > 14) { // bad pass sails away
          this.turnover('oob', null); return;
        }
        this.assist = { id: from.p.id, t: this.time };
        this.handler = ps.to;
        if (this.guide?.endOnCatch) { this.popup('GOOD PASS!', PAL.green, 2); sfx.good(); this.phase = 'live'; this.end(0.9); return; }
        this.def[ps.to].slow = 0.45; // the closeout arrives a beat late: catch-and-shoot is worth it
        this.dribbleT = 0;
        this.grace = 0.35;
        this.lag = { x: to.x, y: to.y };
        this.phase = 'live';
        // a press held through the catch goes straight into a shot
        if (this.ptr.down) { this.ptr.mode = 'press'; this.ptr.x0 = this.ptr.x; this.ptr.y0 = this.ptr.y; this.ptr.t0 = this.time - HOLD_TO_SHOOT * 0.5; }
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
      const peak = dunk ? RIM_Z - reach + 5 : RIM_Z - reach - 2;
      const rise = dunk ? 0.8 : 0.6;
      h.lift = Math.max(0, peak) * Math.sin(Math.min(1, k / rise) * Math.PI * 0.5);
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
          this.popup(pick(CALLS.board), PAL.green, 2); sfx.good();
          this.highlights.push('oreb');
          this.handler = this.off.indexOf(w);
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
    this.off.forEach((e, i) => {
      e.stun = Math.max(0, e.stun - dt); e.slow = Math.max(0, e.slow - dt);
      e.armsUp = Math.max(0, e.armsUp - dt);
      if (this.phase !== 'finish' && !(this.hang > 0 && i === this.handler)) e.lift = Math.max(0, e.lift - dt * 30);
      const controlled = i === this.handler && (this.phase === 'live' || this.phase === 'charge' || this.phase === 'finish' || this.phase === 'shot');
      if (!controlled) {
        if (rebounding && Math.hypot(e.x - this.reb.x1, e.y - this.reb.y1) < 60) { e.tx = this.reb.x1; e.ty = this.reb.y1 + 3; }
        else if (this.phase === 'pass' && i === this.pass.to) { e.tx = this.pass.x1; e.ty = this.pass.y1; }
        else if (!over) {
          e.relocate -= dt;
          if (e.cut > 0) { e.cut -= dt; if (e.cut <= 0) e.relocate = 0; }
          if (e.relocate <= 0) {
            e.relocate = 2.2 + Math.random() * 3;
            if ((e.slot === 1 || e.slot === 2) && Math.random() < 0.28) {
              e.cut = 1.5; e.tx = HOOP.x + (e.x < HOOP.x ? -15 : 15); e.ty = HOOP.y + 20;
            } else {
              const opts = SPOTS[e.slot];
              let sp = opts[Math.floor(Math.random() * opts.length)];
              if (Math.hypot(sp[0] - h.x, sp[1] - h.y) < 34) sp = opts.slice().sort((a, b) => Math.hypot(b[0] - h.x, b[1] - h.y) - Math.hypot(a[0] - h.x, a[1] - h.y))[0];
              e.tx = sp[0]; e.ty = sp[1];
            }
          }
        }
        this.steer(e, e.tx, e.ty, this.speed(e) * 0.85, dt);
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
      let t = this.defTarget(i);
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
      this.steer(d, t.x, t.y, this.speed(d) * this.diff.dspd * (i === this.handler ? 0.9 : 0.9) * (d.slow > 0 ? 0.45 : 1) * (this.practice ? 0.7 : 1), dt);
      const sp = Math.hypot(d.vx, d.vy);
      d.run = sp > 5 ? (d.run < 0 ? 0 : d.run + dt * 5) : -1;
      d.face = Math.abs(d.vx) > 4 ? (d.vx > 0 ? 1 : -1) : 0;
    });
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
        if (!hoopDrawn && e.y >= HOOP.y - 3) { drawHoop(g, this.netKick, this.rimShake, this.time); hoopDrawn = true; }
        const isH = e.off && this.off[this.handler] === e;
        drawPlayer(g, {
          x: e.x, y: e.y, player: e.p, jersey: e.off ? s.offColors.primary : dj, trim: e.off ? s.offColors.secondary : dt,
          run: e.run, face: e.face, lift: e.lift, pose: this.poseOf(e, isH), up: e.off ? e.vy < 14 : e.vy < -14,
          ring: isH && this.phase !== 'pass' && this.phase !== 'idle' ? PAL.yellow : this.ptr.mode === 'mate' && e.off && this.off[this.ptr.mate] === e ? PAL.white : undefined,
          dizzy: e.stun > 0 ? this.time : 0,
        });
      }
      if (!hoopDrawn) drawHoop(g, this.netKick, this.rimShake, this.time);
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
      if (this.phase === 'charge') this.drawMeter();
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
        g.fillStyle = PAL.ink; g.fillRect(W - 23, BASE_Y + 3, 19, 14);
        drawText(g, String(sc).padStart(2, '0'), W - 21, BASE_Y + 5, sc <= 5 ? PAL.red : PAL.yellow, { scale: 2 });
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
    if (this.flash > 0) { g.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash * 2)})`; g.fillRect(0, -TOP, W, VIEW_H); }
    // blit, crisp
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(c.clientWidth * dpr)), ch = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    this.out.imageSmoothingEnabled = false;
    this.out.drawImage(this.buf, 0, 0, cw, ch);
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
      fx = clamp(h.x + 36, 20, W - 20); fy = Math.min(H - 16, h.y + 26); label = 'HOLD STILL';
      const r = 4 + ((this.time * 10) % 8);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (let a = 0; a < 14; a++) g.fillRect(Math.round(fx + Math.cos((a / 14) * 6.283) * r), Math.round(fy + Math.sin((a / 14) * 6.283) * r), 1, 1);
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

  private drawMeter(): void {
    const g = this.g;
    const h = this.off[this.handler];
    const MH = 40, MW = 6;
    const x = Math.round(h.x + (h.x > W - 30 ? -18 : 12));
    const y = Math.round(clamp(h.y - 44, 4, H - MH - 4));
    const { c } = this.contestAt(h);
    const hw = this.meter.hw * (1 - 0.45 * c);
    g.fillStyle = PAL.ink; g.fillRect(x - 1, y - 1, MW + 2, MH + 2);
    g.fillStyle = '#3a3558'; g.fillRect(x, y, MW, MH);
    const zone = (half: number, col: string) => {
      const top = clamp(METER_CENTER + half, 0, 1), bot = clamp(METER_CENTER - half, 0, 1);
      g.fillStyle = col;
      g.fillRect(x, Math.round(y + MH * (1 - top)), MW, Math.max(1, Math.round(MH * (top - bot))));
    };
    zone(hw * 2.2, '#b9902a');
    zone(hw, PAL.green);
    const my = Math.round(y + MH * (1 - this.meter.v));
    g.fillStyle = PAL.white; g.fillRect(x - 2, my - 1, MW + 4, 2);
    g.fillStyle = PAL.ink; g.fillRect(x - 2, my + 1, MW + 4, 1);
    if (c > 0.3) drawText(g, 'CONTESTED', x + MW / 2, y + MH + 3, PAL.red, { align: 'center', outline: PAL.ink });
    else if (c < 0.08) drawText(g, 'OPEN', x + MW / 2, y + MH + 3, PAL.green, { align: 'center', outline: PAL.ink });
  }
}

function colorDist(a: string, b: string): number {
  const p = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
