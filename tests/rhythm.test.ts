import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { pendingMoment, resolveMoment } from '../src/core/org/moments';
import { prog } from '../src/core/org/progress';
import { freshRanking, mvpWeek, powerWeek } from '../src/core/org/rankings';
import { ensureWeek, quietWeek, weekState } from '../src/core/org/week';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(seed = 6, team = 5): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  // an established coach: everything is unlocked, so every kind of interruption is possible
  prog(save).xp = 5000; save.coach.seasons = 2;
  return { save, rng };
}

describe('the rhythm of a season', () => {
  test('some weeks are quiet, and no week brings more than one pop-up', () => {
    let weeks = 0, quiet = 0, events = 0, moments = 0, nothing = 0;
    for (const seed of [6, 9, 14, 21]) {
      const { save, rng } = mk(seed);
      for (let i = 0; i < 16 && save.phase === 'regular'; i++) {
        advance(save, rng, 'simWeek');
        if (save.phase !== 'regular') break;
        weeks++;
        ensureWeek(save);
        const m = pendingMoment(save), e = save.pendingEvent;
        // never an event and an optional moment in the same week
        if (m && e) expect(['demand', 'deadline', 'ultimatum']).toContain(m.kind);
        if (quietWeek(save)) {
          quiet++;
          expect(weekState(save).hand.length).toBe(0);
          expect(e).toBeNull();
          if (m) expect(['demand', 'deadline', 'ultimatum']).toContain(m.kind);
        } else if (save.week > 1) expect(weekState(save).hand.length).toBeGreaterThan(0);
        if (e) events++;
        if (m) moments++;
        if (!m && !e) nothing++;
        if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled), rng);
        save.pendingEvent = null;
      }
    }
    // roughly three weeks in ten are quiet, and plenty of weeks pass without a pop-up at all
    expect(quiet / weeks).toBeGreaterThan(0.12);
    expect(quiet / weeks).toBeLessThan(0.5);
    expect(nothing / weeks).toBeGreaterThan(0.3);
    expect(events).toBeGreaterThan(3);
    expect(moments).toBeGreaterThan(3);
  }, 120000);

  test('power rankings and the MVP ladder come out through the season and are there to be opened', () => {
    const { save, rng } = mk(6);
    const kinds: string[] = [];
    for (let i = 0; i < 16 && save.phase === 'regular'; i++) {
      advance(save, rng, 'simWeek');
      const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled), rng);
      save.pendingEvent = null;
      if (save.phase !== 'regular') break;
      const fresh = freshRanking(save, prog(save).seen);
      if (powerWeek(save) || mvpWeek(save)) expect(fresh).not.toBeNull();
      if (!fresh) continue;
      const list = fresh.item.list!;
      kinds.push(list.kind ?? 'goat');
      if (list.kind === 'power') {
        expect(list.rows.length).toBe(save.teams.length);
        expect(new Set(list.rows.map(r => r.teamId)).size).toBe(save.teams.length);
        expect(list.rows.filter(r => r.mine).length).toBe(1);
        expect(fresh.item.mine).toBe(true);
      }
      if (list.kind === 'mvp') { expect(list.rows.length).toBe(5); for (const r of list.rows) expect(save.players[r.playerId].name).toBe(r.name); }
      // opened once, it is no longer new
      prog(save).seen.push(fresh.key);
      expect(freshRanking(save, prog(save).seen)).toBeNull();
    }
    expect(kinds.filter(k => k === 'power').length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter(k => k === 'mvp').length).toBe(2);
    // the second power list says who moved
    const lists = save.news.filter(n => n.list?.kind === 'power');
    expect(lists[0].list!.rows.some(r => r.move !== undefined)).toBe(true);
  }, 120000);
});
