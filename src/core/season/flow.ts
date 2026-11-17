// Playing games, advancing weeks, playoffs.
import { aiMaintainRosters } from '../gm/teamAi';
import { aiOfferToUser, aiTradesWeek, validateTrade } from '../gm/trade';
import { shortName } from '../gen/league';
import { fixLineup } from '../lineup';
import { beginOffseason } from '../offseason/offseason';
import { CreditLine, checkMilestones, effLevel, gameCredits, headline, pushNews, weeklyFacilities } from '../org/economy';
import { afterUserGame, bumpFans, bumpOwner, checkFired, healWeek, rollEvent, rollInjuries } from '../org/people';
import { checkTrophies, gameProgress, isUnlocked, perk, seasonProgress } from '../org/progress';
import { Objective, ObjectiveResult, settleObjective } from '../org/objectives';
import { gameXp } from '../org/xp';
import { heatedGame, rollMoment } from '../org/moments';
import { doChores } from '../org/chores';
import { FormChange, awardPlayerOfWeek, edgeFor, hasEdge, pressure, withPressure, isRivalGame, notePerformance, settleSponsor, sponsorOf, updateForm, weekState, withForm } from '../org/week';
import { addStats } from '../ratings';
import type { Rng } from '../rng';
import { createLiveGame, simulateGame } from '../sim/engine';
import type { GameSetup, LiveGame, SideInput } from '../sim/api';
import type { GameResult, PlayoffSeries, Save, ScheduledGame, Team } from '../types';
import { cal, perGame, playoffRound } from './calendar';
import { gamesInWeek, standings, userGame } from './schedule';

/** Key moments the user plays per game (a few more come late in close games). */
export const CONTROLLED_POSSESSIONS = 11;

