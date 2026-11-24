// Offseason: awards, retirements, contracts, draft, free agency, training camp, new season.
import { announceBadges } from '../badges';
import { FA_DAYS, MIN_SALARY, ROSTER_MAX, ROSTER_MIN } from '../constants';
import { genFreeAgents, genProspects, genStaffPool, shortName } from '../gen/league';
import { aiDraftChoice, rookieContract } from '../gm/draft';
import { aiFillRosters, runFreeAgencyDay } from '../gm/freeAgency';
import { aiMakeRoom, aiMaintainRosters, aiResignPhase, updateStrategies } from '../gm/teamAi';
import { askingContract, marketSalary, teamStrength } from '../gm/value';
import { fixLineup } from '../lineup';
import { effLevel, headline, maybePoach, pushNews, scoutPointsPerSeason, teamName } from '../org/economy';
import { signingPath } from '../org/finance';
import { bumpFans, bumpOwner, bumpRep, checkFired, evaluateGoals, progressPlayer, setOwnerGoals } from '../org/people';
import { releasePlayer, signPlayer } from '../org/roster';
import { careerStats, clamp, emptyStats, gameScore, ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import { cal } from '../season/calendar';
import { cmpTeams, genSchedule } from '../season/schedule';
import type { OffseasonStep, Player, PlayoffSeries, Save, SeasonHistory, StatLine, Team, TeamSeason } from '../types';
import { grantXp } from '../org/xp';
import { startChallenge } from '../org/progress';
import { publishGoatList } from '../org/goat';
import { draftLookback } from '../org/draftlook';

const STEPS: OffseasonStep[] = ['awards', 'retirements', 'contracts', 'draft', 'freeAgency', 'camp', 'done'];
const per = (s: StatLine, k: keyof StatLine): number => (s.gp ? s[k] / s.gp : 0);
const line = (s: StatLine): string =>
  `${per(s, 'pts').toFixed(1)} pts, ${((s.orb + s.drb) / Math.max(1, s.gp)).toFixed(1)} reb, ${per(s, 'ast').toFixed(1)} ast`;

function playoffFinish(save: Save, teamId: number): TeamSeason['playoff'] {
  const po = save.playoffs;
  if (!po) return 'none';
  if (po.championId === teamId) return 'champ';
  const rounds = po.series.filter(s => s.highId === teamId || s.lowId === teamId).map(s => s.round);
  if (!rounds.length) return 'none';
  const max = Math.max(...rounds);
  return max === 3 ? 'F' : max === 2 ? 'SF' : 'R1';
}

function computeAwards(save: Save): SeasonHistory['awards'] {
  const active = save.teams.flatMap(t => t.roster.map(id => save.players[id])).filter(p => p.season.gp >= Math.ceil(cal(save).games * 0.55));
  const winPct = (p: Player) => { const r = save.teams[p.teamId!].record; return r.w / Math.max(1, r.w + r.l); };
  const best = (pool: Player[], f: (p: Player) => number): Player | null =>
    pool.length ? pool.reduce((a, b) => (f(b) > f(a) ? b : a)) : null;
  const out: SeasonHistory['awards'] = [];
  const add = (award: string, p: Player | null, text?: string) => {
    if (!p) return;
    out.push({ award, playerId: p.id, name: p.name, teamId: p.teamId!, line: text ?? line(p.season) });
    p.awards.push(`${award} (Y${save.year})`);
  };
  const gs = (p: Player) => gameScore(p.season) / p.season.gp;
  add('MVP', best(active, p => gs(p) * (0.6 + 0.4 * winPct(p))));
  add('Defensive Player', best(active, p => (p.season.stl * 1.3 + p.season.blk * 1.3 + p.season.drb * 0.2) / p.season.gp + p.ratings.def / 25),
    undefined);
  add('Rookie of the Year', best(active.filter(p => p.seasons.length === 0 && p.age <= 22), gs));
  add('Sixth Man', best(active.filter(p => p.season.gs < p.season.gp / 2), gs));
  // biggest jump on last season's production (nobody has a last season in year one)
  const prev = (p: Player) => { const l = p.seasons[p.seasons.length - 1]; return l && l.stats.gp >= 6 ? gameScore(l.stats) / l.stats.gp : null; };
  const risers = active.filter(p => { const b = prev(p); return b !== null && gs(p) - b >= 2; });
  add('Most Improved', best(risers, p => gs(p) - (prev(p) ?? 0)));
  add('Scoring Champ', best(active, p => per(p.season, 'pts')));
  // All-League five: best at each position
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
    const p = best(active.filter(x => x.pos === pos), gs);
    if (p) { out.push({ award: `All-League ${pos}`, playerId: p.id, name: p.name, teamId: p.teamId!, line: line(p.season) }); p.awards.push(`All-League (Y${save.year})`); }
  }
  return out;
}

