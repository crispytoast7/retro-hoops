// The dunk contest: one man, one rim, seen from the side. The run-up, the jump, the move in the air and
// the slam are each a beat to be timed. The dunker is a small jointed figure posed in three dimensions and
// turned about his own axis before he is drawn, so a 360 really turns and a windmill really goes round.
import type { Beat, DunkChoice } from '../core/org/allstar';
import { dunkMade } from '../core/org/allstar';
import type { Player } from '../core/types';
import { sfx } from '../audio/sfx';
import { HAIR, PAL, SKIN, VIEW_H, W, shade } from './render';

export interface DunkShowSetup {
  player: Player;
  /** A teammate to jump over, for the dunk that needs one. */
  mate?: Player;
  colors: { primary: string; secondary: string };
  dunk: DunkChoice;
  /** Playing on a computer: prompts name the key. */
  keys: boolean;
  /** Shown at the top, e.g. "DUNK 1 OF 2". */
  label?: string;
}
export interface DunkShowResult { jump: Beat; trick?: Beat; slam: Beat; made: boolean }

// ---- the stage ---------------------------------------------------------------------------
const K = 1.5;                     // how big the dunker is drawn: poses are written at size 1
const FLOOR = 252;                 // where feet stand
const FAR = 124;                   // where the floor meets the stands
const RIM = { x: 203, y: FLOOR - 58 * K };
const BOARD_X = 219;
const START_X = 20;
const REACH = 9;                   // how far in front of his hip the ball is when it goes through (at size 1)
const STAND = FLOOR - 13.4 * K;    // hip height when he stands

// ---- timing, in real seconds -------------------------------------------------------------
const WIN = { perfect: 0.085, good: 0.18, late: 0.31 };
const ZONE = { perfect: 5, good: 11, late: 18 }; // the take-off strip, in pixels either side of its middle
const RING_LEAD = 0.95;

type Phase = 'ready' | 'run' | 'air' | 'slam' | 'fail' | 'done';
interface V3 { f: number; u: number; s: number }  // forward, up, sideways (towards the camera)
interface Popup { text: string; color: string; t: number; x: number; y: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 before `a`, 1 after `b`, smooth in between. */
const ramp = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Up to 1 between a and b, back down to 0 between c and d. */
const hump = (x: number, a: number, b: number, c: number, d: number): number => ramp(x, a, b) * (1 - ramp(x, c, d));
const RATE_TEXT = ['MISSED', 'LATE', 'GOOD', 'PERFECT!'], RATE_COLOR = [PAL.red, '#ffa04d', PAL.white, PAL.green];

/** What the body is doing at one instant: everything the figure needs to be drawn. */
interface Pose {
  yaw: number;                      // turn about his own axis: 0 faces the rim, PI has his back to it
  lean: number;                     // torso tips forward
  legF: [number, number]; legB: [number, number]; // thigh angle from straight down (forward +), knee bend
  /** Where each hand is, relative to the hip (forward, up). */
  handF: [number, number]; handB: [number, number];
  /** Which hand has the ball: both, the front one, the back one, or nobody (it is in the air). */
  hold: 'both' | 'F' | 'B' | 'none';
}

export class DunkShow {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private s!: DunkShowSetup;
  private resolve: ((r: DunkShowResult) => void) | null = null;
  private phase: Phase = 'done';
  private t = 0;                    // seconds in the current phase
  private time = 0;                 // seconds since the attempt began
  private x = START_X;              // hip position along the floor
  private v = 0;
  private x0 = 0;                   // where he took off
  private jump: Beat = 0;
  private trick: Beat | undefined;
  private slam: Beat = 0;
  private pending: ('trick' | 'slam')[] = [];
  private slamAt = -1;              // air time at which a good slam tap came
  private failKind: 'short' | 'under' | 'clank' = 'clank';
  private popups: Popup[] = [];
  private shake = 0;
  private flash = 0;
  private rimBend = 0;
  private freeze = 0;
  private cam = { x: W / 2, y: VIEW_H / 2, z: 1 };
  private ball = { x: 0, y: 0, free: false, vx: 0, vy: 0 };
  private bursts: { x: number; y: number; vx: number; vy: number; t: number; c: string }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = W; canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
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
    this.resolve = null;
  }
  play(setup: DunkShowSetup): Promise<DunkShowResult> {
    this.s = setup;
    this.phase = 'ready'; this.t = 0; this.time = 0;
    this.x = START_X; this.v = 0; this.jump = 0; this.trick = undefined; this.slam = 0; this.slamAt = -1;
    this.pending = []; this.popups = []; this.bursts = [];
    this.shake = 0; this.flash = 0; this.rimBend = 0; this.freeze = 0;
    this.ball.free = false;
    this.cam = { x: W / 2, y: VIEW_H / 2, z: 1 };
    return new Promise(res => { this.resolve = res; });
  }

  // ---- the dunk being tried ------------------------------------------------------------------
  private get style(): DunkChoice['style'] { return this.s.dunk.style; }
  private get ease(): number { return this.s.dunk.ease; }
  /** Middle of the take-off strip. */
  private get jumpX(): number { return this.style === 'line' ? 98 : this.style === 'over' ? 132 : 146; }
  /** Real seconds he is in the air. */
  private get airT(): number { return this.s.dunk.trick ? 2.3 : this.style === 'line' ? 2.05 : 1.75; }
  private get trickT(): number { return this.airT * 0.47; }
  private get peak(): number { return (this.style === 'over' ? 35 : this.style === 'line' ? 28 : 30.5) * K; }
  private get mateX(): number { return 166; }

