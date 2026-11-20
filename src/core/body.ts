import { FEATURED } from '../data/names';
import type { Player, Pos } from './types';

/** Typical pro height (inches) by position. */
const BASE_HT: Record<Pos, number> = { PG: 74, SG: 77, SF: 79, PF: 81, C: 83 };

/** A steady 0..1 from a player id and a slot, so his size never changes and no save field is needed. */
function roll(id: number, k: number): number {
  let h = Math.imul(id ^ (k * 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Height in inches and weight in pounds. Pros are pro-sized; a featured player has his own. */
export function bodyOf(p: Player): { ht: number; wt: number } {
  const f = FEATURED.find(x => x.name === p.name);
  if (f) return { ht: f.ht, wt: f.wt };
  // spread of -2..+2 inches, most near the middle
  const ht = BASE_HT[p.pos] + Math.round((roll(p.id, 1) + roll(p.id, 2) - 1) * 2.5);
  const wt = Math.round((195 + (ht - 74) * 7.5 + (roll(p.id, 3) - 0.5) * 24) / 5) * 5;
  return { ht, wt };
}

export const feetInches = (inches: number): string => `${Math.floor(inches / 12)}'${inches % 12}"`;
export const heightOf = (p: Player): string => feetInches(bodyOf(p).ht);
export const sizeOf = (p: Player): string => { const b = bodyOf(p); return `${feetInches(b.ht)}, ${b.wt} lb`; };
