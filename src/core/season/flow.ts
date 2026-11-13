// Playing games, advancing weeks, playoffs.
import { REG_WEEKS, TRADE_DEADLINE_WEEK } from '../constants';
import { aiMaintainRosters } from '../gm/teamAi';
import { aiOfferToUser, aiTradesWeek, validateTrade } from '../gm/trade';
import { shortName } from '../gen/league';
import { fixLineup } from '../lineup';
import { beginOffseason } from '../offseason/offseason';
import { CreditLine, checkMilestones, effLevel, gameCredits, headline, pushNews, weeklyFacilities } from '../org/economy';
import { afterUserGame, checkFired, healWeek, rollEvent, rollInjuries } from '../org/people';
import { addStats } from '../ratings';
import type { Rng } from '../rng';
import { createLiveGame, simulateGame } from '../sim/engine';
import type { GameSetup, LiveGame, SideInput } from '../sim/api';
import type { GameResult, PlayoffSeries, Save, ScheduledGame, Team } from '../types';
import { gamesInWeek, standings, userGame } from './schedule';

export const CONTROLLED_POSSESSIONS = 16;

export function sideInput(save: Save, teamId: number): SideInput {
  const team = save.teams[teamId];
  return {
    team, players: team.roster.map(id => save.players[id]),
    ocStars: team.staff.oc?.stars ?? 0, dcStars: team.staff.dc?.stars ?? 0,
    arenaLevel: effLevel(team.facilities.arena),
    captainId: teamId === save.userTeamId ? save.captainId : null,
  };
}
export function buildSetup(save: Save, g: ScheduledGame, controlled: number): GameSetup {
  const mine = g.homeId === save.userTeamId || g.awayId === save.userTeamId;
  return {
    home: sideInput(save, g.homeId), away: sideInput(save, g.awayId),
    userTeamId: mine && controlled > 0 ? save.userTeamId : null,
    controlled, playoff: !!g.playoff,
    fans: g.homeId === save.userTeamId ? save.fans : 50,
    difficulty: save.settings.difficulty,
  };
}
export function startLiveGame(save: Save, g: ScheduledGame, rng: Rng): LiveGame {
  fixLineup(save, save.teams[g.homeId]); fixLineup(save, save.teams[g.awayId]);
  return createLiveGame(buildSetup(save, g, CONTROLLED_POSSESSIONS), rng);
}

function bumpRecord(team: Team, pf: number, pa: number, conf: boolean): void {
  const r = team.record, won = pf > pa;
  if (won) { r.w++; if (conf) r.confW++; r.streak = r.streak > 0 ? r.streak + 1 : 1; }
  else { r.l++; if (conf) r.confL++; r.streak = r.streak < 0 ? r.streak - 1 : -1; }
  r.pf += pf; r.pa += pa;
}

/** Record any finished game: scores, standings, player stats, injuries, league news. */
export function applyGame(save: Save, g: ScheduledGame, result: GameResult, rng: Rng): void {
  const home = save.teams[g.homeId], away = save.teams[g.awayId];
  const mine = g.homeId === save.userTeamId || g.awayId === save.userTeamId;
  g.played = true; g.homeScore = result.homeScore; g.awayScore = result.awayScore;
  if (mine) g.result = result;
  if (!g.playoff) {
    const conf = home.conf === away.conf;
    bumpRecord(home, result.homeScore, result.awayScore, conf);
    bumpRecord(away, result.awayScore, result.homeScore, conf);
    for (const side of [result.box.home, result.box.away]) {
      for (const l of side) { const p = save.players[l.playerId]; if (p) addStats(p.season, l); }
    }
  }
  rollInjuries(save, home, result.box.home, rng);
  rollInjuries(save, away, result.box.away, rng);
  const hw = result.homeScore > result.awayScore;
  const W = hw ? home : away, L = hw ? away : home;
  const score = `${Math.max(result.homeScore, result.awayScore)}-${Math.min(result.homeScore, result.awayScore)}`;
  const margin = Math.abs(result.homeScore - result.awayScore);
  const star = save.players[result.topPerformer];
  const tokens = { team: W.name, opp: L.name, score, star: star ? shortName(star.name) : W.name };
  if (mine) {
    const won = W.id === save.userTeamId;
    const key = margin >= 15 ? (won ? 'blowoutWin' : 'blowoutLoss') : margin <= 3 ? (won ? 'closeWin' : 'closeLoss') : won ? 'win' : 'loss';
    const me = save.teams[save.userTeamId], opp = W.id === save.userTeamId ? L : W;
    pushNews(save, 'game', headline(rng, key, { ...tokens, team: me.name, opp: opp.name }), true);
  } else if (g.playoff) {
    pushNews(save, 'game', headline(rng, 'win', tokens));
  } else if (W.record.w + 3 < L.record.w && W.record.w + W.record.l >= 5) {
    pushNews(save, 'game', headline(rng, 'upset', tokens));
  } else if (Math.abs(W.record.streak) === 5) {
    pushNews(save, 'league', headline(rng, 'streakW', { team: W.name, n: 5 }));
  }
}

