// Morale, owner and fans, weekly events, injuries, progression, getting fired.
import { fixLineup } from '../lineup';
import { clamp, ovr, overallOf } from '../ratings';
import type { Rng } from '../rng';
import type { BoxLine, Effect, EventChoice, EventTemplate, OwnerGoal, Player, RatingKey, Save, Team } from '../types';
import { RATING_KEYS } from '../types';
import { EVENTS } from '../../data/events';
import { INJURIES } from '../../data/names';
import { teamStrength } from '../gm/value';
import { effLevel, headline, pushNews, teamName } from './economy';
import { payroll } from './finance';
import { HARD_LIMIT } from '../constants';
import { shortName } from '../gen/league';
import { perk } from './progress';

const bump = (save: Save, k: 'fans', v: number) => { save[k] = clamp(save[k] + v, 0, 100); };
export const bumpOwner = (save: Save, v: number): void => { save.owner.approval = clamp(save.owner.approval + v, 0, 100); };
export const bumpFans = (save: Save, v: number): void => bump(save, 'fans', v);
export const bumpRep = (save: Save, v: number): void => { save.coach.rep = clamp(save.coach.rep + v, 0, 100); };
const bumpMorale = (p: Player, v: number) => { p.morale = clamp(p.morale + v, 0, 100); };

// ---- after a user game ---------------------------------------------------------------
export function afterUserGame(save: Save, won: boolean, margin: number, playoff: boolean, scale = 1): void {
  const team = save.teams[save.userTeamId];
  const streak = team.record.streak;
  const arena = effLevel(team.facilities.arena);
  bumpOwner(save, scale * (won ? (playoff ? 5 : 2) : (-3 - (streak <= -3 ? 2 : 0)) * (1 - 0.2 * perk(save, 'trust'))));
  bumpFans(save, scale * (won ? 2 + (arena >= 3 ? 1 : 0) + (margin <= 3 ? 1 : 0) : -2 - (streak <= -3 ? 1 : 0)));
  bumpRep(save, scale * (won ? (playoff ? 2 : 0.6) : -0.3));
  if (!won && payroll(save, team) > HARD_LIMIT - 6 && team.record.w < team.record.l) bumpOwner(save, -1 * scale); // paying a lot to lose
  // morale
  const captain = save.captainId !== null ? save.players[save.captainId] : null;
  const capBoost = captain && team.roster.includes(captain.id) ? (captain.trait === 'Leader' ? 2 : 1) : 0;
  const fanMood = save.fans >= 70 ? 1 : save.fans <= 30 ? -1 : 0;
  const starters = new Set(team.lineup);
  for (const id of team.roster) {
    const p = save.players[id];
    let d = (won ? 2 : perk(save, 'locker') ? -1 : -2) + fanMood;
    if (!won) d += capBoost; // a captain softens losses
    if (starters.has(id)) d += 1;
    else {
      // bench: good players resent it
      const starterAtPos = team.lineup.map(sid => save.players[sid]).find(s => s.pos === p.pos);
      if (starterAtPos && ovr(p) >= ovr(starterAtPos) - 2) d -= p.trait === 'Diva' ? 4 : 2;
      if (p.trait === 'Diva') d -= 1;
      if (p.trait === 'Quiet Pro' || p.trait === 'Loyal') d += 1;
    }
    if (p.trait === 'Hothead' && !won) d -= 1;
    if (p.contract.years <= 1 && ovr(p) >= 75) d -= 0.5; // wants an extension
    // drift toward 60
    d += (60 - p.morale) * 0.04;
    bumpMorale(p, d * scale);
    if (p.morale < 22 && ovr(p) >= 72 && !save.tradeDemands.includes(id) && p.trait !== 'Loyal') {
      save.tradeDemands.push(id);
      pushNews(save, 'team', `${p.name} is unhappy and has asked for a trade.`, true);
    }
  }
}
export const teamMorale = (save: Save, team: Team): number =>
  Math.round(team.roster.reduce((s, id) => s + save.players[id].morale, 0) / Math.max(1, team.roster.length));

