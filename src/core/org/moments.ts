// Big moments: several times a season the game stops and hands you a real decision with real
// stakes. A star wants a new deal now, a rookie lights up practice, a rival comes for your
// coordinator, a player wants out, the rival's star talks trash, deadline day. And the drama:
// two starters fall out, a veteran goes to the press about his minutes, a night out makes the
// papers, a star wants to play hurt, your own star guarantees a win, a player you let go wants
// revenge, another club is said to want you, the owner shuts the office door.
import { HARD_LIMIT, MAX_CONTRACT_YEARS } from '../constants';
import { shortName } from '../gen/league';
import { askingContract } from '../gm/value';
import { executeTrade, deadlineOffers, validateTrade } from '../gm/trade';
import type { TradeOffer } from '../gm/trade';
import { fixLineup } from '../lineup';
import { clamp, ovr, round1 } from '../ratings';
import { Rng } from '../rng';
import { cal } from '../season/calendar';
import { userGame } from '../season/schedule';
import type { DraftPick, Player, Save } from '../types';
import { POSITIONS } from '../types';
import { pushNews, teamName } from './economy';
import { payroll } from './finance';
import { isUnlocked } from './progress';
import { isRivalGame } from './week';
import { atCeiling, grantXp } from './xp';

export type MomentKind = 'extension' | 'breakout' | 'poach' | 'demand' | 'trash' | 'deadline'
  | 'feud' | 'minutes' | 'nightout' | 'hurt' | 'refs' | 'vow' | 'revenge' | 'rumour' | 'ultimatum' | 'wantsout';
/** What one result of a game with something riding on it does. */
export interface StakeSide { credits?: number; fans?: number; owner?: number; morale?: number; text: string }
/** Something riding on one particular game of the user's. */
export interface Stakes { gameId: number; label: string; win: StakeSide; lose: StakeSide }
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
  data?: { salary?: number; years?: number; slot?: 'oc' | 'dc'; cost?: number; offers?: TradeOffer[]; gameId?: number; otherId?: number; teamId?: number };
}
interface MomentState { pending: BigMoment | null; year: number; count: number; done: string[]; heat?: number; stakes?: Stakes }
export function momentState(save: Save): MomentState {
  const s = save as Save & { moments?: MomentState };
  if (!s.moments || s.moments.year !== save.year) s.moments = { pending: s.moments?.pending ?? null, year: save.year, count: 0, done: s.moments?.year === save.year ? s.moments.done : [], heat: undefined, stakes: undefined };
  return s.moments;
}
export const pendingMoment = (save: Save): BigMoment | null => (save as Save & { moments?: MomentState }).moments?.pending ?? null;
/** The game this week's trash talk is about: rivalry stakes go up for it. */
export const heatedGame = (save: Save): number | undefined => (save as Save & { moments?: MomentState }).moments?.heat;

/** What is riding on this game, if a big moment put something on it. */
export const stakesFor = (save: Save, gameId: number): Stakes | null => {
  const s = (save as Save & { moments?: MomentState }).moments?.stakes;
  return s && s.gameId === gameId ? s : null;
};
/** The game has been played: pay out (or collect) what was riding on it. */
export function settleStakes(save: Save, gameId: number, won: boolean): { label: string; credits: number; text: string } | null {
  const s = stakesFor(save, gameId);
  if (!s) return null;
  const side = won ? s.win : s.lose;
  if (side.fans) save.fans = clamp(save.fans + side.fans, 0, 100);
  if (side.owner) save.owner.approval = clamp(save.owner.approval + side.owner, 0, 100);
  if (side.morale) for (const id of save.teams[save.userTeamId].roster) { const p = save.players[id]; if (p) p.morale = clamp(p.morale + side.morale, 0, 100); }
  momentState(save).stakes = undefined;
  return { label: s.label, credits: side.credits ?? 0, text: side.text };
}

/** Big moments in one season, at most. */
export const MOMENTS_PER_SEASON = 8;

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

