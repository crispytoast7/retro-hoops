// The week between games: one plan to choose, an edge to carry into the next game, player
// form that runs hot and cold, rivalries, what is at stake, and the season's sponsor deal.
import { MIN_SALARY } from '../constants';
import { genPlayer, shortName } from '../gen/league';
import { marketSalary } from '../gm/value';
import { fixLineup } from '../lineup';
import { clamp, gameScore, ovr } from '../ratings';
import { Rng } from '../rng';
import { cal } from '../season/calendar';
import { standings, userGame } from '../season/schedule';
import type { BoxLine, GameResult, Player, RatingKey, Save, ScheduledGame, Team } from '../types';
import { POSITIONS, RATING_KEYS } from '../types';
import { careerGames, isUnlocked, prog } from './progress';
import { atCeiling, grantXp } from './xp';

// ---- storage ---------------------------------------------------------------------------
export type PlanGroup = 'train' | 'prep' | 'club';
export interface Plan {
  id: string;
  group: PlanGroup;
  title: string;
  /** What it does, in a few words. */
  effect: string;
  playerId?: number;
  otherId?: number;
  key?: RatingKey;
}
export type EdgeKind = 'film' | 'shoot' | 'walk' | 'guarantee' | 'promo';
export interface Edge { kind: EdgeKind; label: string }
export type SponsorKind = 'wins' | 'dunks' | 'threes' | 'streak' | 'rival' | 'playoffs';
export interface Sponsor {
  name: string; tier: 'Safe' | 'Solid' | 'Bold'; kind: SponsorKind;
  text: string; target: number; credits: number;
  /** Counter value when the deal was signed. */
  base: number;
  /** Best value reached so far. */
  best: number;
  paid?: boolean;
}
export interface WeekState {
  /** Which week the hand below was dealt for. */
  key: string;
  hand: Plan[];
  /** Plan id chosen this week. */
  picked: string | null;
  result: string | null;
  /** Carried into the user's next game, then spent. */
  edge: Edge | null;
  /** Plan ids dealt in the last two weeks, so the same ones do not come straight back. */
  last: string[];
  sponsor: Sponsor | null;
  sponsorYear: number;
  /** Best single game of the week so far, league-wide (winning teams only). */
  potw?: { playerId: number; score: number; text: string } | null;
  /** One of the user's players was Player of the Week: shown on the hub for the week named by `key`. */
  honor?: { key: string; text: string } | null;
}
export function weekState(save: Save): WeekState {
  const s = save as Save & { weekly?: WeekState };
  if (!s.weekly) s.weekly = { key: '', hand: [], picked: null, result: null, edge: null, last: [], sponsor: null, sponsorYear: 0 };
  return s.weekly;
}
const keyOf = (save: Save): string => `${save.year}:${save.phase}:${save.week}`;
/** Weekly plans start after the first game and need a game to plan for. */
export const plansOpen = (save: Save): boolean => save.phase !== 'offseason' && !save.fired && careerGames(save) >= 1 && !!userGame(save);

