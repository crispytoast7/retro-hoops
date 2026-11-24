// The talk of the league: every few weeks somebody publishes a ranking, and everybody argues about it.
// Power rankings put the sixteen clubs in order; the MVP ladder does the same for the five best seasons.
import { clamp, gameScore, ovr } from '../ratings';
import { cal } from '../season/calendar';
import type { NewsItem, Save, Team } from '../types';
import { pushNews } from './economy';

export type Ranking = NonNullable<NewsItem['list']>;
type Memory = Save & { lastRanks?: { power?: Record<number, number>; mvp?: Record<number, number> } };
const last = (save: Save) => ((save as Memory).lastRanks ??= {});
const played = (t: Team): number => t.record.w + t.record.l;
const pct = (t: Team): number => (played(t) ? t.record.w / played(t) : 0.5);

/** Weeks the power rankings come out: every third week from the fourth (later and wider apart in a long season). */
export function powerWeek(save: Save): boolean {
  const gap = Math.max(3, Math.round(cal(save).regWeeks / 5));
  return save.phase === 'regular' && save.week > gap && (save.week - 1) % gap === 0;
}
/** Weeks the MVP ladder comes out: twice a season, clear of the power rankings. */
export function mvpWeek(save: Save): boolean {
  const n = cal(save).regWeeks;
  return save.phase === 'regular' && !powerWeek(save) && (save.week === Math.round(n * 0.4) || save.week === Math.round(n * 0.75));
}

/** All sixteen clubs, best to worst, as one reporter sees them today. */
export function publishPower(save: Save): Ranking | null {
  if (save.teams.every(t => played(t) === 0)) return null;
  const rating = (t: Team): number => { const os = t.roster.map(id => ovr(save.players[id])).sort((a, b) => b - a).slice(0, 8); return os.reduce((s, v) => s + v, 0) / Math.max(1, os.length); };
  const score = (t: Team): number => {
    const w = Math.min(1, played(t) / 8);
    const diff = played(t) ? (t.record.pf - t.record.pa) / played(t) : 0;
    return pct(t) * 100 * w + (50 + (rating(t) - 72) * 5) * (1 - w * 0.6) + clamp(t.record.streak, -5, 5) * 1.6 + clamp(diff, -15, 15) * 0.9;
  };
  const order = save.teams.slice().sort((a, b) => score(b) - score(a) || a.id - b.id);
  const before = last(save).power;
  const rows = order.map((t, i) => {
    const star = t.roster.map(id => save.players[id]).sort((a, b) => (b.season.gp ? gameScore(b.season) / b.season.gp : 0) - (a.season.gp ? gameScore(a.season) / a.season.gp : 0))[0];
    const s = t.record.streak;
    const say = i === 0 ? 'The team to beat.'
      : s >= 4 ? `Won ${s} straight. Nobody wants to see them.`
      : s <= -4 ? `Lost ${-s} straight. Something has to change.`
      : i === order.length - 1 ? 'Already thinking about the draft.'
      : star && star.season.gp && gameScore(star.season) / star.season.gp > 20 ? `${star.name} is carrying them.`
      : i < 4 ? 'A real contender.' : i < 8 ? 'In the hunt.' : i < 12 ? 'Treading water.' : 'A long season ahead.';
    return { playerId: -1, teamId: t.id, name: `${t.city} ${t.name}`, team: `${t.record.w}-${t.record.l}`, note: say, move: before && before[t.id] !== undefined ? before[t.id] - i : undefined, mine: t.id === save.userTeamId };
  });
  last(save).power = Object.fromEntries(order.map((t, i) => [t.id, i]));
  const me = rows.findIndex(r => r.mine), mv = rows[me]?.move;
  const list: Ranking = { kind: 'power', title: 'POWER RANKINGS', by: 'Kiki Novak', outlet: 'Box Score Weekly', motto: 'Where every club stands this week, like it or not.', rows };
  pushNews(save, 'league', `Power rankings are out: ${rows.slice(0, 3).map((r, i) => `${i + 1}. ${save.teams[r.teamId!].name}`).join(', ')}. Your ${save.teams[save.userTeamId].name} are #${me + 1}${mv ? ` (${mv > 0 ? 'up' : 'down'} ${Math.abs(mv)})` : ''}.`, true);
  save.news[0].list = list;
  return list;
}

/** The five best seasons so far, in the eyes of the loudest man on the radio. */
export function publishMvpLadder(save: Save): Ranking | null {
  const most = Math.max(...save.teams.map(played));
  const pool = save.teams.flatMap(t => t.roster.map(id => save.players[id])).filter(p => p && p.season.gp >= Math.max(2, Math.ceil(most * 0.55)));
  if (pool.length < 8) return null;
  const score = (p: (typeof pool)[number]): number => (gameScore(p.season) / p.season.gp) * (0.6 + 0.4 * pct(save.teams[p.teamId!]));
  const top = pool.slice().sort((a, b) => score(b) - score(a) || a.id - b.id).slice(0, 5);
  const before = last(save).mvp;
  const rows = top.map((p, i) => {
    const s = p.season, g = s.gp;
    return { playerId: p.id, teamId: p.teamId!, name: p.name, team: save.teams[p.teamId!].abbr, note: `${(s.pts / g).toFixed(1)} pts, ${((s.orb + s.drb) / g).toFixed(1)} reb, ${(s.ast / g).toFixed(1)} ast`,
      move: before ? (before[p.id] !== undefined ? before[p.id] - i : 99) : undefined, mine: p.teamId === save.userTeamId };
  });
  last(save).mvp = Object.fromEntries(top.map((p, i) => [p.id, i]));
  const mine = rows.filter(r => r.mine);
  const list: Ranking = { kind: 'mvp', title: 'THE MVP LADDER', by: 'Marcus Ferris', outlet: 'Hot Take Radio', motto: 'Five names. One trophy. I am never wrong.', rows };
  pushNews(save, 'award', `The MVP ladder: ${rows[0].name} (${rows[0].team}) leads the race.${mine.length ? ` Your ${mine.map(r => r.name).join(' and ')} ${mine.length === 1 ? 'is' : 'are'} on it.` : ''}`, mine.length > 0, true);
  save.news[0].list = list;
  return list;
}

/** The ranking published this week that the user has not opened yet, if any. */
export function freshRanking(save: Save, seen: readonly string[]): { key: string; item: NewsItem } | null {
  const item = save.news.find(n => n.list && n.year === save.year && n.week === save.week);
  if (!item) return null;
  const key = `rank:${item.year}:${item.week}:${item.list!.kind ?? 'goat'}`;
  return seen.includes(key) ? null : { key, item };
}