/** The champion's best player in the final (from its box score when we have one, else his season). */
function finalsMvp(save: Save, champId: number, final: PlayoffSeries): SeasonHistory['awards'][number] | null {
  const g = save.schedule.find(x => x.id === final.gameId);
  let p: Player | null = null, text = '';
  if (g?.result) {
    const lines = (g.result.homeId === champId ? g.result.box.home : g.result.box.away).filter(l => l.min > 0 && save.players[l.playerId]);
    if (lines.length) {
      const top = lines.reduce((a, b) => (gameScore(b) > gameScore(a) ? b : a));
      p = save.players[top.playerId];
      text = `${top.pts} pts, ${top.orb + top.drb} reb, ${top.ast} ast in the final`;
    }
  }
  if (!p) {
    const ps = save.teams[champId].roster.map(id => save.players[id]).filter(x => x && x.season.gp > 0);
    if (!ps.length) return null;
    p = ps.reduce((a, b) => (gameScore(b.season) / b.season.gp > gameScore(a.season) / a.season.gp ? b : a));
    text = line(p.season);
  }
  p.awards.push(`Finals MVP (Y${save.year})`);
  return { award: 'Finals MVP', playerId: p.id, name: p.name, teamId: champId, line: text };
}

/** Credits the club earns when one of its own players takes an award. */
export const awardCredits = (award: string): number =>
  award === 'MVP' ? 4 : award === 'Finals MVP' ? 3 : award.startsWith('All-League') ? 1 : 2;
/** Pay the user for awards his players won: credits, a lift with the fans, and a happy player. */
function payAwardRewards(save: Save, awards: SeasonHistory['awards']): NonNullable<Save['offseason']>['awardRewards'] {
  const out: NonNullable<NonNullable<Save['offseason']>['awardRewards']> = [];
  for (const a of awards) {
    if (a.teamId !== save.userTeamId) continue;
    const credits = awardCredits(a.award), fans = a.award === 'MVP' ? 4 : a.award.startsWith('All-League') ? 1 : 2;
    save.credits += credits;
    bumpFans(save, fans);
    const p = save.players[a.playerId];
    if (p) p.morale = clamp(p.morale + 8, 0, 100);
    out.push({ award: a.award, playerId: a.playerId, credits, fans });
  }
  return out;
}

// ---- camp shootaround ------------------------------------------------------------------
/** Shootaround sessions allowed in one training camp. */
export const CAMP_DRILLS = 3;
/** Looks the player gets in one session. */
export const CAMP_SHOTS = 5;
export const campDrillsLeft = (save: Save): number =>
  save.offseason?.step === 'camp' ? Math.max(0, CAMP_DRILLS - (save.offseason.campDrills ?? 0)) : 0;