export function sideInput(save: Save, teamId: number): SideInput {
  const team = save.teams[teamId];
  const mine = teamId === save.userTeamId;
  return {
    // the user's players run hot and cold, and this week's plan may have bought an edge
    team, players: team.roster.map(id => (mine ? withForm(save.players[id]) : save.players[id])),
    ocStars: (team.staff.oc?.stars ?? 0) + (mine && hasEdge(save, 'shoot') ? 1 : 0),
    dcStars: (team.staff.dc?.stars ?? 0) + (mine ? 0.5 * perk(save, 'film') + (hasEdge(save, 'film') ? 1.5 : 0) : 0),
    arenaLevel: effLevel(team.facilities.arena),
    captainId: teamId === save.userTeamId ? save.captainId : null,
  };
}
export function buildSetup(save: Save, g: ScheduledGame, controlled: number): GameSetup {
  const mine = g.homeId === save.userTeamId || g.awayId === save.userTeamId;
  // against the user, opponents raise or drop their game with how he is doing
  const lean = mine ? pressure(save) : 0;
  const side = (id: number): SideInput => { const s = sideInput(save, id); return lean && id !== save.userTeamId ? { ...s, players: s.players.map(p => withPressure(p, lean)) } : s; };
  return {
    home: side(g.homeId), away: side(g.awayId),
    userTeamId: mine && controlled > 0 ? save.userTeamId : null,
    controlled, playoff: !!g.playoff,
    fans: g.homeId === save.userTeamId ? save.fans : 50,
    difficulty: save.settings.difficulty,
  };
}
export function startLiveGame(save: Save, g: ScheduledGame, rng: Rng): LiveGame {
  fixLineup(save, save.teams[g.homeId]); fixLineup(save, save.teams[g.awayId]);
  return createLiveGame(buildSetup(save, g, CONTROLLED_POSSESSIONS + 2 * perk(save, 'clutch') + (hasEdge(save, 'walk') ? 2 : 0)), rng);
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
    notePerformance(save, result);
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
  xp: number; levelUp: number | null; trophies: string[];
  /** Players of yours who levelled up in this game. */
  playerLevelUps: number[];
  /** The challenge picked before the game, if any. */
  objective: ObjectiveResult | null;
  /** Players of yours whose form changed. */
  form: FormChange[];
  /** What else the game meant: rivalry, a guarantee kept or broken, a sponsor paying out. */
  notes: { text: string; good: boolean }[];
}
/** After the user's own game (played or simmed): credits, coach record, morale, owner, fans. */
export function finishUserGame(save: Save, g: ScheduledGame, result: GameResult, highlights: string[], rng: Rng, objective?: Objective | null): PostGame {
  applyGame(save, g, result, rng);
  const home = g.homeId === save.userTeamId;
  const my = home ? result.homeScore : result.awayScore, their = home ? result.awayScore : result.homeScore;
  const won = my > their;
  const c = save.coach, stop = c.stops[c.stops.length - 1];
  if (g.playoff) { if (won) c.playoffW++; else c.playoffL++; }
  else { if (won) { c.w++; if (stop) stop.w++; } else { c.l++; if (stop) stop.l++; } }
  // a playoff game in a seven-game series counts for less than a one-off
  const scale = g.playoff ? (cal(save).seriesWins > 1 ? 0.3 : 1) : perGame(save);
  afterUserGame(save, won, Math.abs(my - their), !!g.playoff, scale);
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
  const credits = [...gameCredits(save, result, highlights, !!g.playoff, scale), ...checkMilestones(save)];
  // what the week's plan and the rivalry add
  const notes: PostGame['notes'] = [];
  const edge = edgeFor(save);
  const rival = isRivalGame(save, g);
  if (rival) {
    const opp = save.teams[home ? g.awayId : g.homeId];
    // after trash talk in the press, the stakes double
    const heat = heatedGame(save) === g.id;
    if (won) { credits.push({ label: heat ? 'Rivalry win (you fired back)' : 'Rivalry win', amount: heat ? 4 : 2 }); bumpFans(save, heat ? 6 : 3); notes.push({ text: `You beat your rivals, the ${opp.name}. Fans +${heat ? 6 : 3}.${heat ? ' Your words held up.' : ''}`, good: true }); }
    else { bumpFans(save, heat ? -5 : -2); notes.push({ text: `You lost to your rivals, the ${opp.name}. Fans -${heat ? 5 : 2}.${heat ? ' After all that talk.' : ''}`, good: false }); }
  }
  if (edge?.kind === 'promo') {
    const gate = credits.find(x => x.label === 'Home gate');
    if (gate) credits.push({ label: 'Ticket promotion', amount: gate.amount });
  }
  if (edge?.kind === 'guarantee') {
    if (won) { credits.push({ label: 'Guarantee kept', amount: 4 }); bumpFans(save, 4); notes.push({ text: 'You guaranteed it and delivered. Fans +4.', good: true }); }
    else { bumpOwner(save, -5); bumpFans(save, -3); notes.push({ text: 'You guaranteed a win and lost. Owner -5, fans -3.', good: false }); }
  }
  weekState(save).edge = null;
  // fractions of a credit carry over to the next game
  const exact = credits.reduce((s, x) => s + x.amount, 0) + (save.creditCarry ?? 0);
  let total = Math.floor(exact + 1e-9);
  save.creditCarry = exact - total;
  save.credits += total;
  const me = save.teams[save.userTeamId];
  if (!g.playoff && me.record.streak === -4) pushNews(save, 'owner', headline(rng, 'ownerAngry', { owner: save.owner.name, team: me.name }), true);
  if (!g.playoff && me.record.streak === 4) pushNews(save, 'owner', headline(rng, 'ownerHappy', { owner: save.owner.name, team: me.name }), true);
  const gp = gameProgress(save, result, highlights, !!g.playoff, scale);
  const done = objective ? settleObjective(save, objective, result, highlights) : null;
  const playerLevelUps = gameXp(save, lines, g.playoff ? 1 : Math.max(scale, 0.35));
  const form = updateForm(save, lines, rng);
  const sponsor = sponsorOf(save);
  const bonus = settleSponsor(save, { won, rival });
  if (bonus > 0 && sponsor) {
    credits.push({ label: `${sponsor.name} bonus`, amount: bonus }); total += bonus;
    notes.push({ text: `Sponsor target met: ${sponsor.text}.`, good: true });
    pushNews(save, 'team', `${sponsor.name} pay the ${me.name} a ${bonus}-credit bonus.`, true);
  }
  return { gameId: g.id, won, credits, total, topPerformer: result.topPerformer, playoff: !!g.playoff, ...gp, playerLevelUps, objective: done, form, notes };
}

function simGame(save: Save, g: ScheduledGame, rng: Rng): PostGame | null {
  fixLineup(save, save.teams[g.homeId]); fixLineup(save, save.teams[g.awayId]);
  const result = simulateGame(buildSetup(save, g, 0), rng);
  if (g.homeId === save.userTeamId || g.awayId === save.userTeamId) return finishUserGame(save, g, result, [], rng);
  applyGame(save, g, result, rng);
  return null;
}