// ---- form ------------------------------------------------------------------------------
type Formed = Player & { form?: number };
/** -2 (slump) to +2 (on fire). Only the user's players run hot and cold. */
export const formOf = (p: Player): number => (p as Formed).form ?? 0;
export const FORM_NAME: Record<string, string> = { '-2': 'SLUMP', '-1': 'COLD', 0: '', 1: 'HOT', 2: 'ON FIRE' };
const setForm = (p: Player, v: number): void => { const f = clamp(Math.round(v), -2, 2); if (f === 0) delete (p as Formed).form; else (p as Formed).form = f; };
/** Rating points per step of form. */
export const FORM_RATING = 2;
/** The player as he plays right now: a copy with his form applied. */
export function withForm(p: Player): Player {
  const f = formOf(p);
  if (!f) return p;
  const ratings = { ...p.ratings };
  for (const k of RATING_KEYS) ratings[k] = clamp(ratings[k] + f * FORM_RATING, 15, 99);
  return { ...p, ratings };
}
/** Game score per 36 minutes to expect of him: his own season so far, anchored by his overall early on. */
function expected(p: Player): number {
  const prior = 8.3 + (ovr(p) - 55) * 0.47, anchor = 80;
  return (36 * ((prior / 36) * anchor + gameScore(p.season))) / (anchor + p.season.min);
}
/** How far above or below expectation a night has to be to move his form. */
const HOT_OVER = 6, COLD_UNDER = 7;
export interface FormChange { playerId: number; form: number; up: boolean }
/** After a user game: big nights heat a player up, bad ones cool him off, and streaks fade. */
export function updateForm(save: Save, lines: BoxLine[], rng: Rng): FormChange[] {
  const out: FormChange[] = [];
  for (const l of lines) {
    const p = save.players[l.playerId];
    if (!p || p.teamId !== save.userTeamId) continue;
    const before = formOf(p);
    let next = before;
    if (l.min >= 16) {
      const per36 = (gameScore(l) / l.min) * 36, exp = expected(p);
      if (per36 >= exp + HOT_OVER) next = before + 1;
      else if (per36 <= exp - COLD_UNDER) next = before - 1;
      else if (before !== 0 && rng.chance(0.45)) next = before - Math.sign(before);
    } else if (before !== 0 && rng.chance(0.6)) next = before - Math.sign(before);
    next = clamp(next, -2, 2);
    if (next !== before) { setForm(p, next); out.push({ playerId: p.id, form: next, up: next > before }); }
  }
  return out;
}

// ---- rivalries and stakes --------------------------------------------------------------
/** Every team has one rival in its own conference. */
export function rivalOf(save: Save, teamId: number): number {
  const conf = save.teams.filter(t => t.conf === save.teams[teamId].conf).map(t => t.id).sort((a, b) => a - b);
  const i = conf.indexOf(teamId);
  return conf[i ^ 1] ?? conf[0];
}
export const isRivalGame = (save: Save, g: ScheduledGame): boolean => !g.playoff && rivalOf(save, g.homeId) === g.awayId;
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
export interface Intel {
  opp: Team;
  star: Player | null;
  starPpg: number;
  /** e.g. "Won 3 straight"; empty when there is nothing to say. */
  run: string;
  rival: boolean;
  /** Where the user stands in the playoff race. */
  race: string;
}
export function intel(save: Save, g: ScheduledGame): Intel {
  const me = save.teams[save.userTeamId];
  const opp = save.teams[g.homeId === me.id ? g.awayId : g.homeId];
  const star = opp.roster.map(id => save.players[id]).filter(p => !p.injury).sort((a, b) => ovr(b) - ovr(a))[0] ?? null;
  const st = opp.record.streak;
  const run = st >= 3 ? `Won ${st} straight` : st <= -3 ? `Lost ${-st} straight` : '';
  let race = '';
  const played = me.record.w + me.record.l;
  if (save.phase === 'regular' && played >= 3) {
    const table = standings(save, me.conf);
    const pos = table.indexOf(me);
    const left = cal(save).games - played;
    const gap = pos < 4 ? me.record.w - table[4].record.w : table[3].record.w - me.record.w;
    const conf = me.conf === 0 ? 'East' : 'West';
    race = `${ORD[pos]} in the ${conf}. `
      + (pos < 4 ? (gap === 0 ? 'Level with 5th' : `${gap} win${gap === 1 ? '' : 's'} clear of 5th`) : gap === 0 ? 'Level with 4th' : `${gap} win${gap === 1 ? '' : 's'} behind 4th`)
      + `, ${left} to play. Top 4 make the playoffs.`;
  }
  return { opp, star, starPpg: star && star.season.gp ? star.season.pts / star.season.gp : 0, run, rival: isRivalGame(save, g), race };
}

