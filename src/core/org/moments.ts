// Big moments: a few times a season the game stops and hands you a real decision with real
// stakes. A star wants a new deal now, a rookie lights up practice, a rival comes for your
// coordinator, a player wants out, the rival's star talks trash, deadline day.
import { HARD_LIMIT, MAX_CONTRACT_YEARS } from '../constants';
import { shortName } from '../gen/league';
import { askingContract } from '../gm/value';
import { executeTrade, deadlineOffers, validateTrade } from '../gm/trade';
import type { TradeOffer } from '../gm/trade';
import { fixLineup } from '../lineup';
import { clamp, ovr, round1 } from '../ratings';
import type { Rng } from '../rng';
import { cal } from '../season/calendar';
import { userGame } from '../season/schedule';
import type { DraftPick, Player, Save } from '../types';
import { POSITIONS } from '../types';
import { pushNews, teamName } from './economy';
import { payroll } from './finance';
import { isUnlocked } from './progress';
import { isRivalGame } from './week';
import { atCeiling, grantXp } from './xp';

export type MomentKind = 'extension' | 'breakout' | 'poach' | 'demand' | 'trash' | 'deadline';
export interface MomentChoice { label: string; effect: string; disabled?: string }
export interface BigMoment {
  kind: MomentKind;
  title: string;
  /** Small line above the title, e.g. "CONTRACT" */
  tag: string;
  text: string;
  playerId?: number;
  choices: MomentChoice[];
  /** Data for resolving the choice. */
  data?: { salary?: number; years?: number; slot?: 'oc' | 'dc'; cost?: number; offers?: TradeOffer[]; gameId?: number };
}
interface MomentState { pending: BigMoment | null; year: number; count: number; done: string[]; heat?: number }
export function momentState(save: Save): MomentState {
  const s = save as Save & { moments?: MomentState };
  if (!s.moments || s.moments.year !== save.year) s.moments = { pending: s.moments?.pending ?? null, year: save.year, count: 0, done: s.moments?.year === save.year ? s.moments.done : [], heat: undefined };
  return s.moments;
}
export const pendingMoment = (save: Save): BigMoment | null => (save as Save & { moments?: MomentState }).moments?.pending ?? null;
/** The game this week's trash talk is about: rivalry stakes go up for it. */
export const heatedGame = (save: Save): number | undefined => (save as Save & { moments?: MomentState }).moments?.heat;

/** Big moments in one season, at most. */
export const MOMENTS_PER_SEASON = 5;

const name = (p: Player) => shortName(p.name);
const pickWords = (pk: DraftPick, save: Save) => `${pk.round === 1 ? '1st' : '2nd'}-round pick, Season ${pk.year}${pk.origTeamId !== save.userTeamId ? ` (${save.teams[pk.origTeamId].abbr})` : ''}`;
/** What a deadline offer gives the user, in a few words. */
export function offerWords(save: Save, o: TradeOffer): string {
  const bits = [...o.aGives.players.map(id => { const p = save.players[id]; return `${p.pos} ${p.name} (${ovr(p)})`; }), ...o.aGives.picks.map(pk => pickWords(pk, save))];
  return bits.join(' + ') || 'nothing';
}

