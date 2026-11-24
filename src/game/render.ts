// Court and sprite drawing for the low-resolution game canvas. Everything is drawn in
// code with whole-pixel rectangles; there are no image assets.
import type { Player } from '../core/types';
import { drawText, textWidth } from './font';

export const W = 240;
export const H = 270;
/** Rows above the court for the stands and the backboard. Court coordinates start below it. */
export const TOP = 24;
export const VIEW_H = H + TOP;
export const HOOP = { x: 120, y: 44 };
export const BASE_Y = 20;
export const SIDE_L = 8;
export const SIDE_R = 232;
export const HALF_Y = 230;
/** 4.48 px per foot. */
export const ARC_R = 106;
export const CORNER_DX = 98.5;
export const CORNER_Y = HOOP.y + 39;
export const PAINT = { x0: 84, x1: 156, y0: BASE_Y, y1: 105 };

export const PAL = {
  bg: '#14121f', wood: '#d9a066', wood2: '#cf955a', woodDark: '#b97f47', line: '#f4e9d0',
  shadow: 'rgba(20,18,31,0.35)', rim: '#ff5a3c', net: '#f4f4f4', board: '#e8e8f0',
  ball: '#ff8a3c', ballDark: '#b4521e', white: '#ffffff', ink: '#14121f',
  green: '#5fd35f', yellow: '#ffd23c', red: '#ff4d4d', blue: '#4da6ff',
};
export const SKIN = ['#f6d3b3', '#e0ac7e', '#c68642', '#8d5524', '#5c3a1e'];
export const HAIR = ['#1a1a1a', '#4a2f1b', '#8a5a2b', '#d6b370', '#b33a2b'];