/** Use up one session. Returns an error text if there is none left. */
export function startCampDrill(save: Save, playerId: number): string | null {
  const off = save.offseason;
  if (!off || off.step !== 'camp') return 'Shootarounds are held at training camp.';
  if (!save.teams[save.userTeamId].roster.includes(playerId)) return 'He is not on your roster.';
  if (campDrillsLeft(save) <= 0) return 'No sessions left this camp.';
  off.campDrills = (off.campDrills ?? 0) + 1;
  return null;
}
/** XP for a session: every make counts, and a hot hand earns a bonus. */
export const campDrillXp = (makes: number): number => makes * 12 + (makes >= CAMP_SHOTS ? 30 : makes >= CAMP_SHOTS - 1 ? 15 : 0);
/** Pay out a finished session. Returns the XP given and the levels he gained. */
export function finishCampDrill(save: Save, playerId: number, makes: number): { xp: number; levels: number } {
  const p = save.players[playerId];
  const xp = campDrillXp(clamp(Math.round(makes), 0, CAMP_SHOTS));
  if (!p || xp <= 0) return { xp: 0, levels: 0 };
  return { xp, levels: grantXp(save, p, xp) };
}

function updateSeasonRecords(save: Save): void {
  const me = save.teams[save.userTeamId];
  for (const id of me.roster) {
    const p = save.players[id];
    const s = p.season;
    const set = (key: string, v: number) => {
      const cur = save.records[key];
      if (v > 0 && (!cur || v > cur.value)) save.records[key] = { value: v, playerId: p.id, name: p.name, year: save.year, teamId: me.id };
    };
    set('season.pts', s.pts); set('season.reb', s.orb + s.drb); set('season.ast', s.ast);
    set('season.tpm', s.tpm); set('season.stl', s.stl); set('season.blk', s.blk);
    // career with this franchise
    const c = emptyStats();
    for (const ps of p.seasons) if (ps.teamId === me.id) for (const k in c) (c as any)[k] += (ps.stats as any)[k];
    for (const k in c) (c as any)[k] += (s as any)[k];
    set('career.pts', c.pts); set('career.reb', c.orb + c.drb); set('career.ast', c.ast); set('career.gp', c.gp);
  }
}

/** Called once the champion is decided. */
export function beginOffseason(save: Save, rng: Rng): void {
  const po = save.playoffs!;
  const champId = po.championId!;
  const final = po.series.find(s => s.round === 3)!;
  const runnerUp = final.highId === champId ? final.lowId : final.highId;
  const me = save.teams[save.userTeamId];
  for (const t of save.teams) {
    const finish = playoffFinish(save, t.id);
    t.history.push({ year: save.year, w: t.record.w, l: t.record.l, playoff: finish });
    if (finish === 'champ') t.titles.push(save.year);
  }
  const awards = computeAwards(save);
  const mvp = awards.find(a => a.award === 'MVP') ?? null;
  const fmvp = finalsMvp(save, champId, final);
  if (fmvp) awards.splice(mvp ? awards.indexOf(mvp) + 1 : 0, 0, fmvp);
  const awardRewards = payAwardRewards(save, awards);
  for (const a of awards.filter(x => !x.award.startsWith('All-League')).slice(0, 7)) pushNews(save, 'award', headline(rng, 'award', { player: a.name, team: save.teams[a.teamId].name, award: a.award }), a.teamId === me.id, a.award === 'MVP');
  const myFinish = playoffFinish(save, me.id);
  save.history.push({
    year: save.year, championId: champId, runnerUpId: runnerUp,
    mvp: mvp ? { playerId: mvp.playerId, name: mvp.name, teamId: mvp.teamId, line: mvp.line ?? '' } : null,
    awards, userTeamId: me.id, userW: me.record.w, userL: me.record.l, userPlayoff: myFinish,
  });
  // coach
  const c = save.coach, stop = c.stops[c.stops.length - 1];
  c.seasons++;
  if (myFinish === 'champ') { c.titles++; if (stop) stop.titles++; bumpRep(save, 12); save.credits += 15; }
  else if (myFinish === 'F') { bumpRep(save, 6); save.credits += 6; }
  else if (myFinish === 'SF') bumpRep(save, 3);
  else if (myFinish === 'R1') bumpRep(save, 1);
  else if (me.record.w < me.record.l) bumpRep(save, -3);
  const log = evaluateGoals(save);
  updateSeasonRecords(save);
  publishGoatList(save, 'summer');
  save.phase = 'offseason';
  save.pendingEvent = null; save.tradeOffer = null;
  save.offseason = { step: 'awards', draftOrder: [], draftIdx: 0, prospects: [], faDay: 1, userOffers: {}, retired: [], campSpent: 0, log, jobOffers: [], awardRewards };
  if (!checkFired(save) && c.rep >= 40 && rng.chance(0.5)) {
    // a bigger club comes calling
    const better = save.teams.filter(t => t.id !== me.id && t.prestige > me.prestige + 8).sort((a, b) => b.prestige - a.prestige);
    if (better.length) save.offseason.jobOffers = [rng.pick(better.slice(0, 3)).id];
  }
  if (myFinish === 'champ' && !save.fired) {
    // nothing left to prove here: the worst club in the league asks whether you could do it again
    const bottom = save.teams.filter(t => t.id !== me.id).sort((x, y) => teamStrength(save, x) - teamStrength(save, y))[0];
    if (bottom && !save.offseason.jobOffers!.includes(bottom.id)) save.offseason.jobOffers!.push(bottom.id);
  }
}