// ---- building the moments ----------------------------------------------------------------
function extension(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const p = me.roster.map(id => save.players[id]).filter(x => x.contract.years <= 1 && ovr(x) >= 74 && !x.injury).sort((a, b) => ovr(b) - ovr(a))[0];
  if (!p || momentState(save).done.includes(`ext${p.id}`)) return null;
  const ask = askingContract(save, p, me.id);
  if (ask.refuses) return null;
  // signing early buys a small discount
  const salary = round1(ask.salary * 0.93), years = Math.min(MAX_CONTRACT_YEARS, Math.max(2, ask.years));
  const room = HARD_LIMIT - (payroll(save, me) - p.contract.salary);
  return {
    kind: 'extension', tag: 'CONTRACT', title: `${name(p).toUpperCase()} WANTS A NEW DEAL`, playerId: p.id,
    text: `His contract runs out this summer. His agent says he will sign today for $${salary}M a season over ${years} years. Wait, and he goes into the summer with every other team calling.`,
    data: { salary, years },
    choices: [
      { label: `Sign him: $${salary}M x ${years}`, effect: 'He is yours. Morale +10. His new salary starts now.', disabled: salary > room ? 'Not enough room under the hard limit.' : undefined },
      { label: 'Wait until the summer', effect: 'Morale -8. You can still re-sign him later, probably for more.' },
      { label: 'See what he would fetch in a trade', effect: 'Morale -4. Opens the trade market for him.' },
    ],
  };
}
function breakout(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const p = me.roster.map(id => save.players[id]).filter(x => !me.lineup.includes(x.id) && x.age <= 23 && !x.injury && !atCeiling(x)).sort((a, b) => b.potential - a.potential)[0];
  if (!p || momentState(save).done.includes(`brk${p.id}`)) return null;
  const starter = save.players[me.lineup[POSITIONS.indexOf(p.pos)]];
  return {
    kind: 'breakout', tag: 'PRACTICE', title: `${name(p).toUpperCase()} IS ON A HEATER`, playerId: p.id,
    text: `The ${p.age}-year-old ${p.pos} has been the best player in practice all week. ${starter ? `${name(starter)} has noticed.` : ''} Everyone is waiting to see what you do.`,
    choices: [
      { label: 'Start him this week', effect: `He starts and comes in hot. Morale +10.${starter ? ` ${name(starter)}: morale -6.` : ''}` },
      { label: 'Give him extra reps', effect: 'He gains 45 XP. Morale +4.' },
      { label: 'Tell him to be patient', effect: 'Morale -6. The veterans like it: team morale +2.' },
    ],
  };
}
function poach(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const slot = (['oc', 'dc'] as const).find(k => (me.staff[k]?.stars ?? 0) >= 3);
  if (!slot) return null;
  const s = me.staff[slot]!;
  if (momentState(save).done.includes(`poach${s.id}`)) return null;
  const cost = s.stars * 2;
  const role = slot === 'oc' ? 'offensive' : 'defensive';
  return {
    kind: 'poach', tag: 'STAFF', title: 'THEY WANT YOUR COORDINATOR',
    text: `Another club has offered ${s.name}, your ${s.stars}-star ${role} coordinator, a promotion. He would rather stay, if you make it worth his while.`,
    data: { slot, cost },
    choices: [
      { label: `Pay him to stay (◉ ${cost})`, effect: 'He stays. Your reputation +2.', disabled: save.credits < cost ? `Needs ${cost} credits.` : undefined },
      { label: 'Let him go', effect: 'He leaves today. The other club pays you 3 credits.' },
    ],
  };
}
function demand(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const id = save.tradeDemands.find(x => me.roster.includes(x) && !momentState(save).done.includes(`dem${x}`));
  if (id === undefined) return null;
  const p = save.players[id];
  const starting = me.lineup.includes(id);
  return {
    kind: 'demand', tag: 'LOCKER ROOM', title: `${name(p).toUpperCase()} WANTS OUT`, playerId: id,
    text: `${p.name} has asked for a trade, and the reporters know. ${starting ? 'He says the team is going nowhere.' : 'He says he deserves to start.'}`,
    choices: [
      { label: starting ? 'Promise him the team will win' : 'Promise him a starting spot', effect: `Morale +15 and he takes it back.${starting ? '' : ' He starts from now.'} If he sours again, he will not listen twice.` },
      { label: 'Shop him', effect: 'Opens the trade market for him. Teams know he wants out.' },
      { label: 'Tell him no', effect: 'Morale -5. He stays unhappy, and it may spread.' },
    ],
  };
}
function trash(save: Save): BigMoment | null {
  const g = userGame(save);
  if (!g || !isRivalGame(save, g)) return null;
  const me = save.teams[save.userTeamId];
  const opp = save.teams[g.homeId === me.id ? g.awayId : g.homeId];
  if (momentState(save).done.includes(`trash${g.id}`)) return null;
  const star = opp.roster.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a))[0];
  return {
    kind: 'trash', tag: 'RIVALRY', title: 'TRASH TALK', data: { gameId: g.id },
    text: `${star ? star.name : 'Their star'} of the ${opp.name} says your team is "a practice squad with jerseys". The press wants your answer before this week's game.`,
    choices: [
      { label: 'Fire back', effect: 'The rivalry game is worth double: win and it pays 4 credits and fans +6. Lose and fans -5.' },
      { label: 'Let the game do the talking', effect: 'Owner +2, team morale +2.' },
    ],
  };
}
function deadline(save: Save, rng: Rng): BigMoment | null {
  if (!isUnlocked(save, 'trades')) return null;
  const offers = deadlineOffers(save, rng, 3);
  if (!offers.length) return null;
  return {
    kind: 'deadline', tag: 'TRADE DEADLINE', title: 'DEADLINE DAY', data: { offers },
    text: `The phones have not stopped. This is the last week to trade before the offseason. ${offers.length} club${offers.length === 1 ? ' has' : 's have'} made a firm offer.`,
    choices: [
      ...offers.map(o => {
        const out = o.bGives.players.map(id => { const p = save.players[id]; return `${p.pos} ${p.name} (${ovr(p)})`; }).join(' + ');
        return { label: `Trade ${out} to the ${save.teams[o.aId].name}`, effect: `You get ${offerWords(save, o)}.` };
      }),
      { label: 'Stand pat', effect: 'Keep the team you have.' },
    ],
  };
}