// ---- the weekly plan -------------------------------------------------------------------
const DRILLS: [RatingKey, string, string][] = [
  ['sht', 'Shooting clinic', 'Shooting'], ['hnd', 'Ball-handling lab', 'Handles'], ['fin', 'Finishing school', 'Finishing'],
  ['def', 'Defensive bootcamp', 'Defense'], ['pas', 'Passing drills', 'Passing'], ['reb', 'Box-out drills', 'Rebounding'], ['spd', 'Speed work', 'Speed'],
];
const last = (p: Player): string => shortName(p.name);
interface Weighted { plan: Plan; w: number }

function candidates(save: Save, rng: Rng): Weighted[] {
  const me = save.teams[save.userTeamId];
  const g = userGame(save);
  const ps = me.roster.map(id => save.players[id]);
  const fit = ps.filter(p => !p.injury);
  const starters = new Set(me.lineup);
  const bench = fit.filter(p => !starters.has(p.id));
  const out: Weighted[] = [];
  const add = (w: number, plan: Plan) => out.push({ plan, w });

  // -- train: make someone better for good
  const room = fit.filter(p => !atCeiling(p));
  if (room.length) {
    const p = room[rng.weighted(room.map(x => (x.age <= 24 ? 3 : 1)))];
    const open = DRILLS.filter(([k]) => p.ratings[k] < 97);
    // (a player with nothing left to train still uses up the roll, so the week's other plans come out the same)
    const d = rng.pick(open.length ? open : DRILLS);
    if (open.length) add(3, { id: `drill_${d[0]}`, group: 'train', title: `${d[1]} with ${last(p)}`, effect: `${d[2]} +2 for good`, playerId: p.id, key: d[0] });
  }
  if (bench.length >= 3) add(2, { id: 'scrimmage', group: 'train', title: 'Bench scrimmage', effect: `All ${bench.length} bench players gain 25 XP` });
  const vet = fit.filter(p => p.age >= 30).sort((a, b) => ovr(b) - ovr(a))[0];
  const kid = fit.filter(p => p.age <= 23 && p.potential < 97 && p.id !== vet?.id).sort((a, b) => b.potential - a.potential)[0];
  if (vet && kid) add(2, { id: 'mentor', group: 'train', title: `${last(vet)} mentors ${last(kid)}`, effect: `${last(kid)}: 40 XP and a higher ceiling`, playerId: kid.id, otherId: vet.id });
  add(1.6, { id: 'twoaday', group: 'train', title: 'Two-a-day practices', effect: 'Starters gain 30 XP each. Morale -4, and someone may pick up a knock' });
  if (room.length) {
    const p = rng.pick(room);
    add(1.4, { id: 'science', group: 'train', title: `Sports-science trial: ${last(p)}`, effect: '2 in 3: +4 to a rating. 1 in 3: he misses a week', playerId: p.id });
  }

  // -- prep: an edge for this game only
  if (g) {
    const opp = save.teams[g.homeId === me.id ? g.awayId : g.homeId];
    add(2.4, { id: 'film', group: 'prep', title: `Film session on the ${opp.name}`, effect: 'They shoot worse in simulated play this game' });
    add(2.4, { id: 'shoot', group: 'prep', title: 'Extra shootaround', effect: 'Steadier aim in your key moments this game' });
    add(2, { id: 'walk', group: 'prep', title: 'Late-game walkthrough', effect: 'You play two more key moments this game' });
    add(isRivalGame(save, g) ? 3 : 1.5, { id: 'guarantee', group: 'prep', title: 'Guarantee a win to the press', effect: 'Win: +4 credits, fans +4. Lose: owner -5, fans -3' });
    const cold = fit.filter(p => formOf(p) < 0).length;
    add(cold >= 2 ? 3.5 : 1.2, { id: 'light', group: 'prep', title: 'Light week, fresh legs', effect: cold ? `Morale +4. Your ${cold === 1 ? 'cold player snaps' : `${cold} cold players snap`} out of it` : 'Team morale +4' });
  }

  // -- club: money, people, the long game
  const star = fit.slice().sort((a, b) => ovr(b) - ovr(a))[0];
  if (star) add(2.2, { id: 'sponsorday', group: 'club', title: `Sponsor shoot with ${last(star)}`, effect: `+3 credits. ${last(star)}'s morale -6`, playerId: star.id });
  if (save.fans < 92) add(2, { id: 'fanday', group: 'club', title: 'Open practice for the fans', effect: 'Fan support +5' });
  if (save.owner.approval < 85) add(save.owner.approval < 35 ? 4 : 1.6, { id: 'owner', group: 'club', title: `Lunch with ${save.owner.name}`, effect: 'Owner approval +5' });
  if (save.credits >= 1) add(1.6, { id: 'dinner', group: 'club', title: 'Team dinner, on you', effect: 'Costs 1 credit. Team morale +7' });
  add(1.6, { id: 'media', group: 'club', title: `Sit down with the ${me.city} press`, effect: 'Reputation +3: better coordinators will listen' });
  add(1.6, { id: 'community', group: 'club', title: 'Community day', effect: 'Fan support +3, owner approval +2' });
  if (save.credits >= 2) add(1.5, { id: 'gear', group: 'club', title: 'New gear for everyone', effect: 'Costs 2 credits. Every player gains 15 XP' });
  const hurt = ps.filter(p => p.injury && p.injury.weeks >= 2 && p.injury.desc !== 'suspended').sort((a, b) => ovr(b) - ovr(a))[0];
  if (hurt) add(starters.has(hurt.id) || ovr(hurt) >= 76 ? 5 : 2.5, { id: 'rehab', group: 'club', title: `Rehab focus: ${last(hurt)}`, effect: 'Back a week sooner', playerId: hurt.id });
  const sad = fit.filter(p => p.morale < 45).sort((a, b) => a.morale - b.morale)[0];
  if (sad) add(4, { id: 'sitdown', group: 'club', title: `Sit down with ${last(sad)}`, effect: 'His morale +15', playerId: sad.id });
  if (g && g.homeId === me.id) add(2.2, { id: 'promo', group: 'club', title: 'Ticket promotion', effect: 'Double gate credits this game. Fans +2' });
  if (isUnlocked(save, 'scouting') && save.phase === 'regular' && save.draftClass.some(id => save.players[id]?.scouted === false)) add(1.8, { id: 'scout', group: 'club', title: 'Scouting trip', effect: '2 extra scouting reports' });
  if (isUnlocked(save, 'trades') && save.phase === 'regular' && save.week <= cal(save).deadlineWeek) add(1.3, { id: 'gem', group: 'club', title: 'Follow a tip from an old friend', effect: 'A young unknown with a high ceiling joins the free agents' });
  return out;
}