function archiveSeasons(save: Save): void {
  for (const id in save.players) {
    const p = save.players[id];
    const lastTeam = p.teamId ?? p.seasons[p.seasons.length - 1]?.teamId ?? p.draft?.teamId ?? 0;
    if (p.season.gp > 0) p.seasons.push({ year: save.year, teamId: lastTeam, age: p.age, ovr: ovr(p), stats: p.season });
    p.season = emptyStats();
  }
}

function ageAndRetire(save: Save, rng: Rng): void {
  const off = save.offseason!;
  const minutesOf = (p: Player): number => { const last = p.seasons[p.seasons.length - 1]; return last && last.year === save.year ? last.stats.min / Math.max(1, last.stats.gp) / 48 : 0; };
  for (const team of save.teams) {
    const training = effLevel(team.facilities.training);
    for (const id of team.roster) {
      const p = save.players[id], before = ovr(p);
      progressPlayer(p, rng, training, clamp(minutesOf(p), 0, 1));
      if (team.id === save.userTeamId) (off.progress ??= []).push({ playerId: id, before, after: ovr(p) });
    }
  }
  for (const id of [...save.freeAgents, ...save.draftClass]) {
    const p = save.players[id];
    if (!save.draftClass.includes(id)) progressPlayer(p, rng, 1, 0.2);
  }
  for (const id in save.players) { const p = save.players[id]; if (!p.retired && !save.draftClass.includes(p.id)) p.age++; }
  // retirements
  const consider = [...save.teams.flatMap(t => t.roster), ...save.freeAgents];
  for (const id of consider) {
    const p = save.players[id];
    const o = ovr(p);
    const chance = p.age >= 38 ? 1 : p.age >= 33 ? (p.age - 32) * 0.18 + (o < 62 ? 0.3 : 0) - (o >= 78 ? 0.2 : 0) : p.teamId === null && p.age >= 31 && o < 56 ? 0.6 : 0;
    if (!rng.chance(chance)) continue;
    const career = careerStats(p);
    const teamId = p.teamId;
    const wasMine = teamId === save.userTeamId;
    if (teamId !== null) {
      const team = save.teams[teamId];
      team.roster = team.roster.filter(x => x !== id);
      fixLineup(save, team);
    }
    save.freeAgents = save.freeAgents.filter(x => x !== id);
    if (save.captainId === id) save.captainId = null;
    save.tradeDemands = save.tradeDemands.filter(x => x !== id);
    p.retired = true; p.teamId = null;
    const peak = Math.max(o, ...p.seasons.map(s => s.ovr));
    const hofScore = career.pts / 350 + p.awards.length * 2.5 + (peak >= 88 ? 4 : peak >= 82 ? 2 : 0) + (p.seasons.length >= 8 ? 2 : 0);
    const mainTeam = p.seasons.length ? p.seasons[p.seasons.length - 1].teamId : teamId ?? 0;
    if (p.seasons.length >= 3 && hofScore >= 10) {
      save.hallOfFame.push({ playerId: p.id, name: p.name, pos: p.pos, yearRetired: save.year, teamId: mainTeam, career, seasons: p.seasons.length, awards: p.awards.slice(), peakOvr: peak });
      pushNews(save, 'award', headline(rng, 'hof', { player: p.name }), wasMine);
      off.log.push(`${p.name} retires and enters the Hall of Fame.`);
    } else if (wasMine || peak >= 80) {
      pushNews(save, 'league', headline(rng, 'retire', { player: p.name, team: save.teams[mainTeam].name, seasons: Math.max(1, p.seasons.length) }), wasMine);
    }
    off.retired.push(id);
  }
}

