import { MIN_SALARY, NUM_TEAMS } from '../constants';
import { clamp, ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import type { Contract, Player, Save } from '../types';
import { teamNeeds } from './value';

/** Which prospect the AI team takes: best available by (ovr now, potential, age) with a need bump and some noise so drafts are not identical. `prospects` = save.offseason.prospects. Returns player id (-1 if the board is empty). Does not mutate. */
export function aiDraftChoice(save: Save, teamId: number, rng: Rng): number {
  const board = save.offseason ? save.offseason.prospects : [];
  const team = save.teams[teamId];
  if (!board.length || !team) return -1;
  const needs = teamNeeds(save, team);
  // Contenders want help now, rebuilders buy ceiling.
  const wNow = team.strategy === 'contend' ? 0.55 : team.strategy === 'rebuild' ? 0.3 : 0.42;
  let best = -1, bs = -1e9;
  for (const id of board) {
    const p = save.players[id];
    if (!p) continue;
    const s = ovr(p) * wNow + p.potential * (1 - wNow)
      - Math.max(0, p.age - 19) * 0.8
      + needs[p.pos] * 4
      + rng.gauss() * 1.8;
    if (s > bs) { bs = s; best = id; }
  }
  return best;
}

/** Rookie contract for a draft slot: round 1 pick 1 about $10M x 3 yrs sliding to $3M at pick 16; round 2 the minimum x 2 yrs. A drafted player can always be signed, whatever the payroll. */
export function rookieContract(round: 1 | 2, pick: number): Contract {
  if (round === 2) return { salary: MIN_SALARY, years: 2 };
  const slot = clamp(pick, 1, NUM_TEAMS);
  return { salary: round1(10 - ((slot - 1) * 7) / (NUM_TEAMS - 1)), years: 3 };
}

/** Still on the contract he was drafted to (first-round picks get 3 years; second-rounders sign for the minimum, which is exempt anyway). */
export function onRookieDeal(save: Save, p: Player): boolean {
  if (!p.draft || p.contract.years <= 0 || save.year - p.draft.year > 3) return false;
  return p.contract.salary === rookieContract(p.draft.round === 2 ? 2 : 1, p.draft.pick).salary;
}
