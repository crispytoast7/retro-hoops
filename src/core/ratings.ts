import type { Player, Pos, RatingKey, Ratings, StatLine } from './types';

/** Position weights for overall. Each row sums to 1. */
export const POS_WEIGHTS: Record<Pos, Ratings> = {
  PG: { sht: 0.17, hnd: 0.25, pas: 0.25, spd: 0.13, fin: 0.07, def: 0.10, reb: 0.03 },
  SG: { sht: 0.30, hnd: 0.17, pas: 0.10, spd: 0.13, fin: 0.13, def: 0.12, reb: 0.05 },
  SF: { sht: 0.20, hnd: 0.10, pas: 0.08, spd: 0.14, fin: 0.18, def: 0.18, reb: 0.12 },
  PF: { sht: 0.10, hnd: 0.04, pas: 0.06, spd: 0.08, fin: 0.24, def: 0.22, reb: 0.26 },
  C:  { sht: 0.04, hnd: 0.02, pas: 0.05, spd: 0.05, fin: 0.27, def: 0.27, reb: 0.30 },
};

export function overallOf(ratings: Ratings, pos: Pos): number {
  const w = POS_WEIGHTS[pos];
  let s = 0;
  for (const k in w) s += ratings[k as RatingKey] * w[k as RatingKey];
  return Math.round(s);
}
export const ovr = (p: Player): number => overallOf(p.ratings, p.pos);

/** 1-100 -> stars in half steps, 0.5 to 5. */
export function stars(v: number): number {
  const s = Math.round(((v - 30) / 62) * 10) / 2; // 30 -> 0, 92 -> 5
  return Math.max(0.5, Math.min(5, s));
}
/** Whole-star level 1-5 used for upgrade pricing. */
export const starLevel = (v: number): number => Math.max(1, Math.min(5, Math.ceil(stars(v))));

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/**
 * Raise one rating by up to `by` points. A player's ceiling is physical: the raise stops at the point
 * where his overall would pass it. Returns what he actually gained.
 */
export function raiseRating(p: Player, key: RatingKey, by: number): number {
  const before = p.ratings[key];
  p.ratings[key] = clamp(before + by, 1, 99);
  while (p.ratings[key] > before && overallOf(p.ratings, p.pos) > p.potential) p.ratings[key]--;
  return p.ratings[key] - before;
}
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export function emptyStats(): StatLine {
  return { gp: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
}
export function addStats(into: StatLine, from: StatLine): StatLine {
  for (const k in into) (into as any)[k] += (from as any)[k] ?? 0;
  return into;
}
export function careerStats(p: Player): StatLine {
  const t = emptyStats();
  for (const s of p.seasons) addStats(t, s.stats);
  return addStats(t, p.season);
}
/** Single-number game score used for top performer and awards. */
export function gameScore(s: StatLine): number {
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.orb + 0.3 * s.drb + s.stl + 0.7 * s.ast + 0.7 * s.blk - s.tov;
}
