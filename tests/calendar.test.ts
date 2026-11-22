// The 82-game calendar: schedule shape, day-by-day advance, best-of-seven playoffs.
import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { resolveEvent, takeJob } from '../src/core/org/people';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import { genSchedule, userGame } from '../src/core/season/schedule';
import type { Save } from '../src/core/types';

function mk(seed: number): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'Test Coach', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.full });
  const rng = new Rng(save.rng);
  chooseTeam(save, 3, rng);
  return { save, rng };
}

describe('82-game calendar', () => {
  test('schedule: 82 games each, balanced venues, one game a day, 21 weeks', () => {
    const { save, rng } = mk(3);
    const s = genSchedule(save, rng);
    expect(s.length).toBe((16 * 82) / 2);
    expect(Math.max(...s.map(g => g.week))).toBe(21);
    for (const t of save.teams) {
      const mine = s.filter(g => g.homeId === t.id || g.awayId === t.id);
      expect(mine.length).toBe(82);
      expect(new Set(mine.map(g => g.day)).size).toBe(82);
      const home = mine.filter(g => g.homeId === t.id).length;
      expect(home).toBe(41);
      const vs = (o: number) => mine.filter(g => g.homeId === o || g.awayId === o).length;
      for (const o of save.teams) if (o.id !== t.id) expect(vs(o.id)).toBe(o.conf === t.conf ? 6 : 5);
    }
  });

  test('a season plays out game by game, with best-of-seven series', () => {
    const { save, rng } = mk(8);
    const credits0 = save.credits;
    let steps = 0, userGames = 0, minOwner = 100;
    while (save.phase !== 'offseason' && steps++ < 400) {
      if (save.pendingEvent) resolveEvent(save, 0);
      if (save.fired) takeJob(save, save.fired.offers[0], true);
      const before = userGame(save);
      // alternate: sim one game at a time, sometimes a whole week
      const posts = advance(save, rng, steps % 5 === 0 ? 'simWeek' : 'simGame');
      userGames += posts.length;
      if (before) expect(posts.length).toBeGreaterThan(0);
      minOwner = Math.min(minOwner, save.owner.approval);
    }
    expect(save.phase).toBe('offseason');
    for (const t of save.teams) { const h = t.history[t.history.length - 1]; expect(h.w + h.l).toBe(82); }
    expect(userGames).toBeGreaterThanOrEqual(82);
    const po = save.playoffs!;
    expect(po.series.length).toBe(7);
    for (const s of po.series) {
      expect(Math.max(s.highW, s.lowW)).toBe(4);
      expect(Math.min(s.highW, s.lowW)).toBeLessThan(4);
      expect(s.games.length).toBe(s.highW + s.lowW);
      expect(s.winnerId).toBe(s.highW === 4 ? s.highId : s.lowId);
    }
    expect(po.championId).toBe(po.series.find(s => s.round === 3)!.winnerId);
    // long seasons pay about what short ones do
    const earned = save.credits - credits0;
    // (a deep playoff run, its trophies and an All-Star contest win can add a few dozen)
    expect(earned).toBeGreaterThan(10); expect(earned).toBeLessThan(200);
    const mvp = save.history[0].mvp!;
    const ppg = Number(mvp.line.split(' ')[0]);
    expect(ppg).toBeGreaterThan(20);
  }, 60000);
});