// ---- owner goals ---------------------------------------------------------------------
export function setOwnerGoals(save: Save): void {
  const me = save.teams[save.userTeamId];
  const ranked = save.teams.slice().sort((a, b) => teamStrength(save, b) - teamStrength(save, a));
  const rank = ranked.indexOf(me); // 0 = strongest
  const g14 = (save.calendar?.games ?? 14) / 14;
  const goals: OwnerGoal[] = [];
  if (rank < 3) goals.push({ kind: 'finals', text: 'Reach the championship game' });
  else if (rank < 6) goals.push({ kind: 'semis', text: 'Win a playoff game' });
  else if (rank < 10) goals.push({ kind: 'playoffs', text: 'Make the playoffs' });
  else if (rank < 13) goals.push({ kind: 'wins', target: Math.round(6 * g14), text: `Win ${Math.round(6 * g14)} games` });
  else goals.push({ kind: 'wins', target: Math.round(4 * g14), text: `Win ${Math.round(4 * g14)} games` });
  const w = Math.round(clamp(11 - Math.floor(rank * 0.55), 4, 11) * g14);
  if (goals[0].kind !== 'wins') goals.push({ kind: 'wins', target: w, text: `Win ${w} games` });
  else goals.push({ kind: 'develop', text: 'Start a player aged 23 or younger' });
  save.owner.goals = goals;
}
/** Season end: mark goals met or missed and move approval. Returns lines for the summary. */
export function evaluateGoals(save: Save): string[] {
  const me = save.teams[save.userTeamId];
  const last = me.history[me.history.length - 1];
  const out: string[] = [];
  for (const g of save.owner.goals) {
    let ok = false;
    if (g.kind === 'wins') ok = me.record.w >= (g.target ?? 0);
    else if (g.kind === 'playoffs') ok = last.playoff !== 'none';
    else if (g.kind === 'semis') ok = last.playoff === 'SF' || last.playoff === 'F' || last.playoff === 'champ';
    else if (g.kind === 'finals') ok = last.playoff === 'F' || last.playoff === 'champ';
    else if (g.kind === 'title') ok = last.playoff === 'champ';
    else if (g.kind === 'develop') ok = me.lineup.some(id => save.players[id].age <= 23);
    g.done = ok; g.failed = !ok;
    bumpOwner(save, ok ? 12 : -14);
    out.push(`${ok ? 'MET' : 'MISSED'}: ${g.text}`);
  }
  if (last.playoff === 'champ') { bumpOwner(save, 25); bumpFans(save, 20); }
  return out;
}

// ---- getting fired -------------------------------------------------------------------
export function checkFired(save: Save): boolean {
  if (save.owner.approval > 0 || save.fired) return !!save.fired;
  // nobody is sacked in his first season at a club: the owner knew what he was handing over
  const stop = save.coach.stops[save.coach.stops.length - 1];
  if (stop && stop.from === save.year) { save.owner.approval = 6; return false; }
  const worst = save.teams.filter(t => t.id !== save.userTeamId)
    .sort((a, b) => teamStrength(save, a) - teamStrength(save, b)).slice(0, 3).map(t => t.id);
  save.fired = { offers: worst };
  pushNews(save, 'owner', `${teamName(save.teams[save.userTeamId])} fire head coach ${save.coach.name}.`, true);
  return true;
}
/** Take over another team (after being fired, or accepting an offseason offer). */
export function takeJob(save: Save, teamId: number, firedFromLast: boolean): void {
  const c = save.coach;
  const stop = c.stops[c.stops.length - 1];
  if (stop && stop.to === null) stop.to = save.year;
  c.stops.push({ teamId, from: save.year, to: null, w: 0, l: 0, titles: 0 });
  if (firedFromLast) { c.fired++; c.rep = clamp(c.rep - 8, 0, 100); }
  save.userTeamId = teamId;
  save.fired = null;
  save.owner.approval = 55;
  save.fans = clamp(35 + save.teams[teamId].prestige * 0.3, 20, 70);
  save.captainId = null;
  save.tradeDemands = [];
  save.tradeOffer = null;
  save.pendingEvent = null;
  save.records = {};
  if (firedFromLast) save.credits = Math.min(save.credits, 6);
  setOwnerGoals(save);
  pushNews(save, 'team', `${c.name} takes over as head coach of the ${teamName(save.teams[teamId])}.`, true);
}