/** Week end: maybe stop the player with a big moment. Call after the week has moved on. */
export function rollMoment(save: Save, rng: Rng): void {
  if (save.phase !== 'regular' || save.fired) return;
  const st = momentState(save);
  if (st.pending || st.count >= MOMENTS_PER_SEASON) return;
  const c = cal(save);
  let m: BigMoment | null = null;
  // a player who wants out always gets his moment
  m = demand(save);
  if (!m && save.week === c.deadlineWeek) m = deadline(save, rng);
  if (!m && save.week >= 3 && rng.chance(0.45)) {
    const options = [trash, extension, breakout, poach].map(f => f(save)).filter((x): x is BigMoment => !!x);
    if (options.length) m = rng.pick(options);
  }
  if (!m) return;
  st.pending = m; st.count++;
}

// ---- answering them ----------------------------------------------------------------------
export interface MomentResult { text: string; good: boolean; goTo?: { route: string; params: Record<string, unknown> } }
const bump = (p: Player, v: number) => { p.morale = clamp(p.morale + v, 0, 100); };

export function resolveMoment(save: Save, idx: number): MomentResult | null {
  const st = momentState(save);
  const m = st.pending;
  if (!m) return null;
  const ch = m.choices[idx];
  if (!ch || ch.disabled) return null;
  const me = save.teams[save.userTeamId];
  const p = m.playerId !== undefined ? save.players[m.playerId] : undefined;
  let r: MomentResult = { text: '', good: true };
  switch (m.kind) {
    case 'extension': {
      if (!p) break;
      st.done.push(`ext${p.id}`);
      if (idx === 0) {
        p.contract = { salary: m.data!.salary!, years: m.data!.years! + 1 };
        bump(p, 10);
        pushNews(save, 'signing', `${p.name} signs an extension with the ${teamName(me)}: $${m.data!.salary}M a season for ${m.data!.years} more years.`, true);
        r = { text: `Done. ${name(p)} is a ${me.name} for years to come.`, good: true };
      } else if (idx === 1) { bump(p, -8); r = { text: `${name(p)} shrugs. "We will see in the summer."`, good: false }; }
      else { bump(p, -4); r = { text: `Word gets out that ${name(p)} is available.`, good: false, goTo: { route: 'trades', params: { tab: 'Shop', playerId: p.id } } }; }
      break;
    }
    case 'breakout': {
      if (!p) break;
      st.done.push(`brk${p.id}`);
      if (idx === 0) {
        const slot = POSITIONS.indexOf(p.pos);
        const was = save.players[me.lineup[slot]];
        me.lineup = me.lineup.map((id, i) => (i === slot ? p.id : id === p.id ? (was?.id ?? id) : id));
        fixLineup(save, me);
        (p as Player & { form?: number }).form = Math.max(1, (p as Player & { form?: number }).form ?? 0);
        bump(p, 10); if (was) bump(was, -6);
        r = { text: `${name(p)} starts this week, and he is hot.`, good: true };
      } else if (idx === 1) { grantXp(save, p, 45); bump(p, 4); r = { text: `${name(p)} stays late every night.`, good: true }; }
      else { bump(p, -6); for (const id of me.roster) if (id !== p.id) bump(save.players[id], 2); r = { text: 'The veterans nod. The kid sulks.', good: false }; }
      break;
    }
    case 'poach': {
      const slot = m.data!.slot!, s = me.staff[slot];
      if (s) st.done.push(`poach${s.id}`);
      if (idx === 0) {
        if (save.credits < m.data!.cost!) return null;
        save.credits -= m.data!.cost!; save.coach.rep = clamp(save.coach.rep + 2, 0, 100);
        r = { text: `${s?.name ?? 'He'} stays. The league notices you look after your people.`, good: true };
      } else {
        me.staff[slot] = null; save.credits += 3;
        if (s) pushNews(save, 'staff', `${s.name} leaves the ${teamName(me)} for a promotion elsewhere.`, true);
        r = { text: `${s?.name ?? 'He'} is gone. The ${slot === 'oc' ? 'offensive' : 'defensive'} coordinator's chair is empty: hire someone in Staff.`, good: false, goTo: { route: 'staff', params: {} } };
      }
      break;
    }
    case 'demand': {
      if (!p) break;
      st.done.push(`dem${p.id}`);
      if (idx === 0) {
        save.tradeDemands = save.tradeDemands.filter(x => x !== p.id);
        bump(p, 15);
        if (!me.lineup.includes(p.id)) { const slot = POSITIONS.indexOf(p.pos); me.lineup[slot] = p.id; fixLineup(save, me); }
        r = { text: `${name(p)} takes back his request. For now.`, good: true };
      } else if (idx === 1) r = { text: 'The market is open.', good: false, goTo: { route: 'trades', params: { tab: 'Shop', playerId: p.id } } };
      else { bump(p, -5); for (const id of me.roster) if (id !== p.id) bump(save.players[id], -1); r = { text: `${name(p)} storms out. The room is tense.`, good: false }; }
      break;
    }
    case 'trash': {
      st.done.push(`trash${m.data!.gameId}`);
      if (idx === 0) { st.heat = m.data!.gameId; r = { text: 'The quote is on every back page. You had better win.', good: true }; }
      else { save.owner.approval = clamp(save.owner.approval + 2, 0, 100); for (const id of me.roster) bump(save.players[id], 2); r = { text: 'Classy. The owner likes it, and so does the room.', good: true }; }
      break;
    }
    case 'deadline': {
      const o = m.data!.offers?.[idx];
      if (o) {
        const err = validateTrade(save, o);
        if (err) { r = { text: `That deal fell through: ${err}`, good: false }; break; }
        const gets = offerWords(save, o);
        executeTrade(save, o);
        r = { text: `Done: you get ${gets}.`, good: true, goTo: { route: 'roster', params: {} } };
      } else r = { text: 'You keep your team together for the run.', good: true };
      break;
    }
  }
  st.pending = null;
  return r;
}