/** Deal this week's three plans (one to train, one to prepare, one for the club) if the week has changed. */
export function ensureWeek(save: Save): boolean {
  const w = weekState(save);
  if (w.sponsorYear !== save.year && w.sponsor) w.sponsor = null;
  const key = keyOf(save);
  if (w.key === key) return false;
  // remember two weeks back, so the same plan does not keep coming round
  w.last = [...w.hand.map(p => p.id), ...w.last.slice(0, 3)];
  w.key = key; w.picked = null; w.result = null; w.edge = null; w.hand = [];
  if (!plansOpen(save)) return true;
  const rng = new Rng((save.rng ^ Math.imul(save.year * 97 + save.week, 2654435761)) >>> 0);
  const all = candidates(save, rng);
  for (const group of ['train', 'prep', 'club'] as const) {
    let pool = all.filter(c => c.plan.group === group);
    const fresh = pool.filter(c => !w.last.includes(c.plan.id));
    if (fresh.length) pool = fresh;
    if (pool.length) w.hand.push(pool[rng.weighted(pool.map(c => c.w))].plan);
  }
  return true;
}
export const needsWeek = (save: Save): boolean => weekState(save).key !== keyOf(save);

const moraleAll = (save: Save, v: number): void => { for (const id of save.teams[save.userTeamId].roster) { const p = save.players[id]; p.morale = clamp(p.morale + v, 0, 100); } };
const RATING_NAME: Record<RatingKey, string> = { sht: 'Shooting', hnd: 'Handles', pas: 'Passing', spd: 'Speed', fin: 'Finishing', def: 'Defense', reb: 'Rebounding' };