// ---- the drama ---------------------------------------------------------------------------
const fitStarters = (save: Save): Player[] => save.teams[save.userTeamId].lineup.map(id => save.players[id]).filter(p => p && !p.injury);
const opponentOf = (save: Save) => { const g = userGame(save); return g ? { g, opp: save.teams[g.homeId === save.userTeamId ? g.awayId : g.homeId] } : null; };
const FIERY: Player['trait'][] = ['Hothead', 'Diva'];

function feud(save: Save): BigMoment | null {
  const five = fitStarters(save);
  if (five.length < 4) return null;
  // the one with the shortest fuse, and the best player who is not him
  const a = five.slice().sort((x, y) => (FIERY.includes(y.trait) ? 1 : 0) - (FIERY.includes(x.trait) ? 1 : 0) || x.morale - y.morale)[0];
  const b = five.filter(x => x.id !== a.id).sort((x, y) => ovr(y) - ovr(x))[0];
  if (!b || momentState(save).done.includes(`feud${a.id}`)) return null;
  return {
    kind: 'feud', tag: 'LOCKER ROOM', title: 'A FIGHT AT PRACTICE', playerId: a.id, data: { otherId: b.id },
    text: `${a.name} and ${b.name} had to be pulled apart at practice. It started over who takes the last shot. The whole room is waiting to see whose side you take.`,
    choices: [
      { label: `Back ${name(a)}`, effect: `${name(a)}: morale +8. ${name(b)}: morale -12.` },
      { label: `Back ${name(b)}`, effect: `${name(b)}: morale +8. ${name(a)}: morale -12.` },
      { label: 'Lock them in a room together', effect: 'A gamble. It clears the air (both +8, team +3) or it gets worse (both -8, team -2).' },
    ],
  };
}
function minutes(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const bench = me.roster.map(id => save.players[id]).filter(p => p && !p.injury && !me.lineup.includes(p.id) && p.age >= 26);
  const cand = bench.map(p => ({ p, starter: save.players[me.lineup[POSITIONS.indexOf(p.pos)]] }))
    .filter(x => x.starter && !x.starter.injury && ovr(x.p) >= ovr(x.starter) - 4).sort((x, y) => ovr(y.p) - ovr(x.p))[0];
  if (!cand || momentState(save).done.includes(`min${cand.p.id}`)) return null;
  const { p, starter } = cand;
  return {
    kind: 'minutes', tag: 'PLAYING TIME', title: `${name(p).toUpperCase()} GOES TO THE PRESS`, playerId: p.id, data: { otherId: starter.id },
    text: `"I did not come here to sit." ${p.name} has told a reporter he should be starting ahead of ${name(starter)}. It is the back page this morning.`,
    choices: [
      { label: 'Start him', effect: `He starts from now. Morale +10. ${name(starter)}: morale -8.` },
      { label: 'Tell him his time will come', effect: 'Morale -6. The rest of the room respects it: team morale +1.' },
      { label: 'Fine him for going public', effect: 'The club keeps 1 credit. Morale -10. Owner +2.' },
    ],
  };
}
function nightout(save: Save): BigMoment | null {
  const five = fitStarters(save).filter(p => p.trait !== 'Loyal' && p.trait !== 'Hard Worker');
  const wild: Player['trait'][] = ['Hothead', 'Diva', 'Lazy'];
  const p = five.slice().sort((x, y) => (wild.includes(y.trait) ? 1 : 0) - (wild.includes(x.trait) ? 1 : 0) || ovr(y) - ovr(x))[0];
  if (!p || !userGame(save) || momentState(save).done.includes(`night${p.id}`)) return null;
  return {
    kind: 'nightout', tag: 'HEADLINES', title: 'PHOTOGRAPHED AT 3 A.M.', playerId: p.id,
    text: `${p.name} was photographed leaving a club at three in the morning, two nights before a game. The picture is everywhere. ${save.owner.name} has already called.`,
    choices: [
      { label: 'Suspend him for a game', effect: 'He misses this week. Morale -8. The room approves: team +3, owner +4.' },
      { label: 'Fine him quietly', effect: 'The club keeps 2 credits. Morale -4.' },
      { label: 'Laugh it off', effect: 'Morale +5. Owner -4, fans -2.' },
    ],
  };
}
function hurt(save: Save): BigMoment | null {
  const p = fitStarters(save).sort((x, y) => ovr(y) - ovr(x))[0];
  const next = opponentOf(save);
  if (!p || !next || momentState(save).done.includes(`hurt${p.id}`)) return null;
  return {
    kind: 'hurt', tag: 'MEDICAL ROOM', title: `${name(p).toUpperCase()} WANTS TO PLAY HURT`, playerId: p.id,
    text: `${p.name} rolled his ankle in the walkthrough. The doctor wants him to sit out the ${next.opp.name} game. He says he is fine and he is not asking.`,
    choices: [
      { label: 'Rest him', effect: 'He misses this week and comes back fresh. Morale -3.' },
      { label: 'Let him play', effect: 'Morale +6, and he plays angry. But 1 time in 3 the ankle goes: out 3 weeks.' },
    ],
  };
}
function refs(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  if (me.record.streak >= 0 || momentState(save).done.includes(`refs${save.week}`) || momentState(save).done.filter(d => d.startsWith('refs')).length >= 2) return null;
  return {
    kind: 'refs', tag: 'PRESS ROOM', title: 'A LOADED QUESTION',
    text: 'After the loss a reporter asks what you made of the officiating. Your players are watching the press conference from the locker room.',
    choices: [
      { label: 'Rip the referees', effect: `The league fines you ${Math.min(2, save.credits)} credit${Math.min(2, save.credits) === 1 ? '' : 's'}. Your players love it: team morale +5, fans +3. Owner -2.` },
      { label: 'Take the blame yourself', effect: 'Team morale +3. Owner -1.' },
      { label: 'Question the effort', effect: 'Team morale -5. Owner +3.' },
    ],
  };
}
function vow(save: Save): BigMoment | null {
  const p = fitStarters(save).sort((x, y) => ovr(y) - ovr(x))[0];
  const next = opponentOf(save);
  if (!p || !next || momentState(save).stakes || momentState(save).done.includes(`vow${p.id}`)) return null;
  return {
    kind: 'vow', tag: 'ON CAMERA', title: `"WE WIN. WRITE IT DOWN."`, playerId: p.id, data: { gameId: next.g.id },
    text: `${p.name} has just guaranteed a win over the ${next.opp.name} on live television. Every phone in the building is ringing.`,
    choices: [
      { label: 'Stand next to him', effect: 'It rides on the game. Win: 2 credits, fans +4, team morale +6. Lose: fans -4, team morale -5.' },
      { label: 'Rein him in', effect: `${name(p)}: morale -7. Owner +2.` },
    ],
  };
}
function revenge(save: Save): BigMoment | null {
  const next = opponentOf(save);
  if (!next || momentState(save).stakes) return null;
  const me = save.userTeamId;
  const ex = next.opp.roster.map(id => save.players[id]).filter(p => p && !p.injury && ovr(p) >= 70 && p.seasons.some(s => s.teamId === me)).sort((x, y) => ovr(y) - ovr(x))[0];
  if (!ex || momentState(save).done.includes(`rev${ex.id}`)) return null;
  return {
    kind: 'revenge', tag: 'GRUDGE MATCH', title: `${name(ex).toUpperCase()} HAS IT CIRCLED`, playerId: ex.id, data: { gameId: next.g.id },
    text: `${ex.name} used to play for you. Now he is with the ${next.opp.name}, and he has told everyone he has had this game circled since the day he left.`,
    choices: [
      { label: 'Make it personal', effect: 'It rides on the game. Win: 2 credits, fans +4, team morale +4. Lose: fans -3, team morale -3.' },
      { label: 'Wish him well', effect: 'Reputation +1. Owner +1.' },
    ],
  };
}
function rumour(save: Save): BigMoment | null {
  if (save.coach.rep < 35 || momentState(save).done.includes('rumour')) return null;
  const me = save.teams[save.userTeamId];
  const suitor = save.teams.filter(t => t.id !== me.id).sort((x, y) => y.prestige - x.prestige)[0];
  if (!suitor) return null;
  return {
    kind: 'rumour', tag: 'RUMOURS', title: 'THEY WANT YOU', data: { teamId: suitor.id },
    text: `The papers say the ${teamName(suitor)} want you as their next coach. Nobody from that club has called. ${save.owner.name} has read every word.`,
    choices: [
      { label: 'Deny it flatly', effect: 'Owner +5, fans +2.' },
      { label: 'Say nothing', effect: 'Reputation +2. Owner -4.' },
      { label: 'Use it: ask for a bigger budget', effect: 'The club finds 5 credits. Owner -7.' },
    ],
  };
}
/** A star asks to be traded: because the team is losing, or because there are too many stars for one ball. */
function wantsout(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const played = me.record.w + me.record.l;
  if (played < 4) return null;
  const ps = me.roster.map(id => save.players[id]).filter(p => p && !p.injury && p.trait !== 'Loyal' && !save.tradeDemands.includes(p.id)).sort((x, y) => ovr(y) - ovr(x));
  const stars = ps.filter(p => ovr(p) >= 80);
  const losing = me.record.w / played < 0.4;
  // on a losing team the best player wants out; on a stacked one, the star who sees the ball least
  const p = losing ? ps.find(x => ovr(x) >= 76) : stars.length >= 3 ? stars[stars.length - 1] : undefined;
  if (!p || momentState(save).done.includes(`out${p.id}`)) return null;
  return {
    kind: 'wantsout', tag: 'TRADE REQUEST', title: `${name(p).toUpperCase()} ASKS FOR A TRADE`, playerId: p.id,
    text: losing
      ? `${p.name} did not sign up for this. His agent has told the club he wants to be traded to a team that can win, and he has told a reporter too.`
      : `There is one ball and ${stars.length} stars. ${p.name}'s agent says he wants a team of his own, and he wants it now.`,
    choices: [
      { label: losing ? 'Promise him it will turn around' : 'Promise him a bigger role', effect: 'He may give you the season (morale +8), or he may have heard it before and ask out anyway.' },
      { label: 'Shop him', effect: 'Opens the trade market for him. Teams know he wants out.' },
      { label: 'Remind him he has a contract', effect: 'Morale -12. His trade request stands, and he will not re-sign.' },
    ],
  };
}
function ultimatum(save: Save): BigMoment | null {
  const me = save.teams[save.userTeamId];
  const next = opponentOf(save);
  if (!next || momentState(save).stakes || momentState(save).done.includes('ult')) return null;
  if (save.owner.approval >= 40 && me.record.streak > -3) return null;
  return {
    kind: 'ultimatum', tag: 'THE OWNER', title: 'THE DOOR CLOSES', data: { gameId: next.g.id },
    text: `${save.owner.name} walks into your office and shuts the door. "I have been patient. Beat the ${next.opp.name}."`,
    choices: [
      { label: 'Promise a win', effect: 'It rides on the game. Win: owner +10. Lose: owner -10.' },
      { label: 'Ask for patience', effect: 'Owner -3. Your players hear you stood your ground: team morale +2.' },
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
  // an owner at the end of his patience does not wait his turn
  if (!m && save.week >= 3) m = ultimatum(save);
  if (!m && save.week >= 2 && rng.chance(0.55)) {
    const options = [trash, extension, breakout, poach, feud, minutes, nightout, hurt, refs, vow, revenge, rumour, wantsout].map(f => f(save)).filter((x): x is BigMoment => !!x);
    if (options.length) m = rng.pick(options);
  }
  if (!m) return;
  st.pending = m; st.count++;
}

// ---- answering them ----------------------------------------------------------------------
export interface MomentResult { text: string; good: boolean; goTo?: { route: string; params: Record<string, unknown> } }
const bump = (p: Player, v: number) => { p.morale = clamp(p.morale + v, 0, 100); };

export function resolveMoment(save: Save, idx: number, rng?: Rng): MomentResult | null {
  const st = momentState(save);
  const m = st.pending;
  if (!m) return null;
  const ch = m.choices[idx];
  if (!ch || ch.disabled) return null;
  const me = save.teams[save.userTeamId];
  const p = m.playerId !== undefined ? save.players[m.playerId] : undefined;
  let r: MomentResult = { text: '', good: true };
  // the gambles need dice: the store's when it is given, else a throw of our own
  const dice = rng ?? new Rng((save.rng ^ Math.imul(save.week + 1, 0x9e3779b1) ^ (st.count * 7919)) >>> 0);
  const all = (v: number) => { for (const id of me.roster) { const x = save.players[id]; if (x) bump(x, v); } };
  const other = m.data?.otherId !== undefined ? save.players[m.data.otherId] : undefined;
  const owner = (v: number) => { save.owner.approval = clamp(save.owner.approval + v, 0, 100); };
  const fans = (v: number) => { save.fans = clamp(save.fans + v, 0, 100); };
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
    case 'feud': {
      if (!p || !other) break;
      st.done.push(`feud${p.id}`);
      if (idx === 0) { bump(p, 8); bump(other, -12); r = { text: `${name(p)} nods. ${name(other)} does not look at you for the rest of the day.`, good: false }; }
      else if (idx === 1) { bump(other, 8); bump(p, -12); r = { text: `${name(other)} nods. ${name(p)} kicks a chair on his way out.`, good: false }; }
      else if (dice.chance(0.55)) { bump(p, 8); bump(other, 8); all(3); r = { text: `An hour later they come out laughing. Whatever was said in there, it worked.`, good: true }; pushNews(save, 'team', `${p.name} and ${other.name} have settled their differences, the ${me.name} say.`, true); }
      else { bump(p, -8); bump(other, -8); all(-2); r = { text: `You can hear the shouting from the car park. It is worse than before.`, good: false }; pushNews(save, 'team', `A rift in the ${me.name} locker room: ${p.name} and ${other.name} are not speaking.`, true); }
      break;
    }
    case 'minutes': {
      if (!p) break;
      st.done.push(`min${p.id}`);
      if (idx === 0) {
        const slot = POSITIONS.indexOf(p.pos);
        const was = save.players[me.lineup[slot]];
        me.lineup = me.lineup.map((id, i) => (i === slot ? p.id : id));
        fixLineup(save, me);
        bump(p, 10); if (was && was.id !== p.id) bump(was, -8);
        r = { text: `${name(p)} starts. ${was ? `${name(was)} takes it badly.` : ''}`, good: true };
      } else if (idx === 1) { bump(p, -6); all(1); r = { text: `${name(p)} hears you out. He does not agree.`, good: false }; }
      else { save.credits += 1; bump(p, -10); owner(2); r = { text: `The fine is paid. ${name(p)} has stopped talking to reporters, and to you.`, good: false }; }
      break;
    }
    case 'nightout': {
      if (!p) break;
      st.done.push(`night${p.id}`);
      if (idx === 0) {
        p.injury = { weeks: 1, desc: 'suspended' }; fixLineup(save, me);
        bump(p, -8); all(3); owner(4);
        pushNews(save, 'team', `The ${me.name} suspend ${p.name} for a game for breaking team rules.`, true);
        r = { text: `${name(p)} sits this week. The message has landed.`, good: true };
      } else if (idx === 1) { save.credits += 2; bump(p, -4); r = { text: `Handled in-house. ${name(p)} pays up.`, good: true }; }
      else { bump(p, 5); owner(-4); fans(-2); r = { text: `"He is a grown man." The owner is not amused.`, good: false }; }
      break;
    }
    case 'hurt': {
      if (!p) break;
      st.done.push(`hurt${p.id}`);
      if (idx === 0) { p.injury = { weeks: 1, desc: 'sore ankle' }; fixLineup(save, me); bump(p, -3); r = { text: `${name(p)} watches this one in a suit. He will be back next week.`, good: true }; }
      else if (dice.chance(2 / 3)) { bump(p, 6); (p as Player & { form?: number }).form = Math.max(1, (p as Player & { form?: number }).form ?? 0); r = { text: `He tapes it up and looks sharper than ever in warm-ups.`, good: true }; }
      else {
        p.injury = { weeks: 3, desc: 'sprained ankle' }; fixLineup(save, me);
        pushNews(save, 'team', `${p.name} aggravates an ankle injury and will miss three weeks.`, true);
        r = { text: `It goes in the warm-up. ${name(p)} is out for three weeks.`, good: false };
      }
      break;
    }
    case 'refs': {
      st.done.push(`refs${save.week}`);
      if (idx === 0) { const fine = Math.min(2, save.credits); save.credits -= fine; all(5); fans(3); owner(-2); r = { text: `The clip is everywhere. The fine arrives by lunchtime${fine ? `: ${fine} credit${fine === 1 ? '' : 's'}` : ''}.`, good: true }; }
      else if (idx === 1) { all(3); owner(-1); r = { text: 'Your players notice who took the bullet.', good: true }; }
      else { all(-5); owner(3); r = { text: 'The locker room goes very quiet.', good: false }; }
      break;
    }
    case 'vow': {
      if (!p) break;
      st.done.push(`vow${p.id}`);
      if (idx === 0) {
        st.stakes = { gameId: m.data!.gameId!, label: `${name(p)}'s guarantee`,
          win: { credits: 2, fans: 4, morale: 6, text: `${name(p)} guaranteed it and you delivered. Fans +4, team morale +6.` },
          lose: { fans: -4, morale: -5, text: `${name(p)} guaranteed a win and you lost. Fans -4, team morale -5.` } };
        r = { text: 'You stand next to him and say you believe every word.', good: true };
      } else { bump(p, -7); owner(2); r = { text: `${name(p)} walks the quote back through gritted teeth.`, good: false }; }
      break;
    }
    case 'revenge': {
      if (!p) break;
      st.done.push(`rev${p.id}`);
      if (idx === 0) {
        st.stakes = { gameId: m.data!.gameId!, label: `Grudge match: ${name(p)}`,
          win: { credits: 2, fans: 4, morale: 4, text: `You beat ${name(p)}'s new team. Fans +4, team morale +4.` },
          lose: { fans: -3, morale: -3, text: `${name(p)} got his revenge. Fans -3, team morale -3.` } };
        r = { text: 'His quote goes up on the locker-room wall.', good: true };
      } else { save.coach.rep = clamp(save.coach.rep + 1, 0, 100); owner(1); r = { text: 'You say he was a pro and you wish him well. Most people believe you.', good: true }; }
      break;
    }
    case 'rumour': {
      st.done.push('rumour');
      if (idx === 0) { owner(5); fans(2); r = { text: '"I am not going anywhere." The city exhales.', good: true }; }
      else if (idx === 1) { save.coach.rep = clamp(save.coach.rep + 2, 0, 100); owner(-4); r = { text: 'Your silence says plenty. Your stock around the league goes up.', good: false }; }
      else { save.credits += 5; owner(-7); r = { text: `${save.owner.name} signs the cheque without looking at you.`, good: true }; }
      break;
    }
    case 'wantsout': {
      if (!p) break;
      // the request has had its moment: it does not come back as a second one
      st.done.push(`out${p.id}`, `dem${p.id}`);
      const ask = () => { if (!save.tradeDemands.includes(p.id)) save.tradeDemands.push(p.id); pushNews(save, 'team', `${p.name} has asked the ${me.name} for a trade.`, true); };
      if (idx === 0) {
        if (dice.chance(0.6)) { bump(p, 8); r = { text: `${name(p)} looks at you for a long time. "Until the end of the season."`, good: true }; }
        else { bump(p, -4); ask(); r = { text: `"I have heard that before." ${name(p)}'s trade request stands.`, good: false }; }
      } else if (idx === 1) { ask(); r = { text: 'The market is open, and every club knows why.', good: false, goTo: { route: 'trades', params: { tab: 'Shop', playerId: p.id } } }; }
      else { bump(p, -12); ask(); for (const id of me.roster) if (id !== p.id) bump(save.players[id], -1); r = { text: `${name(p)} walks out without a word. He will play, but he will not stay.`, good: false }; }
      break;
    }
    case 'ultimatum': {
      st.done.push('ult');
      if (idx === 0) {
        st.stakes = { gameId: m.data!.gameId!, label: 'Your promise to the owner',
          win: { owner: 10, text: `You promised ${save.owner.name} a win and got it. Owner +10.` },
          lose: { owner: -10, text: `You promised ${save.owner.name} a win and lost. Owner -10.` } };
        r = { text: `"Good." ${save.owner.name} leaves the door open on the way out.`, good: true };
      } else { owner(-3); all(2); r = { text: 'A long silence. Then the door opens again.', good: false }; }
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