export function isThree(x: number, y: number): boolean {
  const dx = x - HOOP.x, dy = y - HOOP.y;
  if (Math.abs(dx) >= CORNER_DX && y <= CORNER_Y) return true;
  return Math.hypot(dx, dy) > ARC_R;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w = 1, h = 1): void {
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
function pxArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const steps = Math.ceil(Math.abs(a1 - a0) * r * 1.5);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    px(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Pre-render the static court (floor, lines, paint) once per game. */
export function makeCourt(paint: string, accent: string, banners: number, wood?: { wood: string; wood2: string; grain: string }): HTMLCanvasElement {
  const W1 = wood?.wood ?? PAL.wood, W2 = wood?.wood2 ?? PAL.wood2, WG = wood?.grain ?? PAL.woodDark;
  const c = document.createElement('canvas');
  c.width = W; c.height = VIEW_H;
  const g = c.getContext('2d')!;
  g.translate(0, TOP);
  g.fillStyle = PAL.bg; g.fillRect(0, -TOP, W, VIEW_H);
  // stands, with a courtside board in front of them
  g.fillStyle = '#1e1b30'; g.fillRect(0, -TOP, W, TOP + BASE_Y - 3);
  for (let row = 0; row < 6; row++) { g.fillStyle = row % 2 ? '#262240' : '#201d36'; g.fillRect(0, -TOP + 1 + row * 6, W, 6); }
  // floor planks
  for (let x = 0; x < W; x += 12) {
    g.fillStyle = (x / 12) % 2 ? W1 : W2;
    g.fillRect(x, BASE_Y - 2, 12, H);
  }
  g.fillStyle = WG;
  for (let x = 0; x < W; x += 12) for (let y = BASE_Y + ((x * 7) % 40); y < H; y += 46) g.fillRect(x, y, 12, 1);
  // floor sheen: the middle of the court catches the light
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(48, BASE_Y, 144, H);
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(84, BASE_Y, 72, H);
  // out-of-bounds apron in team colour
  g.fillStyle = shade(paint, 0.55);
  g.fillRect(0, BASE_Y - 2, SIDE_L, H); g.fillRect(SIDE_R + 1, BASE_Y - 2, W - SIDE_R, H);
  g.fillRect(0, BASE_Y - 2, W, 2);
  g.fillStyle = shade(paint, 0.42);
  for (let y = BASE_Y + 6; y < H; y += 14) { g.fillRect(2, y, 3, 6); g.fillRect(W - 5, y, 3, 6); }
  // courtside advertising boards
  g.fillStyle = '#0e0c18'; g.fillRect(0, BASE_Y - 7, W, 5);
  const ads = [accent, paint, '#f4e9d0', paint, accent, '#f4e9d0', paint, accent];
  ads.forEach((c, i) => { g.fillStyle = c; g.fillRect(4 + i * 30, BASE_Y - 6, 24, 3); g.fillStyle = '#0e0c18'; for (let k = 0; k < 5; k++) g.fillRect(7 + i * 30 + k * 4, BASE_Y - 5, 2, 1); });
  // paint, a touch darker toward the baseline
  g.fillStyle = paint; g.fillRect(PAINT.x0, PAINT.y0, PAINT.x1 - PAINT.x0, PAINT.y1 - PAINT.y0);
  g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(PAINT.x0, PAINT.y0, PAINT.x1 - PAINT.x0, 26);
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(PAINT.x0, PAINT.y1 - 30, PAINT.x1 - PAINT.x0, 30);
  g.fillStyle = PAL.line;
  // boundary
  g.fillRect(SIDE_L, BASE_Y, SIDE_R - SIDE_L + 1, 1);
  g.fillRect(SIDE_L, BASE_Y, 1, H); g.fillRect(SIDE_R, BASE_Y, 1, H);
  g.fillRect(SIDE_L, HALF_Y, SIDE_R - SIDE_L + 1, 1);
  // paint outline + free-throw circle
  g.fillRect(PAINT.x0, PAINT.y0, 1, PAINT.y1 - PAINT.y0); g.fillRect(PAINT.x1, PAINT.y0, 1, PAINT.y1 - PAINT.y0);
  g.fillRect(PAINT.x0, PAINT.y1, PAINT.x1 - PAINT.x0 + 1, 1);
  pxArc(g, HOOP.x, PAINT.y1, 27, 0, Math.PI);
  for (let a = Math.PI; a < Math.PI * 2; a += 0.3) pxArc(g, HOOP.x, PAINT.y1, 27, a, a + 0.14);
  // three-point line
  g.fillRect(Math.round(HOOP.x - CORNER_DX), BASE_Y, 1, CORNER_Y - BASE_Y);
  g.fillRect(Math.round(HOOP.x + CORNER_DX), BASE_Y, 1, CORNER_Y - BASE_Y);
  const a0 = Math.asin((CORNER_Y - HOOP.y) / ARC_R);
  pxArc(g, HOOP.x, HOOP.y, ARC_R, a0, Math.PI - a0);
  // lane blocks and hash marks
  for (const yy of [48, 62, 74, 86]) { g.fillRect(PAINT.x0 - 3, yy, 3, yy === 48 ? 4 : 1); g.fillRect(PAINT.x1 + 1, yy, 3, yy === 48 ? 4 : 1); }
  // restricted arc, closed up to the backboard line so it hugs the basket
  pxArc(g, HOOP.x, HOOP.y, 18, 0, Math.PI);
  g.fillRect(HOOP.x - 18, HOOP.y - 8, 1, 9); g.fillRect(HOOP.x + 18, HOOP.y - 8, 1, 9);
  // centre circle: a team-colour disc with a ring
  for (let y = HALF_Y - 26; y < HALF_Y; y++) {
    const half = Math.floor(Math.sqrt(26 * 26 - (HALF_Y - y) * (HALF_Y - y)));
    g.fillStyle = paint; g.fillRect(HOOP.x - half, y, half * 2, 1);
  }
  for (let y = HALF_Y - 14; y < HALF_Y; y++) {
    const half = Math.floor(Math.sqrt(14 * 14 - (HALF_Y - y) * (HALF_Y - y)));
    g.fillStyle = accent; g.fillRect(HOOP.x - half, y, half * 2, 1);
  }
  g.fillStyle = PAL.line; pxArc(g, HOOP.x, HALF_Y, 27, Math.PI, Math.PI * 2);
  g.fillRect(SIDE_L, HALF_Y, SIDE_R - SIDE_L + 1, 1);
  // darker corners so the eye goes to the basket
  g.fillStyle = 'rgba(10,8,20,0.10)';
  g.fillRect(0, HALF_Y + 12, W, H); g.fillRect(0, BASE_Y, 20, H); g.fillRect(W - 20, BASE_Y, 20, H);
  // championship banners
  for (let i = 0; i < Math.min(banners, 12); i++) {
    const bx = 6 + i * 10, by = -TOP + 1;
    g.fillStyle = '#0e0c18'; g.fillRect(bx - 1, by, 9, 13);
    g.fillStyle = paint; g.fillRect(bx, by, 7, 12);
    g.fillStyle = accent; g.fillRect(bx, by, 7, 2); g.fillRect(bx + 2, by + 5, 3, 3);
    g.fillStyle = '#0e0c18'; g.fillRect(bx + 2, by + 11, 3, 1); g.fillRect(bx + 3, by + 10, 1, 1);
  }
  return c;
}

/** The crowd in the stands; `level` 0-100 controls how many are on their feet waving. */
export function drawCrowd(ctx: CanvasRenderingContext2D, t: number, level: number, a: string, b: string, skipLeft: number): void {
  const cols = ['#3a3558', '#4b4470', a, b, '#6b6490', '#55507a'];
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 31; i++) {
      const x = 1 + i * 8 + (row % 2) * 4;
      const y = -TOP + 3 + row * 6;
      if (x < skipLeft && row < 2) continue;
      const seed = (i * 37 + row * 91) % 100;
      const hyped = seed < level * 0.9;
      const up = hyped && Math.sin(t * (6 + (seed % 5)) + seed) > 0.2 ? 1 : 0;
      ctx.fillStyle = cols[seed % 6];
      ctx.fillRect(x, y + 2 - up, 6, 4);
      ctx.fillStyle = SKIN[seed % 5];
      ctx.fillRect(x + 1, y - up, 4, 3);
      ctx.fillStyle = HAIR[(seed >> 2) % 5];
      ctx.fillRect(x + 1, y - up, 4, 1);
      if (up) { ctx.fillStyle = SKIN[seed % 5]; ctx.fillRect(x - 1, y - 1, 1, 3); ctx.fillRect(x + 6, y - 1, 1, 3); }
    }
  }
}