/** Let the week go by without a move. */
export function skipPlan(save: Save): void {
  const w = weekState(save);
  if (w.key !== keyOf(save) || w.picked) return;
  w.picked = 'skip'; w.result = 'You let the week go by.';
}

/** Carry out one of this week's plans. Returns what happened, or null if it cannot be done. */
export function doPlan(save: Save, id: string, rng: Rng): string | null {
  const w = weekState(save);
  if (w.key !== keyOf(save) || w.picked) return null;
  const plan = w.hand.find(p => p.id === id);
  if (!plan) return null;
  const me = save.teams[save.userTeamId];
  const p = plan.playerId != null ? save.players[plan.playerId] : null;
  const starters = me.lineup.map(x => save.players[x]).filter(x => x && !x.injury);
  const bench = me.roster.filter(x => !me.lineup.includes(x)).map(x => save.players[x]).filter(x => !x.injury);
  let result = '';
  const edge = (kind: EdgeKind, label: string) => { w.edge = { kind, label }; };
  if (plan.id.startsWith('drill_') && p && plan.key) {
    const before = p.ratings[plan.key];
    p.ratings[plan.key] = clamp(before + 2, 1, 99);
    if (ovr(p) > p.potential) p.potential = ovr(p);
    result = `${p.name}: ${RATING_NAME[plan.key]} ${before} to ${p.ratings[plan.key]}.`;
  } else switch (plan.id) {
    case 'scrimmage': {
      const up = bench.filter(b => grantXp(save, b, 25) > 0);
      result = `The bench went at it hard.${up.length ? ` ${up.map(last).join(', ')} levelled up.` : ''}`;
      break;
    }
    case 'mentor': {
      if (!p) return null;
      p.potential = clamp(p.potential + 1, 0, 99);
      const up = grantXp(save, p, 40) > 0;
      result = `${last(p)} soaked it all up. His ceiling is higher${up ? ', and he levelled up' : ''}.`;
      break;
    }
    case 'twoaday': {
      const up = starters.filter(s => grantXp(save, s, 30) > 0);
      moraleAll(save, -4);
      result = `Hard yards.${up.length ? ` ${up.map(last).join(', ')} levelled up.` : ''}`;
      if (starters.length && rng.chance(0.16)) {
        const v = rng.pick(starters);
        v.injury = { weeks: 1, desc: 'minor knock' };
        fixLineup(save, me);
        result += ` ${last(v)} tweaked something and misses a week.`;
      }
      break;
    }
    case 'science': {
      if (!p) return null;
      if (rng.chance(2 / 3)) {
        const k = rng.pick(RATING_KEYS.filter(x => p.ratings[x] < 96));
        const before = p.ratings[k];
        p.ratings[k] = clamp(before + 4, 1, 99);
        if (ovr(p) > p.potential) p.potential = ovr(p);
        result = `It worked. ${last(p)}: ${RATING_NAME[k]} ${before} to ${p.ratings[k]}.`;
      } else {
        p.injury = { weeks: 1, desc: 'sore' };
        fixLineup(save, me);
        result = `It did not agree with him. ${last(p)} is sore and misses a week.`;
      }
      break;
    }
    case 'film': edge('film', 'Film session: they shoot worse in simulated play'); result = 'You know their sets better than they do.'; break;
    case 'shoot': edge('shoot', 'Shootaround: steadier aim in your key moments'); result = 'The nets were snapping all morning.'; break;
    case 'walk': edge('walk', 'Walkthrough: two more key moments'); result = 'Everyone knows where to be when it counts.'; break;
    case 'guarantee': edge('guarantee', 'You guaranteed a win: big payout, or an angry owner'); result = 'The quote is everywhere. No pressure.'; break;
    case 'light': {
      moraleAll(save, 4);
      const cold = me.roster.map(x => save.players[x]).filter(x => formOf(x) < 0);
      for (const c of cold) setForm(c, formOf(c) + 1);
      result = cold.length ? `Fresh legs. ${cold.map(last).join(', ')} look more like themselves.` : 'Fresh legs all round.';
      break;
    }
    case 'sponsorday': save.credits += 3; if (p) p.morale = clamp(p.morale - 6, 0, 100); result = `The cheque cleared. ${p ? last(p) : 'Your star'} hated every minute.`; break;
    case 'fanday': save.fans = clamp(save.fans + 5, 0, 100); result = 'The stands were full for a practice. The city is buzzing.'; break;
    case 'owner': save.owner.approval = clamp(save.owner.approval + 5, 0, 100); result = `${save.owner.name} left in a good mood.`; break;
    case 'dinner': if (save.credits < 1) return null; save.credits -= 1; moraleAll(save, 7); result = 'Good food, bad karaoke. The room is closer for it.'; break;
    case 'media': save.coach.rep = clamp(save.coach.rep + 3, 0, 100); result = 'A long, flattering profile. People in the league read it.'; break;
    case 'community': save.fans = clamp(save.fans + 3, 0, 100); save.owner.approval = clamp(save.owner.approval + 2, 0, 100); result = 'Clinics, photos, a ribbon cut. Good for everyone.'; break;
    case 'gear': {
      if (save.credits < 2) return null;
      save.credits -= 2;
      const up = me.roster.map(x => save.players[x]).filter(x => grantXp(save, x, 15) > 0);
      result = `New shoes, new mood.${up.length ? ` ${up.map(last).join(', ')} levelled up.` : ''}`;
      break;
    }
    case 'rehab': {
      if (!p || !p.injury) return null;
      p.injury.weeks = Math.max(1, p.injury.weeks - 1);
      result = `${last(p)} is ahead of schedule: ${p.injury.weeks} week${p.injury.weeks === 1 ? '' : 's'} to go.`;
      break;
    }
    case 'sitdown': if (!p) return null; p.morale = clamp(p.morale + 15, 0, 100); result = `${last(p)} needed to be heard. He feels better.`; break;
    case 'promo': edge('promo', 'Ticket promotion: double gate credits'); save.fans = clamp(save.fans + 2, 0, 100); result = 'The game is a sell-out.'; break;
    case 'scout': save.scoutPoints += 2; result = 'Two more scouting reports to use.'; break;
    case 'gem': {
      const g = genPlayer(save, rng, rng.pick(POSITIONS), rng.int(60, 66), rng.int(19, 21));
      g.potential = clamp(ovr(g) + rng.int(12, 20), 0, 95);
      g.contract = { salary: Math.max(MIN_SALARY, marketSalary(g)), years: 0 };
      save.players[g.id] = g;
      save.freeAgents.push(g.id);
      result = `His name is ${g.name}, a ${g.age}-year-old ${g.pos}. He is in the free-agent pool now, and nobody else has noticed yet.`;
      break;
    }
    default: return null;
  }
  w.picked = plan.id; w.result = result;
  return result;
}