/** Chances at each of the top three picks for the eight teams that missed the playoffs, worst record first. */
export const LOTTERY_WEIGHTS = [25, 20, 16, 13, 10, 7, 5, 4];
const ordinal = (n: number): string => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** Draft order for both rounds. Round 1: the non-playoff teams enter a lottery for picks 1-3 (weights above, worst record first); the rest of them follow by record, worst first; then the playoff teams by record, champion last. Round 2 is strict reverse record. A slot belongs to whoever holds that team's pick. Lottery results go to save.offseason.log ("Lottery: ...") and the news. */
export function buildDraftOrder(save: Save, rng: Rng): void {
  const off = save.offseason!;
  const champ = save.playoffs?.championId;
  const worstFirst = save.teams.slice().sort((a, b) => -cmpTeams(a, b));
  const playoff = new Set<number>();
  for (const s of save.playoffs?.series ?? []) { playoff.add(s.highId); playoff.add(s.lowId); }
  // no bracket on record: the better half of the table counts as the playoff field
  if (!playoff.size) for (const t of worstFirst.slice(Math.ceil(worstFirst.length / 2))) playoff.add(t.id);
  const lottery = worstFirst.filter(t => !playoff.has(t.id));
  const seed = (t: Team): number => lottery.indexOf(t) + 1;

  const pool = lottery.slice();
  const winners: Team[] = [];
  while (winners.length < 3 && pool.length) {
    const i = rng.weighted(pool.map(t => LOTTERY_WEIGHTS[seed(t) - 1] ?? 1));
    winners.push(pool.splice(i, 1)[0]);
  }
  const first = [
    ...winners, ...pool,
    ...worstFirst.filter(t => playoff.has(t.id) && t.id !== champ),
    ...worstFirst.filter(t => playoff.has(t.id) && t.id === champ),
  ];

  const ownerOf = (orig: Team, round: 1 | 2): Team =>
    save.teams.find(t => t.picks.some(p => p.year === save.year && p.round === round && p.origTeamId === orig.id)) ?? orig;
  off.draftOrder = [];
  first.forEach((orig, i) => off.draftOrder.push({ teamId: ownerOf(orig, 1).id, round: 1, pick: i + 1 }));
  worstFirst.forEach((orig, i) => off.draftOrder.push({ teamId: ownerOf(orig, 2).id, round: 2, pick: i + 1 }));

  // what the lottery changed: the top three, and anyone it pushed out of the top three
  const involved = new Set<number>();
  first.slice(0, lottery.length).forEach((orig, i) => {
    const was = seed(orig), now = i + 1;
    if (now > 3 && was > 3) return;
    const owner = ownerOf(orig, 1);
    const via = owner.id !== orig.id ? ` (the pick belongs to ${owner.city})` : '';
    const what = now === was ? `keep the #${now} pick`
      : now < was ? `jump from ${ordinal(was)} to the #${now} pick`
      : `fall from ${ordinal(was)} to the #${now} pick`;
    off.log.push(`Lottery: ${orig.city} ${what}${via}`);
    if (now <= 3) { involved.add(orig.id); involved.add(owner.id); }
  });
  if (winners.length) {
    const name = (t: Team): string => { const o = ownerOf(t, 1); return o.id !== t.id ? `${o.city} (via ${t.abbr})` : t.city; };
    const others = winners.slice(1).map((t, i) => `${name(t)} ${i === 0 ? 'second' : 'third'}`);
    pushNews(save, 'draft', `Draft lottery: ${name(winners[0])} win the #1 pick${others.length ? `. Then ${others.join(', ')}` : ''}.`, involved.has(save.userTeamId));
  }

  for (const t of save.teams) t.picks = t.picks.filter(p => p.year !== save.year);
  off.draftIdx = 0;
  off.prospects = save.draftClass.slice();
  save.draftClass = [];
}