/** Screen height of the rim above its spot on the floor. */
export const RIM_Z = 29;

/**
 * The basket, drawn standing up like the players: stanchion, glass backboard with the
 * shooter's square, orange rim and a mesh net. `netKick` (0-1) stretches and sways the net
 * after a make; `shake` (0-1) rattles the whole thing on a dunk.
 */
export function drawHoop(ctx: CanvasRenderingContext2D, netKick: number, shake = 0, t = 0, glow = 0): void {
  const cx = HOOP.x + (shake > 0 ? Math.round(Math.sin(t * 60) * shake * 1.5) : 0);
  const ry = HOOP.y - RIM_Z + (shake > 0 ? Math.round(Math.abs(Math.sin(t * 45)) * shake * 2) : 0); // rim line
  // shadow on the floor under the rim
  // the rim's shadow on the floor: an oval ring right where the basket hangs
  ctx.fillStyle = 'rgba(20,18,31,0.28)';
  ctx.fillRect(HOOP.x - 4, HOOP.y - 3, 9, 1); ctx.fillRect(HOOP.x - 6, HOOP.y - 2, 2, 1); ctx.fillRect(HOOP.x + 5, HOOP.y - 2, 2, 1);
  ctx.fillRect(HOOP.x - 7, HOOP.y - 1, 1, 2); ctx.fillRect(HOOP.x + 7, HOOP.y - 1, 1, 2);
  ctx.fillRect(HOOP.x - 6, HOOP.y + 1, 2, 1); ctx.fillRect(HOOP.x + 5, HOOP.y + 1, 2, 1); ctx.fillRect(HOOP.x - 4, HOOP.y + 2, 9, 1);
  ctx.fillStyle = 'rgba(20,18,31,0.14)'; ctx.fillRect(HOOP.x - 13, HOOP.y - 8, 27, 2); // backboard shadow
  // stanchion: padded base behind the baseline and the arm up to the board
  ctx.fillStyle = '#2b2f4a'; ctx.fillRect(cx - 4, BASE_Y - 7, 8, 6);
  ctx.fillStyle = '#3d4266'; ctx.fillRect(cx - 4, BASE_Y - 7, 8, 1);
  ctx.fillStyle = '#6a7090'; ctx.fillRect(cx - 1, ry - 2, 2, BASE_Y - 7 - (ry - 2));
  // backboard: glass you can half see through, bright frame, red shooter's square
  const bx = cx - 15, by = ry - 19, bw = 30, bh = 18;
  ctx.fillStyle = 'rgba(214,228,246,0.62)'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 6; i++) { ctx.fillRect(bx + 3 + i, by + 7 - i, 1, 1); ctx.fillRect(bx + 21 + i, by + 9 - i, 1, 1); }
  ctx.fillStyle = '#f6f8ff';
  ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
  ctx.fillStyle = '#9aa6c4'; ctx.fillRect(bx, by + bh - 1, bw, 1);
  ctx.fillStyle = '#e8463c';
  ctx.fillRect(cx - 5, ry - 10, 10, 1); ctx.fillRect(cx - 5, ry - 10, 1, 8); ctx.fillRect(cx + 4, ry - 10, 1, 8); ctx.fillRect(cx - 5, ry - 3, 10, 1);
  ctx.fillStyle = '#c53030'; ctx.fillRect(bx + 1, by + bh, bw - 2, 1); // bottom padding
  // bracket
  ctx.fillStyle = '#b4401c'; ctx.fillRect(cx - 1, ry - 1, 2, 2);
  // net: a tapering mesh hanging from the rim
  // after a make the net is punched down, flares at the bottom and swings
  const stretch = Math.round(netKick * 6);
  const sway = netKick > 0 ? Math.round(Math.sin(t * 26) * netKick * 3) : 0;
  const rows = 8 + stretch;
  for (let r = 0; r < rows; r++) {
    const flare = netKick > 0.25 && r > rows - 4 ? 1 : 0;
    const half = Math.max(2, 5 - Math.floor((r * 3.2) / rows)) + flare;
    const ox = Math.round((sway * r) / rows);
    const y = ry + 3 + r;
    for (let x = -half; x <= half; x++) {
      const edge = x === -half || x === half;
      if (!edge && (x + r) % 2 !== 0) continue;
      ctx.fillStyle = edge ? '#ffffff' : (r % 2 ? '#e6e9f5' : '#c9cee0');
      ctx.fillRect(cx + x + ox, y, 1, 1);
    }
  }
  // rim: an ellipse, far edge dark, near edge bright
  const lit = glow > 0 && Math.floor(t * 24) % 2 === 0;
  ctx.fillStyle = lit ? '#fff2a8' : '#b4401c';
  ctx.fillRect(cx - 3, ry, 7, 1); ctx.fillRect(cx - 5, ry + 1, 2, 1); ctx.fillRect(cx + 4, ry + 1, 2, 1);
  ctx.fillStyle = lit ? '#ffffff' : '#ff6a3c';
  ctx.fillRect(cx - 6, ry + 2, 1, 1); ctx.fillRect(cx + 6, ry + 2, 1, 1);
  ctx.fillRect(cx - 5, ry + 3, 2, 1); ctx.fillRect(cx + 4, ry + 3, 2, 1); ctx.fillRect(cx - 3, ry + 4, 7, 1);
  ctx.fillStyle = '#ffb08a'; ctx.fillRect(cx - 2, ry + 4, 3, 1);
}