// ---- playoffs ------------------------------------------------------------------------
function nextSeriesGame(save: Save, s: PlayoffSeries, day: number): void {
  const n = s.games.length + 1; // game number in the series
  const need = cal(save).seriesWins;
  // higher seed hosts games 1, 2, 5, 7 (and the only game of a one-off)
  const highHome = need === 1 || n === 1 || n === 2 || n === 5 || n === 7;
  const id = save.year * 10000 + 5000 + save.schedule.filter(g => g.playoff).length;
  save.schedule.push({ id, week: cal(save).regWeeks + s.round, day, homeId: highHome ? s.highId : s.lowId, awayId: highHome ? s.lowId : s.highId, played: false, playoff: true });
  s.games.push(id); s.gameId = id;
}
function addSeries(save: Save, round: 1 | 2 | 3, conf: number, high: Team, low: Team, day: number): void {
  const s: PlayoffSeries = { round, conf, highId: high.id, lowId: low.id, highW: 0, lowW: 0, games: [] };
  save.playoffs!.series.push(s);
  nextSeriesGame(save, s, day);
}
const lastDay = (save: Save): number => save.schedule.reduce((m, g) => Math.max(m, g.day), 0);
function startPlayoffs(save: Save, rng: Rng): void {
  save.phase = 'playoffs';
  save.playoffs = { series: [] };
  const day = lastDay(save) + 1;
  for (const conf of [0, 1]) {
    const s = standings(save, conf);
    addSeries(save, 1, conf, s[0], s[3], day);
    addSeries(save, 1, conf, s[1], s[2], day);
    for (const t of s.slice(0, 4)) pushNews(save, 'league', headline(rng, 'playoffClinch', { team: t.name }), t.id === save.userTeamId);
  }
  save.tradeOffer = null;
}
const seedOf = (save: Save, t: Team): number => standings(save, t.conf).indexOf(t);
/** After a playoff game day: update series, schedule the next game of any series still alive. */
function afterPlayoffDay(save: Save, day: number, rng: Rng): void {
  const need = cal(save).seriesWins;
  for (const s of save.playoffs!.series) {
    if (s.winnerId !== undefined) continue;
    const g = save.schedule.find(x => x.id === s.gameId);
    if (!g || !g.played || g.day !== day) continue;
    const winner = (g.homeScore ?? 0) > (g.awayScore ?? 0) ? g.homeId : g.awayId;
    if (winner === s.highId) s.highW++; else s.lowW++;
    if (s.highW >= need || s.lowW >= need) {
      s.winnerId = s.highW >= need ? s.highId : s.lowId;
      const loser = s.winnerId === s.highId ? s.lowId : s.highId;
      if (s.round < 3) pushNews(save, 'league', headline(rng, 'eliminated', { team: save.teams[loser].name }), loser === save.userTeamId);
    } else nextSeriesGame(save, s, day + 1);
  }
}
/** All series of the round are decided: build the next round, or crown the champion. */
function advancePlayoffs(save: Save, rng: Rng): void {
  const po = save.playoffs!;
  const round = playoffRound(save) as 1 | 2 | 3;
  const done = po.series.filter(x => x.round === round);
  const day = lastDay(save) + 1;
  if (round === 1) {
    for (const conf of [0, 1]) {
      const [a, b] = done.filter(s => s.conf === conf).map(s => save.teams[s.winnerId!]);
      const [hi, lo] = seedOf(save, a) < seedOf(save, b) ? [a, b] : [b, a];
      addSeries(save, 2, conf, hi, lo, day);
    }
  } else if (round === 2) {
    const [a, b] = done.map(s => save.teams[s.winnerId!]);
    const better = cmpRecord(a, b) <= 0;
    addSeries(save, 3, 2, better ? a : b, better ? b : a, day);
  } else {
    const f = done[0];
    po.championId = f.winnerId;
    const champ = save.teams[f.winnerId!], other = save.teams[f.winnerId === f.highId ? f.lowId : f.highId];
    pushNews(save, 'league', headline(rng, 'champion', { team: `${champ.city} ${champ.name}`, opp: other.name }), champ.id === save.userTeamId);
  }
}
const cmpRecord = (a: Team, b: Team): number => b.record.w - a.record.w || (b.record.pf - b.record.pa) - (a.record.pf - a.record.pa);