/** The edge for the game about to be played, if this week's plan gave one. */
export const edgeFor = (save: Save): Edge | null => { const w = weekState(save); return w.key === keyOf(save) ? w.edge : null; };
export const hasEdge = (save: Save, kind: EdgeKind): boolean => edgeFor(save)?.kind === kind;

// ---- sponsor deals ---------------------------------------------------------------------
const BRANDS = ['Comet Cola', 'Brickhouse Sneakers', 'Uptown Savings', 'Zap Energy', 'Night Owl Pizza', 'Harbor Air', 'Tip-Top Tires', 'Sunny Side Diner'];
const gamesLeft = (save: Save): number => save.phase === 'regular' ? cal(save).games - (save.teams[save.userTeamId].record.w + save.teams[save.userTeamId].record.l) : 0;
/** A sponsor deal is on the table: one per season, once the coach has a few games behind him. */
export const sponsorOpen = (save: Save): boolean => {
  const w = weekState(save);
  return save.phase === 'regular' && !save.fired && careerGames(save) >= 3 && gamesLeft(save) >= 5 && !(w.sponsor && w.sponsorYear === save.year);
};
function counter(save: Save, kind: SponsorKind): number {
  const me = save.teams[save.userTeamId];
  const c = prog(save).counters;
  return kind === 'wins' ? me.record.w : kind === 'dunks' ? c.dunk ?? 0 : kind === 'threes' ? c.three ?? 0 : 0;
}
/** Three offers: a safe one, a solid one and a bold one. The same season always offers the same three. */
export function sponsorOffers(save: Save): Sponsor[] {
  const rng = new Rng((save.year * 48271 + save.userTeamId * 7907 + save.createdAt) >>> 0);
  const left = gamesLeft(save), k = left / 14;
  const n = (v: number) => Math.max(1, Math.round(v * k));
  const me = save.teams[save.userTeamId];
  const rivalLeft = save.schedule.some(g => !g.played && isRivalGame(save, g) && (g.homeId === me.id || g.awayId === me.id));
  const make = (tier: Sponsor['tier'], kind: SponsorKind, target: number, credits: number): Sponsor => {
    const text = kind === 'wins' ? `Win ${target} more game${target === 1 ? '' : 's'}`
      : kind === 'dunks' ? `Throw down ${target} dunk${target === 1 ? '' : 's'} yourself`
        : kind === 'threes' ? `Make ${target} three${target === 1 ? '' : 's'} yourself`
          : kind === 'streak' ? `Win ${target} in a row`
            : kind === 'rival' ? `Beat the ${save.teams[rivalOf(save, me.id)].name}` : 'Make the playoffs';
    return { name: '', tier, kind, text, target, credits, base: counter(save, kind), best: 0 };
  };
  const tiers: Sponsor[][] = [
    [make('Safe', 'wins', n(5.5), 4), make('Safe', 'dunks', n(5), 4), make('Safe', 'threes', n(6), 4), ...(rivalLeft ? [make('Safe', 'rival', 1, 4)] : [])],
    [make('Solid', 'wins', n(8.5), 7), make('Solid', 'dunks', n(11), 7), make('Solid', 'threes', n(13), 7), make('Solid', 'streak', 3, 6)],
    [make('Bold', 'wins', Math.min(left, n(11)), 11), make('Bold', 'streak', Math.min(left, 5), 10), make('Bold', 'playoffs', 1, 9), make('Bold', 'dunks', n(20), 10)],
  ];
  const used = new Set<SponsorKind>();
  const brands = rng.shuffle(BRANDS.slice());
  return tiers.map((opts, i) => {
    const pool = opts.filter(o => !used.has(o.kind));
    const s = rng.pick(pool.length ? pool : opts);
    used.add(s.kind);
    return { ...s, name: brands[i] };
  });
}
export function signSponsor(save: Save, idx: number): void {
  if (!sponsorOpen(save)) return;
  const s = sponsorOffers(save)[idx];
  if (!s) return;
  const w = weekState(save);
  w.sponsor = s; w.sponsorYear = save.year;
}
export const sponsorOf = (save: Save): Sponsor | null => { const w = weekState(save); return w.sponsor && w.sponsorYear === save.year ? w.sponsor : null; };
/** Progress toward the deal: [so far, target]. */
export function sponsorProgress(save: Save, s: Sponsor): [number, number] {
  if (s.paid) return [s.target, s.target];
  const v = s.kind === 'wins' || s.kind === 'dunks' || s.kind === 'threes' ? counter(save, s.kind) - s.base : s.best;
  return [clamp(v, 0, s.target), s.target];
}
/** After a game (or when the playoffs start): pay the sponsor bonus once the target is met. Returns the credits paid. */
export function settleSponsor(save: Save, game?: { won: boolean; rival: boolean }): number {
  const s = sponsorOf(save);
  if (!s || s.paid) return 0;
  const me = save.teams[save.userTeamId];
  if (s.kind === 'streak') s.best = Math.max(s.best, me.record.streak);
  if (s.kind === 'rival' && game?.won && game.rival) s.best = 1;
  if (s.kind === 'playoffs' && save.playoffs?.series.some(x => x.highId === me.id || x.lowId === me.id)) s.best = 1;
  const [v, t] = sponsorProgress(save, s);
  if (v < t) return 0;
  s.paid = true;
  save.credits += s.credits;
  return s.credits;
}

