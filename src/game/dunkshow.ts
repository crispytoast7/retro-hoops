// The dunk contest, on your own court with the game's own players. The dunker runs up the middle, jumps
// from a lit strip, and the camera swoops in on the rim for the move in the air and the slam. Some dunks
// bring the court into it: a lob from a teammate on the wing, a teammate crouched in the way, a take-off
// from the free-throw line. Then five judges at a table on the baseline raise their cards.
// Every beat (the jump, the trick, the slam) is a tap to be timed.
import type { Beat, DunkChoice } from '../core/org/allstar';
import { dunkMade } from '../core/org/allstar';
import type { Player } from '../core/types';
import { sfx } from '../audio/sfx';
import { drawText } from './font';
import { HOOP, PAL, RIM_Z, TOP, VIEW_H, W, drawBall, drawCrowd, drawHoop, drawPlayer, makeCourt } from './render';
import type { Pose } from './render';

export interface DunkTheme { paint: string; accent: string; banners: number; wood?: { wood: string; wood2: string; grain: string } }
export interface DunkShowSetup {
  player: Player;
  /** The teammate who throws the lob or crouches in the way. */
  mate?: Player;
  /** Five people for the judges' table. */
  judges?: Player[];
  colors: { primary: string; secondary: string };
  dunk: DunkChoice;
  /** Playing on a computer: prompts name the key. */
  keys: boolean;
  /** Shown at the top, e.g. "DUNK 1 OF 2". */
  label?: string;
}
export interface DunkShowResult { jump: Beat; trick?: Beat; slam: Beat; made: boolean }

// ---- the court ---------------------------------------------------------------------------
const START_Y = 200;                // where the run-up starts, clear of the buttons at the bottom
const END_Y = HOOP.y + 7;           // where he finishes, under the rim
const RIM_Y = HOOP.y - RIM_Z;       // the rim, on screen
const MATE_WING = { x: 198, y: 118 };
const MATE_LANE = { x: 120, y: 74 };
const JUDGE_Y = 248;

// ---- timing ------------------------------------------------------------------------------
const WIN = { perfect: 0.085, good: 0.18, late: 0.31 };      // seconds either side of a beat in the air
const ZONE = { perfect: 5, good: 11, late: 18 };              // pixels either side of the middle of the take-off strip
const RING_LEAD = 0.95;                                        // seconds a ring takes to close

type Phase = 'ready' | 'run' | 'air' | 'slam' | 'fail' | 'cards' | 'done';
interface Popup { text: string; color: string; t: number; x: number; y: number; scale: number }
interface Actor { x: number; y: number; player: Player; pose: Pose; lift: number; up?: boolean; face?: number; tuck?: number; hands?: { x: number; y: number }[]; offArm?: 'down' | 'out'; armsUp?: boolean; run?: number; jersey: string; trim: string }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 before `a`, 1 after `b`, smooth in between. */
const ramp = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hump = (x: number, a: number, b: number, c: number, d: number): number => ramp(x, a, b) * (1 - ramp(x, c, d));
const RATE_TEXT = ['MISSED', 'LATE', 'GOOD', 'PERFECT!'], RATE_COLOR = [PAL.red, '#ffa04d', PAL.white, PAL.green];

export class DunkShow {
  private ctx: CanvasRenderingContext2D;
  private scene: HTMLCanvasElement;
  private sg: CanvasRenderingContext2D;
  private court: HTMLCanvasElement;
  private raf = 0;
  private last = 0;
  private s!: DunkShowSetup;
  private resolve: ((r: DunkShowResult) => void) | null = null;
  private cardsDone: (() => void) | null = null;
  phase: Phase = 'done';
  t = 0;                             // seconds in the current phase
  private time = 0;                  // seconds since the attempt began
  y = START_Y;                       // the dunker on the floor
  private v = 0;
  private y0 = 0;                    // where he took off
  private jump: Beat = 0;
  private trick: Beat | undefined;
  private slam: Beat = 0;
  pending: ('trick' | 'slam')[] = [];
  private slamAt = -1;
  private failKind: 'short' | 'under' | 'clank' | 'drop' = 'clank';
  private popups: Popup[] = [];
  private shake = 0;
  private flash = 0;
  private kick = 0;
  private glow = 0;
  private freeze = 0;
  private cam = { x: W / 2, y: VIEW_H / 2, z: 1 };
  private ball = { x: 0, y: 0, z: 0, free: false, vx: 0, vy: 0, vz: 0 };
  private bursts: { x: number; y: number; vx: number; vy: number; t: number; c: string }[] = [];
  private cards: number[] = [];

