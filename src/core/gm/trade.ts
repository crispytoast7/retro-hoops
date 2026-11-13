import { ROSTER_MAX, ROSTER_MIN, ROSTER_NORMAL, SALARY_CAP, TRADE_DEADLINE_WEEK } from '../constants';
import { autoLineup, fixLineup } from '../lineup';
import { payroll } from '../org/finance';
import { movePlayer } from '../org/roster';
import { ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import type { DraftPick, Player, Pos, Save, Team } from '../types';
import { leaguePosAverages, needsForRoster, pickValue, playerValue } from './value';

export interface TradeSide { players: number[]; picks: DraftPick[] }
/** `a` gives aGives to `b` and receives bGives. */
export interface TradeOffer { aId: number; bId: number; aGives: TradeSide; bGives: TradeSide }

const POS_NAMES: Record<Pos, string> = {
  PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'center',
};

const samePick = (a: DraftPick, b: DraftPick): boolean =>
  a.year === b.year && a.round === b.round && a.origTeamId === b.origTeamId;

function tradesOpen(save: Save): string | null {
  if (save.phase === 'playoffs') return 'No trades during the playoffs.';
  if (save.phase === 'regular' && save.week > TRADE_DEADLINE_WEEK) return 'The trade deadline has passed.';
  return null;
}

function checkSide(save: Save, team: Team, side: TradeSide): string | null {
  const seen = new Set<number>();
  for (const id of side.players) {
    const p = save.players[id];
    if (!p || p.teamId !== team.id || !team.roster.includes(id)) return `${team.city} does not have that player.`;
    if (seen.has(id)) return 'A player is listed twice.';
    seen.add(id);
  }
  for (let i = 0; i < side.picks.length; i++) {
    const pk = side.picks[i];
    if (!team.picks.some(x => samePick(x, pk))) return `${team.city} does not own that pick.`;
    for (let j = 0; j < i; j++) if (samePick(side.picks[j], pk)) return 'A pick is listed twice.';
  }
  return null;
}

const salaryOf = (save: Save, ids: readonly number[]): number =>
  ids.reduce((s, id) => s + save.players[id].contract.salary, 0);

/** null if legal, else a short human reason. Checks: deadline (save.phase === 'regular' && save.week > TRADE_DEADLINE_WEEK blocks trades; playoffs block; offseason allows), both payrolls <= cap after the trade, both rosters within ROSTER_MIN..ROSTER_MAX after, players/picks actually owned, at least one asset moving. */
export function validateTrade(save: Save, offer: TradeOffer): string | null {
  const a = save.teams[offer.aId], b = save.teams[offer.bId];
  if (!a || !b || a.id === b.id) return 'A trade needs two different teams.';
  const closed = tradesOpen(save);
  if (closed) return closed;
  const moving = offer.aGives.players.length + offer.aGives.picks.length
    + offer.bGives.players.length + offer.bGives.picks.length;
  if (moving === 0) return 'Nothing is being traded.';
  const own = checkSide(save, a, offer.aGives) ?? checkSide(save, b, offer.bGives);
  if (own) return own;

  const aSize = a.roster.length - offer.aGives.players.length + offer.bGives.players.length;
  const bSize = b.roster.length - offer.bGives.players.length + offer.aGives.players.length;
  for (const [t, size] of [[a, aSize], [b, bSize]] as [Team, number][]) {
    if (size > ROSTER_MAX) return `${t.city} would have too many players (max ${ROSTER_MAX}).`;
    if (size < ROSTER_MIN) return `${t.city} would have too few players (min ${ROSTER_MIN}).`;
  }
  const aOut = salaryOf(save, offer.aGives.players), bOut = salaryOf(save, offer.bGives.players);
  if (round1(payroll(save, a) - aOut + bOut) > SALARY_CAP) return `${a.city} would be over the salary cap.`;
  if (round1(payroll(save, b) - bOut + aOut) > SALARY_CAP) return `${b.city} would be over the salary cap.`;
  return null;
}

/** Strategy lens on a player's value. Applied the same way to players coming and going. */
function stratAdjust(v: number, p: Player, strategy: Team['strategy']): number {
  if (v <= 0) return v;
  const o = ovr(p);
  if (strategy === 'contend') {
    if (o >= 78) return v * 1.12;
    if (o >= 72) return v * 1.05;
    if (p.age <= 22 && o < 68) return v * 0.8;
    return v;
  }
  if (strategy === 'rebuild') {
    if (p.age >= 32) return v * 0.5;
    if (p.age >= 29) return v * 0.7;
    if (p.age <= 24) return v * 1.15;
  }
  return v;
}

const pickMult = (strategy: Team['strategy']): number =>
  strategy === 'contend' ? 0.75 : strategy === 'rebuild' ? 1.2 : 1;

function bestPlayerId(save: Save, team: Team): number | null {
  let best: number | null = null, bo = -1;
  for (const id of team.roster) {
    const o = ovr(save.players[id]);
    if (o > bo) { bo = o; best = id; }
  }
  return best;
}

interface Breakdown {
  inTotal: number; outTotal: number; score: number; margin: number;
  /** What the incoming side would have been worth with no need discount. */
  needLoss: number;
  /** Negative value taken on with bad contracts. */
  dumpLoss: number;
  rosterPenalty: number;
  capBlocked: boolean;
  sellsBest: boolean;
  mostlyPicks: boolean;
  mainIn: Player | null; mainInNeed: number;
  mainOut: Player | null;
}

function breakdown(save: Save, offer: TradeOffer, teamId: number): Breakdown {
  const team = save.teams[teamId];
  const isA = teamId === offer.aId;
  const gives = isA ? offer.aGives : offer.bGives;
  const gets = isA ? offer.bGives : offer.aGives;
  const strat = team.strategy;
  const avg = leaguePosAverages(save);

  const outSet = new Set(gives.players);
  const hypo = team.roster.filter(id => !outSet.has(id));
  const needsAfterOut = needsForRoster(save, hypo, avg);
  const bestId = bestPlayerId(save, team);

  // Outgoing.
  let outTotal = 0, sellsBest = false, mainOut: Player | null = null, mainOutV = -1e9;
  for (const id of gives.players) {
    const p = save.players[id];
    let v = stratAdjust(playerValue(save, p), p, strat);
    if (v > 0) {
      v *= 0.9 + 0.2 * needsAfterOut[p.pos]; // thin behind him = harder to part with
      if (id === bestId) { v *= strat === 'contend' ? 1.3 : 1.12; sellsBest = true; }
      if (save.tradeDemands.includes(id)) v *= 0.85;
    }
    outTotal += v;
    if (v > mainOutV) { mainOutV = v; mainOut = p; }
  }
  let outPicks = 0;
  for (const pk of gives.picks) outPicks += pickValue(save, pk) * pickMult(strat);
  outTotal += outPicks;

  // Incoming: best first, each one lowering the need for the next at his position.
  const incoming = gets.players
    .map(id => save.players[id])
    .map(p => ({ p, raw: stratAdjust(playerValue(save, p), p, strat) }))
    .sort((x, y) => y.raw - x.raw);
  let inPlayers = 0, needLoss = 0, dumpLoss = 0;
  let mainIn: Player | null = null, mainInNeed = 0.5;
  const extraFrom = gives.players.length; // players beyond a one-for-one swap are depth, not value
  incoming.forEach((x, i) => {
    if (x.raw <= 0) { inPlayers += x.raw; dumpLoss += -x.raw; return; }
    const need = needsForRoster(save, hypo, avg)[x.p.pos];
    if (i === 0) { mainIn = x.p; mainInNeed = need; }
    let v = x.raw * (0.85 + 0.3 * need);
    const full = x.raw * 1.0;
    if (i >= extraFrom && i > 0) v *= 0.5;
    needLoss += Math.max(0, full - x.raw * (0.85 + 0.3 * need));
    inPlayers += v;
    hypo.push(x.p.id);
  });
  let inPicks = 0;
  for (const pk of gets.picks) inPicks += pickValue(save, pk) * pickMult(strat);
  const inTotal = inPlayers + inPicks;

  // Roster spots: over the normal ten someone has to be cut, under it someone has to be found.
  const sizeBefore = team.roster.length;
  const sizeAfter = sizeBefore - gives.players.length + gets.players.length;
  let rosterPenalty = 0;
  if (sizeAfter > sizeBefore) rosterPenalty += Math.max(0, sizeAfter - ROSTER_NORMAL) * 4;
  if (sizeAfter < sizeBefore) rosterPenalty += Math.max(0, ROSTER_NORMAL - sizeAfter) * 2;

  const payAfter = round1(payroll(save, team) - salaryOf(save, gives.players) + salaryOf(save, gets.players));
  const capBlocked = payAfter > SALARY_CAP;
  // No money left to fill the holes the trade opens.
  const holes = Math.max(0, ROSTER_NORMAL - sizeAfter);
  if (!capBlocked && holes > 0 && SALARY_CAP - payAfter < holes * 0.5) rosterPenalty += 5;

  const score = inTotal - outTotal - rosterPenalty;
  const margin = Math.max(1, 0.04 * Math.max(0, outTotal));
  return {
    inTotal, outTotal, score, margin, needLoss, dumpLoss, rosterPenalty, capBlocked, sellsBest,
    mostlyPicks: inPicks > Math.max(0, inPlayers),
    mainIn, mainInNeed, mainOut,
  };
}

/** Stable pick from a list so the same offer always gets the same line. */
function vary(lines: readonly string[], offer: TradeOffer): string {
  let h = offer.aId * 31 + offer.bId * 17;
  for (const id of offer.aGives.players) h += id * 7;
  for (const id of offer.bGives.players) h += id * 13;
  h += offer.aGives.picks.length * 3 + offer.bGives.picks.length * 5;
  return lines[Math.abs(h) % lines.length];
}

/** Would AI team `teamId` say yes? Values what it receives vs gives with playerValue/pickValue, adjusted by its needs (teamNeeds), strategy (contenders discount picks and prize current overall; rebuilders prize youth and picks and discount players 29+), roster-spot and cap consequences, and a small margin it wants to win the trade by. Returns a message the UI can show ("We'd need more for him.", "Deal.", "We have no use for another center."). `score` = value in minus value out from its point of view. */
export function evaluateTrade(save: Save, offer: TradeOffer, teamId: number): { accept: boolean; score: number; message: string } {
  const invalid = validateTrade(save, offer);
  if (invalid) return { accept: false, score: 0, message: invalid };
  if (teamId !== offer.aId && teamId !== offer.bId) return { accept: false, score: 0, message: 'We are not part of this deal.' };

  const team = save.teams[teamId];
  const b = breakdown(save, offer, teamId);
  const score = round1(b.score);
  if (b.capBlocked) return { accept: false, score, message: "We can't fit that under the cap." };

  if (b.score >= b.margin) {
    const big = b.score > 10 + 0.3 * Math.max(0, b.outTotal);
    const message = big
      ? vary(['Where do I sign?', "You've got a deal. Send the paperwork.", "Done. Don't change your mind."], offer)
      : vary(['Deal.', "You've got a deal.", 'We can do that.', "Works for us. Let's call it in."], offer);
    return { accept: true, score, message };
  }

  const short = b.margin - b.score;
  let message: string;
  if (b.sellsBest && team.strategy === 'contend' && b.mostlyPicks) {
    message = vary(["We're trying to win now. He's not going anywhere for picks.", "Picks don't help us this year. He stays."], offer);
  } else if (b.dumpLoss > 0 && b.dumpLoss >= short * 0.5) {
    message = vary(["We're not taking on that contract without something extra.", "That contract is your problem. Make it worth our while."], offer);
  } else if (b.mainIn && b.mainInNeed < 0.25 && b.needLoss >= short * 0.5) {
    message = `We have no use for another ${POS_NAMES[(b.mainIn as Player).pos]}.`;
  } else if (b.rosterPenalty > 0 && b.rosterPenalty >= short) {
    message = vary(["We don't have the roster room for that.", "Too many bodies. We'd have to cut someone."], offer);
  } else if (team.strategy === 'rebuild' && b.mainIn && (b.mainIn as Player).age >= 30) {
    message = vary(["We're building for the future. He doesn't fit our timeline.", "He's too old for where we are. Got anything younger, or picks?"], offer);
  } else if (b.score < -0.5 * Math.max(10, b.outTotal)) {
    message = vary(["That's not a serious offer.", 'Not even close.', "Call back when you're ready to talk for real."], offer);
  } else if (short <= Math.max(2, 0.1 * Math.max(0, b.outTotal))) {
    message = vary(['Close, but we need a little more.', "We're nearly there. Add something small."], offer);
  } else if (b.sellsBest) {
    message = vary(["He's the face of our franchise. It would take a lot more.", "You're asking for our best player. Pay like it."], offer);
  } else if (b.mainOut) {
    message = vary(["We'd need more for him.", "He's worth more than that to us."], offer);
  } else {
    message = vary(["We'd need more than that.", "Those picks are worth more than you're offering."], offer);
  }
  return { accept: false, score, message };
}

function pickLabel(save: Save, team: Team, pk: DraftPick): string {
  const via = pk.origTeamId !== team.id && save.teams[pk.origTeamId] ? ` (via ${save.teams[pk.origTeamId].abbr})` : '';
  return `a season ${pk.year} ${pk.round === 1 ? '1st' : '2nd'}-round pick${via}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function setLineup(save: Save, team: Team): void {
  if (team.id === save.userTeamId) { fixLineup(save, team); return; }
  team.lineup = autoLineup(team.roster.map(id => save.players[id]));
}

/** Apply an agreed trade: move players (movePlayer), swap picks, fix lineups, push a NewsItem. */
export function executeTrade(save: Save, offer: TradeOffer): void {
  const a = save.teams[offer.aId], b = save.teams[offer.bId];
  // Describe before anything moves, while ownership is still as offered.
  const aParts = [...offer.aGives.players.map(id => save.players[id].name), ...offer.aGives.picks.map(pk => pickLabel(save, a, pk))];
  const bParts = [...offer.bGives.players.map(id => save.players[id].name), ...offer.bGives.picks.map(pk => pickLabel(save, b, pk))];

  for (const id of offer.aGives.players) movePlayer(save, id, b.id);
  for (const id of offer.bGives.players) movePlayer(save, id, a.id);
  for (const pk of offer.aGives.picks) {
    const i = a.picks.findIndex(x => samePick(x, pk));
    if (i >= 0) b.picks.push(a.picks.splice(i, 1)[0]);
  }
  for (const pk of offer.bGives.picks) {
    const i = b.picks.findIndex(x => samePick(x, pk));
    if (i >= 0) a.picks.push(b.picks.splice(i, 1)[0]);
  }
  setLineup(save, a);
  setLineup(save, b);

  const mine = a.id === save.userTeamId || b.id === save.userTeamId;
  save.news.push({
    year: save.year, week: save.week, kind: 'trade',
    text: `Trade: ${a.city} sends ${joinList(aParts)} to ${b.city} for ${joinList(bParts)}.`,
    ...(mine ? { mine: true } : {}),
  });
}

/** Everything a team could put in a deal: one player, one pick, a player plus a pick, or two picks. */
function packages(team: Team, exclude: ReadonlySet<number> = new Set()): TradeSide[] {
  const out: TradeSide[] = [];
  const players = team.roster.filter(id => !exclude.has(id));
  for (const id of players) out.push({ players: [id], picks: [] });
  for (const pk of team.picks) out.push({ players: [], picks: [pk] });
  for (const id of players) for (const pk of team.picks) out.push({ players: [id], picks: [pk] });
  for (let i = 0; i < team.picks.length; i++) {
    for (let j = i + 1; j < team.picks.length; j++) out.push({ players: [], picks: [team.picks[i], team.picks[j]] });
  }
  return out;
}

const rawSideValue = (save: Save, side: TradeSide): number =>
  side.players.reduce((s, id) => s + playerValue(save, save.players[id]), 0)
  + side.picks.reduce((s, pk) => s + pickValue(save, pk), 0);

function findAiTrade(save: Save, rng: Rng): TradeOffer | null {
  const ai = save.teams.filter(t => t.id !== save.userTeamId);
  if (ai.length < 2) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = rng.pick(ai);
    const b = rng.pick(ai);
    if (a.id === b.id) continue;
    const needs = needsForRoster(save, a.roster);
    const bBest = bestPlayerId(save, b);
    const targets = b.roster.filter(id => !(b.strategy === 'contend' && id === bBest));
    if (!targets.length) continue;
    const weights = targets.map(id => {
      const p = save.players[id];
      return Math.max(0, playerValue(save, p)) * (0.2 + needs[p.pos]);
    });
    if (weights.every(w => w <= 0)) continue;
    const targetId = targets[rng.weighted(weights)];
    const targetV = playerValue(save, save.players[targetId]);

    let best: TradeOffer | null = null, bestFair = -1e9;
    for (const pkg of packages(a)) {
      const v = rawSideValue(save, pkg);
      if (v < targetV * 0.6 || v > targetV * 1.7) continue;
      const offer: TradeOffer = { aId: a.id, bId: b.id, aGives: pkg, bGives: { players: [targetId], picks: [] } };
      if (validateTrade(save, offer)) continue;
      const ea = evaluateTrade(save, offer, a.id);
      if (!ea.accept) continue;
      const eb = evaluateTrade(save, offer, b.id);
      if (!eb.accept) continue;
      const fair = Math.min(ea.score, eb.score);
      if (fair > bestFair) { bestFair = fair; best = offer; }
    }
    if (best) return best;
  }
  return null;
}

/** AI-to-AI trades for one week of the season (a few per season league-wide, more near the deadline, none after). Both sides must pass evaluateTrade. Returns nothing; pushes news. */
export function aiTradesWeek(save: Save, rng: Rng): void {
  if (tradesOpen(save)) return;
  const wk = save.phase === 'regular' ? save.week : 3;
  let tries = rng.chance(0.2 + 0.07 * wk) ? 1 : 0;
  if (save.phase === 'regular' && wk === TRADE_DEADLINE_WEEK && rng.chance(0.5)) tries++;
  for (let i = 0; i < tries; i++) {
    const offer = findAiTrade(save, rng);
    if (offer) executeTrade(save, offer);
  }
}

/** Occasionally an AI team proposes a trade to the user (about once every 3-4 weeks before the deadline; more likely for players in save.tradeDemands). Must be one the AI would accept and that validates. null if none. Does not execute. The AI team is `aId`, the user is `bId`. */
export function aiOfferToUser(save: Save, rng: Rng): TradeOffer | null {
  if (tradesOpen(save)) return null;
  const user = save.teams[save.userTeamId];
  if (!user) return null;
  const demands = save.tradeDemands.filter(id => user.roster.includes(id));
  if (!rng.chance(demands.length ? 0.55 : 0.28)) return null;

  const ai = rng.shuffle(save.teams.filter(t => t.id !== user.id));
  for (const team of ai.slice(0, 6)) {
    const needs = needsForRoster(save, team.roster);
    let targetId: number;
    if (demands.length) targetId = rng.pick(demands);
    else {
      const weights = user.roster.map(id => {
        const p = save.players[id];
        return Math.max(0, playerValue(save, p)) * needs[p.pos] * needs[p.pos];
      });
      if (weights.every(w => w <= 0)) continue;
      targetId = user.roster[rng.weighted(weights)];
    }
    const targetV = playerValue(save, save.players[targetId]);
    if (targetV <= 0) continue;
    // A player who wants out can be had a little cheaper, but never for an insult.
    const floor = targetV * (demands.length ? 0.7 : 0.85);

    let best: TradeOffer | null = null, bestScore = 1e9;
    for (const pkg of packages(team)) {
      const v = rawSideValue(save, pkg);
      if (v < floor || v > targetV * 1.6) continue;
      const offer: TradeOffer = { aId: team.id, bId: user.id, aGives: pkg, bGives: { players: [targetId], picks: [] } };
      if (validateTrade(save, offer)) continue;
      const ev = evaluateTrade(save, offer, team.id);
      // Of the deals the AI likes, lead with the one that leaves it the least profit.
      if (ev.accept && ev.score < bestScore) { bestScore = ev.score; best = offer; }
    }
    if (best) return best;
  }
  return null;
}

/** What would make the AI say yes: given an offer the AI rejects, suggest the cheapest extra asset from the user's side (a pick or player) that flips it, or null. */
export function suggestSweetener(save: Save, offer: TradeOffer, aiTeamId: number): { playerId?: number; pick?: DraftPick } | null {
  if (aiTeamId !== offer.aId && aiTeamId !== offer.bId) return null;
  if (evaluateTrade(save, offer, aiTeamId).accept) return null;
  const otherIsA = aiTeamId === offer.bId;
  const other = save.teams[otherIsA ? offer.aId : offer.bId];
  const side = otherIsA ? offer.aGives : offer.bGives;

  const withExtra = (extra: TradeSide): TradeOffer => {
    const s: TradeSide = { players: [...side.players, ...extra.players], picks: [...side.picks, ...extra.picks] };
    return otherIsA ? { ...offer, aGives: s } : { ...offer, bGives: s };
  };

  const cands: { cost: number; playerId?: number; pick?: DraftPick }[] = [];
  for (const pk of other.picks) {
    if (side.picks.some(x => samePick(x, pk))) continue;
    cands.push({ cost: pickValue(save, pk), pick: pk });
  }
  for (const id of other.roster) {
    if (side.players.includes(id)) continue;
    const v = playerValue(save, save.players[id]);
    if (v > 0) cands.push({ cost: v, playerId: id });
  }
  cands.sort((x, y) => x.cost - y.cost);
  for (const c of cands) {
    const trial = withExtra(c.pick ? { players: [], picks: [c.pick] } : { players: [c.playerId as number], picks: [] });
    if (evaluateTrade(save, trial, aiTeamId).accept) return c.pick ? { pick: c.pick } : { playerId: c.playerId };
  }
  return null;
}