// ---- player of the week ----------------------------------------------------------------
/** Every regular-season game: remember the best night by a player on the winning side. */
export function notePerformance(save: Save, result: GameResult): void {
  const w = weekState(save);
  const lines = result.homeScore > result.awayScore ? result.box.home : result.box.away;
  for (const l of lines) {
    const score = gameScore(l);
    if (w.potw && score <= w.potw.score) continue;
    const reb = l.orb + l.drb;
    const text = `${l.pts} pts` + (reb >= 8 ? `, ${reb} reb` : '') + (l.ast >= 7 ? `, ${l.ast} ast` : '') + (l.stl + l.blk >= 5 ? `, ${l.stl + l.blk} stocks` : '');
    w.potw = { playerId: l.playerId, score, text };
  }
}
/** Week over: name the Player of the Week. If he is yours, the club is paid and he is delighted. */
export function awardPlayerOfWeek(save: Save): { player: Player; text: string; mine: boolean } | null {
  const w = weekState(save);
  const best = w.potw;
  w.potw = null;
  const p = best ? save.players[best.playerId] : null;
  if (!best || !p || p.teamId === null) return null;
  const mine = p.teamId === save.userTeamId;
  if (mine) {
    save.credits += 1;
    p.morale = clamp(p.morale + 6, 0, 100);
    save.fans = clamp(save.fans + 1, 0, 100);
    w.honor = { key: keyOf(save), text: `${p.name}: ${best.text}` };
  }
  return { player: p, text: best.text, mine };
}
/** The honour to show on the hub this week, if one of the user's players earned it last week. */
export const honorNow = (save: Save): string | null => { const h = weekState(save).honor; return h && h.key === keyOf(save) ? h.text : null; };

