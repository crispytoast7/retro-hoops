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

/** One backup per starter slot (null if the bench is too short), best fits first. */
export function pickBackups(pool: Player[], starters: number[]): (number | null)[] {
  const out: (number | null)[] = starters.map(() => null);
  const used = new Set<number>(starters);
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