/** Week-end housekeeping, then move the calendar on. */
function closeWeek(save: Save, rng: Rng): void {
  const c = cal(save);
  const wasRegular = save.phase === 'regular';
  healWeek(save, rng);
  weeklyFacilities(save, rng);
  if (save.phase === 'regular') {
    if (save.week <= c.deadlineWeek) aiTradesWeek(save, rng);
    aiMaintainRosters(save, rng);
    if (save.week === c.deadlineWeek) { pushNews(save, 'league', 'The trade deadline has passed. Rosters are locked until the offseason.'); save.tradeOffer = null; }
    save.week++;
    if (save.week > c.regWeeks) {
      startPlayoffs(save, rng);
      const sponsor = sponsorOf(save), bonus = settleSponsor(save);
      if (bonus > 0 && sponsor) pushNews(save, 'team', `${sponsor.name} pay a ${bonus}-credit bonus: ${sponsor.text.toLowerCase()}.`, true);
    } else {
      if (save.tradeOffer && validateTrade(save, save.tradeOffer)) save.tradeOffer = null;
      if (!save.tradeOffer && save.week <= c.deadlineWeek && isUnlocked(save, 'trades')) {
        const offer = aiOfferToUser(save, rng);
        if (offer) save.tradeOffer = offer;
      }
      if (isUnlocked(save, 'staff')) rollEvent(save, rng);
    }
  } else if (save.phase === 'playoffs') {
    advancePlayoffs(save, rng);
    if (save.playoffs!.championId !== undefined) { beginOffseason(save, rng); seasonProgress(save); }
    else save.week++;
  }
  if (wasRegular) {
    // the assistant GM does the chores, if you let him
    if (save.settings.assistant) {
      const done = doChores(save);
      if (done.length) pushNews(save, 'team', `Your assistant: ${done.join('; ')}.`, true);
    }
    rollMoment(save, rng);
    // named once the calendar has moved on, so the hub shows it in the week that follows
    const potw = awardPlayerOfWeek(save);
    if (potw) pushNews(save, 'award', `Player of the Week: ${potw.player.name} (${save.teams[potw.player.teamId!].name}), ${potw.text}.${potw.mine ? ' The club gets 1 credit.' : ''}`, potw.mine);
  }
  for (const t of save.teams) fixLineup(save, t);
  checkTrophies(save);
  checkFired(save);
}

/**
 * Move the season forward.
 *  - 'afterUser': the user has just played his game by hand; finish that day, then run on until
 *    his next game (or the end of the week).
 *  - 'simGame': simulate the user's next game too, then behave like 'afterUser'.
 *  - 'simWeek': simulate everything left this week.
 * Returns the post-game summaries of any user games that were simulated.
 */
export function advance(save: Save, rng: Rng, mode: 'afterUser' | 'simGame' | 'simWeek'): PostGame[] {
  const posts: PostGame[] = [];
  const mine = (g: ScheduledGame) => g.homeId === save.userTeamId || g.awayId === save.userTeamId;
  let userSims = mode === 'simWeek' ? Infinity : mode === 'simGame' ? 1 : 0;
  const week = save.week, phase = save.phase;
  for (let guard = 0; guard < 400; guard++) {
    if (save.fired || save.week !== week || save.phase !== phase) break;
    const open = gamesInWeek(save, save.week).filter(g => !g.played);
    if (!open.length) { closeWeek(save, rng); break; }
    const day = open.reduce((m, g) => Math.min(m, g.day), Infinity);
    const today = open.filter(g => g.day === day);
    const ug = today.find(mine);
    if (ug && userSims <= 0) break; // his game: wait for him to play or sim it
    for (const g of today) { const post = simGame(save, g, rng); if (post) posts.push(post); }
    if (ug) userSims--;
    if (save.phase === 'playoffs') afterPlayoffDay(save, day, rng);
  }
  return posts;
}
/** Simulate the rest of the current week. Returns the last user game simulated, if any. */
export function endWeek(save: Save, rng: Rng): PostGame | null {
  const posts = advance(save, rng, 'simWeek');
  return posts.length ? posts[posts.length - 1] : null;
}

export const userInPlayoffs = (save: Save): boolean => !!userGame(save);
