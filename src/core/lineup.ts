import { overallOf } from './ratings';
import type { Player, Pos, Save, Team } from './types';
import { POSITIONS } from './types';

const ADJ: Record<Pos, Pos[]> = { PG: ['SG'], SG: ['PG', 'SF'], SF: ['SG', 'PF'], PF: ['SF', 'C'], C: ['PF'] };

/** How well a player fills a slot: own position full value, neighbour -4, otherwise -10. */
export function slotValue(p: Player, slot: Pos): number {
  const base = overallOf(p.ratings, slot);
  if (p.pos === slot) return base;
  return base - (ADJ[p.pos].includes(slot) ? 4 : 10);
}

/** Best healthy five in PG..C slot order (greedy by biggest edge). */
export function autoLineup(players: Player[]): number[] {
  const pool = players.filter(p => !p.injury);
  const avail = pool.length >= 5 ? pool : players.slice();
  const out: (number | null)[] = [null, null, null, null, null];
  const used = new Set<number>();
  const cands: { v: number; id: number; s: number }[] = [];
  for (const p of avail) POSITIONS.forEach((slot, s) => cands.push({ v: slotValue(p, slot), id: p.id, s }));
  cands.sort((a, b) => b.v - a.v);
  for (const c of cands) {
    if (out[c.s] !== null || used.has(c.id)) continue;
    out[c.s] = c.id; used.add(c.id);
  }
  return out.filter((x): x is number => x !== null);
}

/** Repair a team's lineup after roster changes or injuries: keep valid starters, fill holes. */
export function fixLineup(save: Save, team: Team): void {
  const ok = (id: number) => team.roster.includes(id) && !save.players[id].injury;
  const kept = team.lineup.map(id => (ok(id) ? id : -1));
  if (kept.length === 5 && kept.every(id => id >= 0) && new Set(kept).size === 5) return;
  const used = new Set(kept.filter(id => id >= 0));
  const bench = team.roster.map(id => save.players[id]).filter(p => !used.has(p.id));
  const healthy = bench.filter(p => !p.injury);
  const pool = healthy.length ? healthy : bench;
  for (let s = 0; s < 5; s++) {
    if (kept[s] !== undefined && kept[s] >= 0) continue;
    let best: Player | null = null, bv = -1e9;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const v = slotValue(p, POSITIONS[s]);
      if (v > bv) { bv = v; best = p; }
    }
    if (best) { kept[s] = best.id; used.add(best.id); }
  }
  team.lineup = kept.filter(id => id !== undefined && id >= 0);
}
