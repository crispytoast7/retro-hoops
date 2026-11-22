// All-Star weekend: at mid-season the league names its All-Stars, and every club sends a shooter to the
// three-point contest and a dunker to the dunk contest. The user plays his own two by hand (or skips them).
import { clamp, gameScore } from '../ratings';
import { Rng } from '../rng';
import { cal } from '../season/calendar';
import type { Player, Save } from '../types';
import { pushNews } from './economy';
import { prog } from './progress';

export type DunkStyle = 'twohand' | 'onehand' | 'reverse' | 'windmill' | 'spin' | 'legs';
export interface DunkChoice {
  style: DunkStyle; name: string;
  /** What a judge gives it on average: thrown down perfectly, and merely cleanly. */
  perfect: number; clean: number;
  /** How much harder the take-off is to time (1 = a plain jam). */
  amp: number;
}
/** Safe to spectacular. The hard ones score higher and are harder to time. */
export const DUNKS: DunkChoice[] = [
  { style: 'twohand', name: 'Two-hand jam', perfect: 7.0, clean: 6.4, amp: 1 },
  { style: 'onehand', name: 'One-hand slam', perfect: 7.6, clean: 7.0, amp: 1.12 },
  { style: 'reverse', name: 'Reverse', perfect: 8.3, clean: 7.6, amp: 1.28 },
  { style: 'windmill', name: 'Windmill', perfect: 9.0, clean: 8.2, amp: 1.45 },
  { style: 'spin', name: '360', perfect: 9.5, clean: 8.7, amp: 1.62 },
  { style: 'legs', name: 'Between the legs', perfect: 10, clean: 9.2, amp: 1.8 },
];
/** A missed dunk still gets a (bad) score. */
export const MISSED_DUNK = 5.2;
export const JUDGES = 5;
/** Three-point contest: racks around the arc, balls on each; the last ball of a rack is the money ball, worth two. */
export const RACKS = 5, BALLS = 2;
export const THREE_MAX = RACKS * (BALLS + 1);
export const DUNK_TRIES = 2;
/** Stars named per conference. */
export const STARS_PER_CONF = 5;

export interface ContestRow { playerId: number; name: string; teamId: number; score: number; mine: boolean }
export interface AllStarState {
  year: number;
  /** The All-Stars of both conferences. */
  stars: number[];
  /** The contests are waiting for the user to play or skip them. */
  open: boolean;
  /** Who the user sends, and who he is up against. */
  shooterId: number; dunkerId: number;
  rivals3: number[]; rivalsDunk: number[];
  three?: ContestRow[]; dunk?: ContestRow[];
}
type Holder = Save & { allstar?: AllStarState };
export const allStarState = (save: Save): AllStarState | null => {
  const s = (save as Holder).allstar;
  return s && s.year === save.year ? s : null;
};
export const allStarPending = (save: Save): boolean => !!allStarState(save)?.open && save.phase === 'regular' && !save.fired;
/** The week the weekend falls in: the first week of the second half. */
export const allStarWeek = (save: Save): number => Math.floor(cal(save).regWeeks / 2) + 1;

const healthy = (p: Player): boolean => !p.injury && !p.retired;
const rostered = (save: Save): Player[] => save.teams.flatMap(t => t.roster.map(id => save.players[id])).filter(Boolean);

/** Name the All-Stars and line up the contests. No dice: the picks are what the season so far says. */
export function openAllStar(save: Save): AllStarState {
  const me = save.teams[save.userTeamId];
  const stars: number[] = [];
  for (const conf of [0, 1]) {
    const pool = save.teams.filter(t => t.conf === conf).flatMap(t => t.roster.map(id => save.players[id]))
      .filter(p => p && p.season.gp >= Math.max(1, Math.floor((save.teams[p.teamId!].record.w + save.teams[p.teamId!].record.l) * 0.5)));
    pool.sort((a, b) => gameScore(b.season) / b.season.gp - gameScore(a.season) / a.season.gp || a.id - b.id);
    for (const p of pool.slice(0, STARS_PER_CONF)) { stars.push(p.id); p.awards.push(`All-Star (Y${save.year})`); }
  }
  const mine = me.roster.map(id => save.players[id]).filter(healthy);
  const anyMine = me.roster.map(id => save.players[id]);
  const best = (list: Player[], k: 'sht' | 'fin'): Player => list.slice().sort((a, b) => b.ratings[k] - a.ratings[k] || a.id - b.id)[0];
  const shooter = best(mine.length ? mine : anyMine, 'sht'), dunker = best(mine.length ? mine : anyMine, 'fin');
  const others = rostered(save).filter(p => p.teamId !== me.id && healthy(p));
  const top = (k: 'sht' | 'fin'): number[] => others.slice().sort((a, b) => b.ratings[k] - a.ratings[k] || a.id - b.id).slice(0, 3).map(p => p.id);
  const st: AllStarState = { year: save.year, stars, open: true, shooterId: shooter.id, dunkerId: dunker.id, rivals3: top('sht'), rivalsDunk: top('fin') };
  (save as Holder).allstar = st;
  const myStars = stars.map(id => save.players[id]).filter(p => p.teamId === me.id);
  pushNews(save, 'league', `All-Star weekend. The All-Stars are named, and the three-point and dunk contests are on.`, false);
  if (myStars.length) {
    save.fans = clamp(save.fans + myStars.length, 0, 100);
    pushNews(save, 'award', `${myStars.map(p => p.name).join(' and ')} ${myStars.length === 1 ? 'is an All-Star' : 'are All-Stars'}. The fans love it.`, true);
  }
  return st;
}