export interface PostGame {
  gameId: number; won: boolean; credits: CreditLine[]; total: number; topPerformer: number; playoff: boolean;
}
/** After the user's own game (played or simmed): credits, coach record, morale, owner, fans. */
export function finishUserGame(save: Save, g: ScheduledGame, result: GameResult, highlights: string[], rng: Rng): PostGame {
  applyGame(save, g, result, rng);
  const home = g.homeId === save.userTeamId;
  const my = home ? result.homeScore : result.awayScore, their = home ? result.awayScore : result.homeScore;
  const won = my > their;
  const c = save.coach, stop = c.stops[c.stops.length - 1];
  if (g.playoff) { if (won) c.playoffW++; else c.playoffL++; }
  else { if (won) { c.w++; if (stop) stop.w++; } else { c.l++; if (stop) stop.l++; } }
  afterUserGame(save, won, Math.abs(my - their), !!g.playoff);
  // franchise single-game records
  const lines = home ? result.box.home : result.box.away;
  for (const l of lines) {
    const p = save.players[l.playerId];
    if (!p) continue;
    for (const [k, v] of [['game.pts', l.pts], ['game.reb', l.orb + l.drb], ['game.ast', l.ast], ['game.tpm', l.tpm], ['game.stl', l.stl], ['game.blk', l.blk]] as const) {
      const cur = save.records[k];
      if (v > 0 && (!cur || v > cur.value)) save.records[k] = { value: v, playerId: p.id, name: p.name, year: save.year, teamId: save.userTeamId };
    }
  }
  const credits = [...gameCredits(save, result, highlights, !!g.playoff), ...checkMilestones(save)];
  const total = credits.reduce((s, x) => s + x.amount, 0);
  save.credits += total;
  const me = save.teams[save.userTeamId];
  if (!g.playoff && me.record.streak === -4) pushNews(save, 'owner', headline(rng, 'ownerAngry', { owner: save.owner.name, team: me.name }), true);
  if (!g.playoff && me.record.streak === 4) pushNews(save, 'owner', headline(rng, 'ownerHappy', { owner: save.owner.name, team: me.name }), true);
  return { gameId: g.id, won, credits, total, topPerformer: result.topPerformer, playoff: !!g.playoff };
}

/** Simulate every unplayed game of the current week. If the user's game is unplayed it is simmed too. */
export function simWeekGames(save: Save, rng: Rng): PostGame | null {
  let post: PostGame | null = null;
  for (const g of gamesInWeek(save, save.week)) {
    if (g.played) continue;
    fixLineup(save, save.teams[g.homeId]); fixLineup(save, save.teams[g.awayId]);
    const result = simulateGame(buildSetup(save, g, 0), rng);
    if (g.homeId === save.userTeamId || g.awayId === save.userTeamId) post = finishUserGame(save, g, result, [], rng);
    else applyGame(save, g, result, rng);
  }
  return post;
}