function makePick(save: Save, playerId: number, rng: Rng): void {
  const off = save.offseason!;
  const slot = off.draftOrder[off.draftIdx];
  const p = save.players[playerId];
  const team = save.teams[slot.teamId];
  off.prospects = off.prospects.filter(id => id !== playerId);
  p.draft = { year: save.year, round: slot.round, pick: slot.pick, teamId: team.id };
  p.scouted = true;
  signPlayer(save, playerId, team.id, rookieContract(slot.round, slot.pick));
  const mine = team.id === save.userTeamId;
  const overall = (slot.round - 1) * 16 + slot.pick;
  off.log.push(`${overall}. ${team.abbr}: ${p.name} (${p.pos}, ${p.age})`);
  if (mine || overall <= 5) pushNews(save, 'draft', headline(rng, 'draftPick', { player: p.name, team: team.name, pick: overall, pos: p.pos }), mine);
  off.draftIdx++;
}
/** True if the user is on the clock. */
export const userOnClock = (save: Save): boolean => {
  const off = save.offseason;
  return !!off && off.step === 'draft' && off.draftIdx < off.draftOrder.length && off.draftOrder[off.draftIdx].teamId === save.userTeamId;
};
export const draftDone = (save: Save): boolean => {
  const off = save.offseason!;
  return off.draftIdx >= off.draftOrder.length || off.prospects.length === 0;
};
/** Run AI picks until the user is on the clock or the draft ends. */
export function runDraftUntilUser(save: Save, rng: Rng): void {
  const off = save.offseason!;
  while (!draftDone(save) && !userOnClock(save)) {
    const slot = off.draftOrder[off.draftIdx];
    const pick = aiDraftChoice(save, slot.teamId, rng);
    if (pick < 0) break;
    makePick(save, pick, rng);
  }
}
export function userDraftPick(save: Save, playerId: number | null, rng: Rng): string | null {
  const off = save.offseason!;
  if (!userOnClock(save)) return 'Not your pick.';
  if (playerId === null) { off.log.push(`${save.teams[save.userTeamId].abbr} pass.`); off.draftIdx++; }
  else {
    const team = save.teams[save.userTeamId];
    if (team.roster.length >= ROSTER_MAX) return `Roster is full (${ROSTER_MAX}). Release someone or pass.`;
    // a drafted player can always be signed to his rookie deal, whatever the payroll
    makePick(save, playerId, rng);
  }
  runDraftUntilUser(save, rng);
  return null;
}