// ---- weekly events -------------------------------------------------------------------
function subjectFor(save: Save, t: EventTemplate, rng: Rng): Player | null | undefined {
  if (t.subject === 'none') return null;
  const team = save.teams[save.userTeamId];
  const ps = team.roster.map(id => save.players[id]).filter(p => !p.injury);
  const byOvr = ps.slice().sort((a, b) => ovr(b) - ovr(a));
  const starters = new Set(team.lineup);
  let pool: Player[] = [];
  switch (t.subject) {
    case 'star': pool = byOvr.slice(0, 2); break;
    case 'rookie': pool = ps.filter(p => p.age <= 22 || p.seasons.length === 0); break;
    case 'benched': pool = ps.filter(p => !starters.has(p.id)); break;
    case 'captain': pool = ps.filter(p => p.id === save.captainId); break;
    case 'unhappy': pool = ps.filter(p => p.morale < 45); break;
    case 'veteran': pool = ps.filter(p => p.age >= 30); break;
    default: pool = ps;
  }
  if (t.traits) pool = pool.filter(p => t.traits!.includes(p.trait));
  return pool.length ? rng.pick(pool) : undefined;
}
export function rollEvent(save: Save, rng: Rng): void {
  if (save.pendingEvent || !rng.chance(0.55)) return;
  const opts = rng.shuffle(EVENTS.filter(e => !save.seenEvents.includes(e.id)));
  for (const t of opts) {
    const subj = subjectFor(save, t, rng);
    if (subj === undefined) continue;
    const others = save.teams.filter(x => x.id !== save.userTeamId);
    save.pendingEvent = { templateId: t.id, playerId: subj ? subj.id : null, oppId: rng.pick(others).id };
    save.seenEvents.push(t.id);
    return;
  }
}
export function eventText(save: Save, text: string): string {
  const ev = save.pendingEvent;
  const team = save.teams[save.userTeamId];
  const tokens: Record<string, string> = {
    player: ev?.playerId != null ? save.players[ev.playerId].name : 'a player',
    team: team.name, city: team.city, coach: save.coach.name, owner: save.owner.name,
    opp: ev?.oppId != null ? save.teams[ev.oppId].name : 'the opposition',
  };
  return text.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? '');
}
export const currentEvent = (save: Save): EventTemplate | null =>
  save.pendingEvent ? EVENTS.find(e => e.id === save.pendingEvent!.templateId) ?? null : null;

export interface EventOutcome { result: string; effects: Effect[] }
export function resolveEvent(save: Save, choiceIdx: number): EventOutcome | null {
  const ev = save.pendingEvent, t = currentEvent(save);
  if (!ev || !t) { save.pendingEvent = null; return null; }
  const choice: EventChoice = t.choices[choiceIdx];
  const p = ev.playerId != null ? save.players[ev.playerId] : null;
  const alt = p && choice.byTrait ? choice.byTrait[p.trait] : undefined;
  const result = eventText(save, alt ? alt.result : choice.result);
  const effects = (alt ? alt.effects : choice.effects).filter(e => e.k === 'tradeDemand' || e.v !== 0);
  const team = save.teams[save.userTeamId];
  for (const e of effects) {
    switch (e.k) {
      case 'morale': if (p) bumpMorale(p, e.v); break;
      case 'teamMorale': for (const id of team.roster) bumpMorale(save.players[id], e.v); break;
      case 'fans': bumpFans(save, e.v); break;
      case 'owner': bumpOwner(save, e.v); break;
      case 'credits': save.credits = Math.max(0, save.credits + e.v); break;
      case 'rep': bumpRep(save, e.v); break;
      case 'injury': if (p) { p.injury = { weeks: e.v, desc: 'minor knock' }; fixLineup(save, team); } break;
      case 'suspend': if (p) { p.injury = { weeks: e.v, desc: 'suspended' }; fixLineup(save, team); } break;
      case 'tradeDemand': if (p && !save.tradeDemands.includes(p.id)) save.tradeDemands.push(p.id); break;
    }
  }
  save.pendingEvent = null;
  return { result, effects };
}

