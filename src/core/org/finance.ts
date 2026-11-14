// The money rules: soft cap, luxury tax, two aprons, and the few ways a team may add salary.
import {
  FIRST_APRON, LUXURY_TAX, MAX_SALARY, MIN_DEAL_YEARS, MIN_SALARY, MLE, SALARY_CAP, SECOND_APRON, SUPERMAX_SALARY, TAX_MLE,
} from '../constants';
import { round1 } from '../ratings';
import type { Save, Team } from '../types';

/** Rostered live contracts plus dead cap. A deal with no years left has expired (offseason) and is off the books. */
export function payroll(save: Save, team: Team): number {
  let t = team.deadCap;
  for (const id of team.roster) { const c = save.players[id].contract; if (c.years > 0) t += c.salary; }
  return round1(t);
}
/** Room under the soft cap. Negative when the team is over it. */
export const capSpace = (save: Save, team: Team): number => round1(SALARY_CAP - payroll(save, team));
export const teamById = (save: Save, id: number): Team => save.teams[id];
export const userTeam = (save: Save): Team => save.teams[save.userTeamId];

// ---- where a payroll stands ----------------------------------------------------------
export type CapStatus = 'under cap' | 'over cap' | 'taxpayer' | 'first apron' | 'second apron';
/** Status for a payroll figure: each line is crossed only when the payroll is above it. */
export function statusOf(pay: number): CapStatus {
  if (pay <= SALARY_CAP) return 'under cap';
  if (pay <= LUXURY_TAX) return 'over cap';
  if (pay <= FIRST_APRON) return 'taxpayer';
  if (pay <= SECOND_APRON) return 'first apron';
  return 'second apron';
}
export const capStatus = (save: Save, team: Team): CapStatus => statusOf(payroll(save, team));

/** The season-end tax bill at a payroll: 1 credit per full $3M over the line, owner approval -1 per $4M over (at least -2). */
export function taxBill(pay: number): { over: number; credits: number; ownerHit: number } {
  const over = round1(Math.max(0, pay - LUXURY_TAX));
  if (over <= 0) return { over: 0, credits: 0, ownerHit: 0 };
  return { over, credits: Math.floor(over / 3 + 1e-9), ownerHit: Math.max(2, Math.floor(over / 4 + 1e-9)) };
}
/** What the luxury tax would cost this team if the season ended now. */
export const luxuryTax = (save: Save, team: Team): { over: number; credits: number; ownerHit: number } =>
  taxBill(payroll(save, team));

// ---- signing -------------------------------------------------------------------------
export type SigningVia = 'space' | 'bird' | 'mle' | 'taxMle' | 'min';
export type SigningResult = { ok: true; via: SigningVia } | { ok: false; reason: string };
export const VIA_LABEL: Record<SigningVia, string> = {
  space: 'cap space', bird: 'own free agent', mle: 'mid-level exception', taxMle: 'taxpayer mid-level', min: 'minimum deal',
};
export interface SigningOpts {
  /** Re-signing his own expiring player: always allowed. */
  ownPlayer?: boolean;
  /** Contract length, when known: a minimum deal runs 1 or 2 years. */
  years?: number;
  /** Salary already promised elsewhere (other pending offers) to count on top of the payroll. */
  pending?: number;
  /** Treat the mid-level as spent (another pending offer would use it). */
  mleTaken?: boolean;
}

const m = (v: number): string => `$${round1(v)}M`;