export type Pose = 'stand' | 'dribble' | 'shoot' | 'jump' | 'defend';
export interface SpriteOpts {
  x: number; y: number;
  player: Player;
  jersey: string; trim: string;
  /** 0..1 run cycle phase; <0 = standing still */
  run: number;
  /** -1 left, 0 straight, 1 right */
  face: number;
  /** Facing away from the camera (toward the basket): shows his back and number. */
  up?: boolean;
  pose?: Pose;
  /** Kept for callers that only know "arms up". */
  armsUp?: boolean;
  /** Height off the floor in px (jump). */
  lift: number;
  ring?: string;
  dim?: boolean;
  /** Where his hands are (same coordinates as x, y): the arms reach there. One hand or two. */
  hands?: { x: number; y: number }[];
  /** With one hand given, what the other arm does. */
  offArm?: 'down' | 'out';
  /** Extra knee tuck in the air, in px. */
  tuck?: number;
  dizzy?: number;
}

const OUTLINE = '#1b1726';
/** Sprite height in px for a height class 0-2 (guards to centers). */
export const spriteHeight = (p: Player): number => [22, 24, 27][Math.max(0, Math.min(2, p.look.height))];

export function drawPlayer(ctx: CanvasRenderingContext2D, o: SpriteOpts): void {
  const x = Math.round(o.x), yb = Math.round(o.y);
  const pl = o.player;
  const tall = pl.look.height;
  const skin = SKIN[pl.look.skin % 5], skinD = shade(skin, 0.8);
  const hair = HAIR[pl.look.hairColor % 5];
  const pose: Pose = o.pose ?? (o.armsUp ? 'shoot' : 'stand');
  const up = !!o.up;
  const lift = Math.round(o.lift);
  // shadow shrinks as he leaves the floor
  ctx.fillStyle = PAL.shadow;
  const sw = lift > 4 ? 3 : 5;
  ctx.fillRect(x - sw, yb - 1, sw * 2, 2); ctx.fillRect(x - sw + 1, yb + 1, sw * 2 - 2, 1);
  if (o.ring) {
    ctx.fillStyle = o.ring;
    ctx.fillRect(x - 5, yb + 2, 10, 1); ctx.fillRect(x - 7, yb + 1, 2, 1); ctx.fillRect(x + 5, yb + 1, 2, 1);
    ctx.fillRect(x - 8, yb - 1, 1, 2); ctx.fillRect(x + 7, yb - 1, 1, 2);
    ctx.fillRect(x - 7, yb - 2, 2, 1); ctx.fillRect(x + 5, yb - 2, 2, 1);
  }
  const rects: [number, number, number, number, string][] = [];
  const R = (rx: number, ry: number, w: number, h: number, c: string) => { if (w > 0 && h > 0) rects.push([x + rx, ry, w, h, c]); };

  const frame = o.run >= 0 ? Math.floor((o.run % 1) * 4) : -1; // 0 left leg up, 2 right leg up
  const bob = frame === 1 || frame === 3 ? 1 : 0;
  const y = yb - lift;
  const crouch = pose === 'defend' ? 1 : 0;
  const tuck = pose === 'jump' ? 2 + (o.tuck ?? 0) : 0;
  // guards are compact, centers are long: 22, 24 and 27 px tall
  const legH = [5, 6, 8][tall] - crouch - tuck;
  const torsoH = [5, 6, 7][tall];
  const big = tall > 1 ? 1 : 0; // centers are broader too
  const wide = pose === 'defend' ? 1 : 0;
  // legs + shoes
  const lUp = frame === 0 ? 2 : 0, rUp = frame === 2 ? 2 : 0;
  const lx = -3 - wide, rx = 1 + wide;
  const legTop = y - 2 - legH;
  R(lx, legTop, 2, legH - lUp, skin); R(rx, legTop, 2, legH - rUp, skin);
  R(lx, y - 3 - lUp, 2, 1, '#f4f4f4'); R(rx, y - 3 - rUp, 2, 1, '#f4f4f4'); // socks
  R(lx - 1, y - 2 - lUp, 3, 2, '#f4f4f4'); R(rx, y - 2 - rUp, 3, 2, '#f4f4f4'); // shoes
  R(lx - 1, y - 1 - lUp, 3, 1, o.trim); R(rx, y - 1 - rUp, 3, 1, o.trim);
  // shorts
  const shortsTop = legTop - 3 + bob;
  R(-4, shortsTop, 8, 4, o.trim);
  R(-4, shortsTop, 1, 4, o.jersey); R(3, shortsTop, 1, 4, o.jersey);
  R(-1, shortsTop + 3, 2, 1, shade(o.trim, 0.6));
  // torso
  const torsoTop = shortsTop - torsoH;
  R(-4 - big, torsoTop, 8 + big * 2, torsoH, o.jersey);
  R(-4 - big, torsoTop + torsoH - 1, 8 + big * 2, 1, shade(o.jersey, 0.8));
  if (!up) R(-1, torsoTop, 2, 1, skin); // neckline
  // arms
  const armLen = 6;
  const sh = torsoTop;
  if (o.hands && o.hands.length) {
    // arms that reach for a point: the ball in his hands, the rim he is hanging on
    const arm = (sx: number, tx: number, ty: number) => {
      let dx = tx - x - sx, dy = ty - (sh + 1);
      const d = Math.hypot(dx, dy) || 1, L = Math.min(10, d);
      dx /= d; dy /= d;
      for (let t = 0; t <= L; t++) R(Math.round(sx + dx * t) - 1, Math.round(sh + 1 + dy * t) - 1, 2, 2, skin);
    };
    const hs = o.hands.slice().sort((a, b) => a.x - b.x);
    if (hs.length >= 2) { arm(-5, hs[0].x, hs[0].y); arm(5, hs[hs.length - 1].x, hs[hs.length - 1].y); }
    else {
      const right = hs[0].x >= x, other = right ? -5 : 5;
      arm(right ? 5 : -5, hs[0].x, hs[0].y);
      if (o.offArm === 'out') arm(other, x + other * 3, sh - 1); else arm(other, x + other, sh + 8);
    }
  } else if (pose === 'shoot' || pose === 'jump') {
    const reach = pose === 'jump' ? 8 : 7;
    R(-6, sh - reach + 2, 2, reach, skin); R(4, sh - reach + 2 - (pose === 'jump' ? 1 : 0), 2, reach + (pose === 'jump' ? 1 : 0), skin);
    R(-6, sh, 2, 2, skinD); R(4, sh, 2, 2, skinD);
  } else if (pose === 'defend') {
    R(-9, sh + 1, 5, 2, skin); R(4, sh + 1, 5, 2, skin);
    R(-10, sh, 2, 2, skin); R(8, sh, 2, 2, skin);
  } else if (pose === 'dribble') {
    const side = o.face < 0 ? -1 : 1;
    // dribbling arm reaches out and down, the other swings
    if (side > 0) { R(-6, sh, 2, armLen, skin); R(4, sh, 2, 4, skin); R(5, sh + 4, 2, 4, skin); }
    else { R(4, sh, 2, armLen, skin); R(-6, sh, 2, 4, skin); R(-7, sh + 4, 2, 4, skin); }
  } else {
    const ls = frame === 0 ? -1 : frame === 2 ? 1 : 0;
    R(-6, sh + Math.max(0, ls), 2, armLen - Math.abs(ls), skin); R(4, sh + Math.max(0, -ls), 2, armLen - Math.abs(ls), skin);
  }
  // head
  const headTop = torsoTop - 7;
  R(-1, torsoTop - 1, 2, 1, skinD); // neck
  R(-3, headTop, 6, 6, skin);
  const hs = pl.look.hair % 6;
  if (up) {
    // back of the head
    if (hs !== 5) R(-3, headTop, 6, hs === 0 ? 3 : 4, hair);
    if (hs === 2) { R(-4, headTop - 2, 8, 5, hair); }
    if (hs === 3) R(-2, headTop - 3, 4, 3, hair);
    if (hs === 4) R(-3, headTop + 2, 6, 1, o.trim);
  } else {
    if (hs === 0) { R(-3, headTop, 6, 1, hair); }
    else if (hs === 1) { R(-3, headTop, 6, 2, hair); R(-3, headTop + 2, 1, 1, hair); R(2, headTop + 2, 1, 1, hair); }
    else if (hs === 2) { R(-4, headTop - 2, 8, 4, hair); R(-4, headTop + 2, 1, 2, hair); R(3, headTop + 2, 1, 2, hair); }
    else if (hs === 3) { R(-2, headTop - 3, 4, 3, hair); R(-3, headTop, 6, 1, hair); }
    else if (hs === 4) { R(-3, headTop, 6, 1, hair); R(-3, headTop + 1, 6, 1, o.trim); }
  }
  // outline pass, then fills
  ctx.fillStyle = OUTLINE;
  for (const [rx2, ry2, w, h] of rects) ctx.fillRect(rx2 - 1, ry2 - 1, w + 2, h + 2);
  for (const [rx2, ry2, w, h, c] of rects) { ctx.fillStyle = c; ctx.fillRect(rx2, ry2, w, h); }
  // face or number on top of the fills
  if (!up) {
    const ex = o.face > 0 ? 1 : o.face < 0 ? -1 : 0;
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(x - 2 + ex, headTop + 3, 1, 1); ctx.fillRect(x + 1 + ex, headTop + 3, 1, 1);
    ctx.fillStyle = o.trim; ctx.fillRect(x - 1, torsoTop + 2, 2, 3);
  } else {
    const num = String(pl.num);
    const tw = textWidth(num);
    if (tw <= 7) drawText(ctx, num, x - Math.floor(tw / 2), torsoTop + (torsoH > 5 ? 1 : 0), o.trim);
    else { ctx.fillStyle = o.trim; ctx.fillRect(x - 2, torsoTop + 1, 4, 4); }
  }
  if (o.dizzy && o.dizzy > 0) {
    ctx.fillStyle = PAL.yellow;
    const a = o.dizzy * 12;
    for (let k = 0; k < 3; k++) {
      const aa = a + (k * Math.PI * 2) / 3;
      ctx.fillRect(Math.round(x + Math.cos(aa) * 6), headTop - 4 + Math.round(Math.sin(aa) * 2), 2, 2);
    }
  }
  if (o.dim) { ctx.fillStyle = 'rgba(20,18,31,0.25)'; ctx.fillRect(x - 7, headTop - 3, 14, y - headTop + 3); }
}