// ---- injuries ------------------------------------------------------------------------
export function rollInjuries(save: Save, team: Team, lines: BoxLine[], rng: Rng): void {
  const med = effLevel(team.facilities.medical);
  for (const l of lines) {
    if (l.min <= 0) continue;
    const p = save.players[l.playerId];
    if (!p || p.injury) continue;
    const ageK = p.age >= 32 ? 1.4 : 1;
    if (!rng.chance((save.calendar && save.calendar.games > 20 ? 0.005 : 0.011) * (l.min / 40) * (1.25 - 0.17 * med) * ageK)) continue;
    const inj = rng.pick(INJURIES);
    const weeks = Math.max(1, Math.round(rng.int(inj.min, inj.max) * (1.1 - 0.1 * med)));
    p.injury = { weeks, desc: inj.desc, fresh: true };
    const mine = team.id === save.userTeamId;
    if (mine || ovr(p) >= 80) pushNews(save, 'injury', headline(rng, 'injury', { player: p.name, team: team.name, desc: inj.desc, weeks }), mine);
  }
  fixLineup(save, team);
}
export function healWeek(save: Save, rng: Rng): void {
  for (const id of save.freeAgents) { const p = save.players[id]; if (p?.injury && --p.injury.weeks <= 0) p.injury = null; }
  for (const team of save.teams) {
    for (const id of team.roster) {
      const p = save.players[id];
      if (!p.injury) continue;
      if (p.injury.fresh) { delete p.injury.fresh; continue; }
      p.injury.weeks--;
      if (p.injury.weeks <= 0) {
        p.injury = null;
        if (team.id === save.userTeamId) pushNews(save, 'injury', headline(rng, 'returnInjury', { player: shortName(p.name), team: team.name }), true);
      }
    }
  }
}

// ---- progression ---------------------------------------------------------------------
const ATHLETIC: RatingKey[] = ['spd', 'fin', 'def'];
/** One offseason of growth or decline. `minShare` = share of team minutes he played (0-1 of a full starter). */
export function progressPlayer(p: Player, rng: Rng, training: number, minShare: number): number {
  const before = overallOf(p.ratings, p.pos);
  const a = p.age;
  let mean = a <= 21 ? 2.6 : a <= 23 ? 1.8 : a <= 25 ? 0.9 : a <= 28 ? 0 : a <= 30 ? -0.8 : a <= 32 ? -1.7 : a <= 34 ? -2.8 : -4;
  const room = p.potential - before;
  if (mean > 0) mean *= clamp(room / 9, 0.1, 1.4);
  mean += (training - 3) * (a <= 26 ? 0.35 : 0.2);
  mean += (minShare - 0.55) * (a <= 25 ? 1.4 : 0.4);
  if (p.trait === 'Hard Worker') mean += 0.8;
  if (p.trait === 'Lazy') mean -= 0.8;
  const delta = mean + rng.gauss() * 1.4;
  const was = { ...p.ratings };
  for (const k of RATING_KEYS) {
    let d = delta + rng.gauss() * 1.6;
    if (delta < 0 && ATHLETIC.includes(k)) d *= 1.5;
    if (delta < 0 && (k === 'sht' || k === 'pas')) d *= 0.45;
    p.ratings[k] = clamp(Math.round(p.ratings[k] + d), 15, 99);
  }
  // the ceiling is physical: a good summer takes him up to it, never through it
  const cap = Math.max(p.potential, before);
  for (let i = 0; i < 400 && overallOf(p.ratings, p.pos) > cap; i++) {
    const grown = RATING_KEYS.filter(k => p.ratings[k] > was[k]);
    if (!grown.length) break;
    const k = grown.reduce((a, b) => (p.ratings[b] - was[b] > p.ratings[a] - was[a] ? b : a));
    p.ratings[k]--;
  }
  const after = overallOf(p.ratings, p.pos);
  // and it comes down with age: past thirty he can train back a little of what he has lost, not all of it
  if (a >= 30) p.potential = clamp(p.potential, after, after + 2);
  return after - before;
}
