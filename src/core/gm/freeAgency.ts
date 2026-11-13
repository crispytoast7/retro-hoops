import { FA_DAYS, MAX_CONTRACT_YEARS, MAX_SALARY, MIN_SALARY, ROSTER_MAX, ROSTER_NORMAL } from '../constants';
import { capSpace } from '../org/finance';
import { releasePlayer, signPlayer } from '../org/roster';
import { clamp, ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import type { FreeAgentOffer, Player, Save, Team } from '../types';
import { FACILITY_KEYS, POSITIONS } from '../types';
import { askingContract, leaguePosAverages, marketSalary, needsForRoster, playerValue, teamSuccess } from './value';

function formerTeamId(p: Player): number | null {
  return p.seasons.length ? p.seasons[p.seasons.length - 1].teamId : null;
}

/** How attractive an offer is to a free agent: money vs his asking price (dominant), years (young want short if cheap, old want long), team success (last season + current record), facilities (average level of team.facilities), coach reputation (save.coach.rep, only for the user's team; AI teams use team.prestige), playing-time opportunity (teamNeeds at his position), trait effects (Mercenary = money only, Loyal prefers former team). Scale so that 100 = "signs immediately", 70 = "would accept if nothing better". */
export function offerScore(save: Save, p: Player, offer: FreeAgentOffer): number {
  const team = save.teams[offer.teamId];
  if (!team) return 0;
  const ask = askingContract(save, p, offer.teamId);
  const r = offer.salary / Math.max(MIN_SALARY, ask.salary);
  // Money: 70 at his number, 100 at 30% over, falling faster below it.
  let score = 70 + (r >= 1 ? (r - 1) * 100 : (r - 1) * 130);
  if (p.trait === 'Mercenary') return round1(clamp(score, 0, 130));

  // Years.
  const dy = offer.years - ask.years;
  if (p.age >= 30) score += dy > 0 ? Math.min(6, dy * 2) : dy * 3;
  else if (p.age <= 25 && r < 1) score -= Math.max(0, offer.years - 2) * 2; // won't lock in cheap
  else score -= Math.abs(dy) * 1.5;

  score += (teamSuccess(team) - 0.5) * 14;
  let fac = 0;
  for (const k of FACILITY_KEYS) fac += team.facilities[k].level;
  score += (fac / FACILITY_KEYS.length - 3) * 2;
  const rep = offer.teamId === save.userTeamId ? save.coach.rep : team.prestige;
  score += ((rep - 50) / 50) * 4;
  score += (needsForRoster(save, team.roster)[p.pos] - 0.5) * 8;
  if (p.trait === 'Loyal' && formerTeamId(p) === offer.teamId) score += 8;
  return round1(clamp(score, 0, 130));
}

/** UI helper: 'low' | 'medium' | 'high' interest for a hypothetical user offer. */
export function interestLevel(save: Save, p: Player, offer: FreeAgentOffer): 'none' | 'low' | 'medium' | 'high' {
  const s = offerScore(save, p, offer);
  if (s < 45) return 'none';
  if (s < 65) return 'low';
  if (s < 82) return 'medium';
  return 'high';
}

/** Score an offer must clear on a given day: picky early, takes the best real offer on the last day. */
function dayThreshold(day: number): number {
  if (day >= FA_DAYS) return 45;
  return Math.max(64, 88 - (day - 1) * 6);
}

const canFit = (save: Save, team: Team, salary: number): boolean =>
  team.roster.length < ROSTER_MAX && capSpace(save, team) >= salary - 1e-9;

const dealText = (years: number, salary: number): string => `(${years} yr${years === 1 ? '' : 's'}, $${round1(salary)}M)`;

/** The offers AI teams put on the table today. */
function aiOffers(save: Save, rng: Rng, day: number): Map<number, FreeAgentOffer[]> {
  const out = new Map<number, FreeAgentOffer[]>();
  const avg = leaguePosAverages(save);
  const pool = save.freeAgents.map(id => save.players[id]).filter(p => p && !p.retired);
  const teams = rng.shuffle(save.teams.filter(t => t.id !== save.userTeamId));
  for (const team of teams) {
    if (team.roster.length >= ROSTER_MAX) continue;
    const space = capSpace(save, team);
    if (space < MIN_SALARY) continue;
    const needs = needsForRoster(save, team.roster, avg);
    const os = team.roster.map(id => ovr(save.players[id])).sort((a, b) => b - a);
    const short = team.roster.length < ROSTER_NORMAL;
    // With a full ten, only a real upgrade to the rotation is worth a spot.
    const bar = short ? (os[7] ?? 0) - 6 : (os[4] ?? 0);
    const cands: { p: Player; fit: number; salary: number; years: number }[] = [];
    for (const p of pool) {
      const o = ovr(p);
      if (o < bar) continue;
      if (team.strategy === 'rebuild' && p.age >= 31 && !short) continue;
      if (team.strategy === 'contend' && p.age <= 22 && o < 66 && !short) continue;
      const ask = askingContract(save, p, team.id);
      // Bid around his number, a little higher as the days run out and for a position of need.
      const f = rng.range(0.93, 1.08) + needs[p.pos] * 0.06 + (day - 1) * 0.01;
      const salary = round1(clamp(ask.salary * f, MIN_SALARY, MAX_SALARY));
      if (salary > space) continue;
      let v = Math.max(0.5, playerValue(save, { ...p, contract: { salary, years: ask.years } }));
      if (team.strategy === 'rebuild' && p.age >= 29) v *= 0.7;
      if (team.strategy === 'contend' && o >= 75) v *= 1.15;
      cands.push({ p, fit: v * (0.6 + 0.8 * needs[p.pos]), salary, years: ask.years });
    }
    cands.sort((a, b) => b.fit - a.fit);
    let committed = 0;
    for (const c of cands.slice(0, short ? 3 : 2)) {
      if (committed + c.salary > space) continue;
      committed += c.salary;
      const list = out.get(c.p.id) ?? [];
      list.push({ teamId: team.id, salary: c.salary, years: clamp(c.years, 1, MAX_CONTRACT_YEARS) });
      out.set(c.p.id, list);
    }
  }
  return out;
}

/** One offseason free-agency day. AI teams with needs and cap space make offers to the best-fitting free agents; each free agent with offers (AI ones plus save.offseason.userOffers[playerId]) picks the best by offerScore if it clears a threshold that drops each day (day 1 picky, last day takes the best available); signs via signPlayer. Never exceed cap or ROSTER_MAX. Clears resolved user offers. Returns log lines for the user ("M. Reyes signs with Harbor City (3 yrs, $12.5M)", "T. Banks turned down your offer."). Pushes news for notable signings. Reads the day from save.offseason.faDay; the caller advances it. */
export function runFreeAgencyDay(save: Save, rng: Rng): string[] {
  const log: string[] = [];
  const off = save.offseason;
  const day = off ? clamp(off.faDay || 1, 1, FA_DAYS) : FA_DAYS;
  const lastDay = day >= FA_DAYS;
  const threshold = dayThreshold(day);
  const userOffers: Record<number, FreeAgentOffer> = off ? off.userOffers : {};
  const offers = aiOffers(save, rng, day);
  const userId = save.userTeamId;

  // Offers for players who are no longer available are simply dropped.
  for (const key of Object.keys(userOffers)) {
    const id = Number(key);
    if (!save.freeAgents.includes(id)) delete userOffers[id];
  }

  const ids = save.freeAgents
    .filter(id => offers.has(id) || userOffers[id] !== undefined)
    .sort((a, b) => ovr(save.players[b]) - ovr(save.players[a]) || a - b);

  for (const id of ids) {
    const p = save.players[id];
    const mine = userOffers[id];
    const all: FreeAgentOffer[] = [...(offers.get(id) ?? [])];
    if (mine) all.push({ ...mine, teamId: userId });
    const scored = all
      .map(o => ({ o, s: offerScore(save, p, o) + (o.teamId === userId ? 0 : rng.range(-1.5, 1.5)) }))
      .sort((a, b) => b.s - a.s);

    let signedWith: Team | null = null;
    let userCouldNotFit = false;
    for (const { o, s } of scored) {
      if (s < threshold) break;
      const team = save.teams[o.teamId];
      const salary = round1(clamp(o.salary, MIN_SALARY, MAX_SALARY));
      const years = clamp(Math.round(o.years), 1, MAX_CONTRACT_YEARS);
      if (!canFit(save, team, salary)) {
        if (o.teamId === userId) userCouldNotFit = true;
        continue;
      }
      signPlayer(save, id, team.id, { salary, years });
      signedWith = team;
      const isUser = team.id === userId;
      log.push(`${p.name} signs with ${team.city} ${dealText(years, salary)}`);
      if (isUser || ovr(p) >= 76) {
        save.news.unshift({
          year: save.year, week: save.week, kind: 'signing',
          text: `${p.name} signs with ${team.city} ${dealText(years, salary)}.`,
          ...(isUser ? { mine: true } : {}),
        });
      }
      break;
    }

    if (!mine) continue;
    if (signedWith) {
      if (signedWith.id !== userId) log.push(`${p.name} turned down your offer.`);
      delete userOffers[id];
    } else if (userCouldNotFit) {
      log.push(`You could not fit ${p.name} under the cap or on the roster. Offer withdrawn.`);
      delete userOffers[id];
    } else {
      const s = offerScore(save, p, { ...mine, teamId: userId });
      // A hopeless offer gets a straight no; a decent one stays on his desk until the last day.
      if (lastDay || s < 60) {
        log.push(`${p.name} turned down your offer.`);
        delete userOffers[id];
      } else {
        log.push(`${p.name} is still weighing your offer.`);
      }
    }
  }
  return log;
}

/** After the last day and during the season: AI teams under ROSTER_NORMAL sign the best affordable free agents to 1-year minimum-ish deals so every AI team has at least 10 (and at least one natural player per position where possible). */
export function aiFillRosters(save: Save, rng: Rng): void {
  for (const team of save.teams) {
    if (team.id === save.userTeamId) continue;
    let guard = 0;
    while (team.roster.length < ROSTER_NORMAL && guard++ < 30) {
      const pool = save.freeAgents.map(id => save.players[id]).filter(p => p && !p.retired);
      if (!pool.length) break;
      const space = capSpace(save, team);
      if (space < MIN_SALARY) {
        // No room even for a minimum deal: move on from the worst contract (AI pays no dead cap).
        const worst = worstContract(save, team);
        if (worst === null) break;
        releasePlayer(save, worst, { deadCap: false });
        continue;
      }
      const have = new Set(team.roster.map(id => save.players[id].pos));
      const missing = POSITIONS.filter(pos => !have.has(pos));
      let best: Player | null = null, bs = -1e9;
      for (const p of pool) {
        let s = ovr(p) - Math.max(0, p.age - 31) * 1.5 + rng.range(0, 1.5);
        if (missing.includes(p.pos)) s += 25;
        if (s > bs) { bs = s; best = p; }
      }
      if (!best) break;
      const salary = round1(clamp(Math.min(marketSalary(best) * 0.5, 3, space), MIN_SALARY, MAX_SALARY));
      signPlayer(save, best.id, team.id, { salary, years: 1 });
    }
  }
}

/** Player id with the worst value per dollar, or null if the roster is empty. */
export function worstContract(save: Save, team: Team): number | null {
  let worst: number | null = null, ws = 1e9;
  for (const id of team.roster) {
    const p = save.players[id];
    if (p.contract.salary <= MIN_SALARY) continue; // cutting a minimum deal frees nothing useful
    const s = playerValue(save, p) / Math.max(MIN_SALARY, p.contract.salary);
    if (s < ws) { ws = s; worst = id; }
  }
  if (worst === null && team.roster.length) {
    // Everyone is on the minimum: let the weakest go.
    for (const id of team.roster) {
      const s = playerValue(save, save.players[id]);
      if (s < ws) { ws = s; worst = id; }
    }
  }
  return worst;
}
