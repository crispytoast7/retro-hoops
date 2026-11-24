// Side helpers for the game sim: who is available, who starts, who backs up each slot,
// and the composite ratings the engine and the UI read.
import { autoLineup, slotValue } from '../lineup';
import { clamp, ovr } from '../ratings';
import { POSITIONS, type Player } from '../types';

/** Weights of the scoring composite that drives shot usage. */
const SCORER_BEST = 0.45; // better of shooting / finishing
const SCORER_OTHER = 0.2; // the weaker of the two
const SCORER_HANDLES = 0.2;
const SCORER_SPEED = 0.15;

/** Weights of the defensive composite shown to the UI and AI. */
const DEF_DEFENSE = 0.7;
const DEF_REBOUND = 0.2;
const DEF_SPEED = 0.1;

/** How dangerous a player is with the ball (1-100). */
export function scorerRating(p: Player): number {
  const r = p.ratings;
  return (
    SCORER_BEST * Math.max(r.sht, r.fin) +
    SCORER_OTHER * Math.min(r.sht, r.fin) +
    SCORER_HANDLES * r.hnd +
    SCORER_SPEED * r.spd
  );
}

/** Overall defensive value (1-100). */
export function defenderRating(p: Player): number {
  const r = p.ratings;
  return DEF_DEFENSE * r.def + DEF_REBOUND * r.reb + DEF_SPEED * r.spd;
}

/** Healthy players; if fewer than five are healthy, the best injured ones fill in. */
export function availablePlayers(players: Player[]): Player[] {
  const healthy = players.filter(p => !p.injury);
  if (healthy.length >= 5) return healthy;
  const hurt = players.filter(p => p.injury).sort((a, b) => ovr(b) - ovr(a));
  return healthy.concat(hurt.slice(0, 5 - healthy.length));
}

/** The given lineup if it is five different available players, otherwise the best five. */
export function resolveLineup(lineup: number[], pool: Player[]): number[] {
  const ids = new Set(pool.map(p => p.id));
  const valid = lineup.length === 5 && new Set(lineup).size === 5 && lineup.every(id => ids.has(id));
  return valid ? lineup.slice() : autoLineup(pool);
}

/** One backup per starter slot (null if the bench is too short): the ones the coach named, then the best fits. */
export function pickBackups(pool: Player[], starters: number[], named?: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = starters.map(() => null);
  const used = new Set<number>(starters);
  const here = new Set(pool.map(p => p.id));
  // a named backup counts only while he is available and not starting himself
  starters.forEach((_, s) => { const id = named?.[s]; if (id !== null && id !== undefined && here.has(id) && !used.has(id)) { out[s] = id; used.add(id); } });
  const cands: { v: number; id: number; s: number }[] = [];
  for (const p of pool) {
    if (used.has(p.id)) continue;
    for (let s = 0; s < starters.length; s++) cands.push({ v: slotValue(p, POSITIONS[s]), id: p.id, s });
  }
  cands.sort((a, b) => b.v - a.v || a.id - b.id);
  for (const c of cands) {
    if (out[c.s] !== null || used.has(c.id)) continue;
    out[c.s] = c.id;
    used.add(c.id);
  }
  return out;
}

export type Depth = 'tight' | 'normal' | 'deep';
/** Seconds of each of a backup's two stints, before his quality is weighed. */
const STINT_BASE: Record<Depth, number> = { tight: 280, normal: 400, deep: 520 };
export const GAME_MINUTES = 48;
export interface RotationSlot {
  slot: (typeof POSITIONS)[number];
  starterId: number;
  backupId: number | null;
  /** Seconds of each of the backup's two stints (0: he does not come in). */
  stint: number;
  starterMin: number; backupMin: number;
}
/**
 * Who plays how much. Every starter has one backup, who comes in for two stints a game. How long those
 * stints are depends on how good the backup is next to the man he relieves: a sixth man who could start
 * plays a lot, a deep reserve only spells him. A tight rotation uses just the two best backups.
 */
export function rotationPlan(pool: Player[], starters: number[], opts: { backups?: (number | null)[]; depth?: Depth } = {}): RotationSlot[] {
  const depth = opts.depth ?? 'normal';
  const byId = new Map(pool.map(p => [p.id, p]));
  const backups = pickBackups(pool, starters, opts.backups);
  const worth = starters.map((sid, s) => {
    const st = byId.get(sid), b = backups[s] !== null ? byId.get(backups[s]!) : undefined;
    return { s, b, gap: st && b ? slotValue(st, POSITIONS[s]) - slotValue(b, POSITIONS[s]) : 99, value: b ? slotValue(b, POSITIONS[s]) : -1 };
  });
  // in a tight rotation only the two best reserves see the floor
  const plays = new Set(depth === 'tight' ? worth.filter(w => w.b).sort((a, b) => b.value - a.value).slice(0, 2).map(w => w.s) : worth.filter(w => w.b).map(w => w.s));
  return worth.map(w => {
    // a typical reserve (about ten points behind his starter) plays the standard stints; one who could nearly start plays more
    const k = clamp(1 + (10 - w.gap) * 0.02, 1, 1.2);
    const stint = plays.has(w.s) ? Math.round((STINT_BASE[depth] * k) / 20) * 20 : 0;
    const backupMin = Math.round((stint * 2) / 60);
    return { slot: POSITIONS[w.s], starterId: starters[w.s], backupId: stint > 0 ? backups[w.s] : null, stint, starterMin: GAME_MINUTES - backupMin, backupMin };
  });
}

/** Offense, defense and overall (1-100) of a five, for the UI and the AI. */
export function teamRatings(players: Player[], lineup: number[]): { off: number; def: number; ovr: number } {
  const pool = availablePlayers(players);
  const byId = new Map(pool.map(p => [p.id, p]));
  const five = resolveLineup(lineup, pool).map(id => byId.get(id)).filter((p): p is Player => !!p);
  if (!five.length) return { off: 1, def: 1, ovr: 1 };
  const mean = (f: (p: Player) => number) => five.reduce((s, p) => s + f(p), 0) / five.length;
  const fit = (v: number) => clamp(Math.round(v), 1, 100);
  return { off: fit(mean(scorerRating)), def: fit(mean(defenderRating)), ovr: fit(mean(ovr)) };
}
