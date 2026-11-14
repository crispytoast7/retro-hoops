import { NUM_TEAMS } from '../constants';
import type { Rng } from '../rng';
import type { Save, ScheduledGame, Team } from '../types';
import { cal } from './calendar';

/**
 * A season is a list of rounds; in each round every team plays once.
 * Classic (14): each conference rival once, 7 of the 8 teams from the other conference.
 * Full (82): each conference rival 6 times (42), each team from the other conference 5 times (40).
 * Rounds are shuffled, then dealt out `perWeek` to a week. Home and away are balanced.
 */
export function genSchedule(save: Save, rng: Rng): ScheduledGame[] {
  const c = cal(save);
  const half = NUM_TEAMS / 2;
  const A = rng.shuffle(save.teams.filter(t => t.conf === 0).map(t => t.id));
  const B = rng.shuffle(save.teams.filter(t => t.conf === 1).map(t => t.id));
  const full = c.games >= 82;
  const rounds: [number, number][][] = [];
  for (let rep = 0; rep < (full ? 6 : 1); rep++) {
    for (let r = 0; r < half - 1; r++) {
      const round: [number, number][] = [];
      for (const conf of [A, B]) {
        const rot = [conf[0], ...conf.slice(1).map((_, i) => conf[1 + ((i + r) % (half - 1))])];
        for (let i = 0; i < half / 2; i++) round.push([rot[i], rot[half - 1 - i]]);
      }
      rounds.push(round);
    }
  }
  for (let rep = 0; rep < (full ? 5 : 1); rep++) {
    for (let k = 0; k < (full ? half : half - 1); k++) rounds.push(A.map((a, i) => [a, B[(i + k) % half]] as [number, number]));
  }
  rng.shuffle(rounds);
  const games: ScheduledGame[] = [];
  let id = save.year * 10000;
  const homeCount = new Map<number, number>();
  const lastHome = new Map<string, number>();
  const interFirst = new Map<string, number>();
  A.forEach((a, i) => { for (let k = 0; k < half; k++) { const b = B[(i + k) % half]; interFirst.set(a < b ? `${a}-${b}` : `${b}-${a}`, k % 2 === 0 ? a : b); } });
  rounds.slice(0, c.games).forEach((round, i) => {
    for (const [x, y] of round) {
      const hx = homeCount.get(x) ?? 0, hy = homeCount.get(y) ?? 0;
      const key = x < y ? `${x}-${y}` : `${y}-${x}`;
      const prev = lastHome.get(key);
      // Alternate venues between the same two teams. Cross-conference pairs meet an odd number
      // of times, so who hosts first is fixed up front to give everyone the same number of homes.
      const planned = interFirst.get(key);
      const xHome = prev !== undefined ? prev !== x : planned !== undefined ? planned === x : hx === hy ? rng.chance(0.5) : hx < hy;
      const [h, a] = xHome ? [x, y] : [y, x];
      lastHome.set(key, h);
      homeCount.set(h, (homeCount.get(h) ?? 0) + 1);
      games.push({ id: id++, week: Math.floor(i / c.perWeek) + 1, day: i + 1, homeId: h, awayId: a, played: false });
    }
  });
  return games;
}

export const gamesInWeek = (save: Save, week: number): ScheduledGame[] => save.schedule.filter(g => g.week === week);
const involves = (save: Save, g: ScheduledGame): boolean => g.homeId === save.userTeamId || g.awayId === save.userTeamId;
/** The user's next unplayed game this week, if any. */
export function userGame(save: Save, week = save.week): ScheduledGame | undefined {
  let best: ScheduledGame | undefined;
  for (const g of save.schedule) if (g.week === week && !g.played && involves(save, g) && (!best || g.day < best.day)) best = g;
  return best;
}
/** The user's games in a week, in order. */
export const userGamesInWeek = (save: Save, week = save.week): ScheduledGame[] =>
  save.schedule.filter(g => g.week === week && involves(save, g)).sort((a, b) => a.day - b.day);

/** Conference standings, best first. Tiebreaks: win pct, wins, conference wins, point difference. */
export function standings(save: Save, conf: number): Team[] {
  return save.teams.filter(t => t.conf === conf).sort(cmpTeams);
}
export function cmpTeams(a: Team, b: Team): number {
  const pa = a.record.w / Math.max(1, a.record.w + a.record.l), pb = b.record.w / Math.max(1, b.record.w + b.record.l);
  return pb - pa || b.record.w - a.record.w || b.record.confW - a.record.confW
    || (b.record.pf - b.record.pa) - (a.record.pf - a.record.pa) || a.id - b.id;
}
