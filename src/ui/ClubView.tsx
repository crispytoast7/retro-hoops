// The club's home, drawn in pixels: the arena and the three buildings around it grow with every
// upgrade, look shabby when run down, wear scaffolding while work is under way, fly a banner
// for every title, and draw a crowd that grows with the fans.
import { useEffect, useRef } from 'preact/hooks';
import type { Facility, FacilityKey, Save } from '../core/types';
import { drawText, textWidth } from '../game/font';
import { shade } from '../game/render';

/** Logical width of the scene. Heights: compact strip for the hub, full view for Facilities. */
const W = 208;
const H_COMPACT = 58, H_FULL = 90;
/** Rows of extra sky the full view adds above the compact scene. */
const SKY_EXTRA = 26;
const SLOT: Record<FacilityKey, [number, number]> = { scouting: [2, 30], training: [32, 66], arena: [68, 132], medical: [134, 168] };
const PLAZA: [number, number] = [170, 206];
const LABEL: Record<FacilityKey, string> = { scouting: 'SCOUTS', training: 'TRAINING', arena: 'ARENA', medical: 'MEDICAL' };
const ORDER: FacilityKey[] = ['scouting', 'training', 'arena', 'medical'];

interface Box { x: number; y: number; w: number; h: number }
interface Scene {
  g: CanvasRenderingContext2D; t: number; GY: number; H: number; full: boolean;
  night: boolean; dusk: boolean; p1: string; p2: string; abbr: string;
}

