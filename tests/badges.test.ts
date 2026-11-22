import { describe, expect, test } from 'vitest';
import { BADGES, BADGE_AT, announceBadges, badgeOf, badgeProgress, giftOf, refreshBadges, withBadge } from '../src/core/badges';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import type { Save } from '../src/core/types';

function mk(seed = 6): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, 5, rng);
  return { save, rng };
}

describe('player badges', () => {
  test('rare: about one player in seven, every one of them with the rating to match', () => {
    let n = 0, b = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { save } = mk(seed);
      for (const t of save.teams) for (const id of t.roster) {
        const p = save.players[id]; n++;
        const bd = badgeOf(p);
        if (!bd) continue;
        b++;
        expect(p.ratings[BADGES[bd].key]).toBeGreaterThanOrEqual(BADGE_AT);
        expect(giftOf(p)).not.toBeNull();
      }
    }
    expect(b / n).toBeGreaterThan(0.07);
    expect(b / n).toBeLessThan(0.22);
  });

  test('a gifted player earns his badge when the rating gets there, the club is told, and he keeps it', () => {
    const { save } = mk();
    const me = save.teams[save.userTeamId];
    const p = me.roster.map(id => save.players[id]).find(x => !badgeOf(x) && giftOf(x))!;
    expect(p).toBeDefined();
    const prog = badgeProgress(p)!;
    expect(prog.now).toBeLessThan(prog.need);
    expect(refreshBadges(save)).toEqual([]);
    p.ratings[prog.badge.key] = BADGE_AT;
    const news = save.news.length;
    expect(announceBadges(save).map(x => x.id)).toEqual([p.id]);
    expect(badgeOf(p)).toBe(prog.badge.id);
    expect(save.news.length).toBe(news + 1);
    expect(save.news.some(x => x.text.includes(p.name) && x.text.includes(prog.badge.name))).toBe(true);
    expect(badgeProgress(p)).toBeNull();
    // age takes the rating; the badge stays
    p.ratings[prog.badge.key] = 60;
    refreshBadges(save);
    expect(badgeOf(p)).toBe(prog.badge.id);
  });

  test('a player without the gift never gets one, however good he becomes', () => {
    const { save } = mk();
    const p = Object.values(save.players).find(x => !giftOf(x) && x.teamId !== null)!;
    for (const k in p.ratings) (p.ratings as Record<string, number>)[k] = 99;
    refreshBadges(save);
    expect(badgeOf(p)).toBeNull();
  });

  test('in simulated games a badge lifts its own rating a little, and nothing else', () => {
    const { save } = mk();
    const p = Object.values(save.players).find(x => badgeOf(x))!;
    const k = BADGES[badgeOf(p)!].key;
    const q = withBadge(p);
    expect(q.ratings[k]).toBe(Math.min(99, p.ratings[k] + 4));
    for (const kk in p.ratings) if (kk !== k) expect((q.ratings as Record<string, number>)[kk]).toBe((p.ratings as Record<string, number>)[kk]);
    expect(withBadge(Object.values(save.players).find(x => !badgeOf(x))!).ratings).toBe(Object.values(save.players).find(x => !badgeOf(x))!.ratings);
  });
});