  constructor(private canvas: HTMLCanvasElement, theme: DunkTheme) {
    canvas.width = W; canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.scene = document.createElement('canvas'); this.scene.width = W; this.scene.height = VIEW_H;
    this.sg = this.scene.getContext('2d')!; this.sg.imageSmoothingEnabled = false;
    this.court = makeCourt(theme.paint, theme.accent, theme.banners, theme.wood);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('keydown', this.onKey);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { dunkshow?: DunkShow }).dunkshow = this;
  }
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('keydown', this.onKey);
    this.resolve = null; this.cardsDone = null;
  }
  play(setup: DunkShowSetup): Promise<DunkShowResult> {
    this.s = setup;
    this.phase = 'ready'; this.t = 0; this.time = 0;
    this.y = START_Y; this.v = 0; this.jump = 0; this.trick = undefined; this.slam = 0; this.slamAt = -1;
    this.pending = []; this.popups = []; this.bursts = []; this.cards = [];
    this.shake = 0; this.flash = 0; this.kick = 0; this.glow = 0; this.freeze = 0;
    this.ball.free = false;
    this.cam = { x: W / 2, y: VIEW_H / 2, z: 1 };
    return new Promise(res => { this.resolve = res; });
  }
  /** The judges raise their cards, one after another, on the court. */
  showCards(cards: number[]): Promise<void> {
    this.cards = cards.slice(); this.phase = 'cards'; this.t = 0;
    return new Promise(res => { this.cardsDone = res; });
  }

  // ---- the dunk being tried ------------------------------------------------------------------
  private get style(): DunkChoice['style'] { return this.s.dunk.style; }
  private get ease(): number { return this.s.dunk.ease; }
  /** Middle of the take-off strip. */
  get jumpY(): number { return this.style === 'line' ? 108 : this.style === 'over' ? 98 : 86; }
  get airT(): number { return this.s.dunk.trick ? 2.1 : this.style === 'line' ? 1.95 : 1.6; }
  get trickT(): number { return this.airT * (this.style === 'oop' ? 0.52 : this.style === 'over' ? 0.4 : 0.47); }
  private get peak(): number { return this.style === 'over' ? 30 : this.style === 'line' ? 26 : 24; }
  private get trickName(): string { return this.style === 'oop' ? 'CATCH' : this.style === 'over' ? 'CLEAR' : 'TRICK'; }

  // ---- input ---------------------------------------------------------------------------------
  private onDown = (e: PointerEvent): void => { e.preventDefault(); this.tap(); };
  private onKey = (e: KeyboardEvent): void => { if (e.repeat) return; if (e.key === ' ' || e.key === 'Enter') { if (this.phase !== 'done') e.preventDefault(); this.tap(); } };
  private say(text: string, color: string, x: number, y: number, scale = 1): void { this.popups.push({ text, color, t: 0, x, y, scale }); }
  private rate(err: number, w: { perfect: number; good: number; late: number }): Beat {
    const e = Math.abs(err) / this.ease;
    return e <= w.perfect ? 3 : e <= w.good ? 2 : e <= w.late ? 1 : 0;
  }
  tap(): void {
    if (this.phase === 'ready') { if (this.t > 0.25) { this.phase = 'run'; this.t = 0; this.v = 52; sfx.move(); } return; }
    if (this.phase === 'run') {
      const b = this.rate(this.y - this.jumpY, ZONE);
      this.jump = b;
      if (b === 0) { this.say(this.y > this.jumpY ? 'TOO EARLY' : 'TOO LATE', PAL.red, 120, this.y - 34); sfx.bad(); this.fail('short'); return; }
      this.say(b === 3 ? 'PERFECT TAKE-OFF!' : b === 2 ? 'GOOD LIFT' : 'OFF BALANCE', RATE_COLOR[b], 120, this.y - 40);
      if (b === 3) sfx.perfect(); else sfx.good();
      sfx.whoosh();
      this.y0 = this.y; this.phase = 'air'; this.t = 0;
      this.pending = this.s.dunk.trick ? ['trick', 'slam'] : ['slam'];
      return;
    }
    if (this.phase === 'air') {
      const next = this.pending[0];
      if (!next || this.t < 0.22) return;
      const at = next === 'trick' ? this.trickT : this.airT;
      if (this.t < at - RING_LEAD * 0.9) return; // nothing to hit yet: a nervous tap is let go
      const b = this.rate(this.t - at, WIN);
      this.pending.shift();
      const d = this.dunker();
      if (next === 'trick') {
        this.trick = b;
        this.say(b ? (this.style === 'oop' && b >= 2 ? 'CAUGHT IT!' : RATE_TEXT[b]) : this.style === 'oop' ? 'DROPPED IT' : this.style === 'over' ? 'CLIPPED HIM' : 'FUMBLED IT', RATE_COLOR[b], d.x, d.y - d.lift - 34);
        if (b === 3) sfx.perfect(); else if (b) sfx.good(); else sfx.bad();
        if (b === 0 && this.style === 'oop') { this.slam = 0; this.pending = []; this.fail('drop'); }
      } else {
        this.slam = b;
        if (b) this.slamAt = this.t;
        else { this.say('TOO EARLY', PAL.red, HOOP.x, RIM_Y - 14); sfx.bad(); }
      }
    }
  }
  private fail(kind: 'short' | 'under' | 'clank' | 'drop'): void {
    const d = this.dunker();
    this.failKind = kind; this.phase = 'fail'; this.t = 0;
    this.ball.free = true;
    if (kind === 'clank') { this.ball.x = HOOP.x + 3; this.ball.y = HOOP.y; this.ball.z = RIM_Z + 2; this.ball.vx = (Math.random() < 0.5 ? -1 : 1) * 40; this.ball.vy = 46; this.ball.vz = 60; sfx.rim(); this.kick = 0.4; this.shake = 0.5; }
    else if (kind === 'drop') { this.ball.x = d.x + 8; this.ball.y = d.y; this.ball.z = d.lift + 18; this.ball.vx = 30; this.ball.vy = 34; this.ball.vz = 10; }
    else { this.ball.x = 124; this.ball.y = this.y; this.ball.z = 10; this.ball.vx = 0; this.ball.vy = kind === 'short' ? -60 : -20; this.ball.vz = kind === 'short' ? 70 : 20; this.y0 = this.y; }
    sfx.groan();
  }
  private finish(): void {
    const r = this.resolve; this.resolve = null;
    const beats = { jump: this.jump, trick: this.s.dunk.trick ? (this.trick ?? 0) : undefined, slam: this.slam };
    // a lob that was dropped never went down
    const made = dunkMade(beats) && !(this.style === 'oop' && !this.trick);
    this.phase = 'done';
    r?.({ ...beats, made });
  }

  // ---- where everyone is ---------------------------------------------------------------------
  /** Progress through the air, 0 at take-off, 1 with the ball over the rim. */
  private get u(): number { return this.phase === 'air' ? clamp(this.t / this.airT, 0, 1) : this.phase === 'slam' ? 1 : 0; }
  private dunkerY(u: number): number { return lerp(this.y0, END_Y, Math.pow(u, 0.9)); }
  private liftAt(u: number): number { return this.peak * (1 - Math.pow(1 - u, 2.3)); }
  /** The dunker this instant: where he stands, how high he is, and what his body is doing. */
  private dunker(): Actor {
    const p = this.s.player, J = this.s.colors.primary, T = this.s.colors.secondary;
    const base = { player: p, jersey: J, trim: T, x: 120 };
    if (this.phase === 'ready') return { ...base, y: this.y, pose: 'dribble', lift: 0, up: true, face: 0 };
    if (this.phase === 'run') return { ...base, y: this.y, pose: 'dribble', lift: 0, up: true, face: 0, run: this.time * (1.2 + this.v / 70) };
    if (this.phase === 'fail') {
      if (this.failKind === 'clank') { const d = clamp(this.t / 0.42, 0, 1); return { ...base, y: END_Y + 4 * d, pose: d < 1 ? 'jump' : 'stand', lift: lerp(this.peak, 0, d * d), up: false, face: 0, armsUp: d >= 1 }; }
      if (this.failKind === 'drop') { const u0 = this.trickT / this.airT, d = clamp(this.t / 0.5, 0, 1); return { ...base, y: lerp(this.dunkerY(u0), END_Y + 8, d), pose: d < 1 ? 'jump' : 'stand', lift: lerp(this.liftAt(u0), 0, d * d), up: true, face: 0 }; }
      // under: ran past the strip; short: jumped from too far out
      const k = clamp(this.t / 0.7, 0, 1);
      return { ...base, y: this.failKind === 'short' ? this.y0 - 28 * k : this.y, pose: k < 1 && this.failKind === 'short' ? 'jump' : 'stand', lift: this.failKind === 'short' ? 10 * Math.sin(k * Math.PI) : 0, up: true, face: 0, armsUp: k >= 1 };
    }
    if (this.phase === 'cards' || this.phase === 'done') return { ...base, y: END_Y + 22, pose: 'stand', lift: 0, up: false, face: 0, armsUp: true };
    if (this.phase === 'slam') {
      const d = clamp((this.t - 0.45) / 0.35, 0, 1);
      if (d >= 1) return { ...base, y: END_Y + 4, pose: 'stand', lift: 0, up: false, face: 0, armsUp: Math.sin(this.t * 12) > 0 };
      const two = [{ x: HOOP.x - 3, y: RIM_Y + 1 + 4 * d }, { x: HOOP.x + 3, y: RIM_Y + 1 + 4 * d }];
      const back = this.style === 'reverse';
      const both = this.style === 'twohand' || back || this.style === 'spin' || this.style === 'oop';
      return { ...base, y: END_Y, pose: 'jump', lift: lerp(this.peak, 0, d * d), tuck: 2, up: !back, face: 0, hands: both ? two : [{ x: HOOP.x, y: RIM_Y + 1 + 4 * d }], offArm: 'down' };
    }
    // in the air: every dunk has its own shape
    const u = this.u, y = this.dunkerY(u), lift = this.liftAt(u);
    const sh = y - lift - 17;                       // shoulder height on screen
    const reach = ramp(u, 0.82, 1);                 // the last stretch to the rim
    const atRim = (h: { x: number; y: number }, i = 0) => ({ x: lerp(h.x, HOOP.x + (i ? 3 : -3), reach), y: lerp(h.y, RIM_Y + 1, reach) });
    const a: Actor = { ...base, y, pose: 'jump', lift, up: true, face: 0, tuck: Math.round(2 * ramp(u, 0, 0.3)), offArm: 'down' };
    switch (this.style) {
      case 'twohand': { const g = ramp(u, 0.05, 0.5); a.hands = [atRim({ x: 117, y: sh - 4 - 6 * g }), atRim({ x: 123, y: sh - 4 - 6 * g }, 1)]; break; }
      case 'onehand': { const cock = hump(u, 0.15, 0.5, 0.78, 0.95); a.hands = [atRim({ x: 122 + 2 * cock, y: sh - 8 - 10 * cock })]; break; }
      case 'reverse': { a.up = u < 0.55; a.face = u > 0.35 && u < 0.7 ? 1 : 0; const g = ramp(u, 0.1, 0.6); a.hands = [atRim({ x: 118, y: sh - 4 - 6 * g }), atRim({ x: 122, y: sh - 4 - 6 * g }, 1)]; break; }
      case 'windmill': { const ang = 0.4 - 5.6 * ramp(u, 0.1, 0.86), r = 11; a.hands = [atRim({ x: 121 + Math.sin(ang) * r, y: sh + 2 - Math.cos(ang) * r })]; a.offArm = 'out'; break; }
      case 'spin': {
        // four quarter turns on the way up: back to us, side, facing us, other side
        const q = Math.floor(ramp(u, 0.08, 0.86) * 3.999);
        a.up = q === 0 || u > 0.86; a.face = q === 1 ? 1 : q === 3 ? -1 : 0;
        if (q === 2 && u <= 0.86) a.up = false;
        a.hands = [atRim({ x: 119, y: sh - 2 }), atRim({ x: 123, y: sh - 2 }, 1)]; a.tuck = 3; break;
      }
      case 'oop': {
        const caught = u >= this.trickT / this.airT && !!this.trick;
        a.hands = caught ? [atRim({ x: 121, y: sh - 10 }), atRim({ x: 125, y: sh - 10 }, 1)] : [{ x: 125, y: sh - 10 - 4 * ramp(u, 0.2, 0.5) }];
        a.offArm = 'out'; break;
      }
      case 'over': { const split = hump(u, 0.15, 0.35, 0.55, 0.75); a.tuck = Math.round(2 + 3 * split); a.hands = [atRim({ x: 123, y: sh - 8 })]; break; }
      case 'line': { a.tuck = 0; a.hands = [atRim({ x: 121, y: sh - 12 })]; a.offArm = 'out'; break; }
      case 'legs': {
        const under = hump(u, 0.2, 0.38, 0.58, 0.74), pass = ramp(u, 0.28, 0.62);
        a.tuck = Math.round(2 + 3 * under);
        a.hands = u < 0.7 ? [{ x: lerp(114, 127, pass), y: lerp(sh - 6, y - lift - 4, under) }] : [atRim({ x: 122, y: sh - 8 })];
        break;
      }
    }
    return a;
  }
  /** Where the ball is while he has it: in his hands (or between them). */
  private held(a: Actor): { x: number; y: number; z: number } | null {
    if (this.ball.free || !a.hands?.length) return null;
    if (this.style === 'oop' && this.phase === 'air' && !(this.trick && this.u >= this.trickT / this.airT)) return null;
    const hx = a.hands.reduce((s, h) => s + h.x, 0) / a.hands.length, hy = a.hands.reduce((s, h) => s + h.y, 0) / a.hands.length;
    return { x: hx + (a.hands.length > 1 ? 0 : 1), y: hy - 2, z: 0 };
  }

  // ---- the loop ------------------------------------------------------------------------------
  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.phase !== 'done' && this.s) this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };
  private update(dt: number): void {
    this.time += dt;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < 1.3);
    for (const b of this.bursts) { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 50 * dt; }
    this.bursts = this.bursts.filter(b => b.t < 1.4);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.kick = Math.max(0, this.kick - dt * 1.4);
    this.glow = Math.max(0, this.glow - dt * 1.2);
    if (this.freeze > 0) { this.freeze -= dt; return; }
    this.t += dt;
    if (this.phase === 'ready') {
      if (this.t > 4) { this.phase = 'run'; this.t = 0; this.v = 52; }
    } else if (this.phase === 'run') {
      this.v = Math.min(96, this.v + 70 * dt);
      this.y -= this.v * dt;
      if (this.y < this.jumpY - ZONE.late * this.ease - 3) { this.jump = 0; this.say('TOO LATE', PAL.red, 120, this.y - 34); sfx.bad(); this.fail('under'); }
    } else if (this.phase === 'air') {
      const next = this.pending[0];
      if (next) {
        const at = next === 'trick' ? this.trickT : this.airT;
        if (this.t > at + WIN.late * this.ease) {
          this.pending.shift();
          const d = this.dunker();
          if (next === 'trick') {
            this.trick = 0;
            this.say(this.style === 'oop' ? 'DROPPED IT' : this.style === 'over' ? 'CLIPPED HIM' : 'FUMBLED IT', PAL.red, d.x, d.y - d.lift - 34); sfx.bad();
            if (this.style === 'oop') { this.slam = 0; this.pending = []; this.fail('drop'); return; }
          } else { this.slam = 0; this.say('TOO LATE', PAL.red, HOOP.x, RIM_Y - 14); this.fail('clank'); return; }
        }
      }
      if (this.t >= this.airT) {
        if (this.slamAt >= 0) this.doSlam();
        else if (!this.pending.includes('slam')) this.fail('clank');
      }
    } else if (this.phase === 'slam') {
      if (this.t > 1.6) this.finish();
    } else if (this.phase === 'fail') {
      const b = this.ball;
      b.vz -= 220 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.z < 0) { b.z = 0; b.vz = -b.vz * 0.5; b.vx *= 0.7; b.vy *= 0.7; if (b.vz > 25) sfx.bounce(); }
      if (this.failKind === 'under') this.y = Math.max(END_Y + 6, this.y - Math.max(0, 60 - this.t * 90) * dt);
      if (this.t > 1.5) this.finish();
    } else if (this.phase === 'cards') {
      const n = this.cards.length, i = Math.floor((this.t - 0.3) / 0.28);
      if (i >= 0 && i < n && Math.floor((this.t - dt - 0.3) / 0.28) < i) { if (this.cards[i] >= 10) sfx.good(); else sfx.select(); }
      if (this.t > 0.3 + n * 0.28 + 1.1) { this.phase = 'done'; const f = this.cardsDone; this.cardsDone = null; f?.(); }
    }
    // the camera: wide for the run-up, swooping in on the rim while he is in the air, out again for the judges
    const d = this.dunker();
    const air = this.phase === 'air' || (this.phase === 'slam' && this.t < 0.9) || (this.phase === 'fail' && (this.failKind === 'clank' || this.failKind === 'drop') && this.t < 0.8);
    const tz = air ? 2.1 : this.phase === 'slam' ? 1.5 : 1;
    const fy = (d.y - d.lift - 10 + RIM_Y) / 2 + TOP;
    const tx = air ? clamp((d.x + HOOP.x) / 2, W / 2 / tz, W - W / 2 / tz) : W / 2;
    const ty = air ? clamp(fy, VIEW_H / 2 / tz, VIEW_H - VIEW_H / 2 / tz) : this.phase === 'slam' ? clamp(TOP + HOOP.y, VIEW_H / 2 / tz, VIEW_H - VIEW_H / 2 / tz) : VIEW_H / 2;
    const k = Math.min(1, dt * 4.5);
    this.cam.z = lerp(this.cam.z, tz, k); this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
  }
  private doSlam(): void {
    this.phase = 'slam'; this.t = 0;
    const all = [this.jump, this.slam, ...(this.s.dunk.trick ? [this.trick ?? 0] : [])];
    const flawless = all.every(b => b === 3);
    this.freeze = 0.16; this.shake = flawless ? 1.4 : 1; this.flash = flawless ? 1 : 0.6; this.kick = 1; this.glow = 1;
    sfx.dunk(); sfx.cheer(flawless);
    this.say(flawless ? 'FLAWLESS!' : this.slam === 3 ? 'SLAM!' : 'IT GOES DOWN', flawless ? PAL.yellow : RATE_COLOR[this.slam], HOOP.x, RIM_Y - 16, 2);
    const cols = [PAL.yellow, PAL.white, this.s.colors.primary, this.s.colors.secondary];
    for (let i = 0; i < (flawless ? 42 : 16); i++) this.bursts.push({ x: HOOP.x, y: RIM_Y, vx: (Math.random() - 0.5) * 120, vy: -20 - Math.random() * 80, t: 0, c: cols[i % cols.length] });
  }

  // ---- drawing -------------------------------------------------------------------------------
  private draw(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAL.bg; c.fillRect(0, 0, W, VIEW_H);
    if (!this.s) return;
    this.drawScene();
    // the scene, through the camera
    const z = this.cam.z, sw = W / z, sh = VIEW_H / z;
    c.drawImage(this.scene, this.cam.x - sw / 2, this.cam.y - sh / 2, sw, sh, 0, 0, W, VIEW_H);
    if (this.flash > 0) { c.fillStyle = `rgba(255,255,255,${0.5 * this.flash})`; c.fillRect(0, 0, W, VIEW_H); }
    this.drawHud();
  }
  private drawScene(): void {
    const g = this.sg, J = this.s.colors.primary, T = this.s.colors.secondary;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.court, 0, 0);
    g.translate(0, TOP);
    drawCrowd(g, this.time, this.phase === 'slam' || this.phase === 'cards' ? 100 : 80, '#ffd23c', '#ffffff', 0);
    if (this.shake > 0) g.translate(Math.round((Math.random() - 0.5) * this.shake * 4), Math.round((Math.random() - 0.5) * this.shake * 4));
    this.drawFloor(g);
    // everyone on the floor, back to front, the basket in among them
    const d = this.dunker();
    const actors: Actor[] = [d];
    if (this.style === 'oop') actors.push({ x: MATE_WING.x, y: MATE_WING.y, player: this.s.mate ?? this.s.player, pose: 'shoot', lift: 0, face: -1, armsUp: this.phase === 'air' && this.u < 0.4, jersey: J, trim: T });
    if (this.style === 'over') {
      const duck = this.phase === 'air' ? hump(this.u, 0.1, 0.3, 0.55, 0.75) : 0;
      actors.push({ x: MATE_LANE.x, y: MATE_LANE.y + duck, player: this.s.mate ?? this.s.player, pose: 'defend', lift: 0, up: false, face: 0, jersey: J, trim: T });
    }
    actors.push(...this.judgeActors());
    actors.sort((a, b) => a.y - b.y || (a === d ? 1 : -1));
    let hoop = false;
    for (const a of actors) {
      if (!hoop && a.y >= HOOP.y - 3) { drawHoop(g, this.kick, this.shake * 0.7, this.time, this.glow); hoop = true; }
      drawPlayer(g, { x: a.x, y: a.y, player: a.player, jersey: a.jersey, trim: a.trim, run: a.run ?? -1, face: a.face ?? 0, up: a.up, pose: a.pose, lift: a.lift, tuck: a.tuck, hands: a.hands, offArm: a.offArm, armsUp: a.armsUp });
      if (a === d) { const b = this.held(a); if (b) drawBall(g, b.x, b.y, b.z); else if (this.phase === 'ready' || this.phase === 'run') drawBall(g, a.x + 6, a.y, 3 + Math.abs(Math.sin(this.time * 9)) * 7); }
    }
    if (!hoop) drawHoop(g, this.kick, this.shake * 0.7, this.time, this.glow);
    // the lob, in the air on its own until he catches it
    if (this.style === 'oop' && this.phase === 'air' && !(this.trick && this.u >= this.trickT / this.airT)) {
      const u0 = this.trickT / this.airT, k = clamp((this.u - 0.08) / (u0 - 0.08), 0, 1.15);
      const tx = 125, ty = this.dunkerY(u0) - this.liftAt(u0) - 27;
      drawBall(g, lerp(MATE_WING.x, tx, k), lerp(MATE_WING.y - 22, ty, k) - 30 * Math.sin(Math.min(1, k) * Math.PI), 0);
    }
    if (this.ball.free) drawBall(g, this.ball.x, this.ball.y, this.ball.z);
    for (const b of this.bursts) { g.fillStyle = b.c; g.fillRect(Math.round(b.x), Math.round(b.y), 2, 2); }
    this.drawRings(g);
    this.drawCards(g);
  }
  /** The lit lane and the strip to jump from. */
  private drawFloor(g: CanvasRenderingContext2D): void {
    if (this.phase !== 'ready' && this.phase !== 'run') return;
    const e = this.ease, y = this.jumpY;
    g.fillStyle = 'rgba(255,210,60,0.10)'; g.fillRect(108, y - 8, 24, START_Y - y + 12);
    g.globalAlpha = 0.55; g.fillStyle = '#ffa04d'; g.fillRect(102, Math.round(y - ZONE.late * e), 36, Math.round(ZONE.late * e * 2));
    g.globalAlpha = 0.8; g.fillStyle = PAL.white; g.fillRect(102, Math.round(y - ZONE.good * e), 36, Math.round(ZONE.good * e * 2));
    g.globalAlpha = 1; g.fillStyle = PAL.green; g.fillRect(102, Math.round(y - ZONE.perfect * e), 36, Math.round(ZONE.perfect * e * 2));
    if (Math.sin(this.time * 9) > 0 || this.phase === 'ready') drawText(g, 'JUMP', 146, y - 3, PAL.green, { outline: PAL.ink });
  }
  /** The rings that close on the trick and on the rim. */
  private drawRings(g: CanvasRenderingContext2D): void {
    if (this.phase !== 'air') return;
    const next = this.pending[0];
    if (!next) return;
    const at = next === 'trick' ? this.trickT : this.airT, left = at - this.t;
    if (left > RING_LEAD) return;
    let cx = HOOP.x, cy = RIM_Y + 1, target = 9;
    if (next === 'trick') {
      const u = at / this.airT, y = this.dunkerY(u), lift = this.liftAt(u);
      cx = this.style === 'oop' ? 125 : 120; cy = y - lift - (this.style === 'oop' ? 27 : 12); target = this.style === 'oop' ? 7 : 13;
    }
    const r = target + Math.max(0, left / RING_LEAD) * 20;
    const col = Math.abs(left) <= WIN.perfect * this.ease ? PAL.green : Math.abs(left) <= WIN.good * this.ease ? PAL.white : PAL.yellow;
    const ring = (rr: number, cc: string) => { g.fillStyle = cc; const n = Math.max(16, Math.round(rr * 3.2)); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1); } };
    ring(target, 'rgba(255,255,255,0.55)');
    if (left > -WIN.late * this.ease) ring(r, col);
  }
  /** The judges at their table on the baseline, nearest the camera. */
  private judgeActors(): Actor[] {
    // they come out to score it, and only then
    if (this.phase !== 'cards') return [];
    return (this.s.judges ?? []).slice(0, 5).map((p, i) => {
      const raised = this.phase === 'cards' && this.t > 0.3 + i * 0.28;
      return { x: 56 + i * 32, y: JUDGE_Y, player: p, pose: raised ? 'shoot' : 'stand', lift: 0, up: true, face: 0, armsUp: raised, jersey: '#3a3558', trim: '#6b6490' };
    });
  }
  private drawCards(g: CanvasRenderingContext2D): void {
    if (!(this.s.judges?.length) || this.phase !== 'cards') return;
    g.fillStyle = '#1d1a30'; g.fillRect(40, JUDGE_Y - 2, 160, 12);
    g.fillStyle = PAL.yellow; g.fillRect(40, JUDGE_Y - 2, 160, 1);
    this.cards.forEach((v, i) => {
      if (this.t <= 0.3 + i * 0.28) return;
      const x = 56 + i * 32, y = JUDGE_Y - 42;
      g.fillStyle = PAL.ink; g.fillRect(x - 9, y - 1, 18, 14);
      g.fillStyle = v >= 10 ? PAL.yellow : '#f4e9d0'; g.fillRect(x - 8, y, 16, 12);
      drawText(g, String(v), x, y + 3, PAL.ink, { align: 'center' });
    });
  }
  private drawHud(): void {
    const c = this.ctx, how = this.s.keys ? 'SPACE' : 'TAP';
    if (this.phase === 'cards' || this.phase === 'done') return;
    c.fillStyle = 'rgba(11,10,20,0.8)'; c.fillRect(0, 4, W, this.s.label ? 30 : 18);
    drawText(c, this.s.dunk.name, W / 2, 8, PAL.yellow, { align: 'center', outline: PAL.ink });
    if (this.s.label) drawText(c, this.s.label, W / 2, 21, '#cfcaea', { align: 'center', outline: PAL.ink });
    // the beats of this dunk, lit as they come and coloured by how they went
    const beats: [string, Beat | undefined, boolean][] = [['JUMP', this.phase === 'ready' || this.phase === 'run' ? undefined : this.jump, this.phase === 'run']];
    if (this.s.dunk.trick) beats.push([this.trickName, this.trick, this.phase === 'air' && this.pending[0] === 'trick']);
    beats.push(['SLAM', this.phase === 'slam' || this.phase === 'fail' || (this.phase === 'air' && !this.pending.includes('slam')) ? this.slam : undefined, this.phase === 'air' && this.pending[0] === 'slam']);
    const bw = 64, x0 = W / 2 - (beats.length * bw) / 2, y = VIEW_H - 26;
    beats.forEach(([name, b, live], i) => {
      const x = x0 + i * bw;
      c.fillStyle = 'rgba(11,10,20,0.85)'; c.fillRect(x + 2, y, bw - 4, 18);
      c.fillStyle = b !== undefined ? RATE_COLOR[b] : live ? PAL.yellow : '#3d3966'; c.fillRect(x + 2, y + 16, bw - 4, 2);
      drawText(c, name, x + bw / 2, y + 5, b !== undefined ? RATE_COLOR[b] : live && Math.sin(this.time * 10) > 0 ? PAL.yellow : '#cfcaea', { align: 'center', outline: PAL.ink });
    });
    const prompt = this.phase === 'ready' ? `${how} TO START YOUR RUN`
      : this.phase === 'run' ? `${how} ON THE GREEN STRIP`
      : this.phase === 'air' && this.pending[0] === 'trick' ? (this.style === 'oop' ? `${how} TO CATCH THE LOB` : `${how} WHEN THE RING CLOSES`)
      : this.phase === 'air' && this.pending[0] === 'slam' ? `${how} WHEN THE RING CLOSES ON THE RIM` : '';
    if (prompt) drawText(c, prompt, W / 2, VIEW_H - 42, PAL.white, { align: 'center', outline: PAL.ink });
    for (const p of this.popups) {
      // popups belong to the scene, so they follow the camera
      if (p.t > 0.9 && Math.floor(p.t * 12) % 2) continue;
      const x = (p.x - this.cam.x) * this.cam.z + W / 2, yy = (p.y + TOP - this.cam.y) * this.cam.z + VIEW_H / 2 - p.t * 14;
      drawText(c, p.text, clamp(x, 60, W - 60), clamp(yy, 40, VIEW_H - 60), p.color, { align: 'center', outline: PAL.ink, scale: p.scale });
    }
  }
}
