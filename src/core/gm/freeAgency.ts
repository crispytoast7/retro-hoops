import { FA_DAYS, HARD_LIMIT, MAX_FA_YEARS, MAX_SALARY, MIN_DEAL_YEARS, MIN_SALARY, ROSTER_MAX, ROSTER_NORMAL } from '../constants';
import { maxOffer, payroll, signingPath } from '../org/finance';
import type { SigningVia } from '../org/finance';
import { signPlayer } from '../org/roster';
import { clamp, ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import type { FreeAgentOffer, Player, Save, Team } from '../types';
import { POSITIONS } from '../types';
import { CORE_OVR, askingContract, keepCeiling, leaguePosAverages, needsForRoster, playerValue, teamSuccess } from './value';

function formerTeamId(p: Player): number | null {
  return p.seasons.length ? p.seasons[p.seasons.length - 1].teamId : null;
}

/** A free agent is still his old team's own player for the summer he leaves it: the team he finished the season with may go over the cap (never past the hard limit) to bring him back. */
export function isOwnFreeAgent(save: Save, p: Player, teamId: number): boolean {
  const last = p.seasons[p.seasons.length - 1];
  return save.phase === 'offseason' && p.teamId === null && !!last && last.year === save.year && last.teamId === teamId;
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

  // everyone likes a winner; a star with his pick of teams cares most of all
  const o = ovr(p), success = teamSuccess(team);
  score += (success - 0.5) * (o >= 85 ? 28 : o >= 80 ? 20 : 14);
  let fac = 0;
  const base = ['arena', 'training', 'medical', 'scouting'] as const;
  for (const k of base) fac += team.facilities[k].level;
  score += (fac / base.length - 3) * 2;
  // the tour of the trophy room
  score += ((team.facilities.trophy?.level ?? 1) - 1) * 0.8;
  const rep = offer.teamId === save.userTeamId ? save.coach.rep : team.prestige;
  score += ((rep - 50) / 50) * 4;
  score += (needsForRoster(save, team.roster)[p.pos] - 0.5) * 8;
  if (p.trait === 'Loyal' && formerTeamId(p) === offer.teamId) score += 8;
  // a star is never keen on a losing team unless it pays him a clear premium
  if (o >= 85 && success < 0.5 && r < 1.15) score = Math.min(score, 81);
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

const dealText = (years: number, salary: number): string => `(${years} yr${years === 1 ? '' : 's'}, $${round1(salary)}M)`;

/** The offers AI teams put on the table today. Another team's free agent needs room under the cap, so each team bids only what its cap space covers (a team that is short of ten players can always offer the minimum). The one exception is a team's own free agent, the player who has just left it: for him it may go over the cap, as far as its plan allows and never past the hard limit. */
function aiOffers(save: Save, rng: Rng, day: number): Map<number, FreeAgentOffer[]> {
  const out = new Map<number, FreeAgentOffer[]>();
  const avg = leaguePosAverages(save);
  const pool = save.freeAgents.map(id => save.players[id]).filter(p => p && !p.retired);
  const teams = rng.shuffle(save.teams.filter(t => t.id !== save.userTeamId));
  for (const team of teams) {
    if (team.roster.length >= ROSTER_MAX) continue;
    const short = team.roster.length < ROSTER_NORMAL;
    // The most this team can pay another team's player today: its cap space, or the minimum.
    const space = maxOffer(save, team).salary;
    const pay = payroll(save, team);
    const needs = needsForRoster(save, team.roster, avg);
    const os = team.roster.map(id => ovr(save.players[id])).sort((a, b) => b - a);
    // With a full ten, only someone who cracks the top seven is worth a spot.
    const bar = short ? (os[7] ?? 0) - 6 : (os[6] ?? 0) + 1;
    const cands: { p: Player; fit: number; salary: number; years: number }[] = [];
    for (const p of pool) {
      const o = ovr(p);
      if (o < bar) continue;
      const own = isOwnFreeAgent(save, p, team.id);
      // for its own man the room runs to its payroll ceiling instead of the cap
      const top = own ? Math.max(space, round1(Math.min(MAX_SALARY, (o >= CORE_OVR ? HARD_LIMIT : keepCeiling(team)) - pay))) : space;
      if (top <= MIN_SALARY && !short) continue;
      if (team.strategy === 'rebuild' && p.age >= 31 && o < 78 && !short) continue;
      if (team.strategy === 'contend' && p.age <= 22 && o < 66 && !short) continue;
      const ask = askingContract(save, p, team.id);
      // Bid around his number, a little higher as the days run out and for a position of need.
      const f = rng.range(0.93, 1.08) + needs[p.pos] * 0.06 + (day - 1) * 0.01;
      let salary = round1(clamp(ask.salary * f, MIN_SALARY, MAX_SALARY));
      if (salary > top) {
        // Cannot reach his number: put all the room on the table if that is close.
        if (top < ask.salary * 0.78) continue;
        salary = top;
      }
      let years = clamp(ask.years, 1, MAX_FA_YEARS);
      if (salary <= MIN_SALARY) years = Math.min(years, MIN_DEAL_YEARS);
      if (!signingPath(save, team, salary, { years, ownPlayer: own }).ok) continue;
      let v = Math.max(0.5, playerValue(save, { ...p, contract: { salary, years } }));
      if (team.strategy === 'rebuild' && p.age >= 29) v *= 0.7;
      if (team.strategy === 'contend' && o >= 75) v *= 1.15;
      cands.push({ p, fit: v * (0.6 + 0.8 * needs[p.pos]), salary, years });
    }
    cands.sort((a, b) => b.fit - a.fit);
    for (const c of cands.slice(0, short ? 3 : 2)) {
      const list = out.get(c.p.id) ?? [];
      list.push({ teamId: team.id, salary: c.salary, years: c.years });
      out.set(c.p.id, list);
    }
  }
  return out;
}

/** One offseason free-agency day. AI teams with needs make the offers their cap space allows (or the minimum); each free agent with offers (AI ones plus save.offseason.userOffers[playerId]) picks the best by offerScore if it clears a threshold that drops each day (day 1 picky, last day takes the best available); signs via signPlayer. Every signing must be legal by signingPath at the moment it happens (into cap space, a minimum deal, or over the cap for the team's own free agent): an offer that no longer is gets passed over (and a user offer is withdrawn with a line saying why). Never exceeds ROSTER_MAX. Clears resolved user offers. Returns log lines for the user ("M. Reyes signs with Harbor City (3 yrs, $12.5M)", "T. Banks turned down your offer."). Pushes news for notable signings. Reads the day from save.offseason.faDay; the caller advances it. */
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
    let userBlocked: string | null = null;
    for (const { o, s } of scored) {
      if (s < threshold) break;
      const team = save.teams[o.teamId];
      const isUser = team.id === userId;
      const salary = round1(clamp(o.salary, MIN_SALARY, MAX_SALARY));
      const years = clamp(Math.round(o.years), 1, MAX_FA_YEARS);
      if (team.roster.length >= ROSTER_MAX) {
        if (isUser) userBlocked = `your roster is full (${ROSTER_MAX})`;
        continue;
      }
      const path = signingPath(save, team, salary, { years, ownPlayer: isOwnFreeAgent(save, p, team.id) });
      if (!path.ok) {
        if (isUser) userBlocked = path.reason;
        continue;
      }
      signPlayer(save, id, team.id, { salary, years });
      signedWith = team;
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
    if (userBlocked) {
      // he would have taken it, but the rules did not allow the deal
      log.push(`Your offer to ${p.name} was not allowed and has been withdrawn: ${userBlocked.replace(/\.$/, '')}.`);
      delete userOffers[id];
    } else if (signedWith) {
      if (signedWith.id !== userId) log.push(`${p.name} turned down your offer.`);
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

/** After the last day and during the season: AI teams under ROSTER_NORMAL sign the best free agents still out there to one-year minimum deals (always legal, whatever the payroll) so every AI team has at least 10 (and at least one natural player per position where possible). */
export function aiFillRosters(save: Save, rng: Rng): void {
  for (const team of save.teams) {
    if (team.id === save.userTeamId) continue;
    let guard = 0;
    while (team.roster.length < ROSTER_NORMAL && guard++ < 30) {
      const pool = save.freeAgents.map(id => save.players[id]).filter(p => p && !p.retired);
      if (!pool.length) break;
      const have = new Set(team.roster.map(id => save.players[id].pos));
      const missing = POSITIONS.filter(pos => !have.has(pos));
      let best: Player | null = null, bs = -1e9;
      for (const p of pool) {
        let s = ovr(p) - Math.max(0, p.age - 31) * 1.5 + rng.range(0, 1.5);
        if (missing.includes(p.pos)) s += 25;
        if (s > bs) { bs = s; best = p; }
      }
      if (!best) break;
      signPlayer(save, best.id, team.id, { salary: MIN_SALARY, years: 1 });
    }
  }
}

/** A free agent asking this much or less counts as a fringe player. */
export const FRINGE_ASK = 6;

/** Signing a free agent on the spot, outside the bidding days (the user, in season or at camp). He wants his asking deal, which needs the cap space for it. Once the market has closed, a fringe player (asking no more than $6M) will settle for a one-year minimum from a team that cannot fit his number, so a capped-out team can still fill its bench. */
export function instantSigning(save: Save, p: Player, teamId: number):
  { ok: true; salary: number; years: number; via: SigningVia; settled: boolean } | { ok: false; reason: string } {
  const team = save.teams[teamId];
  const ask = askingContract(save, p, teamId);
  if (team.roster.length >= ROSTER_MAX) return { ok: false, reason: `Your roster is full (${ROSTER_MAX}). Release someone first.` };
  let years = clamp(ask.years, 1, MAX_FA_YEARS);
  if (ask.salary <= MIN_SALARY) years = Math.min(years, MIN_DEAL_YEARS);
  const path = signingPath(save, team, ask.salary, { years });
  if (path.ok) return { ok: true, salary: ask.salary, years, via: path.via, settled: false };
  const marketClosed = save.phase !== 'offseason' || save.offseason?.step === 'camp';
  if (marketClosed && ask.salary <= FRINGE_ASK) return { ok: true, salary: MIN_SALARY, years: 1, via: 'min', settled: true };
  return { ok: false, reason: path.reason };
}
