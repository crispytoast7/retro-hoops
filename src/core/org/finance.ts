// The money rules: a salary cap for signing other teams' players, and a hard limit nobody may pass.
import { HARD_LIMIT, MAX_SALARY, MIN_DEAL_YEARS, MIN_SALARY, SALARY_CAP } from '../constants';
import { round1 } from '../ratings';
import type { Save, Team } from '../types';

/** Rostered live contracts plus dead cap. A deal with no years left has expired (offseason) and is off the books. */
export function payroll(save: Save, team: Team): number {
  let t = team.deadCap;
  for (const id of team.roster) { const c = save.players[id].contract; if (c.years > 0) t += c.salary; }
  return round1(t);
}
/** Room under the cap. Negative when the team is over it. */
export const capSpace = (save: Save, team: Team): number => round1(SALARY_CAP - payroll(save, team));
/** Room under the hard limit: what is left for re-signing the team's own players. */
export const limitSpace = (save: Save, team: Team): number => round1(HARD_LIMIT - payroll(save, team));
export const teamById = (save: Save, id: number): Team => save.teams[id];
export const userTeam = (save: Save): Team => save.teams[save.userTeamId];

// ---- where a payroll stands ----------------------------------------------------------
export type CapStatus = 'under the cap' | 'over the cap' | 'at the hard limit';
/** Status for a payroll figure. "At the hard limit" means within $2M of it (or past it). */
export function statusOf(pay: number): CapStatus {
  if (pay >= HARD_LIMIT - 2) return 'at the hard limit';
  if (pay > SALARY_CAP) return 'over the cap';
  return 'under the cap';
}
export const capStatus = (save: Save, team: Team): CapStatus => statusOf(payroll(save, team));

// ---- signing -------------------------------------------------------------------------
export type SigningVia = 'space' | 'own' | 'min';
export type SigningResult = { ok: true; via: SigningVia } | { ok: false; reason: string };
export interface SigningOpts {
  /** Re-signing his own expiring player: allowed over the cap, up to the hard limit. */
  ownPlayer?: boolean;
  /** Contract length, when known: a minimum deal runs 1 or 2 years. */
  years?: number;
  /** Salary already promised elsewhere (other pending offers) to count on top of the payroll. */
  pending?: number;
}

const m = (v: number): string => `$${round1(v)}M`;

/** The one place that decides whether a team may add a salary, and how: into cap space; over the cap for its own player, up to the hard limit; or a minimum deal, which is always allowed. Roster size is the caller's business. */
export function signingPath(save: Save, team: Team, salary: number, opts: SigningOpts = {}): SigningResult {
  const s = round1(salary);
  const pay = round1(payroll(save, team) + (opts.pending ?? 0));
  const after = round1(pay + s);
  if (s < MIN_SALARY) return { ok: false, reason: `The minimum salary is ${m(MIN_SALARY)}.` };
  if (s > MAX_SALARY) return { ok: false, reason: `The maximum salary is ${m(MAX_SALARY)}.` };
  if (after <= SALARY_CAP) return { ok: true, via: 'space' };
  if (s <= MIN_SALARY && (opts.years ?? 1) <= MIN_DEAL_YEARS) return { ok: true, via: 'min' };
  if (opts.ownPlayer) {
    if (after <= HARD_LIMIT) return { ok: true, via: 'own' };
    const room = round1(HARD_LIMIT - pay);
    return {
      ok: false,
      reason: room >= MIN_SALARY
        ? `That would take your payroll to ${m(after)}, past the hard limit of ${m(HARD_LIMIT)}. You have ${m(room)} of room under it.`
        : `Your payroll is at the hard limit of ${m(HARD_LIMIT)}: there is no room to re-sign him.`,
    };
  }
  if (s <= MIN_SALARY) return { ok: false, reason: `Over the cap, a minimum deal can run ${MIN_DEAL_YEARS} years at most.` };
  const room = round1(SALARY_CAP - pay);
  return {
    ok: false,
    reason: room >= MIN_SALARY
      ? `You have ${m(room)} of cap space: that is the most you can offer another team's free agent.`
      : `You are over the cap: only minimum deals (${m(MIN_SALARY)}) for other teams' free agents.`,
  };
}

/** The biggest salary this team could offer a free agent right now, and the path it would use: its cap space for another team's player, room under the hard limit for its own (opts.ownPlayer). Every salary from the minimum up to this is legal. */
export function maxOffer(save: Save, team: Team, opts: SigningOpts = {}): { salary: number; via: SigningVia } {
  const pay = round1(payroll(save, team) + (opts.pending ?? 0));
  const room = round1(Math.min(MAX_SALARY, SALARY_CAP - pay));
  if (opts.ownPlayer) {
    const own = round1(Math.min(MAX_SALARY, HARD_LIMIT - pay));
    if (own >= MIN_SALARY && own > room) return { salary: own, via: 'own' };
  }
  return room >= MIN_SALARY ? { salary: room, via: 'space' } : { salary: MIN_SALARY, via: 'min' };
}

// ---- trades --------------------------------------------------------------------------
/** The most salary a team may take back in a trade that sends out `outgoing`: anything that leaves it at or under the cap; if it would be over the cap afterwards, no more than it sends. (So a trade can never carry a payroll up past the hard limit.) */
export function matchLimit(save: Save, team: Team, outgoing: number): number {
  const base = payroll(save, team) - outgoing;
  return round1(Math.max(SALARY_CAP - base, outgoing));
}