  // ---- input ---------------------------------------------------------------------------------
  private onDown = (e: PointerEvent): void => { e.preventDefault(); this.tap(); };
  private onKey = (e: KeyboardEvent): void => { if (e.repeat) return; if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.tap(); } };
  private say(text: string, color: string, x: number, y: number): void { this.popups.push({ text, color, t: 0, x, y }); }
  private rate(err: number, w: { perfect: number; good: number; late: number }): Beat {
    const e = Math.abs(err) / this.ease;
    return e <= w.perfect ? 3 : e <= w.good ? 2 : e <= w.late ? 1 : 0;
  }
  private tap(): void {
    if (this.phase === 'ready') { if (this.t > 0.25) { this.phase = 'run'; this.t = 0; this.v = 52; sfx.move(); } return; }
    if (this.phase === 'run') {
      const b = this.rate(this.x - this.jumpX, ZONE);
      this.jump = b;
      if (b === 0) { this.say(this.x < this.jumpX ? 'TOO EARLY' : 'TOO LATE', PAL.red, this.x, FLOOR - 66); sfx.bad(); this.fail('short'); return; }
      this.say(b === 3 ? 'PERFECT TAKE-OFF!' : b === 2 ? 'GOOD LIFT' : 'OFF BALANCE', RATE_COLOR[b], this.x, FLOOR - 70);
      if (b === 3) sfx.perfect(); else sfx.good();
      sfx.whoosh();
      this.x0 = this.x; this.phase = 'air'; this.t = 0;
      this.pending = this.s.dunk.trick ? ['trick', 'slam'] : ['slam'];
      return;
    }
    if (this.phase === 'air') {
      const next = this.pending[0];
      if (!next || this.t < 0.22) return; // the tap that jumped is still on the screen
      const at = next === 'trick' ? this.trickT : this.airT;
      // nothing to hit yet: a nervous tap long before the ring arrives is let go
      if (this.t < at - RING_LEAD * 0.9) return;
      const b = this.rate(this.t - at, WIN);
      this.pending.shift();
      const hip = this.hip();
      if (next === 'trick') {
        this.trick = b;
        this.say(b ? RATE_TEXT[b] : 'FUMBLED IT', RATE_COLOR[b], hip.x, hip.y - 46);
        if (b === 3) sfx.perfect(); else if (b) sfx.good(); else sfx.bad();
      } else {
        this.slam = b;
        if (b) this.slamAt = this.t;
        else { this.say('TOO EARLY', PAL.red, RIM.x - 10, RIM.y - 30); sfx.bad(); }
      }
    }
  }
  private fail(kind: 'short' | 'under' | 'clank'): void {
    this.failKind = kind; this.phase = 'fail'; this.t = 0; this.x0 = this.x;
    const h = this.hip();
    this.ball.free = true; this.ball.x = h.x + 9; this.ball.y = h.y - 22;
    if (kind === 'short') { this.ball.vx = 66; this.ball.vy = -128; }
    else if (kind === 'under') { this.ball.vx = 30; this.ball.vy = -20; }
    else { this.ball.x = RIM.x + 6; this.ball.y = RIM.y - 5; this.ball.vx = -62; this.ball.vy = -120; sfx.rim(); this.rimBend = 0.5; this.shake = 2; }
    sfx.groan();
  }
  private finish(): void {
    this.phase = 'done';
    const r = this.resolve; this.resolve = null;
    const beats = { jump: this.jump, trick: this.s.dunk.trick ? (this.trick ?? 0) : undefined, slam: this.slam };
    r?.({ ...beats, made: dunkMade(beats) });
  }

  // ---- where he is ---------------------------------------------------------------------------
  /** Progress through the air, 0 at take-off, 1 with the ball over the rim. */
  private get u(): number { return this.phase === 'air' ? clamp(this.t / this.airT, 0, 1) : this.phase === 'slam' ? 1 : 0; }
  private height(u: number): number { return this.peak * (1 - Math.pow(1 - u, 2.3)); }
  /** Hip position on screen. */
  private hip(): { x: number; y: number; z: number } {
    const stand = STAND;
    if (this.phase === 'air' || this.phase === 'slam') {
      let u = this.u, z = this.height(u);
      const end = RIM.x - REACH * K;
      let x = lerp(this.x0, end, Math.pow(u, 0.9));
      if (this.phase === 'slam') {
        // hang on the rim for a moment, then drop
        const d = clamp((this.t - 0.5) / 0.38, 0, 1);
        z = lerp(this.peak - 4, 0, d * d); x = end - 4 * d; u = 1;
      }
      return { x, y: stand - z, z };
    }
    if (this.phase === 'fail' && this.failKind === 'short') {
      const u = clamp(this.t / 0.75, 0, 1), z = 19 * Math.sin(u * Math.PI);
      return { x: this.x0 + 34 * u, y: stand - z, z };
    }
    if (this.phase === 'fail' && this.failKind === 'clank') {
      const d = clamp(this.t / 0.42, 0, 1), z = lerp(this.peak, 0, d * d);
      return { x: RIM.x - REACH * K - 5 * d, y: stand - z, z };
    }
    return { x: this.x, y: stand, z: 0 };
  }

  // ---- how he holds himself ------------------------------------------------------------------
  private pose(): Pose {
    const st = this.style, u = this.u;
    if (this.phase === 'ready') {
      const b = Math.abs(Math.sin(this.t * 6));
      return { yaw: 0, lean: 0.12, legF: [0.15, -0.25], legB: [-0.1, -0.2], handF: [5, -1 - 3 * b], handB: [-3, 4], hold: 'F' };
    }
    if (this.phase === 'run' || (this.phase === 'fail' && this.failKind === 'under')) {
      const k = this.phase === 'run' ? 1 : clamp(1 - this.t * 1.6, 0, 1);
      const c = Math.sin(this.time * (9 + this.v * 0.06)) * k;
      return { yaw: 0, lean: 0.3 * k + 0.05, legF: [0.9 * c, -0.5 - 0.6 * Math.max(0, -c)], legB: [-0.9 * c, -0.5 - 0.6 * Math.max(0, c)],
        handF: this.phase === 'run' ? [6, -2 - 4 * Math.abs(c)] : [3, -22], handB: this.phase === 'run' ? [-4 + 3 * c, 5] : [-3, -22], hold: this.phase === 'run' ? 'F' : 'none' };
    }
    if (this.phase === 'fail') {
      // head in hands
      return { yaw: 0, lean: 0.25, legF: [0.2, -0.3], legB: [-0.2, -0.3], handF: [3, -24], handB: [1, -24], hold: 'none' };
    }
    if (this.phase === 'slam') {
      const d = clamp((this.t - 0.5) / 0.38, 0, 1);
      if (d >= 1) {
        // landed: arms up, soaking it in
        const w = Math.sin(this.t * 14) * 1.5;
        return { yaw: -1.1, lean: -0.1, legF: [0.25, -0.1], legB: [-0.25, -0.1], handF: [6, -24 + w], handB: [-6, -24 - w], hold: 'none' };
      }
      const back = st === 'reverse';
      return { yaw: back ? Math.PI : 0, lean: back ? -0.2 : 0.2, legF: [0.7 - 0.5 * d, -1.1 + 0.8 * d], legB: [0.2, -0.9 + 0.6 * d],
        handF: back ? [-REACH, -20 + 6 * d] : [REACH, -20 + 6 * d], handB: st === 'twohand' || back ? (back ? [-REACH + 1, -20 + 6 * d] : [REACH - 1, -20 + 6 * d]) : [-5, -6], hold: 'none' };
    }
    // ---- in the air: every dunk has its own shape ----
    const tuck: [number, number] = [0.75 * ramp(u, 0, 0.3), -1.25 * ramp(u, 0, 0.35)];
    const trail: [number, number] = [-0.25 + 0.5 * ramp(u, 0.2, 0.7), -0.9 * ramp(u, 0, 0.4)];
    const up = ramp(u, 0.82, 1);                        // the last reach to the rim
    const over: [number, number] = [REACH - 1, -23 + 2 * up];
    let p: Pose = { yaw: 0, lean: 0.15, legF: tuck, legB: trail, handF: over, handB: [-5, -4], hold: 'F' };
    if (st === 'twohand') {
      const g = ramp(u, 0.05, 0.5);
      p.handF = [lerp(5, 3, g) + (REACH - 4) * up, lerp(-8, -25, g) + 3 * up]; p.handB = [p.handF[0] - 1, p.handF[1]]; p.hold = 'both';
    } else if (st === 'onehand') {
      // cocked back behind the head, then thrown forward
      const cock = hump(u, 0.15, 0.55, 0.8, 0.98);
      p.handF = [lerp(5, -6, cock) + (REACH - 5) * up, lerp(-10, -25, ramp(u, 0.05, 0.5)) + 3 * up];
      p.lean = 0.1 - 0.3 * cock; p.handB = [6, -10];
    } else if (st === 'reverse') {
      p.yaw = Math.PI * ramp(u, 0.2, 0.68);
      const g = ramp(u, 0.1, 0.6);
      p.handF = [lerp(5, -REACH + 1, g), lerp(-8, -24, g) + 2 * up]; p.handB = [p.handF[0] + 1, p.handF[1]]; p.hold = 'both';
      p.lean = 0.15 - 0.4 * g;
    } else if (st === 'windmill') {
      // the ball arm goes all the way round: down, back, over the top
      const a = 0.7 - 4.9 * ramp(u, 0.1, 0.9), r = 10.5;
      p.handF = [Math.sin(a) * r + (REACH - 6) * up, -11 + Math.cos(a) * r]; p.handB = [5, -12]; p.lean = 0.1 + 0.15 * Math.sin(a);
    } else if (st === 'spin') {
      p.yaw = Math.PI * 2 * ramp(u, 0.08, 0.86);
      const g = ramp(u, 0.74, 0.98);
      p.handF = [lerp(3, REACH - 1, g), lerp(-9, -22, g)]; p.handB = [p.handF[0] - 1, p.handF[1] + 1]; p.hold = 'both';
      p.legF = [0.5, -1.3]; p.legB = [0.3, -1.2];
    } else if (st === 'legs') {
      // the lead leg comes up, the ball goes under it from the back hand to the front
      const kick = hump(u, 0.18, 0.4, 0.62, 0.8);
      p.legF = [lerp(tuck[0], 1.55, kick), lerp(tuck[1], -0.15, kick)];
      const pass = ramp(u, 0.38, 0.58);
      const low: [number, number] = [lerp(-4, 9, pass), lerp(1, 2, pass) + 2 * Math.sin(pass * Math.PI)];
      const g = ramp(u, 0.6, 0.95);
      if (u < 0.6) { p.hold = pass < 0.5 ? 'B' : 'F'; p.handB = pass < 0.5 ? low : [-4, -6]; p.handF = pass < 0.5 ? [7, -8] : low; }
      else { p.hold = 'F'; p.handF = [lerp(9, REACH - 1, g), lerp(3, -22, g)]; p.handB = [-5, -8]; }
      p.lean = 0.2 + 0.25 * kick;
    } else if (st === 'line') {
      // flat and long, legs walking on air
      const c = Math.sin(u * Math.PI * 5);
      p.legF = [0.9 * c, -0.7 + 0.3 * c]; p.legB = [-0.9 * c, -0.7 - 0.3 * c];
      p.lean = 0.42 - 0.2 * up;
      p.handF = [lerp(7, REACH, up), lerp(-17, -21, up)]; p.handB = [-7, -9];
    } else if (st === 'board') {
      // empty hands until the ball comes back off the glass
      const caught = u >= 0.47;
      p.hold = caught ? 'both' : 'none';
      const g = ramp(u, 0.47, 0.9);
      p.handF = caught ? [lerp(6, REACH - 1, g), lerp(-22, -22, g) + 2 * up] : [6, lerp(-10, -22, ramp(u, 0.1, 0.45))];
      p.handB = [p.handF[0] - 1, p.handF[1]];
    } else if (st === 'over') {
      // legs split wide to clear the man underneath
      const split = hump(u, 0.15, 0.4, 0.7, 0.9);
      p.legF = [lerp(tuck[0], 1.5, split), lerp(tuck[1], -0.25, split)]; p.legB = [lerp(trail[0], -1.35, split), lerp(trail[1], -0.3, split)];
      p.handF = [lerp(5, REACH - 1, ramp(u, 0.5, 0.95)), lerp(-12, -23, ramp(u, 0.05, 0.5)) + 2 * up]; p.handB = [-6, -12];
    }
    return p;
  }

  // ---- the loop ------------------------------------------------------------------------------
  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.phase !== 'done') this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };
  private update(dt: number): void {
    this.time += dt;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < 1.3);
    for (const b of this.bursts) { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 60 * dt; }
    this.bursts = this.bursts.filter(b => b.t < 1.4);
    this.shake = Math.max(0, this.shake - dt * 9);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.rimBend = Math.max(0, this.rimBend - dt * 2.2);
    if (this.freeze > 0) { this.freeze -= dt; return; }
    this.t += dt;
    if (this.phase === 'ready') {
      if (this.t > 4) { this.phase = 'run'; this.t = 0; this.v = 52; }
    } else if (this.phase === 'run') {
      this.v = Math.min(96, this.v + 70 * dt);
      this.x += this.v * dt;
      if (this.x > this.jumpX + ZONE.late * this.ease + 3) { this.jump = 0; this.say('TOO LATE', PAL.red, this.x, FLOOR - 66); sfx.bad(); this.fail('under'); }
    } else if (this.phase === 'air') {
      // a beat nobody tapped for goes by
      const next = this.pending[0];
      if (next) {
        const at = next === 'trick' ? this.trickT : this.airT;
        if (this.t > at + WIN.late * this.ease) {
          this.pending.shift();
          if (next === 'trick') { this.trick = 0; const h = this.hip(); this.say('FUMBLED IT', PAL.red, h.x, h.y - 46); sfx.bad(); }
          else { this.slam = 0; this.say('TOO LATE', PAL.red, RIM.x - 10, RIM.y - 30); this.fail('clank'); return; }
        }
      }
      if (this.t >= this.airT) {
        if (this.slamAt >= 0) this.doSlam();
        else if (!this.pending.includes('slam')) this.fail('clank'); // tapped far too early
      }
    } else if (this.phase === 'slam') {
      if (this.t > 2.05) this.finish();
    } else if (this.phase === 'fail') {
      this.ball.vy += 210 * dt; this.ball.x += this.ball.vx * dt; this.ball.y += this.ball.vy * dt;
      if (this.failKind === 'short' && this.ball.vx > 0 && this.ball.x > RIM.x - 13 && this.ball.y > RIM.y - 8) { this.ball.vx = -54; this.ball.vy = -70; sfx.rim(); this.rimBend = 0.4; this.shake = 1.5; }
      if (this.ball.y > FLOOR - 5 && this.ball.vy > 0) { this.ball.y = FLOOR - 5; this.ball.vy *= -0.55; this.ball.vx *= 0.7; if (Math.abs(this.ball.vy) > 25) sfx.bounce(); }
      if (this.failKind === 'under') { this.v = Math.max(0, this.v - 190 * dt); this.x = Math.min(RIM.x + 2, this.x + this.v * dt); }
      if (this.t > 1.5) this.finish();
    }
    // the camera closes in while he is in the air
    const h = this.hip();
    const airborne = this.phase === 'air' || (this.phase === 'slam' && this.t < 0.9);
    const tz = airborne ? 1.5 : this.phase === 'slam' ? 1.2 : 1;
    const tx = airborne ? clamp((h.x * 2 + RIM.x) / 3 + 4, W / 2 / tz, W - W / 2 / tz) : W / 2;
    const ty = airborne ? clamp(h.y - 26, VIEW_H / 2 / tz, VIEW_H - VIEW_H / 2 / tz) : VIEW_H / 2;
    const k = Math.min(1, dt * 5);
    this.cam.z = lerp(this.cam.z, tz, k); this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
  }
  private doSlam(): void {
    this.phase = 'slam'; this.t = 0;
    const all = [this.jump, this.slam, ...(this.s.dunk.trick ? [this.trick ?? 0] : [])];
    const flawless = all.every(b => b === 3);
    this.freeze = 0.16; this.shake = flawless ? 7 : 4.5; this.flash = flawless ? 1 : 0.6; this.rimBend = 1;
    sfx.dunk(); sfx.cheer(flawless);
    this.say(flawless ? 'FLAWLESS!' : this.slam === 3 ? 'SLAM!' : 'IT GOES DOWN', flawless ? PAL.yellow : RATE_COLOR[this.slam], RIM.x - 20, RIM.y - 40);
    const cols = [PAL.yellow, PAL.white, this.s.colors.primary, this.s.colors.secondary];
    for (let i = 0; i < (flawless ? 46 : 16); i++) this.bursts.push({ x: RIM.x, y: RIM.y, vx: (Math.random() - 0.5) * 150, vy: -30 - Math.random() * 120, t: 0, c: cols[i % cols.length] });
  }

  // ---- drawing -------------------------------------------------------------------------------
  private px(x: number, y: number, w: number, h: number, c: string): void { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  private draw(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0c0a16'; c.fillRect(0, 0, W, VIEW_H);
    if (!this.s) return;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    c.setTransform(this.cam.z, 0, 0, this.cam.z, W / 2 - this.cam.x * this.cam.z + sx, VIEW_H / 2 - this.cam.y * this.cam.z + sy);
    this.drawArena();
    const h = this.hip();
    // his shadow shrinks as he rises
    const sw = Math.max(6, 20 - h.z * 0.2);
    c.fillStyle = 'rgba(8,7,14,0.4)'; c.fillRect(Math.round(h.x - sw / 2), FLOOR + 1, Math.round(sw), 3); c.fillRect(Math.round(h.x - sw / 2 + 2), FLOOR, Math.round(sw - 4), 5);
    this.drawHoop(false);
    if (this.style === 'over') this.drawMate();
    // afterimages on the way up make the flight read as speed
    if (this.phase === 'air') for (const back of [0.09, 0.045]) {
      const t0 = this.t; this.t = Math.max(0, t0 - back);
      c.globalAlpha = back > 0.06 ? 0.16 : 0.28; this.drawDunker(); c.globalAlpha = 1; this.t = t0;
    }
    this.drawDunker();
    this.drawHoop(true);
    for (const b of this.bursts) this.px(b.x, b.y, 2, 2, b.c);
    this.drawGuides();
    c.setTransform(1, 0, 0, 1, 0, 0);
    // the house lights go down while he is in the air: the edges of the picture fall away
    const dark = this.phase === 'air' ? ramp(this.t, 0, 0.4) : this.phase === 'slam' ? 1 - ramp(this.t, 0.5, 1.1) : 0;
    if (dark > 0) for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(8,7,14,${0.08 * dark})`; c.fillRect(0, 0, W, 54 - i * 8); c.fillRect(0, 0, 30 - i * 5, VIEW_H); }
    if (this.flash > 0) { c.fillStyle = `rgba(255,255,255,${0.55 * this.flash})`; c.fillRect(0, 0, W, VIEW_H); }
    this.drawHud();
  }
  private drawArena(): void {
    const c = this.ctx, t = this.time;
    // the stands, eight rows deep, and the people in them
    for (let row = 0; row < 8; row++) {
      const y = 22 + row * 12, depth = row / 8;
      c.fillStyle = shade('#2b2748', 0.5 + depth * 0.55); c.fillRect(-60, y, W + 120, 12);
      for (let i = -7; i < 44; i++) {
        const seed = (i * 37 + row * 91 + 800) % 100;
        const x = i * 8 + (row % 2) * 4;
        const loud = this.phase === 'slam' || (this.phase === 'air' && seed < 45);
        const upp = loud && Math.sin(t * (7 + (seed % 5)) + seed) > 0.1 ? 2 : 0;
        c.fillStyle = [this.s.colors.primary, '#4b4470', this.s.colors.secondary, '#6b6490', '#3a3558', '#55507a'][seed % 6];
        c.fillRect(x, y + 5 - upp, 6, 6);
        c.fillStyle = SKIN[seed % 5]; c.fillRect(x + 1, y + 2 - upp, 4, 3);
        c.fillStyle = HAIR[(seed >> 2) % 5]; c.fillRect(x + 1, y + 2 - upp, 4, 1);
        if (upp) { c.fillStyle = SKIN[seed % 5]; c.fillRect(x - 1, y, 1, 4); c.fillRect(x + 6, y, 1, 4); }
        // cameras going off while he is in the air
        if ((this.phase === 'air' || this.phase === 'slam') && Math.sin(t * 23 + seed * 7.3) > 0.985) { c.fillStyle = '#ffffff'; c.fillRect(x + 1, y + 1 - upp, 3, 3); }
      }
    }
    c.fillStyle = '#0c0a16'; c.fillRect(-60, -40, W + 120, 62);
    // a rail, then the floor running away from the camera in bands
    c.fillStyle = '#14121f'; c.fillRect(-60, FAR - 6, W + 120, 6);
    c.fillStyle = '#3d3966'; c.fillRect(-60, FAR - 6, W + 120, 1);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const y0 = FAR + (FLOOR - FAR) * Math.pow(i / n, 1.7), y1 = FAR + (FLOOR - FAR) * Math.pow((i + 1) / n, 1.7);
      c.fillStyle = i % 2 ? PAL.wood2 : PAL.wood; c.fillRect(-60, Math.round(y0), W + 120, Math.ceil(y1 - y0) + 1);
    }
    // the far sideline, and the painted key lying back under the rim
    c.fillStyle = PAL.line; c.fillRect(-60, FAR + 5, W + 120, 1);
    for (let y = FAR + 16; y < FLOOR; y++) {
      const k = (y - FAR) / (FLOOR - FAR), x0 = Math.round(lerp(162, 146, k)), x1 = Math.round(lerp(214, 232, k));
      c.fillStyle = this.s.colors.primary; c.globalAlpha = 0.5; c.fillRect(x0, y, x1 - x0, 1); c.globalAlpha = 1;
      c.fillStyle = PAL.line; c.fillRect(x0 - 1, y, 1, 1);
    }
    c.fillStyle = PAL.line; c.fillRect(162, FAR + 15, 52, 1);
    // the front of the floor, nearest the camera
    c.fillStyle = shade(PAL.wood, 0.94); c.fillRect(-60, FLOOR, W + 120, VIEW_H - FLOOR + 60);
    c.fillStyle = PAL.line; c.fillRect(-60, FLOOR + 8, W + 120, 1);
    // the judges, at their table on the far side
    const jx = 22, jy = FAR + 22;
    for (let i = 0; i < 5; i++) {
      const x = jx + i * 13;
      c.fillStyle = ['#3a3558', '#55507a', '#4b4470', '#6b6490', '#3a3558'][i]; c.fillRect(x, jy - 9, 8, 9);
      c.fillStyle = SKIN[(i * 2 + 1) % 5]; c.fillRect(x + 2, jy - 15, 5, 6);
      c.fillStyle = HAIR[(i * 3) % 5]; c.fillRect(x + 2, jy - 15, 5, 2);
    }
    c.fillStyle = '#1d1a30'; c.fillRect(jx - 4, jy - 3, 72, 11);
    c.fillStyle = PAL.yellow; c.fillRect(jx - 4, jy - 3, 72, 1);
    this.text('JUDGES', jx + 32, jy + 3, '#cfcaea', 5);
  }
  /** The stanchion, the glass and the rim. The front of the rim is drawn over the dunker, the rest behind him. */
  private drawHoop(front: boolean): void {
    const c = this.ctx, bend = Math.round(this.rimBend * 4 * Math.abs(Math.sin(this.rimBend * 9)));
    if (!front) {
      c.fillStyle = '#23203a'; c.fillRect(BOARD_X + 8, RIM.y - 22, 5, FLOOR - RIM.y + 22); c.fillRect(BOARD_X + 3, RIM.y - 16, 8, 4);
      c.fillStyle = '#14121f'; c.fillRect(BOARD_X + 5, FLOOR - 4, 12, 5);
      c.fillStyle = PAL.board; c.fillRect(BOARD_X, RIM.y - 36, 4, 46);
      c.fillStyle = '#bcbcd0'; c.fillRect(BOARD_X + 3, RIM.y - 36, 1, 46);
      c.fillStyle = PAL.red; c.fillRect(BOARD_X, RIM.y - 16, 1, 13);
      c.fillStyle = shade(PAL.rim, 0.7); c.fillRect(RIM.x - 12, RIM.y + bend, 28, 2);
      return;
    }
    c.fillStyle = PAL.rim; c.fillRect(RIM.x - 13, RIM.y + 2 + bend, 30, 3);
    // the net swings when it is hit
    const kick = Math.round(Math.sin(this.rimBend * 14) * 3 * this.rimBend);
    c.fillStyle = PAL.net;
    for (let i = 0; i < 6; i++) {
      const x = RIM.x - 11 + i * 5;
      c.fillRect(x + Math.round(kick * (i / 5)), RIM.y + 5 + bend, 1, 6); c.fillRect(x + 2 + kick, RIM.y + 11 + bend, 1, 6);
    }
    c.fillRect(RIM.x - 10 + kick, RIM.y + 10 + bend, 24, 1); c.fillRect(RIM.x - 8 + kick, RIM.y + 17 + bend, 18, 1);
  }
  /** The teammate he jumps over: bent at the waist, ducking as he goes by. */
  private drawMate(): void {
    const duck = this.phase === 'air' ? hump(this.u, 0.1, 0.4, 0.75, 0.95) : 0;
    const m = this.s.mate ?? this.s.player;
    this.figure(m, this.mateX, STAND + 3 * duck, { yaw: Math.PI, lean: 0.55 + 0.25 * duck, legF: [0.25, -0.35], legB: [-0.1, -0.3], handF: [4, 2], handB: [3, 2], hold: 'none' }, false, shade(this.s.colors.primary, 0.75));
  }
  private drawDunker(): void {
    const h = this.hip(), p = this.pose();
    this.figure(this.s.player, h.x, h.y, p, true, this.s.colors.primary);
  }
  /**
   * The jointed figure. Every joint is placed in his own space (forward, up, sideways), turned by `yaw`
   * about his spine, and dropped flat onto the screen; the far limbs are drawn first and a shade darker.
   */
  private figure(pl: Player, hx: number, hy: number, p: Pose, withBall: boolean, jersey: string): void {
    const skin = SKIN[pl.look.skin % 5], hair = HAIR[pl.look.hairColor % 5];
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    // screen x of a point: forward swings with the turn, sideways comes into view as he turns
    const X = (v: V3): number => hx + v.f * cy + v.s * sy;
    const Y = (v: V3): number => hy - v.u;
    const depth = (v: V3): number => -v.f * sy + v.s * cy; // larger is nearer the camera
    const tall = [0.92, 1, 1.08][Math.max(0, Math.min(2, pl.look.height))];
    const z = K * tall;
    const L = { thigh: 7 * z, shin: 6.5 * z, torso: 11 * z, arm: 5.6 * z };
    const neck: V3 = { f: Math.sin(p.lean) * L.torso, u: Math.cos(p.lean) * L.torso, s: 0 };
    const limbs: { pts: V3[]; w: number; col: string; d: number; hand?: boolean }[] = [];
    const leg = (side: number, a: [number, number]): void => {
      const hip: V3 = { f: 0, u: 0, s: side * 3 };
      const knee: V3 = { f: Math.sin(a[0]) * L.thigh, u: -Math.cos(a[0]) * L.thigh, s: side * 3 };
      const foot: V3 = { f: knee.f + Math.sin(a[0] + a[1]) * L.shin, u: knee.u - Math.cos(a[0] + a[1]) * L.shin, s: side * 3 };
      const toe: V3 = { f: foot.f + 4, u: foot.u, s: side * 3 };
      limbs.push({ pts: [hip, knee], w: 5, col: this.s.colors.secondary, d: depth(knee) });
      limbs.push({ pts: [knee, foot], w: 3, col: skin, d: depth(foot) - 0.01 });
      limbs.push({ pts: [foot, toe], w: 3, col: '#f4f4f4', d: depth(foot) - 0.02 });
    };
    const arm = (side: number, hand: [number, number], spread: number): void => {
      const sh: V3 = { f: neck.f, u: neck.u - 2, s: side * 5.4 };
      // two bones reaching for the hand: the elbow goes where the reach leaves room for it
      const tf = hand[0] * z, tu = -hand[1] * z;
      let dx = tf - sh.f, dy = tu - sh.u; const dist = Math.max(0.001, Math.hypot(dx, dy)), reach = Math.min(dist, L.arm * 2 - 0.2);
      dx = (dx / dist) * reach; dy = (dy / dist) * reach;
      const mid = Math.sqrt(Math.max(0, L.arm * L.arm - (reach / 2) * (reach / 2)));
      const el: V3 = { f: sh.f + dx / 2 + (-dy / reach) * mid * (dy > 0 ? -1 : 1), u: sh.u + dy / 2 + (dx / reach) * mid * (dy > 0 ? -1 : 1), s: side * 6.3 };
      const hd: V3 = { f: sh.f + dx, u: sh.u + dy, s: side * spread };
      limbs.push({ pts: [sh, el], w: 3, col: skin, d: depth(el) });
      limbs.push({ pts: [el, hd], w: 3, col: skin, d: depth(hd) + 0.01, hand: true });
    };
    leg(1, p.legF); leg(-1, p.legB);
    arm(1, p.handF, p.hold === 'both' ? 1.5 : 5.4); arm(-1, p.handB, p.hold === 'both' ? -1.5 : -5.4);
    const far = limbs.filter(l => l.d < 0).sort((a, b) => a.d - b.d), near = limbs.filter(l => l.d >= 0).sort((a, b) => a.d - b.d);
    const bone = (l: (typeof limbs)[number], dark: boolean): void => {
      const [a, b] = l.pts, x0 = X(a), y0 = Y(a), x1 = X(b), y1 = Y(b);
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      const col = dark ? shade(l.col, 0.72) : l.col;
      for (let i = 0; i <= n; i++) this.px(lerp(x0, x1, i / n) - l.w / 2, lerp(y0, y1, i / n) - l.w / 2, l.w, l.w, col);
    };
    const handAt = (hand: [number, number], side: number, spread: number): { x: number; y: number } => {
      const sh: V3 = { f: neck.f, u: neck.u - 2, s: side * 5.4 };
      let dx = hand[0] * z - sh.f, dy = -hand[1] * z - sh.u; const dist = Math.max(0.001, Math.hypot(dx, dy)), reach = Math.min(dist, L.arm * 2 - 0.2);
      dx = (dx / dist) * reach; dy = (dy / dist) * reach;
      const v: V3 = { f: sh.f + dx, u: sh.u + dy, s: side * spread };
      return { x: X(v), y: Y(v) };
    };
    const hands = { F: handAt(p.handF, 1, p.hold === 'both' ? 1.5 : 5.4), B: handAt(p.handB, -1, p.hold === 'both' ? -1.5 : -5.4) };
    const ballAt = p.hold === 'both' ? { x: (hands.F.x + hands.B.x) / 2, y: (hands.F.y + hands.B.y) / 2 - 3 } : p.hold === 'F' ? { x: hands.F.x, y: hands.F.y - 3 } : p.hold === 'B' ? { x: hands.B.x, y: hands.B.y - 2 } : null;
    const ballDepth = p.hold === 'B' ? depth({ f: p.handB[0] * z, u: 0, s: -5.4 }) : depth({ f: p.handF[0] * z, u: 0, s: p.hold === 'both' ? 0 : 5.4 });
    const drawBall = (): void => { if (withBall && ballAt && !this.ball.free) this.drawBall(ballAt.x, ballAt.y); };
    for (const l of far) bone(l, true);
    if (ballDepth < 0) drawBall();
    // torso: narrow from the side, broad when he faces us or turns his back
    const wide = 7 + 6 * Math.abs(sy), n = Math.ceil(L.torso);
    const backOn = sy > 0.35; // his back is to the camera
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = hx + neck.f * cy * k, y = hy - neck.u * k;
      this.px(x - wide / 2, y - 1, Math.round(wide), 2, i < 5 ? this.s.colors.secondary : jersey);
    }
    // a stripe down his side, and the number when he turns his back
    if (Math.abs(sy) < 0.5) this.px(hx + neck.f * cy * 0.62 - 1, hy - neck.u * 0.86, 2, Math.round(neck.u * 0.5), this.s.colors.secondary);
    if (backOn) { this.px(hx + neck.f * cy * 0.6 - 2, hy - neck.u * 0.8, 4, 6, this.s.colors.secondary); this.px(hx + neck.f * cy * 0.6 - 1, hy - neck.u * 0.8 + 1, 2, 4, jersey); }
    // head
    const headX = hx + (neck.f + Math.sin(p.lean) * 5) * cy, headY = hy - neck.u - Math.cos(p.lean) * 5 - 4;
    this.px(headX - 4, headY - 4, 9, 9, backOn ? hair : skin);
    this.px(headX - 4, headY - 4, 9, 3, hair);
    if (!backOn) {
      const facing = Math.abs(cy) > 0.35 ? Math.sign(cy) : 0; // profile: one eye, towards where he looks. Facing us: two
      if (facing) { this.px(headX + facing * 2.5, headY, 2, 2, PAL.ink); this.px(facing > 0 ? headX - 4 : headX + 2, headY - 4, 3, 6, hair); }
      else { this.px(headX - 3, headY, 2, 2, PAL.ink); this.px(headX + 2, headY, 2, 2, PAL.ink); }
    }
    for (const l of near) bone(l, false);
    if (ballDepth >= 0) drawBall();
  }
  private drawBall(x: number, y: number): void {
    this.px(x - 4, y - 3, 9, 7, PAL.ball); this.px(x - 3, y - 4, 7, 9, PAL.ball);
    this.px(x - 4, y, 9, 1, PAL.ballDark); this.px(x, y - 4, 1, 9, PAL.ballDark);
    this.px(x - 3, y - 3, 2, 2, '#ffb066');
  }
  /** Things drawn on the scene to time against: the take-off strip, and the rings that close on the trick and the slam. */
  private drawGuides(): void {
    const c = this.ctx;
    if (this.phase === 'ready' || this.phase === 'run') {
      const e = this.ease, on = Math.sin(this.time * 9) > 0;
      c.globalAlpha = 0.55; this.px(this.jumpX - ZONE.late * e, FLOOR + 1, Math.round(ZONE.late * e * 2), 6, '#ffa04d');
      c.globalAlpha = 0.8; this.px(this.jumpX - ZONE.good * e, FLOOR + 1, Math.round(ZONE.good * e * 2), 6, PAL.white);
      c.globalAlpha = 1; this.px(this.jumpX - ZONE.perfect * e, FLOOR + 1, Math.round(ZONE.perfect * e * 2), 6, PAL.green);
      if (on || this.phase === 'ready') { this.px(this.jumpX - 1, FLOOR + 10, 2, 8, PAL.green); this.px(this.jumpX - 3, FLOOR + 11, 6, 2, PAL.green); this.px(this.jumpX - 2, FLOOR + 10, 4, 1, PAL.green); this.text('JUMP', this.jumpX, FLOOR + 24, PAL.green, 6); }
    }
    // off the backboard: the ball is on its own until he catches it
    if (this.style === 'board' && this.phase === 'air' && this.u < 0.47) {
      const u = this.u / 0.47, h = this.hip();
      const out = u < 0.5, k = out ? u / 0.5 : (u - 0.5) / 0.5;
      const from = out ? { x: this.x0 + 9, y: STAND - 26 } : { x: BOARD_X - 5, y: RIM.y - 18 };
      const to = out ? { x: BOARD_X - 5, y: RIM.y - 18 } : { x: h.x + 9, y: h.y - 34 };
      this.drawBall(lerp(from.x, to.x, k), lerp(from.y, to.y, k) - 12 * Math.sin(k * Math.PI));
    }
    if (this.ball.free) this.drawBall(this.ball.x, this.ball.y);
    if (this.phase !== 'air') return;
    const next = this.pending[0];
    if (!next) return;
    const at = next === 'trick' ? this.trickT : this.airT, left = at - this.t;
    if (left > RING_LEAD) return;
    const h = this.hip();
    const cx = next === 'trick' ? h.x + 3 : RIM.x + 2, cy = next === 'trick' ? h.y - 16 : RIM.y + 2;
    const target = next === 'trick' ? 21 : 15;
    const r = target + Math.max(0, left / RING_LEAD) * 30;
    const col = Math.abs(left) <= WIN.perfect * this.ease ? PAL.green : Math.abs(left) <= WIN.good * this.ease ? PAL.white : PAL.yellow;
    this.ring(cx, cy, target, 'rgba(255,255,255,0.55)');
    if (left > -WIN.late * this.ease) this.ring(cx, cy, r, col);
  }
  private ring(cx: number, cy: number, r: number, col: string): void {
    const n = Math.max(16, Math.round(r * 3.4));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.px(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2, col); }
  }
  private text(s: string, x: number, y: number, col: string, size = 8, align: CanvasTextAlign = 'center'): void {
    const c = this.ctx;
    c.font = `${size}px "Press Start 2P", monospace`; c.textAlign = align; c.textBaseline = 'middle';
    c.fillStyle = PAL.ink; c.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    c.fillStyle = col; c.fillText(s, Math.round(x), Math.round(y));
  }
  private drawHud(): void {
    const c = this.ctx, how = this.s.keys ? 'SPACE' : 'TAP';
    this.text(this.s.dunk.name.toUpperCase(), W / 2, 12, PAL.yellow, 8);
    if (this.s.label) this.text(this.s.label, W / 2, 26, '#cfcaea', 6);
    // the beats of this dunk, lit as they come and coloured by how they went
    const beats: [string, Beat | undefined, boolean][] = [['JUMP', this.phase === 'ready' || this.phase === 'run' ? undefined : this.jump, this.phase === 'run']];
    if (this.s.dunk.trick) beats.push(['TRICK', this.trick, this.phase === 'air' && this.pending[0] === 'trick']);
    beats.push(['SLAM', this.phase === 'slam' || this.phase === 'fail' || (this.phase === 'air' && !this.pending.includes('slam')) ? this.slam : undefined, this.phase === 'air' && this.pending[0] === 'slam']);
    const bw = 62, x0 = W / 2 - (beats.length * bw) / 2;
    beats.forEach(([name, b, live], i) => {
      const x = x0 + i * bw;
      c.fillStyle = 'rgba(11,10,20,0.8)'; c.fillRect(x + 2, VIEW_H - 22, bw - 4, 16);
      c.fillStyle = b !== undefined ? RATE_COLOR[b] : live ? PAL.yellow : '#3d3966'; c.fillRect(x + 2, VIEW_H - 8, bw - 4, 2);
      this.text(name, x + bw / 2, VIEW_H - 14, b !== undefined ? RATE_COLOR[b] : live && Math.sin(this.time * 10) > 0 ? PAL.yellow : '#cfcaea', 6);
    });
    const prompt = this.phase === 'ready' ? `${how} TO START YOUR RUN`
      : this.phase === 'run' ? `${how} ON THE GREEN STRIP`
      : this.phase === 'air' && this.pending[0] === 'trick' ? `${how} WHEN THE RING CLOSES ON HIM`
      : this.phase === 'air' && this.pending[0] === 'slam' ? `${how} WHEN THE RING CLOSES ON THE RIM` : '';
    if (prompt) this.text(prompt, W / 2, VIEW_H - 32, PAL.white, 6);
    for (const p of this.popups) {
      // popups are placed in the scene, so they follow the camera
      const x = (p.x - this.cam.x) * this.cam.z + W / 2, y = (p.y - this.cam.y) * this.cam.z + VIEW_H / 2 - p.t * 14;
      c.globalAlpha = clamp((1.3 - p.t) / 0.4, 0, 1);
      const half = p.text.length * 4 + 3;
      this.text(p.text, clamp(x, half, W - half), clamp(y, 44, VIEW_H - 44), p.color, 8);
      c.globalAlpha = 1;
    }
  }
}