const R = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void => {
  g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
/** Repeatable 0-1 noise from an integer. */
const hash = (n: number): number => {
  let h = Math.imul(n | 0, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
const cen = (k: FacilityKey): number => (SLOT[k][0] + SLOT[k][1]) / 2;

// ---- small pieces -------------------------------------------------------------------------
/** A window: glass by day, mostly lit at night, sometimes dark or broken when run down. */
function win(s: Scene, x: number, y: number, w: number, h: number, seed: number, shab: boolean): void {
  const dead = shab && hash(seed * 7 + 3) < 0.45;
  const lit = s.night ? hash(seed) < 0.75 : s.dusk ? hash(seed) < 0.4 : false;
  R(s.g, x, y, w, h, dead ? '#2a2630' : lit ? '#ffd86b' : s.night ? '#3a3550' : '#86b9dc');
  if (!dead && !lit && !s.night && w >= 3) R(s.g, x, y, 1, 1, '#d6ecfa');
}
function winRow(s: Scene, x: number, y: number, n: number, w: number, h: number, gap: number, seed: number, shab: boolean): void {
  for (let i = 0; i < n; i++) win(s, x + i * (w + gap), y, w, h, seed + i, shab);
}
/** A rounded top: rows widening from a point to the full width, like a dome or an arched roof. */
function arch(g: CanvasRenderingContext2D, x: number, yBottom: number, w: number, h: number, c: string, rib?: string): void {
  for (let r = 0; r < h; r++) {
    const f = (r + 1) / h;
    const half = Math.max(1, Math.round((w / 2) * Math.sqrt(1 - (1 - f) * (1 - f))));
    R(g, x + w / 2 - half, yBottom - h + r, half * 2, 1, c);
  }
  if (rib) for (let i = 1; i < 4; i++) {
    const rx = x + (w * i) / 4;
    for (let r = 0; r < h; r++) {
      const f = (r + 1) / h, half = (w / 2) * Math.sqrt(1 - (1 - f) * (1 - f));
      if (Math.abs(rx - (x + w / 2)) <= half - 1) R(g, rx, yBottom - h + r, 1, 1, rib);
    }
  }
}
function plate(s: Scene, cx: number, y: number, text: string, scale = 1): void {
  const tw = textWidth(text, scale), pw = tw + 4 * scale, ph = 5 * scale + 4;
  R(s.g, cx - pw / 2 - 1, y - 1, pw + 2, ph + 2, s.p2);
  R(s.g, cx - pw / 2, y, pw, ph, s.p1);
  drawText(s.g, text, cx, y + 2, '#ffffff', { scale, align: 'center' });
}
function person(s: Scene, x: number, foot: number, shirt: string, skin: string, cheer: boolean, step: number): void {
  const g = s.g, top = foot - 5 - (cheer ? 1 : 0);
  R(g, x, top, 2, 2, skin);
  R(g, x, top + 2, 2, 2, shirt);
  if (cheer) { R(g, x - 1, top + 1, 1, 1, skin); R(g, x + 2, top + 1, 1, 1, skin); }
  if (step) { R(g, x - (step > 0 ? 0 : 0), top + 4, 1, 1, '#2a2840'); R(g, x + 1, top + 4 + (cheer ? 0 : 0), 1, 1, '#2a2840'); R(g, x + (step > 0 ? 1 : 0), top + 5, 1, 1, '#2a2840'); }
  else R(g, x, top + 4, 2, 1 + (cheer ? 1 : 0), '#2a2840');
}
const SKINS = ['#f6d3b3', '#e0ac7e', '#c68642', '#8d5524', '#5c3a1e'];

// ---- the buildings ------------------------------------------------------------------------
function arena(s: Scene, lvl: number, shab: boolean, titles: number): Box {
  const g = s.g, GY = s.GY, cx = cen('arena');
  const [bw, bh] = ([[40, 16], [48, 20], [56, 24], [60, 28], [62, 34]] as const)[lvl - 1];
  const x = Math.round(cx - bw / 2), y = GY - bh;
  if (lvl <= 2) {
    // a brick gym
    R(g, x, y, bw, bh, '#a24c3a');
    for (let r = y + 2, row = 0; r < GY; r += 3, row++) {
      R(g, x, r, bw, 1, '#86392c');
      for (let c = x + (row % 2 ? 2 : 5); c < x + bw - 1; c += 6) R(g, c, r - 2, 1, 2, '#86392c');
    }
    R(g, x - 1, y - 2, bw + 2, 2, '#5a2a22');
    if (lvl === 2) arch(g, x + 2, y - 2, bw - 4, 5, s.p1);
    winRow(s, x + 3, y + 5, 2, 5, 4, 3, 11, shab);
    winRow(s, x + bw - 16, y + 5, 2, 5, 4, 3, 21, shab);
    R(g, cx - 4, GY - 8, 8, 8, '#3a2a22'); R(g, cx, GY - 8, 1, 8, '#2a1e18');
    plate(s, cx, y + 2 - (lvl === 2 ? 1 : 0), lvl === 2 ? s.abbr : 'GYM');
  } else if (lvl <= 4) {
    // a proper arena: concrete, a team band, a curved metal roof, glass doors
    const roofH = lvl === 3 ? 6 : 8;
    R(g, x, y + roofH - 2, bw, bh - roofH + 2, '#cfc8bc');
    arch(g, x - 1, y + roofH, bw + 2, roofH + 1, '#8b93a6', '#6e7689');
    R(g, x, y + roofH, bw, 3, s.p1); R(g, x, y + roofH + 3, bw, 1, s.p2);
    if (lvl === 4) {
      R(g, x + 3, y + roofH + 6, bw - 6, 5, s.night ? '#2c2a44' : '#5f8db3');
      winRow(s, x + 4, y + roofH + 7, 9, 4, 3, 2, 31, shab);
      // roof-edge lights, chasing
      for (let i = 0; i < 12; i++) R(g, x + 3 + i * 5, y + roofH - 2, 1, 1, (Math.floor(s.t * 4) + i) % 3 === 0 ? '#fff6a0' : '#8a7a40');
      plate(s, cx, y + roofH - 3, s.abbr, 2);
    } else {
      winRow(s, x + 4, y + roofH + 6, 4, 4, 3, 2, 41, shab);
      winRow(s, x + bw - 26, y + roofH + 6, 4, 4, 3, 2, 51, shab);
      plate(s, cx, y + roofH - 1, s.abbr);
    }
    R(g, cx - 8, GY - 8, 16, 8, '#2c2a3c');
    for (let i = 0; i < 4; i++) R(g, cx - 7 + i * 4, GY - 7, 3, 7, s.night ? '#ffd86b' : '#86b9dc');
    // a flag on the roof
    flag(s, cx, y - 1, 7, s.p1, s.p2);
  } else {
    // the dome: a lit base, a ribbed dome in team colours, a jumbotron and searchlights
    const baseH = 18, domeH = bh - baseH;
    R(g, x, GY - baseH, bw, baseH, '#d8d2c6');
    arch(g, x, GY - baseH, bw, domeH, s.p1, shade(s.p1, 0.75));
    R(g, x - 1, GY - baseH - 1, bw + 2, 2, s.p2);
    R(g, x + 2, GY - baseH + 2, bw - 4, 3, s.night ? '#ffd86b' : '#7fb2d9');
    for (let i = 0; i < 15; i++) R(g, x + 3 + i * 4, GY - baseH + 2, 1, 3, '#cfc8bc');
    // jumbotron
    const jx = cx - 10, jy = GY - baseH + 7;
    R(g, jx, jy, 20, 9, '#1c1a28'); R(g, jx + 1, jy + 1, 18, 7, '#0c0b14');
    const phase = Math.floor(s.t / 2.5) % 3;
    if (phase === 0) drawText(g, s.abbr, cx, jy + 2, s.p2 === '#ffffff' ? s.p2 : '#ffffff', { align: 'center' });
    else if (phase === 1) { if (Math.floor(s.t * 4) % 2) drawText(g, 'GO!', cx, jy + 2, '#ffd23c', { align: 'center' }); }
    else { const k = (s.t * 1.6) % 1; R(g, jx + 2 + k * 14, jy + 5 - Math.sin(k * Math.PI) * 4, 2, 2, '#ff8a3c'); }
    R(g, cx - 9, GY - 1, 18, 1, '#2c2a3c');
    flag(s, cx, GY - bh - 1, 8, s.p2, s.p1);
  }
  // a banner for every championship, hanging either side of the sign
  const off = lvl <= 2 ? 10 : lvl === 3 ? 11 : lvl === 4 ? 15 : 12;
  const perSide = Math.max(1, Math.floor((bw / 2 - off - 2) / 5));
  const n = Math.min(titles, perSide * 2);
  const by = lvl <= 2 ? y + 1 : lvl <= 4 ? y + (lvl === 3 ? 6 : 8) + 4 : GY - 12;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    const bx = side > 0 ? cx + off + k * 5 : cx - off - 4 - k * 5;
    R(g, bx, by, 4, 7, s.p1); R(g, bx, by + 5, 4, 1, s.p2); R(g, bx + 1, by + 2, 2, 2, '#ffd23c');
    R(g, bx, by + 7, 1, 1, s.p1); R(g, bx + 3, by + 7, 1, 1, s.p1);
  }
  return { x, y, w: bw, h: bh };
}
function flag(s: Scene, x: number, y: number, pole: number, c1: string, c2: string): void {
  R(s.g, x, y - pole, 1, pole, '#c8c8d0');
  for (let i = 0; i < 6; i++) {
    const dy = Math.round(Math.sin(s.t * 6 - i * 0.9) * (i / 6) * 1.2);
    R(s.g, x + 1 + i, y - pole + dy, 1, 4, i < 3 ? c1 : c2);
  }
}

function training(s: Scene, lvl: number, shab: boolean): Box {
  const g = s.g, GY = s.GY, cx = cen('training');
  const [bw, bh] = ([[18, 10], [24, 13], [28, 17], [30, 21], [32, 25]] as const)[lvl - 1];
  const x = Math.round(cx - bw / 2), y = GY - bh;
  if (lvl === 1) {
    R(g, x, y + 3, bw, bh - 3, '#8a5a34');
    for (let c = x + 2; c < x + bw; c += 3) R(g, c, y + 3, 1, bh - 3, '#6e4628');
    for (let r = 0; r < 4; r++) R(g, x - 1 + r * 2, y + r, bw + 2 - r * 4, 1, '#5a3a22');
    R(g, cx - 2, GY - 6, 4, 6, '#3a2618');
    win(s, x + 2, y + 5, 3, 3, 61, shab);
  } else if (lvl === 2) {
    R(g, x, y + 1, bw, bh - 1, '#9aa3ad');
    for (let c = x + 1; c < x + bw; c += 2) R(g, c, y + 1, 1, bh - 1, '#86909b');
    R(g, x - 1, y, bw + 2, 2, '#5f6873');
    R(g, x + 3, GY - 8, 11, 8, '#6c757d');
    for (let r = GY - 7; r < GY; r += 2) R(g, x + 3, r, 11, 1, '#59626a');
    win(s, x + bw - 7, y + 4, 4, 3, 62, shab);
  } else if (lvl === 3) {
    R(g, x, y, bw, bh, '#b85c44');
    for (let r = y + 2, row = 0; r < GY; r += 3, row++) {
      R(g, x, r, bw, 1, '#9a4a36');
      for (let c = x + (row % 2 ? 1 : 4); c < x + bw - 1; c += 6) R(g, c, r - 2, 1, 2, '#9a4a36');
    }
    R(g, x - 1, y - 1, bw + 2, 2, '#4a3a34');
    plate(s, cx, y + 2, 'GYM');
    winRow(s, x + 3, y + 10, 3, 4, 3, 5, 63, shab);
    R(g, cx - 2, GY - 6, 5, 6, '#2c2a3c');
  } else if (lvl === 4) {
    R(g, x, y, bw, bh, '#d8d2c6');
    R(g, x - 1, y - 1, bw + 2, 2, s.p1);
    R(g, x + 2, y + 4, bw - 4, 6, s.night ? '#2c2a44' : '#5f8db3');
    winRow(s, x + 3, y + 5, 5, 4, 4, 1, 64, shab);
    // a dumbbell sign
    R(g, cx - 5, y + 13, 11, 1, '#2c2a3c'); R(g, cx - 6, y + 12, 2, 3, '#2c2a3c'); R(g, cx + 5, y + 12, 2, 3, '#2c2a3c');
    R(g, cx - 2, GY - 5, 5, 5, '#2c2a3c');
  } else {
    // a glass gym: team-colour frame, glass panels, people working out inside
    R(g, x, y, bw, bh, s.p1);
    R(g, x + 1, y + 2, bw - 2, bh - 3, s.night ? '#ffe9a8' : '#9fd0ef');
    for (let c = x + 1; c < x + bw - 1; c += 5) R(g, c, y + 2, 1, bh - 3, shade(s.p1, 0.8));
    R(g, x + 1, y + 12, bw - 2, 1, shade(s.p1, 0.8));
    if (!s.night) for (let i = 0; i < 5; i++) R(g, x + 3 + i * 6, y + 4 + (i % 2), 1, 2, '#e6f5ff');
    for (let i = 0; i < 3; i++) {
      const px = x + 4 + ((i * 9 + Math.floor((Math.sin(s.t * 1.5 + i * 2) + 1) * 3)) % (bw - 8));
      const fy = i === 1 ? y + 11 : GY - 1;
      R(g, px, fy - 4, 2, 2, '#4a3a34'); R(g, px, fy - 2, 2, 2, '#2c2a3c');
    }
    R(g, x - 1, y - 1, bw + 2, 2, s.p2);
    R(g, cx - 3, GY - 6, 6, 6, '#2c2a3c');
  }
  return { x, y, w: bw, h: bh };
}

function medical(s: Scene, lvl: number, shab: boolean): Box {
  const g = s.g, GY = s.GY, cx = cen('medical');
  const [bw, bh] = ([[16, 10], [20, 12], [26, 16], [30, 20], [32, 24]] as const)[lvl - 1];
  const x = Math.round(cx - bw / 2), y = GY - bh;
  const cross = (cx2: number, cy: number, big = false) => {
    if (big) { R(g, cx2 - 4, cy - 4, 9, 9, '#ffffff'); R(g, cx2 - 1, cy - 3, 3, 7, '#e23b3b'); R(g, cx2 - 3, cy - 1, 7, 3, '#e23b3b'); }
    else { R(g, cx2 - 3, cy - 3, 7, 7, '#ffffff'); R(g, cx2 - 1, cy - 2, 2, 5, '#e23b3b'); R(g, cx2 - 2, cy - 1, 4, 2, '#e23b3b'); }
  };
  if (lvl === 1) {
    // a first-aid tent
    for (let r = 0; r < bh; r++) {
      const half = Math.round(((r + 1) / bh) * (bw / 2));
      R(g, cx - half, y + r, half, 1, '#d2d0c8'); R(g, cx, y + r, half, 1, '#f0efe8');
    }
    R(g, cx - 1, GY - 4, 2, 4, '#7a7468');
    cross(cx, y + 6);
  } else {
    R(g, x, y, bw, bh, '#ecebe6');
    R(g, x - 1, y - 1, bw + 2, 2, '#9aa6b8');
    const rows = lvl === 2 ? 1 : lvl === 3 ? 1 : lvl === 4 ? 2 : 3;
    for (let r = 0; r < rows; r++) winRow(s, x + 3, y + 4 + r * 6, Math.floor((bw - 4) / 5), 3, 3, 2, 70 + r * 10, shab);
    R(g, cx - 3, GY - 6, 6, 6, '#7f8ea6');
    R(g, cx - 2, GY - 5, 4, 5, s.night ? '#ffe9a8' : '#b9d6ea');
    if (lvl === 2) cross(cx, y - 4);
    if (lvl >= 3) {
      // the cross on the roof; at the top level it is big and glows at night
      const big = lvl === 5;
      R(g, cx, y - 4, 1, 3, '#9aa6b8');
      cross(cx, y - (big ? 8 : 6), big);
      if (big && s.night && Math.floor(s.t * 2) % 2) R(g, cx - 5, y - 13, 11, 1, 'rgba(255,90,90,0.5)');
    }
    if (lvl >= 4) { R(g, cx - 6, GY - 8, 12, 2, '#9aa6b8'); }
  }
  return { x, y, w: bw, h: bh };
}
function ambulance(s: Scene): void {
  const g = s.g, x = PLAZA[0] + 1, by = s.GY + 1;
  R(g, x, by - 6, 13, 6, '#f4f4f4'); R(g, x + 9, by - 5, 4, 3, '#9fc8e8');
  R(g, x, by - 3, 13, 1, '#e23b3b'); R(g, x + 3, by - 6, 3, 1, '#e23b3b');
  R(g, x + 2, by, 2, 1, '#22202e'); R(g, x + 9, by, 2, 1, '#22202e');
  const on = Math.floor(s.t * 4) % 2;
  R(g, x + 4, by - 7, 2, 1, on ? '#ff4d4d' : '#4da6ff'); R(g, x + 6, by - 7, 2, 1, on ? '#4da6ff' : '#ff4d4d');
}

function scouting(s: Scene, lvl: number, shab: boolean): Box {
  const g = s.g, GY = s.GY, cx = cen('scouting');
  const [bw, bh] = ([[18, 8], [18, 8], [22, 12], [24, 16], [26, 20]] as const)[lvl - 1];
  const x = Math.round(cx - bw / 2), y = GY - bh - (lvl <= 2 ? 2 : 0);
  const dish = (dx: number, dy: number, flip = false) => {
    const d = flip ? -1 : 1;
    R(g, dx, dy + 3, 1, 3, '#8a8a96');
    R(g, dx - 2 * d, dy, 1, 1, '#e8e8f0'); R(g, dx - d, dy + 1, 1, 1, '#e8e8f0'); R(g, dx, dy + 2, 1, 1, '#e8e8f0');
    R(g, dx + d, dy + 2, 1, 1, '#e8e8f0'); R(g, dx + 2 * d, dy + 1, 1, 1, '#d0d0dc');
    R(g, dx - d, dy - 1, 1, 1, '#ff8a3c');
  };
  if (lvl <= 2) {
    // a trailer on blocks
    R(g, x, y, bw, bh, '#d9cfa8'); R(g, x, y + 4, bw, 1, s.p1);
    R(g, x - 1, y - 1, bw + 2, 1, '#b8ad86');
    win(s, x + 3, y + 1, 4, 2, 81, shab); win(s, x + 10, y + 1, 4, 2, 82, shab);
    R(g, x + 2, GY - 2, 3, 2, '#8a8a8a'); R(g, x + bw - 5, GY - 2, 3, 2, '#8a8a8a');
    R(g, x + bw, y + bh - 2, 3, 1, '#5a5a66');
    if (lvl === 2) {
      // a whip antenna with a pennant
      R(g, x + 3, y - 9, 1, 9, '#8a8a96'); R(g, x + 1, y - 7, 5, 1, '#8a8a96');
      R(g, x + 4, y - 9 + Math.round(Math.sin(s.t * 6)), 3, 2, s.p2);
    }
  } else {
    const glass = lvl === 5;
    R(g, x, y, bw, bh, glass ? s.p1 : lvl === 4 ? '#a9564a' : '#bcc6cf');
    if (glass) { R(g, x + 1, y + 1, bw - 2, bh - 2, s.night ? '#ffe9a8' : '#9fd0ef'); for (let c = x + 1; c < x + bw - 1; c += 5) R(g, c, y + 1, 1, bh - 2, shade(s.p1, 0.8)); }
    else winRow(s, x + 3, y + 3, Math.floor((bw - 4) / 5), 3, 3, 2, 90 + lvl, shab);
    if (lvl === 4) winRow(s, x + 3, y + 9, 4, 3, 3, 2, 95, shab);
    R(g, x - 1, y - 1, bw + 2, 2, '#4a4a58');
    R(g, cx - 2, GY - 5, 4, 5, '#2c2a3c');
    dish(x + 4, y - 6);
    if (lvl >= 4) dish(x + bw - 5, y - 6, true);
    if (lvl === 5) {
      dish(cx, y - 7);
      // a radio mast with a blinking light
      R(g, x + bw - 2, y - 16, 1, 15, '#c8c8d0');
      for (let i = 0; i < 4; i++) R(g, x + bw - 3, y - 14 + i * 4, 3, 1, '#a8a8b4');
      R(g, x + bw - 2, y - 17, 1, 1, Math.floor(s.t * 1.5) % 2 ? '#ff3b3b' : '#6a1a1a');
    }
  }
  return { x, y, w: bw, h: bh };
}

// ---- states: run down, under construction ------------------------------------------------
function shabby(s: Scene, b: Box, seed: number): void {
  const g = s.g;
  g.fillStyle = 'rgba(40,30,20,0.28)'; g.fillRect(b.x, b.y, b.w, b.h);
  // cracks
  for (let k = 0; k < 2; k++) {
    let cx = b.x + 3 + Math.floor(hash(seed + k) * (b.w - 6)), cy = b.y + 2 + Math.floor(hash(seed + k + 9) * 3);
    for (let i = 0; i < Math.min(8, b.h - 3); i++) { R(g, cx, cy, 1, 1, '#2b1e17'); cy++; cx += hash(seed * 3 + i + k * 17) < 0.5 ? -1 : 1; }
  }
  // a boarded window
  const bx = b.x + 2 + Math.floor(hash(seed + 5) * Math.max(1, b.w - 8)), by = b.y + Math.max(2, Math.floor(b.h / 2) - 2);
  R(g, bx, by, 5, 5, '#3a2a22');
  for (let i = 0; i < 5; i++) { R(g, bx + i, by + i, 1, 1, '#a0703e'); R(g, bx + 4 - i, by + i, 1, 1, '#a0703e'); }
  // weeds along the bottom
  for (let i = 0; i < b.w; i += 4) {
    if (hash(seed + i * 13) < 0.6) { R(g, b.x + i, s.GY - 2, 1, 2, '#4f8a35'); R(g, b.x + i + 1, s.GY - 3, 1, 3, '#62a544'); }
  }
}
function scaffold(s: Scene, b: Box): void {
  const g = s.g, top = b.y - 4;
  for (let x = b.x - 1; x <= b.x + b.w; x += 5) R(g, x, top, 1, s.GY - top, '#7d6a4a');
  for (let y = top; y < s.GY; y += 5) R(g, b.x - 1, y, b.w + 2, 1, '#b08a4a');
  // a crane over the job
  const mx = Math.min(W - 6, b.x + b.w + 1), mtop = Math.max(2, b.y - 14);
  R(g, mx, mtop, 3, s.GY - mtop, '#e0b000');
  for (let y = mtop + 1; y < s.GY; y += 3) R(g, mx + 1, y, 1, 1, '#9a7a00');
  R(g, mx - 26, mtop, 32, 2, '#e0b000');
  for (let x = mx - 25; x < mx; x += 3) R(g, x, mtop + 1, 1, 1, '#9a7a00');
  R(g, mx + 3, mtop + 2, 4, 3, '#5a5a66'); R(g, mx - 1, mtop + 2, 4, 3, '#d04030');
  const hx = Math.round(mx - 18 + Math.sin(s.t * 0.6) * 5), hy = Math.round(mtop + 9 + Math.sin(s.t * 1.3) * 2);
  R(g, hx, mtop + 2, 1, hy - mtop - 2, '#3a3846');
  R(g, hx - 3, hy, 7, 2, '#8a6236');
}

// ---- the scene ----------------------------------------------------------------------------
function drawScene(g: CanvasRenderingContext2D, save: Save, t: number, full: boolean): void {
  const H = full ? H_FULL : H_COMPACT;
  const oy = full ? SKY_EXTRA : 0;
  const GY = oy + 50;
  const team = save.teams[save.userTeamId];
  const hour = new Date().getHours();
  const night = hour >= 20 || hour < 6, dusk = !night && hour >= 17;
  const s: Scene = { g, t, GY, H, full, night, dusk, p1: team.colors.primary, p2: team.colors.secondary, abbr: team.abbr };
  g.clearRect(0, 0, W, H);
  // sky in bands
  const bands = night ? ['#0e1030', '#121540', '#171b4a', '#1d2356'] : dusk ? ['#3b2a5c', '#6a3a6b', '#c0605a', '#eba36b'] : ['#5fb6f2', '#79c3f4', '#93cff6', '#b4def8'];
  const skyH = GY;
  for (let i = 0; i < 4; i++) R(g, 0, (skyH * i) / 4, W, skyH / 4 + 1, bands[i]);
  if (night) {
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(hash(i + 1) * W), y = Math.floor(hash(i + 50) * (GY - 24));
      if (Math.sin(t * 2 + i) > -0.6) R(g, x, y, 1, 1, i % 5 ? '#c8cbe8' : '#ffffff');
    }
    R(g, W - 26, 6 + oy / 2, 6, 6, '#f2f0d8'); R(g, W - 24, 7 + oy / 2, 5, 5, bands[0]);
  } else {
    R(g, W - 26, 5 + oy / 3, 7, 7, dusk ? '#ffb070' : '#fff1a0');
    for (let k = 0; k < 3; k++) {
      const cx = ((hash(k + 7) * W + t * (2 + k)) % (W + 30)) - 15, cy = 6 + k * 7 + oy / 2;
      const c = dusk ? '#e8a8a0' : '#ffffff';
      R(g, cx, cy, 14, 3, c); R(g, cx + 3, cy - 2, 7, 2, c);
    }
  }
  if (full) drawText(g, `HOME OF THE ${team.name}`, W / 2, 4, '#ffffff', { align: 'center', outline: '#14121f' });
  // the city behind
  const city = night ? '#1e2350' : dusk ? '#5a4370' : '#a8bbd8';
  for (let x = 0, i = 0; x < W; x += 8, i++) {
    const h = 8 + Math.floor(hash(i + 300) * 16);
    R(g, x, GY - h, 7, h, city);
    if (night) for (let k = 0; k < 3; k++) if (hash(i * 7 + k) < 0.5) R(g, x + 1 + k * 2, GY - h + 2 + k * 3, 1, 1, '#ffd86b');
  }
  // searchlights over the big arena, behind everything else
  const f = team.facilities;
  if (f.arena.level >= 5) {
    const ax = cen('arena');
    g.fillStyle = night || dusk ? 'rgba(255,250,210,0.22)' : 'rgba(255,255,255,0.12)';
    for (const [k, sx] of [[0, ax - 24], [1, ax + 24]] as const) {
      const a = -Math.PI / 2 + Math.sin(t * 0.7 + k * 2) * 0.55, len = 60, half = 0.09;
      g.beginPath(); g.moveTo(sx, GY - 30);
      g.lineTo(sx + Math.cos(a - half) * len, GY - 30 + Math.sin(a - half) * len);
      g.lineTo(sx + Math.cos(a + half) * len, GY - 30 + Math.sin(a + half) * len);
      g.closePath(); g.fill();
    }
  }
  // grass behind the plaza line
  R(g, 0, GY - 1, W, 1, night ? '#2d4a2a' : '#5a9a48');
  // buildings
  const draw: Record<FacilityKey, (lvl: number, shab: boolean) => Box> = {
    scouting: (l, sh) => scouting(s, l, sh), training: (l, sh) => training(s, l, sh),
    arena: (l, sh) => arena(s, l, sh, team.titles.length), medical: (l, sh) => medical(s, l, sh),
  };
  ORDER.forEach((k, i) => {
    const fac: Facility = f[k];
    const lvl = Math.max(1, Math.min(5, fac.level));
    const shab = fac.condition < 50;
    const b = draw[k](lvl, shab);
    if (shab) shabby(s, b, 400 + i * 31);
    if (fac.pending) scaffold(s, b);
  });
  if (f.medical.level >= 5) ambulance(s);
  // flagpole on the plaza
  const fx = PLAZA[1] - 12;
  R(g, fx, GY - 26, 1, 26, '#c8c8d0'); R(g, fx - 1, GY - 27, 3, 1, '#ffd23c');
  for (let i = 0; i < 9; i++) {
    const dy = Math.round(Math.sin(t * 5 - i * 0.8) * (i / 9) * 1.5);
    R(g, fx + 1 + i, GY - 25 + dy, 1, 6, i < 5 ? s.p1 : s.p2);
  }
  // sidewalk
  R(g, 0, GY, W, 3, '#bdb6aa');
  for (let x = 3; x < W; x += 9) R(g, x, GY, 1, 3, '#a39c90');
  // the fans: more of them the more the city loves you
  const fans = Math.round(Math.max(0, Math.min(100, save.fans)) / 100 * 26);
  const plazaStart = PLAZA[0] + (f.medical.level >= 5 ? 16 : 2);
  for (let i = 0; i < fans; i++) {
    const inPlaza = i % 3 !== 2;
    const x = inPlaza ? plazaStart + Math.floor(hash(i + 900) * (PLAZA[1] - 3 - plazaStart)) : SLOT.arena[0] + 4 + Math.floor(hash(i + 950) * 56);
    const shirt = hash(i + 970) < 0.75 ? (i % 2 ? s.p1 : s.p2) : ['#e8e0c0', '#4da6ff', '#5fd35f'][i % 3];
    const cheer = hash(i * 31 + Math.floor(t * 2)) < 0.12;
    person(s, x, GY + 2, shirt, SKINS[Math.floor(hash(i + 990) * 5)], cheer, 0);
  }
  // people walking by
  for (let k = 0; k < 3; k++) {
    const dir = k % 2 ? -1 : 1, speed = 5 + k * 2;
    const x = ((((hash(k + 40) * W + dir * t * speed) % (W + 10)) + W + 10) % (W + 10)) - 5;
    person(s, Math.round(x), GY + 2, ['#4a6aa8', '#a84a6a', '#6a8a4a'][k], SKINS[(k * 2) % 5], false, Math.floor(t * 6 + k) % 2 ? 1 : -1);
  }
  if (full) {
    // a name strip under each building: what it is and how far it has come
    R(g, 0, GY + 3, W, H - GY - 3, '#24223a');
    R(g, 0, GY + 3, W, 1, '#3a3760');
    for (const k of ORDER) {
      const fac = f[k], c = cen(k);
      drawText(g, LABEL[k], c, GY + 5, fac.condition < 50 ? '#ff9a7a' : '#e8e4f8', { align: 'center' });
      for (let i = 0; i < 5; i++) {
        const on = i < fac.level, next = fac.pending && i === fac.level;
        R(g, c - 7 + i * 3, GY + 12, 2, 2, on ? '#ffd23c' : next && Math.floor(t * 3) % 2 ? '#ffd23c' : '#4a4766');
      }
    }
  } else {
    // a street, with the odd car
    R(g, 0, GY + 3, W, H - GY - 3, '#4b4a5a');
    for (let x = (Math.floor(-t * 10) % 8 + 8) % 8; x < W; x += 8) R(g, x, GY + 6, 3, 1, '#d8d0b0');
    const carX = ((t * 24) % (W + 60)) - 30;
    R(g, carX, GY + 3, 11, 3, '#d04040'); R(g, carX + 2, GY + 2, 6, 2, '#e86060'); R(g, carX + 5, GY + 2, 2, 1, '#9fc8e8');
    R(g, carX + 1, GY + 6, 2, 1, '#14121f'); R(g, carX + 8, GY + 6, 2, 1, '#14121f');
  }
}

/** The club's home in pixels. Tap a building to pick it. `compact` is the short strip for the hub. */
export function ClubView({ save, compact, onPick }: { save: Save; compact?: boolean; onPick?: (k: FacilityKey) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(save);
  live.current = save;
  const H = compact ? H_COMPACT : H_FULL;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    const g = buf.getContext('2d')!;
    const out = c.getContext('2d')!;
    let raf = 0, last = -1e9;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 50) return; // 20 frames a second is plenty for flags and lights
      last = now;
      drawScene(g, live.current, (now - t0) / 1000, !compact);
      // scale up by a whole number into the canvas; CSS stretches the rest with pixelated sampling
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(1, Math.round((c.clientWidth * dpr) / W));
      if (c.width !== W * k || c.height !== H * k) { c.width = W * k; c.height = H * k; }
      out.imageSmoothingEnabled = false;
      out.drawImage(buf, 0, 0, W * k, H * k);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [compact]);
  const tap = (e: MouseEvent) => {
    if (!onPick || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const hit = ORDER.find(k => x >= SLOT[k][0] - 1 && x <= SLOT[k][1] + 1);
    if (hit) onPick(hit);
  };
  return <canvas ref={ref} class={`clubview ${compact ? 'compact' : ''} ${onPick ? 'tap' : ''}`} style={{ aspectRatio: `${W} / ${H}` }} onClick={tap} />;
}
