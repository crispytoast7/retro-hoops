// Court and sprite drawing for the low-resolution game canvas. Everything is drawn in
// code with whole-pixel rectangles; there are no image assets.
import type { Player } from '../core/types';

export const W = 240;
export const H = 270;
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
const SKIN = ['#f6d3b3', '#e0ac7e', '#c68642', '#8d5524', '#5c3a1e'];
const HAIR = ['#1a1a1a', '#4a2f1b', '#8a5a2b', '#d6b370', '#b33a2b'];

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
export function makeCourt(paint: string, accent: string, banners: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = PAL.bg; g.fillRect(0, 0, W, H);
  // stands
  g.fillStyle = '#1e1b30'; g.fillRect(0, 0, W, BASE_Y - 3);
  g.fillStyle = '#2a2644'; g.fillRect(0, BASE_Y - 4, W, 2);
  // floor planks
  for (let x = 0; x < W; x += 12) {
    g.fillStyle = (x / 12) % 2 ? PAL.wood : PAL.wood2;
    g.fillRect(x, BASE_Y - 2, 12, H);
  }
  g.fillStyle = PAL.woodDark;
  for (let x = 0; x < W; x += 12) for (let y = BASE_Y + ((x * 7) % 40); y < H; y += 46) g.fillRect(x, y, 12, 1);
  // out-of-bounds apron
  g.fillStyle = shade(paint, 0.55);
  g.fillRect(0, BASE_Y - 2, SIDE_L, H); g.fillRect(SIDE_R + 1, BASE_Y - 2, W - SIDE_R, H);
  g.fillRect(0, BASE_Y - 2, W, 2);
  // paint
  g.fillStyle = paint; g.fillRect(PAINT.x0, PAINT.y0, PAINT.x1 - PAINT.x0, PAINT.y1 - PAINT.y0);
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
  // restricted arc + centre circle
  pxArc(g, HOOP.x, HOOP.y, 18, 0, Math.PI);
  pxArc(g, HOOP.x, HALF_Y, 27, Math.PI, Math.PI * 2);
  g.fillStyle = accent; pxArc(g, HOOP.x, HALF_Y, 26, Math.PI, Math.PI * 2);
  // championship banners
  for (let i = 0; i < Math.min(banners, 12); i++) {
    const bx = 10 + i * 9;
    g.fillStyle = paint; g.fillRect(bx, 1, 7, 9);
    g.fillStyle = accent; g.fillRect(bx, 1, 7, 2); g.fillRect(bx + 3, 5, 1, 2);
    g.fillStyle = '#1e1b30'; g.fillRect(bx, 9, 2, 1); g.fillRect(bx + 5, 9, 2, 1);
  }
  return c;
}

/** Flickering crowd in the stands; `level` 0-100 controls how many are up and waving. */
export function drawCrowd(ctx: CanvasRenderingContext2D, t: number, level: number, a: string, b: string, skipLeft: number): void {
  const cols = ['#3a3558', '#4b4470', a, b, '#6b6490'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 40; i++) {
      const x = 2 + i * 6 + (row % 2) * 3;
      if (x < skipLeft) continue;
      const seed = (i * 37 + row * 91) % 100;
      const hyped = seed < level * 0.9;
      const up = hyped && Math.sin(t * (6 + (seed % 5)) + seed) > 0.2 ? 1 : 0;
      ctx.fillStyle = cols[seed % 5];
      ctx.fillRect(x, 3 + row * 4 - up, 4, 3);
      ctx.fillStyle = SKIN[seed % 5];
      ctx.fillRect(x + 1, 2 + row * 4 - up, 2, 1);
    }
  }
}

export function drawHoop(ctx: CanvasRenderingContext2D, netKick: number): void {
  ctx.fillStyle = '#8888a0'; ctx.fillRect(HOOP.x - 1, BASE_Y - 4, 2, 14);
  ctx.fillStyle = PAL.board; ctx.fillRect(HOOP.x - 13, HOOP.y - 9, 26, 3);
  ctx.fillStyle = PAL.rim; ctx.fillRect(HOOP.x - 4, HOOP.y - 7, 8, 1);
  ctx.fillStyle = PAL.rim;
  ctx.fillRect(HOOP.x - 5, HOOP.y - 4, 10, 1); ctx.fillRect(HOOP.x - 5, HOOP.y + 3, 10, 1);
  ctx.fillRect(HOOP.x - 6, HOOP.y - 3, 1, 6); ctx.fillRect(HOOP.x + 5, HOOP.y - 3, 1, 6);
  ctx.fillRect(HOOP.x - 1, HOOP.y - 6, 2, 2);
  ctx.fillStyle = PAL.net;
  const k = Math.round(netKick * 2);
  for (let i = 0; i < 4; i++) ctx.fillRect(HOOP.x - 4 + i * 3 - (i < 2 ? 0 : 1), HOOP.y - 2 + (i % 2), 1, 4 + k);
}

export interface SpriteOpts {
  x: number; y: number;
  player: Player;
  jersey: string; trim: string;
  /** 0..1 run cycle phase; <0 = standing */
  run: number;
  face: number;
  armsUp: boolean;
  /** vertical lift in px (jump) */
  lift: number;
  ring?: string;
  dim?: boolean;
  dizzy?: number;
}