/** Re-sign one of the user's expiring players at his asking price. A team may go over the cap to keep its own player, but not past the hard limit. */
export function resignPlayer(save: Save, playerId: number): string | null {
  const p = save.players[playerId];
  const team = save.teams[save.userTeamId];
  if (!p || p.teamId !== team.id) return 'He is not on your team.';
  const ask = askingContract(save, p, team.id);
  if (ask.refuses) return `${shortName(p.name)} is not interested in returning.`;
  if (team.roster.length > ROSTER_MAX) return `Your roster is over the limit (${team.roster.length} of ${ROSTER_MAX}). Release someone first.`;
  const path = signingPath(save, team, ask.salary, { ownPlayer: true, years: ask.years });
  if (!path.ok) return path.reason;
  p.contract = { salary: ask.salary, years: ask.years };
  p.morale = clamp(p.morale + 8, 0, 100);
  pushNews(save, 'signing', `${p.name} re-signs with ${teamName(team)} (${ask.years} yr${ask.years === 1 ? '' : 's'}, $${ask.salary}M).`, true);
  return null;
}
export const expiringPlayers = (save: Save): Player[] =>
  save.teams[save.userTeamId].roster.map(id => save.players[id]).filter(p => p.contract.years <= 0);

export function faNextDay(save: Save, rng: Rng): string[] {
  const off = save.offseason!;
  const lines = runFreeAgencyDay(save, rng);
  off.faDay++;
  off.log = lines;
  return lines;
}
export const faOver = (save: Save): boolean => (save.offseason?.faDay ?? 0) > FA_DAYS;

/** Move to the next offseason step, doing the work that happens between steps. */
export function advanceOffseason(save: Save, rng: Rng): void {
  const off = save.offseason!;
  const next = STEPS[STEPS.indexOf(off.step) + 1];
  if (off.step === 'awards') {
    archiveSeasons(save);
    off.log = [];
    ageAndRetire(save, rng);
  } else if (off.step === 'retirements') {
    for (const t of save.teams) for (const id of t.roster) { const p = save.players[id]; p.contract.years = Math.max(0, p.contract.years - 1); p.tenure++; }
    for (const t of save.teams) t.deadCap = 0;
    aiResignPhase(save, rng);
    maybePoach(save, rng);
    off.log = [];
  } else if (off.step === 'contracts') {
    for (const p of expiringPlayers(save)) {
      releasePlayer(save, p.id, { deadCap: false });
      pushNews(save, 'signing', headline(rng, 'release', { player: p.name, team: save.teams[save.userTeamId].name }), true);
    }
    for (const id of save.freeAgents) { const p = save.players[id]; p.contract = { salary: marketSalary(p), years: 0 }; }
    off.log = [];
    buildDraftOrder(save, rng);
    off.step = 'draft';
    runDraftUntilUser(save, rng);
    return;
  } else if (off.step === 'draft') {
    // anyone left on the board becomes a free agent
    for (const id of off.prospects) { const p = save.players[id]; p.scouted = true; p.contract = { salary: MIN_SALARY, years: 0 }; save.freeAgents.push(id); }
    off.prospects = [];
    aiMakeRoom(save);
    off.faDay = 1; off.userOffers = {}; off.log = [];
  } else if (off.step === 'freeAgency') {
    aiFillRosters(save, rng);
    aiMaintainRosters(save, rng);
    off.log = [];
  } else if (off.step === 'camp') {
    startNewSeason(save, rng);
    return;
  }
  off.step = next;
}