// ---- scoring --------------------------------------------------------------------------
/** A rival's three-point contest score: better shooters make more, nobody is automatic. */
export function simThree(p: Player, rng: Rng): number {
  const make = clamp(0.16 + 0.5 * (p.ratings.sht / 100), 0.3, 0.68);
  let score = 0;
  for (let r = 0; r < RACKS; r++) for (let b = 0; b < BALLS; b++) if (rng.next() < make) score += b === BALLS - 1 ? 2 : 1;
  return score;
}
/** Five judges' cards for one dunk, given what the dunk deserved on average. Each card is 5 to 10. */
export function judge(mean: number, rng: Rng): number[] {
  return Array.from({ length: JUDGES }, () => clamp(Math.round(mean + rng.gauss() * 0.4), 5, 10));
}
/** The judges' cards for a dunk the user tried: its style, and how well he timed the take-off (0-3). */
export function judgeDunk(style: DunkStyle, quality: number, rng: Rng): number[] {
  const d = DUNKS.find(x => x.style === style) ?? DUNKS[0];
  return judge(quality >= 3 ? d.perfect : quality === 2 ? d.clean : MISSED_DUNK, rng);
}
/** A rival's dunk contest total over all his tries. */
export function simDunk(p: Player, rng: Rng): number {
  let total = 0;
  for (let i = 0; i < DUNK_TRIES; i++) {
    // the great dunkers go for more, and now and then one of them misses
    const miss = rng.next() < 0.12;
    const mean = miss ? MISSED_DUNK : clamp(6.0 + 2.8 * ((p.ratings.fin - 60) / 35) + rng.gauss() * 0.45, 6, 9.8);
    total += judge(mean, rng).reduce((s, v) => s + v, 0);
  }
  return total;
}

/**
 * Settle the weekend. `mine` holds the scores the user put up by hand; anything left out is simulated,
 * as if he had sent his player and stayed home. Pays the prizes and writes the news.
 */
export function finishAllStar(save: Save, mine: { three?: number; dunk?: number } = {}): AllStarState | null {
  const st = allStarState(save);
  if (!st || !st.open) return st;
  // its own dice, so the weekend never changes how the rest of the season rolls
  const rng = new Rng((save.rng ^ Math.imul(save.year + 1, 0x9e3779b1)) >>> 0);
  const row = (id: number, score: number): ContestRow | null => {
    const p = save.players[id];
    return p ? { playerId: id, name: p.name, teamId: p.teamId ?? -1, score, mine: id === st.shooterId || id === st.dunkerId } : null;
  };
  const table = (myId: number, myScore: number | undefined, rivals: number[], sim: (p: Player, r: Rng) => number): ContestRow[] => {
    const rows = rivals.map(id => save.players[id] && row(id, sim(save.players[id], rng))).filter(Boolean) as ContestRow[];
    const mineRow = save.players[myId] ? { ...row(myId, myScore ?? sim(save.players[myId], rng))!, mine: true } : null;
    for (const r of rows) r.mine = false;
    if (mineRow) rows.push(mineRow);
    // a tie goes to the user's man: he shot last
    return rows.sort((a, b) => b.score - a.score || (a.mine ? -1 : b.mine ? 1 : 0));
  };
  st.three = table(st.shooterId, mine.three, st.rivals3, simThree);
  st.dunk = table(st.dunkerId, mine.dunk, st.rivalsDunk, simDunk);
  st.open = false;
  const c = prog(save).counters;
  const settle = (rows: ContestRow[], what: string, award: string, key: string, fans: number): void => {
    const win = rows[0];
    const wp = save.players[win.playerId];
    if (wp) wp.awards.push(`${award} (Y${save.year})`);
    const place = rows.findIndex(r => r.mine);
    if (place === 0) {
      save.credits += 3; save.fans = clamp(save.fans + fans, 0, 100); c[key] = (c[key] ?? 0) + 1;
      pushNews(save, 'award', `${win.name} wins the ${what} with ${win.score}. The club gets 3 credits and the fans are buzzing.`, true);
    } else {
      if (place === 1) save.credits += 1;
      const my = rows[place];
      pushNews(save, 'award', `${win.name} (${save.teams[win.teamId]?.name ?? 'free agent'}) wins the ${what} with ${win.score}.${my ? ` ${my.name} finishes ${['first', 'second', 'third', 'fourth'][place]} with ${my.score}.${place === 1 ? ' One credit for second place.' : ''}` : ''}`, place === 1);
    }
  };
  settle(st.three, 'three-point contest', '3-Point Champion', 'three_win', 2);
  settle(st.dunk, 'dunk contest', 'Dunk Champion', 'dunk_win', 3);
  return st;
}
