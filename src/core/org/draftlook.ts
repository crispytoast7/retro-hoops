// Looking back at a draft: grading a club's class on draft night, and calling out the steals and the
// busts once a class has had a few seasons to show what it is.
import { ovr, stars } from '../ratings';
import type { Player, Save } from '../types';
import { NUM_TEAMS } from '../constants';
import { pushNews } from './economy';

const overall = (p: Player): number => (p.draft!.round - 1) * NUM_TEAMS + p.draft!.pick;
const classOf = (save: Save, year: number): Player[] => Object.values(save.players).filter(p => p.draft && p.draft.year === year);
const starWords = (v: number): string => `${String(stars(v)).replace('.5', ' and a half')}-star`;

export interface DraftGrade { grade: string; line: string }
/**
 * A club's draft-night grade: how high its picks' ceilings rank in the class against where it picked them.
 * Taking the fifth-best ceiling with the tenth pick is a good night; the reverse is not.
 */
export function gradeDraft(save: Save, teamId: number, year = save.year): DraftGrade | null {
  const all = classOf(save, year);
  const mine = all.filter(p => p.draft!.teamId === teamId);
  if (!mine.length) return null;
  const byCeil = all.slice().sort((a, b) => b.potential - a.potential || overall(a) - overall(b));
  const rank = (p: Player) => byCeil.indexOf(p) + 1;
  // positive: you found more than the slot promised
  const score = mine.reduce((s, p) => s + Math.max(-12, Math.min(12, overall(p) - rank(p))) / Math.sqrt(overall(p)), 0) / mine.length;
  const grade = score >= 1.2 ? 'A' : score >= 0.4 ? 'B' : score >= -0.4 ? 'C' : score >= -1.2 ? 'D' : 'F';
  const best = mine.slice().sort((a, b) => (overall(b) - rank(b)) - (overall(a) - rank(a)))[0];
  const line = overall(best) - rank(best) >= 3
    ? `${best.name} at #${overall(best)} could be a steal: the scouts see a ${starWords(best.potential)} ceiling.`
    : (() => { const top = mine.slice().sort((a, b) => b.potential - a.potential)[0]; return `Your best prospect, ${top.name}, has a ${starWords(top.potential)} ceiling.`; })();
  return { grade, line };
}

/** Two and four seasons on, the papers say who the steals and busts of a draft class were. */
export function draftLookback(save: Save): void {
  for (const back of [2, 4]) {
    const year = save.year - back;
    const cls = classOf(save, year).filter(p => !p.retired || p.seasons.length > 0);
    if (cls.length < 10) continue;
    const now = (p: Player) => Math.max(ovr(p), ...p.seasons.slice(-1).map(s => s.ovr));
    const sorted = cls.slice().sort((a, b) => now(b) - now(a));
    const top5 = sorted.slice(0, 5).map(p => p.id);
    // a steal: one of the five best of the class, taken outside the top ten
    const steal = sorted.slice(0, 5).filter(p => overall(p) > 10).sort((a, b) => overall(b) - overall(a))[0];
    // a bust: a top-three pick who is not even in the better half of his class
    const bust = cls.filter(p => overall(p) <= 3 && !top5.includes(p.id) && sorted.indexOf(p) >= cls.length / 2).sort((a, b) => overall(a) - overall(b))[0];
    for (const [p, what] of [[steal, 'steal'], [bust, 'bust']] as const) {
      if (!p) continue;
      const by = save.teams[p.draft!.teamId];
      const mine = p.draft!.teamId === save.userTeamId || p.teamId === save.userTeamId;
      const text = what === 'steal'
        ? `The steal of the Season ${year} draft: ${p.name}, taken #${overall(p)} by the ${by?.name ?? 'league'}, is now a ${starWords(now(p))} player.`
        : `The bust of the Season ${year} draft: ${p.name}, the #${overall(p)} pick of the ${by?.name ?? 'league'}, has never become more than a ${starWords(now(p))} player.`;
      pushNews(save, 'draft', text, mine, mine);
    }
  }
}