// ---- playoffs ------------------------------------------------------------------------
function addSeries(save: Save, round: 1 | 2 | 3, conf: number, high: Team, low: Team): void {
  const id = save.year * 1000 + 500 + (save.playoffs?.series.length ?? 0);
  const week = REG_WEEKS + round;
  save.schedule.push({ id, week, homeId: high.id, awayId: low.id, played: false, playoff: true });
  save.playoffs!.series.push({ round, conf, highId: high.id, lowId: low.id, gameId: id });
}
function startPlayoffs(save: Save, rng: Rng): void {
  save.phase = 'playoffs';
  save.playoffs = { series: [] };
  for (const conf of [0, 1]) {
    const s = standings(save, conf);
    addSeries(save, 1, conf, s[0], s[3]);
    addSeries(save, 1, conf, s[1], s[2]);
    for (const t of s.slice(0, 4)) pushNews(save, 'league', headline(rng, 'playoffClinch', { team: t.name }), t.id === save.userTeamId);
  }
  save.tradeOffer = null;
}
const seedOf = (save: Save, t: Team): number => standings(save, t.conf).indexOf(t);
function advancePlayoffs(save: Save, rng: Rng): void {
  const po = save.playoffs!;
  const round = (save.week - REG_WEEKS) as 1 | 2 | 3;
  const done: PlayoffSeries[] = [];
  for (const s of po.series.filter(x => x.round === round)) {
    const g = save.schedule.find(x => x.id === s.gameId)!;
    s.winnerId = (g.homeScore ?? 0) > (g.awayScore ?? 0) ? g.homeId : g.awayId;
    const loser = s.winnerId === g.homeId ? g.awayId : g.homeId;
    if (round < 3) pushNews(save, 'league', headline(rng, 'eliminated', { team: save.teams[loser].name }), loser === save.userTeamId);
    done.push(s);
  }
  if (round === 1) {
    for (const conf of [0, 1]) {
      const [a, b] = done.filter(s => s.conf === conf).map(s => save.teams[s.winnerId!]);
      const [hi, lo] = seedOf(save, a) < seedOf(save, b) ? [a, b] : [b, a];
      addSeries(save, 2, conf, hi, lo);
    }
  } else if (round === 2) {
    const [a, b] = done.map(s => save.teams[s.winnerId!]);
    const better = a.record.w > b.record.w || (a.record.w === b.record.w && a.record.pf - a.record.pa >= b.record.pf - b.record.pa);
    addSeries(save, 3, 2, better ? a : b, better ? b : a);
  } else {
    const f = done[0];
    po.championId = f.winnerId;
    const champ = save.teams[f.winnerId!], other = save.teams[f.winnerId === f.highId ? f.lowId : f.highId];
    pushNews(save, 'league', headline(rng, 'champion', { team: `${champ.city} ${champ.name}`, opp: other.name }), champ.id === save.userTeamId);
  }
}

/**
 * Close out the current week once the user's game (if any) is done: sim the rest, heal,
 * wear facilities, AI moves, roll next week's event, then move the calendar on.
 */
export function endWeek(save: Save, rng: Rng): PostGame | null {
  const post = simWeekGames(save, rng);
  healWeek(save, rng);
  if (save.phase === 'regular') {
    weeklyFacilities(save, rng);
    if (save.week <= TRADE_DEADLINE_WEEK) aiTradesWeek(save, rng);
    aiMaintainRosters(save, rng);
    if (save.week === TRADE_DEADLINE_WEEK) { pushNews(save, 'league', 'The trade deadline has passed. Rosters are locked until the offseason.'); save.tradeOffer = null; }
    save.week++;
    if (save.week > REG_WEEKS) startPlayoffs(save, rng);
    else {
      if (save.tradeOffer && validateTrade(save, save.tradeOffer)) save.tradeOffer = null;
      if (!save.tradeOffer && save.week <= TRADE_DEADLINE_WEEK) {
        const offer = aiOfferToUser(save, rng);
        if (offer) save.tradeOffer = offer;
      }
      rollEvent(save, rng);
    }
  } else if (save.phase === 'playoffs') {
    weeklyFacilities(save, rng);
    advancePlayoffs(save, rng);
    if (save.playoffs!.championId !== undefined) beginOffseason(save, rng);
    else save.week++;
  }
  for (const t of save.teams) fixLineup(save, t);
  checkFired(save);
  return post;
}

export const userInPlayoffs = (save: Save): boolean => !!userGame(save);