export function startNewSeason(save: Save, rng: Rng): void {
  const me = save.teams[save.userTeamId];
  // a summer of growth may have earned someone his badge
  announceBadges(save);
  // make sure the user can field a team
  const pool = () => save.freeAgents.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a));
  while (me.roster.length < ROSTER_MIN) {
    const fa = pool()[0];
    if (!fa) break;
    signPlayer(save, fa.id, me.id, { salary: MIN_SALARY, years: 1 });
    pushNews(save, 'signing', `${fa.name} joins ${me.name} on a minimum deal to fill out the roster.`, true);
  }
  // plans first, then payrolls: a team that is no longer contending gets under the tax before tip-off
  updateStrategies(save);
  aiFillRosters(save, rng);
  aiMaintainRosters(save, rng);
  for (const f of Object.values(me.facilities)) if (f.pending) { f.level = f.pending; delete f.pending; f.condition = 100; }
  save.year++;
  save.week = 1;
  save.phase = 'regular';
  save.playoffs = null;
  save.offseason = null;
  save.seenEvents = [];
  save.tradeOffer = null;
  for (const t of save.teams) {
    t.record = { w: 0, l: 0, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 };
    for (const round of [1, 2] as const) if (!save.teams.some(x => x.picks.some(p => p.year === save.year + 2 && p.round === round && p.origTeamId === t.id))) t.picks.push({ year: save.year + 2, round, origTeamId: t.id });
    for (const id of t.roster) { const p = save.players[id]; p.injury = null; p.morale = clamp(Math.round(p.morale + (62 - p.morale) * 0.4), 0, 100); }
    fixLineup(save, t);
    // AI clubs slowly invest
    if (t.id !== me.id && rng.chance(0.25)) { const k = rng.pick(['arena', 'training', 'medical', 'scouting'] as const); t.facilities[k].level = clamp(t.facilities[k].level + (rng.chance(t.facilities[k].level < 3 ? 0.7 : 0.35) ? 1 : -1), 1, 5); }
    // last season's win percentage, on the scale a 14-game season used to give (so it means the same over 82 games)
    const last = t.history[t.history.length - 1];
    const lastPct = last && last.w + last.l > 0 ? last.w / (last.w + last.l) : 0.5;
    if (t.id !== me.id) t.prestige = clamp(Math.round(t.prestige * 0.9 + lastPct * 12.6 + (t.titles.includes(save.year - 1) ? 8 : 0)), 5, 99);
  }
  // prune: retired players nobody references, and the dregs of free agency
  const fas = pool();
  for (const p of fas.slice(36)) { save.freeAgents = save.freeAgents.filter(id => id !== p.id); p.retired = true; }
  const hof = new Set(save.hallOfFame.map(h => h.playerId));
  for (const id in save.players) { const p = save.players[id]; if (p.retired && !hof.has(p.id)) delete save.players[id]; }
  if (save.freeAgents.length < 22) genFreeAgents(save, rng, 22 - save.freeAgents.length);
  save.draftClass = genProspects(save, rng);
  save.staffPool = [...save.staffPool.filter(() => rng.chance(0.4)).slice(0, 6), ...genStaffPool(save, rng)].slice(0, 16);
  save.schedule = genSchedule(save, rng);
  save.fans = Math.round(save.fans + (50 - save.fans) * 0.2);
  save.owner.approval = clamp(Math.round(save.owner.approval + (55 - save.owner.approval) * 0.15), 0, 100);
  save.scoutPoints = scoutPointsPerSeason(save);
  setOwnerGoals(save);
  pushNews(save, 'league', `Season ${save.year} tips off.`);
  // and the papers look back at old drafts
  draftLookback(save);
}

/** First-time setup after the user picks a franchise. */
/** The weakest roster in the league: where every new coach starts. */
export const worstTeam = (save: Save): Team => save.teams.slice().sort((x, y) => teamStrength(save, x) - teamStrength(save, y))[0];
export function chooseTeam(save: Save, teamId: number, rng: Rng): void {
  save.userTeamId = teamId;
  startChallenge(save);
  save.coach.stops = [{ teamId, from: 1, to: null, w: 0, l: 0, titles: 0 }];
  save.fans = clamp(Math.round(35 + save.teams[teamId].prestige * 0.3), 20, 75);
  save.schedule = genSchedule(save, rng);
  updateStrategies(save);
  save.scoutPoints = scoutPointsPerSeason(save);
  setOwnerGoals(save);
  pushNews(save, 'team', `${save.coach.name} is named head coach of the ${teamName(save.teams[teamId])}.`, true);
}
export { bumpFans, bumpOwner };