// ---- the league reacts to you ------------------------------------------------------------
/**
 * How opponents treat the user's team, in rating points added to every opponent player in his games.
 * Champions and runaway leaders get everyone's best game; a team at the bottom is taken lightly.
 */
export function pressure(save: Save): number {
  const me = save.teams[save.userTeamId];
  let v = 0;
  // last season with this club
  const last = save.history[save.history.length - 1];
  if (last && last.userTeamId === me.id && last.year === save.year - 1) {
    v += { champ: 3, F: 2, SF: 1, R1: 0, none: 0 }[last.userPlayoff] ?? 0;
    const prev = save.history[save.history.length - 2];
    if (last.userPlayoff === 'champ' && prev && prev.userTeamId === me.id && prev.userPlayoff === 'champ') v += 1.5; // a dynasty
  }
  // this season so far
  const played = me.record.w + me.record.l;
  if (played >= 4) {
    const pct = me.record.w / played;
    if (pct >= 0.6) v += (pct - 0.6) * 7.5;         // 80% wins: +1.5, unbeaten: +3
    else if (pct <= 0.3) v -= (0.3 - pct) * 6 + 0.4; // 20% wins: -1, winless: -2
  }
  if (save.phase === 'playoffs') v = Math.max(v, 1);  // nobody coasts in the playoffs
  return Math.round(clamp(v, -2, 6) * 2) / 2;
}
/** An opponent as he plays against the user right now. */
export function withPressure(p: Player, amount: number): Player {
  if (!amount) return p;
  const ratings = { ...p.ratings };
  for (const k of RATING_KEYS) ratings[k] = clamp(ratings[k] + amount, 15, 99);
  return { ...p, ratings };
}
