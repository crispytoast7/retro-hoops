import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { afterGameChoice, atCeiling, grantXp, levelOfPlayer, pointsOf, readyToLevel, spendPoint, xpNeed, POINT_GAIN } from '../src/core/org/xp';
import { ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance, startLiveGame } from '../src/core/season/flow';
import { userGame } from '../src/core/season/schedule';
import type { Save } from '../src/core/types';

function mk(seed = 6): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, 5, rng);
  return { save, rng };
}

describe('player XP', () => {
  test('levels cost more each time and give one point each', () => {
    const { save } = mk();
    const p = save.teams[5].roster.map(id => save.players[id]).find(x => !atCeiling(x))!;
    expect(levelOfPlayer(p)).toBe(1);
    expect(grantXp(save, p, xpNeed(1) - 1)).toBe(0);
    expect(grantXp(save, p, 1)).toBe(1);
    expect(levelOfPlayer(p)).toBe(2);
    expect(pointsOf(p)).toBe(1);
    expect(xpNeed(2)).toBeGreaterThan(xpNeed(1));
    const before = p.ratings.sht, o = ovr(p);
    expect(spendPoint(save, p.id, 'sht')).toBeNull();
    expect(p.ratings.sht).toBe(Math.min(99, before + POINT_GAIN));
    expect(ovr(p)).toBeGreaterThanOrEqual(o);
    expect(spendPoint(save, p.id, 'sht')).toMatch(/points/i);
  });

  test('a player at his ceiling earns credits instead of points', () => {
    const { save } = mk();
    const p = save.players[save.teams[5].roster[0]];
    p.potential = ovr(p);
    const credits = save.credits;
    grantXp(save, p, xpNeed(1));
    expect(pointsOf(p)).toBe(0);
    expect(save.credits).toBe(credits + 1);
  });

  test('a season of games levels up the rotation a few times each', () => {
    const { save, rng } = mk(9);
    let n = 0;
    while (save.phase === 'regular' && n++ < 40) { save.pendingEvent = null; advance(save, rng, 'simGame'); }
    const lv = save.teams[5].lineup.map(id => levelOfPlayer(save.players[id]));
    for (const l of lv) { expect(l).toBeGreaterThanOrEqual(2); expect(l).toBeLessThanOrEqual(8); }
    expect(readyToLevel(save).length + save.credits).toBeGreaterThan(0);
  });

  test('the choice after a game moves the right meter', () => {
    const { save } = mk();
    const fans = save.fans, m = save.players[save.teams[5].roster[0]].morale;
    afterGameChoice(save, 'fans', true);
    expect(save.fans).toBeGreaterThan(fans);
    afterGameChoice(save, 'team', true);
    expect(save.players[save.teams[5].roster[0]].morale).toBeGreaterThan(m);
  });
});

describe('momentum', () => {
  test('scoring in key moments wins games; wasting them loses', () => {
    const play = (make: boolean) => {
      let diff = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const { save } = mk(seed);
        const live = startLiveGame(save, userGame(save)!, new Rng(seed * 13));
        for (;;) {
          const st = live.next();
          if (st.kind === 'final') break;
          if (st.kind === 'user') live.resolveUser({ events: [{ t: 'shot', by: st.setup.offense[1], type: 'mid', made: make }], seconds: 12 });
        }
        const r = live.result(), home = r.homeId === save.userTeamId;
        diff += (home ? r.homeScore - r.awayScore : r.awayScore - r.homeScore);
      }
      return diff / 16;
    };
    const good = play(true), bad = play(false);
    expect(good).toBeGreaterThan(8);
    expect(bad).toBeLessThan(-8);
  });
});
