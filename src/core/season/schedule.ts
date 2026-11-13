import { NUM_TEAMS, REG_WEEKS } from '../constants';
import type { Rng } from '../rng';
import type { Save, ScheduledGame, Team } from '../types';

/**
 * 14 weeks: every team plays its 7 conference rivals once (odd weeks) and 7 of the 8
 * teams from the other conference (even weeks). Home and away are balanced to within one game.
 */
export function genSchedule(save: Save, rng: Rng): ScheduledGame[] {
  const half = NUM_TEAMS / 2;
  const A = rng.shuffle(save.teams.filter(t => t.conf === 0).map(t => t.id));
  const B = rng.shuffle(save.teams.filter(t => t.conf === 1).map(t => t.id));
  const games: ScheduledGame[] = [];
  let id = save.year * 1000;
  const homeCount = new Map<number, number>();
  const add = (week: number, x: number, y: number) => {
    const hx = homeCount.get(x) ?? 0, hy = homeCount.get(y) ?? 0;
    const xHome = hx === hy ? rng.chance(0.5) : hx < hy;
    const [h, a] = xHome ? [x, y] : [y, x];
    homeCount.set(h, (homeCount.get(h) ?? 0) + 1);
    games.push({ id: id++, week, homeId: h, awayId: a, played: false });
  };
  const rounds = REG_WEEKS / 2;
  for (let r = 0; r < rounds; r++) {
    // circle method inside each conference
    for (const conf of [A, B]) {
      const rot = [conf[0], ...conf.slice(1).map((_, i) => conf[1 + ((i + r) % (half - 1))])];
      for (let i = 0; i < half / 2; i++) add(r * 2 + 1, rot[i], rot[half - 1 - i]);
    }
    for (let i = 0; i < half; i++) add(r * 2 + 2, A[i], B[(i + r) % half]);
  }
  return games;
}

export const gamesInWeek = (save: Save, week: number): ScheduledGame[] => save.schedule.filter(g => g.week === week);
export function userGame(save: Save, week = save.week): ScheduledGame | undefined {
  return save.schedule.find(g => g.week === week && (g.homeId === save.userTeamId || g.awayId === save.userTeamId));
}

/** Conference standings, best first. Tiebreaks: wins, conference wins, point difference. */
export function standings(save: Save, conf: number): Team[] {
  return save.teams.filter(t => t.conf === conf).sort(cmpTeams);
}
export function cmpTeams(a: Team, b: Team): number {
  const pa = a.record.w / Math.max(1, a.record.w + a.record.l), pb = b.record.w / Math.max(1, b.record.w + b.record.l);
  return pb - pa || b.record.w - a.record.w || b.record.confW - a.record.confW
    || (b.record.pf - b.record.pa) - (a.record.pf - a.record.pa) || a.id - b.id;
}
