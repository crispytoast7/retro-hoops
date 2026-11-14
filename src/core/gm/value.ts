import { LUXURY_TAX, MAX_CONTRACT_YEARS, MAX_FA_YEARS, MAX_SALARY, MIN_SALARY, SALARY_CAP, SECOND_APRON, SUPERMAX_SALARY } from '../constants';
import { resignDiscount } from '../org/progress';
import { clamp, ovr, round1 } from '../ratings';
import type { Contract, DraftPick, Player, Pos, Save, Team } from '../types';
import { POSITIONS } from '../types';

type Curve = readonly (readonly [number, number])[];

/** Piecewise-linear lookup, clamped at both ends. */
function lerpCurve(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

/** Overall -> trade value for a prime-age player on a fair contract. */
const VALUE_CURVE: Curve = [
  [40, 0], [50, 1], [55, 2.5], [58, 5], [62, 10], [66, 18], [70, 30],
  [75, 45], [80, 62], [85, 80], [90, 105], [93, 122], [99, 150],
];
/** Overall -> fair $M per season at prime age. Runs past the max salary at the top: only a supermax can pay that part. */
const SALARY_CURVE: Curve = [
  [50, 1.5], [55, 3.2], [60, 5.5], [65, 8.5], [70, 15], [75, 23.5],
  [80, 33], [82, 37], [86, 42], [90, 46], [95, 52.5],
];

function salaryAgeFactor(age: number): number {
  if (age <= 29) return 1;
  if (age === 30) return 0.95;
  if (age === 31) return 0.88;
  if (age === 32) return 0.8;
  if (age === 33) return 0.7;
  if (age === 34) return 0.58;
  return 0.48;
}

function valueAgeFactor(age: number): number {
  if (age <= 24) return 1.08;
  if (age <= 27) return 1.04;
  if (age <= 29) return 1;
  if (age === 30) return 0.88;
  if (age === 31) return 0.72;
  if (age === 32) return 0.56;
  if (age === 33) return 0.42;
  if (age === 34) return 0.3;
  if (age === 35) return 0.2;
  return 0.12;
}

/** How much of the gap to his ceiling a young player is credited with. */
function potentialWeight(age: number): number {
  if (age <= 20) return 0.6;
  if (age >= 26) return 0;
  return 0.6 - (age - 20) * 0.1;
}

/** What his play is worth before the max-salary rule cuts it off. */
function rawSalaryAt(p: Player, age: number): number {
  const o = ovr(p);
  let s = lerpCurve(SALARY_CURVE, o) * salaryAgeFactor(age);
  if (age <= 23 && p.potential > o) s *= 1 + Math.min(0.2, (p.potential - o) * 0.01);
  return s;
}
function marketSalaryAt(p: Player, age: number): number {
  return round1(clamp(rawSalaryAt(p, age), MIN_SALARY, MAX_SALARY));
}

/** Fair $M per season for this player on the open market (ovr and age driven; the minimum for a 50, about 8 for a 65, 14 for a 70, 22 for a 75, 36 for an 82, the max for a 90+). With 10-man rosters a typical team's payroll built from this lands a little over the soft cap. */
export function marketSalary(p: Player): number {
  return marketSalaryAt(p, p.age);
}

/** Talent part of the value: overall, potential and age. No contract, no injury. */
export function talentValue(p: Player): number {
  const o = ovr(p);
  const eff = o + Math.max(0, p.potential - o) * potentialWeight(p.age);
  return lerpCurve(VALUE_CURVE, eff) * valueAgeFactor(p.age);
}

const YEAR_WEIGHTS = [1, 0.8, 0.6, 0.45, 0.35];

/** Value from the contract alone: positive for a bargain, negative for an overpay. Looks ahead at how his market price ages. */
export function contractSurplusValue(p: Player, contract: Contract): number {
  let surplus = 0;
  const years = Math.min(contract.years, MAX_CONTRACT_YEARS);
  for (let i = 0; i < years; i++) {
    surplus += YEAR_WEIGHTS[i] * (marketSalaryAt(p, p.age + i) - contract.salary);
  }
  // $M to trade-value points: a bargain is worth a little less than an overpay costs
  return surplus > 0 ? surplus * 0.24 : surplus * 0.29;
}

/** playerValue as if he were on a different contract (used to judge re-signings and signings). */
export function valueWithContract(save: Save, p: Player, contract: Contract): number {
  let talent = talentValue(p);
  if (p.injury && p.injury.weeks > 0) {
    talent *= save.phase === 'offseason'
      ? 1 - Math.min(0.2, p.injury.weeks * 0.02)
      : 1 - Math.min(0.4, p.injury.weeks * 0.04);
  }
  // Expired deal: all a team holds is the inside track on re-signing him.
  if (contract.years <= 0) return round1(talent * 0.3);
  return round1(talent + contractSurplusValue(p, contract));
}

/** Trade value on an open scale: replacement-level vet about 5, average starter about 30, star about 80, superstar 120+. Non-linear in overall; adjusted for age (youth and potential add, 31+ subtracts steeply), contract (surplus of marketSalary over actual salary x years adds, overpaid subtracts), injury. */
export function playerValue(save: Save, p: Player): number {
  return valueWithContract(save, p, p.contract);
}

/** Win pct for a record, 0.5 when nothing has been played. */
function pct(w: number, l: number): number {
  return w + l > 0 ? w / (w + l) : 0.5;
}

/** 0-1 blend of this season's record (once it means something) and last season's. */
export function teamSuccess(team: Team): number {
  const last = team.history.length ? team.history[team.history.length - 1] : null;
  const lastPct = last ? pct(last.w, last.l) : 0.5;
  const gp = team.record.w + team.record.l;
  if (gp === 0) return lastPct;
  const wNow = Math.min(1, gp / 8);
  return pct(team.record.w, team.record.l) * wNow + lastPct * (1 - wNow);
}

function desiredYears(p: Player, own: boolean): number {
  const o = ovr(p);
  let y: number;
  if (p.age <= 22) y = 3;
  else if (p.age <= 29) y = 4;
  else if (p.age <= 31) y = 3;
  else if (p.age <= 33) y = 2;
  else y = 1;
  // only his own team can give a proven player a fifth year
  if (own && o >= 74 && p.age >= 23 && p.age <= 28) y = 5;
  if (o < 62) y = Math.min(y, 2);
  if (o < 56) y = 1;
  return clamp(y, 1, own ? MAX_CONTRACT_YEARS : MAX_FA_YEARS);
}

/** Supermax rule: an MVP or All-League award at any point in his career. Only his own team can offer it. */
export const supermaxEligible = (p: Player): boolean =>
  p.awards.some(a => a.startsWith('MVP') || a.startsWith('All-League'));

/** What the player asks for from a given team. Rises with ratings, prime age and the team's success (win pct this season, titles); 'Loyal' and long tenure discount for his own team, 'Mercenary' and 'Diva' ask more, low morale asks more or refuses (refuses = true) to re-sign with his current team. Capped at the max salary, or the supermax from his own team when he is eligible (`supermax` = the ask is above the normal max). His own team may offer up to 5 years, anyone else 4. */
export function askingContract(save: Save, p: Player, teamId: number): { salary: number; years: number; refuses: boolean; supermax: boolean } {
  const team = save.teams[teamId];
  let f = 1;
  if (p.age >= 25 && p.age <= 29) f += 0.04;
  if (team) {
    f += (teamSuccess(team) - 0.5) * 0.08;
    const recentTitles = team.titles.filter(y => y >= save.year - 3).length;
    f += Math.min(0.04, recentTitles * 0.02);
  }
  if (p.trait === 'Mercenary') f += 0.12;
  if (p.trait === 'Diva') f += 0.1;

  let refuses = false;
  const own = p.teamId === teamId;
  if (own) {
    if (p.trait === 'Loyal') f -= 0.1;
    f -= Math.min(0.075, p.tenure * 0.015);
    if (p.morale < 40) f += 0.15;
    else if (p.morale < 55) f += 0.05;
    const walkAt = p.trait === 'Loyal' ? 12 : 25;
    if (p.morale < walkAt || save.tradeDemands.includes(p.id)) refuses = true;
  }
  // the user's Negotiator perk
  if (own && teamId === save.userTeamId) f *= resignDiscount(save);
  const top = own && supermaxEligible(p) ? SUPERMAX_SALARY : MAX_SALARY;
  const salary = round1(clamp(rawSalaryAt(p, p.age) * f, MIN_SALARY, top));
  return { salary, years: desiredYears(p, own), refuses, supermax: salary > MAX_SALARY };
}

/** How high an AI team lets its payroll run when it keeps its own players: contenders pay the tax up to the second apron, everyone else stops at the tax line. */
export const keepCeiling = (team: Team): number => (team.strategy === 'contend' ? SECOND_APRON : LUXURY_TAX);
/** How high an AI team will go to add a player from outside: contenders up to the second apron, middle teams up to the tax line, rebuilders only into cap space. */
export const addCeiling = (team: Team): number =>
  team.strategy === 'contend' ? SECOND_APRON : team.strategy === 'middle' ? LUXURY_TAX : SALARY_CAP;

/** Roster quality as one number on the overall scale: starters count fully, the next three half. */
export function teamStrength(save: Save, team: Team): number {
  const os = team.roster.map(id => ovr(save.players[id])).sort((a, b) => b - a);
  if (!os.length) return 40;
  let sum = 0, wsum = 0;
  for (let i = 0; i < Math.min(8, os.length); i++) {
    const w = i < 5 ? 1 : 0.5;
    sum += os[i] * w; wsum += w;
  }
  return sum / wsum;
}

/** Team ids from expected best to expected worst this season. */
export function expectedOrder(save: Save): number[] {
  return save.teams
    .map(t => {
      const gp = t.record.w + t.record.l;
      const rec = gp > 0 ? (pct(t.record.w, t.record.l) - 0.5) * 10 * Math.min(1, gp / 8) : 0;
      return { id: t.id, q: teamStrength(save, t) + rec };
    })
    .sort((a, b) => b.q - a.q || a.id - b.id)
    .map(x => x.id);
}

/** Value of a draft pick on the same scale as playerValue (round 1 worth about 12-40 depending on the original team's expected record, round 2 about 3-8; later years discounted). */
export function pickValue(save: Save, pick: DraftPick): number {
  const yearsOut = pick.year - save.year;
  if (yearsOut < 0) return 0;
  const order = expectedOrder(save);
  const idx = order.indexOf(pick.origTeamId);
  let frac = idx < 0 || order.length < 2 ? 0.5 : idx / (order.length - 1); // 0 best team, 1 worst
  // The further out, the less today's roster says about the slot.
  const certainty = yearsOut === 0 ? 1 : yearsOut === 1 ? 0.6 : 0.35;
  frac = 0.5 + (frac - 0.5) * certainty;
  const base = pick.round === 1 ? 12 + 28 * frac : 3 + 5 * frac;
  return round1(base * Math.pow(0.88, yearsOut));
}

const MISSING_SLOT = 45;

function posQuality(save: Save, roster: readonly number[]): Record<Pos, number> {
  const best: Record<Pos, [number, number]> = {
    PG: [MISSING_SLOT, MISSING_SLOT], SG: [MISSING_SLOT, MISSING_SLOT], SF: [MISSING_SLOT, MISSING_SLOT],
    PF: [MISSING_SLOT, MISSING_SLOT], C: [MISSING_SLOT, MISSING_SLOT],
  };
  for (const id of roster) {
    const p = save.players[id];
    if (!p) continue;
    const o = ovr(p);
    const b = best[p.pos];
    if (o > b[0]) { b[1] = b[0]; b[0] = o; }
    else if (o > b[1]) b[1] = o;
  }
  const out = {} as Record<Pos, number>;
  for (const pos of POSITIONS) out[pos] = best[pos][0] * 0.65 + best[pos][1] * 0.35;
  return out;
}

/** League-average quality of a team's best two at each position. */
export function leaguePosAverages(save: Save): Record<Pos, number> {
  const sum: Record<Pos, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const t of save.teams) {
    const q = posQuality(save, t.roster);
    for (const pos of POSITIONS) sum[pos] += q[pos];
  }
  const n = Math.max(1, save.teams.length);
  for (const pos of POSITIONS) sum[pos] /= n;
  return sum;
}

/** teamNeeds for any list of player ids (a roster as it would look after a move). Pass `avg` to avoid recomputing league averages. */
export function needsForRoster(save: Save, roster: readonly number[], avg?: Record<Pos, number>): Record<Pos, number> {
  const league = avg ?? leaguePosAverages(save);
  const q = posQuality(save, roster);
  const out = {} as Record<Pos, number>;
  for (const pos of POSITIONS) out[pos] = clamp(0.5 + (league[pos] - q[pos]) / 16, 0, 1);
  return out;
}

/** Need at each position, 0 (stacked) to 1 (desperate), from the quality of the team's best two players per position vs league average. */
export function teamNeeds(save: Save, team: Team): Record<Pos, number> {
  return needsForRoster(save, team.roster);
}