/** The one place that decides whether a team may add a salary, and how. Roster size is the caller's business. */
export function signingPath(save: Save, team: Team, salary: number, opts: SigningOpts = {}): SigningResult {
  const s = round1(salary);
  const pay = round1(payroll(save, team) + (opts.pending ?? 0));
  const after = round1(pay + s);
  if (s < MIN_SALARY) return { ok: false, reason: `The minimum salary is ${m(MIN_SALARY)}.` };
  if (opts.ownPlayer) {
    if (s > SUPERMAX_SALARY) return { ok: false, reason: `No contract can pay more than ${m(SUPERMAX_SALARY)}.` };
    return { ok: true, via: after <= SALARY_CAP ? 'space' : 'bird' };
  }
  if (s > MAX_SALARY) return { ok: false, reason: `The maximum salary is ${m(MAX_SALARY)}.` };
  if (after <= SALARY_CAP) return { ok: true, via: 'space' };
  if (s <= MIN_SALARY && (opts.years ?? 1) <= MIN_DEAL_YEARS) return { ok: true, via: 'min' };
  const mleLeft = !team.mleUsed && !opts.mleTaken;
  if (mleLeft && s <= MLE && after <= FIRST_APRON) return { ok: true, via: 'mle' };
  if (mleLeft && s <= TAX_MLE && after <= SECOND_APRON) return { ok: true, via: 'taxMle' };

  // Not allowed: say which rule stands in the way, and what would be allowed instead.
  if (s <= MIN_SALARY) return { ok: false, reason: `Over the cap, a minimum deal can run ${MIN_DEAL_YEARS} years at most.` };
  const best = maxOffer(save, team, opts);
  if (best.via === 'space') return { ok: false, reason: `You have ${m(best.salary)} of cap space: that is the most you can offer.` };
  if (best.via === 'mle') return { ok: false, reason: `Over the cap: the most you can offer is the mid-level exception, ${m(best.salary)}.` };
  if (best.via === 'taxMle') {
    return pay > FIRST_APRON
      ? { ok: false, reason: `Over the first apron only the taxpayer mid-level is left: up to ${m(best.salary)}.` }
      : { ok: false, reason: `That would take you past the first apron (${m(FIRST_APRON)}), where only the taxpayer mid-level is allowed: up to ${m(best.salary)}.` };
  }
  if (!mleLeft) return { ok: false, reason: 'Over the cap with the mid-level exception already used: only minimum deals.' };
  if (pay > SECOND_APRON) return { ok: false, reason: 'Over the second apron: only minimum deals and your own free agents.' };
  return { ok: false, reason: `Any more than the minimum would put the payroll over the second apron (${m(SECOND_APRON)}).` };
}

/** The biggest salary this team could offer an outside free agent right now, and the path it would use. Every salary from the minimum up to this is legal. */
export function maxOffer(save: Save, team: Team, opts: SigningOpts = {}): { salary: number; via: SigningVia } {
  const pay = round1(payroll(save, team) + (opts.pending ?? 0));
  const mleLeft = !team.mleUsed && !opts.mleTaken;
  let best: { salary: number; via: SigningVia } = { salary: MIN_SALARY, via: 'min' };
  const consider = (salary: number, via: SigningVia) => { const v = round1(Math.min(MAX_SALARY, salary)); if (v > best.salary) best = { salary: v, via }; };
  if (mleLeft) {
    consider(Math.min(MLE, FIRST_APRON - pay), 'mle');
    consider(Math.min(TAX_MLE, SECOND_APRON - pay), 'taxMle');
  }
  // cap space wins a tie: it does not spend the exception
  if (round1(Math.min(MAX_SALARY, SALARY_CAP - pay)) >= best.salary) best = { salary: round1(Math.min(MAX_SALARY, SALARY_CAP - pay)), via: 'space' };
  return best;
}

/** Whether the mid-level is still there to use, and how big it is at this payroll. */
export function mleStatus(save: Save, team: Team): { available: boolean; amount: number; kind: 'mle' | 'taxMle' | null } {
  if (team.mleUsed) return { available: false, amount: 0, kind: null };
  const pay = payroll(save, team);
  const full = round1(Math.min(MLE, FIRST_APRON - pay)), tax = round1(Math.min(TAX_MLE, SECOND_APRON - pay));
  if (full >= tax && full > MIN_SALARY) return { available: true, amount: full, kind: 'mle' };
  if (tax > MIN_SALARY) return { available: true, amount: tax, kind: 'taxMle' };
  return { available: false, amount: 0, kind: null };
}

// ---- trades --------------------------------------------------------------------------
/** The most salary a team may take back in a trade that sends out `outgoing`. Judged on the payroll after the trade: anything that fits under the cap; 125% of outgoing plus $0.25M while it stays at or under the first apron; never more than outgoing above it. */
export function matchLimit(save: Save, team: Team, outgoing: number): number {
  const pay = payroll(save, team);
  const base = pay - outgoing;
  const underCap = SALARY_CAP - base;
  const overCap = Math.min(outgoing * 1.25 + 0.25, FIRST_APRON - base);
  return round1(Math.max(underCap, overCap, outgoing));
}