export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
  const bx = Math.round(x), by = Math.round(y);
  // the shadow stays on the floor: smaller and fainter the higher the ball is
  ctx.fillStyle = z > 24 ? 'rgba(20,18,31,0.22)' : PAL.shadow;
  if (z > 12) ctx.fillRect(bx - 1, by, 3, 1); else { ctx.fillRect(bx - 2, by, 5, 1); ctx.fillRect(bx - 1, by + 1, 3, 1); }
  // and the ball itself is drawn a size up when it is high, as if nearer the camera
  const high = z > 20;
  const r = high ? 3 : 2;
  const yy = by - Math.round(z) - r * 2 - 1;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(bx - r, yy - 1, r * 2 + 1, r * 2 + 3); ctx.fillRect(bx - r - 1, yy, r * 2 + 3, r * 2 + 1);
  ctx.fillStyle = PAL.ball;
  ctx.fillRect(bx - r + 1, yy, r * 2 - 1, r * 2 + 1); ctx.fillRect(bx - r, yy + 1, r * 2 + 1, r * 2 - 1);
  ctx.fillStyle = PAL.ballDark;
  ctx.fillRect(bx, yy, 1, r * 2 + 1); ctx.fillRect(bx - r, yy + r, r * 2 + 1, 1);
  ctx.fillRect(bx + r - 1, yy + r * 2 - 1, 1, 1); ctx.fillRect(bx + r, yy + r + 1, 1, 1);
  ctx.fillStyle = '#ffc089'; ctx.fillRect(bx - r + 1, yy + 1, 1, 1);
}
