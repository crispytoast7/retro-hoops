import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { deadlineOffers, evaluateTrade, executeTrade, shopPlayer, validateTrade } from '../src/core/gm/trade';
import { chooseTeam, worstTeam } from '../src/core/offseason/offseason';
import { ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { CALENDARS, cal } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(seed: number): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, worstTeam(save).id, rng);
  for (let i = 0; i < 2; i++) advance(save, rng, 'simWeek');
  return { save, rng };
}
const roster = (save: Save) => save.teams[save.userTeamId].roster.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a));

describe('shopping a player', () => {
  test('up to three offers from different teams, all legal and all ones the other team says yes to', () => {
    let some = 0;
    for (const seed of [3, 7, 11]) {
      const { save } = mk(seed);
      for (const p of roster(save).slice(0, 4)) {
        const offers = shopPlayer(save, p.id);
        expect(offers.length).toBeLessThanOrEqual(3);
        expect(new Set(offers.map(o => o.aId)).size).toBe(offers.length);
        for (const o of offers) {
          expect(o.bId).toBe(save.userTeamId);
          expect(o.bGives).toEqual({ players: [p.id], picks: [] });
          expect(validateTrade(save, o)).toBeNull();
          expect(evaluateTrade(save, o, o.aId).accept).toBe(true);
        }
        if (offers.length) some++;
      }
    }
    expect(some).toBeGreaterThanOrEqual(6);
  }, 60000);

  test('the same week shows the same offers, and an offer can be taken', () => {
    const { save } = mk(5);
    const p = roster(save)[1];
    const a = shopPlayer(save, p.id), b = shopPlayer(save, p.id);
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    executeTrade(save, a[0]);
    expect(save.players[p.id].teamId).toBe(a[0].aId);
    expect(shopPlayer(save, p.id)).toEqual([]); // he is not yours to shop any more
  }, 30000);

  test('nothing after the deadline', () => {
    const { save, rng } = mk(9);
    while (save.week <= cal(save).deadlineWeek) advance(save, rng, 'simWeek');
    const p = roster(save)[0];
    expect(shopPlayer(save, p.id)).toEqual([]);
    expect(deadlineOffers(save, rng)).toEqual([]);
  });

  test('deadline day: offers for different players from different teams', () => {
    let total = 0;
    for (const seed of [2, 4, 6]) {
      const { save, rng } = mk(seed);
      const offers = deadlineOffers(save, rng, 3);
      expect(offers.length).toBeLessThanOrEqual(3);
      total += offers.length;
      const targets = offers.map(o => o.bGives.players[0]);
      expect(new Set(targets).size).toBe(offers.length);
      expect(new Set(offers.map(o => o.aId)).size).toBe(offers.length);
      for (const o of offers) { expect(validateTrade(save, o)).toBeNull(); expect(evaluateTrade(save, o, o.aId).accept).toBe(true); }
    }
    expect(total).toBeGreaterThanOrEqual(4);
  }, 60000);

  test('fast enough to run on a tap', () => {
    const { save } = mk(8);
    const t0 = performance.now();
    for (const p of roster(save).slice(0, 3)) shopPlayer(save, p.id);
    const per = (performance.now() - t0) / 3;
    expect(per).toBeLessThan(400);
  }, 30000);
});