export function drawPlayer(ctx: CanvasRenderingContext2D, o: SpriteOpts): void {
  const x = Math.round(o.x), yb = Math.round(o.y);
  const tall = o.player.look.height; // 0..2
  const skin = SKIN[o.player.look.skin % 5];
  const hair = HAIR[o.player.look.hairColor % 5];
  // shadow
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(x - 4, yb - 1, 8, 2); ctx.fillRect(x - 3, yb + 1, 6, 1);
  if (o.ring) {
    ctx.fillStyle = o.ring;
    ctx.fillRect(x - 5, yb - 2, 1, 3); ctx.fillRect(x + 4, yb - 2, 1, 3);
    ctx.fillRect(x - 4, yb + 1, 1, 1); ctx.fillRect(x + 3, yb + 1, 1, 1);
    ctx.fillRect(x - 3, yb + 2, 6, 1); ctx.fillRect(x - 4, yb - 3, 1, 1); ctx.fillRect(x + 3, yb - 3, 1, 1);
  }
  const y = yb - Math.round(o.lift);
  const legH = 3 + (tall > 1 ? 1 : 0);
  const bodyH = 5 + (tall > 0 ? 1 : 0);
  const step = o.run >= 0 ? (o.run % 1 < 0.5 ? 1 : -1) : 0;
  // shoes + legs
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x - 3, y - 1 - (step > 0 ? 1 : 0), 2, 1); ctx.fillRect(x + 1, y - 1 - (step < 0 ? 1 : 0), 2, 1);
  ctx.fillStyle = skin;
  ctx.fillRect(x - 3, y - 1 - legH + (step > 0 ? 0 : 1) - (step > 0 ? 1 : 0), 2, legH - 1);
  ctx.fillRect(x + 1, y - 1 - legH + (step < 0 ? 0 : 1) - (step < 0 ? 1 : 0), 2, legH - 1);
  // shorts
  const ys = y - legH - 2;
  ctx.fillStyle = o.trim; ctx.fillRect(x - 3, ys, 6, 2);
  // jersey
  const yj = ys - bodyH;
  ctx.fillStyle = o.jersey; ctx.fillRect(x - 3, yj, 6, bodyH);
  ctx.fillStyle = o.trim; ctx.fillRect(x - 1, yj + 2, 2, 2);
  // arms
  ctx.fillStyle = skin;
  if (o.armsUp) { ctx.fillRect(x - 4, yj - 4, 1, 5); ctx.fillRect(x + 3, yj - 4, 1, 5); }
  else { ctx.fillRect(x - 4, yj + 1 + (step > 0 ? 1 : 0), 1, 3); ctx.fillRect(x + 3, yj + 1 + (step < 0 ? 1 : 0), 1, 3); }
  // head
  const yh = yj - 4;
  ctx.fillStyle = skin; ctx.fillRect(x - 2, yh, 4, 4);
  ctx.fillStyle = hair;
  const hs = o.player.look.hair % 6;
  if (hs === 0) ctx.fillRect(x - 2, yh, 4, 1);
  else if (hs === 1) { ctx.fillRect(x - 2, yh - 1, 4, 2); }
  else if (hs === 2) { ctx.fillRect(x - 3, yh - 1, 6, 2); ctx.fillRect(x - 3, yh + 1, 1, 1); ctx.fillRect(x + 2, yh + 1, 1, 1); }
  else if (hs === 3) { ctx.fillRect(x - 1, yh - 2, 2, 2); ctx.fillRect(x - 2, yh, 4, 1); }
  else if (hs === 4) { ctx.fillRect(x - 2, yh, 4, 1); ctx.fillStyle = o.trim; ctx.fillRect(x - 2, yh + 1, 4, 1); }
  // hs 5 = bald
  ctx.fillStyle = PAL.ink;
  if (o.face >= 0) ctx.fillRect(x + 1, yh + 2, 1, 1);
  if (o.face <= 0) ctx.fillRect(x - 2, yh + 2, 1, 1);
  if (o.dizzy && o.dizzy > 0) {
    ctx.fillStyle = PAL.yellow;
    const a = o.dizzy * 14;
    ctx.fillRect(Math.round(x + Math.cos(a) * 4), yh - 3 + Math.round(Math.sin(a) * 1), 1, 1);
    ctx.fillRect(Math.round(x - Math.cos(a) * 4), yh - 3 - Math.round(Math.sin(a) * 1), 1, 1);
  }
  if (o.dim) { ctx.fillStyle = 'rgba(20,18,31,0.25)'; ctx.fillRect(x - 4, yh - 2, 8, y - yh + 2); }
}

export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, z: number): void {
  const bx = Math.round(x), by = Math.round(y);
  ctx.fillStyle = PAL.shadow; ctx.fillRect(bx - 1, by, 3, 1);
  const yy = by - Math.round(z) - 3;
  ctx.fillStyle = PAL.ball; ctx.fillRect(bx - 1, yy, 3, 3);
  ctx.fillStyle = PAL.ballDark; ctx.fillRect(bx + 1, yy + 2, 1, 1); ctx.fillRect(bx, yy + 1, 1, 1);
  ctx.fillStyle = '#ffc089'; ctx.fillRect(bx - 1, yy, 1, 1);
}
