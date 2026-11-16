import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import {
  adaptChallenge, challenge,
  COURTS, MAX_LEVEL, PERKS, TROPHIES, buyPerk, checkTrophies, coachLevel, courtStyle, gamesToUnlock, isUnlocked,
  levelOf, markTip, nextTip, perk, perkPoints, prog, resignDiscount, xpFor,
} from '../src/core/org/progress';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(): { save: Save; rng: Rng } {
  const save = newLeague({ seed: 4, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.full });
  const rng = new Rng(save.rng);
  chooseTeam(save, 2, rng);
  return { save, rng };
}

describe('coach progression', () => {
  test('levels rise with xp and cap out', () => {
    expect(levelOf(0)).toBe(1);
    for (let l = 2; l <= MAX_LEVEL; l++) { expect(xpFor(l)).toBeGreaterThan(xpFor(l - 1)); expect(levelOf(xpFor(l))).toBe(l); expect(levelOf(xpFor(l) - 1)).toBe(l - 1); }
    expect(levelOf(1e9)).toBe(MAX_LEVEL);
  });

  test('perks need a point, the right level, and stop at max rank', () => {
    const { save } = mk();
    expect(perkPoints(save)).toBe(0);
    expect(buyPerk(save, 'shooting')).toMatch(/perk point/i);
    prog(save).xp = xpFor(4);
    expect(perkPoints(save)).toBe(3);
    expect(buyPerk(save, 'clutch')).toMatch(/level 5/);
    expect(buyPerk(save, 'negotiator')).toBeNull();
    expect(resignDiscount(save)).toBeCloseTo(0.95);
    expect(buyPerk(save, 'develop')).toBeNull();
    expect(buyPerk(save, 'develop')).toMatch(/top rank/);
    expect(perk(save, 'develop')).toBe(1);
    expect(perkPoints(save)).toBe(1);
    // there are more ranks to buy than points to spend, so choices matter
    expect(PERKS.reduce((s, p) => s + p.max, 0)).toBeGreaterThan(MAX_LEVEL - 1);
  });

  test('the hub opens up over the first games, with one explainer at a time', () => {
    const { save, rng } = mk();
    expect(isUnlocked(save, 'roster')).toBe(true);
    expect(isUnlocked(save, 'trades')).toBe(false);
    expect(gamesToUnlock(save, 'trades')).toBe(5);
    expect(nextTip(save)!.id).toBe('welcome');
    markTip(save, 'welcome');
    expect(nextTip(save)).toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      save.pendingEvent = null;
      advance(save, rng, 'simGame');
      for (let t = nextTip(save); t; t = nextTip(save)) { seen.push(t.id); markTip(save, t.id); }
    }
    expect(isUnlocked(save, 'trades')).toBe(true);
    expect(seen).toEqual(['week', 'u_stats', 'u_coach', 'u_facilities', 'u_staff', 'u_finances', 'u_trades', 'u_scouting', 'u_history']);
    expect(save.tradeOffer === null || isUnlocked(save, 'trades')).toBe(true);
  });

  test('trophies pay out once', () => {
    const { save } = mk();
    save.coach.w = 1;
    const credits = save.credits;
    expect(checkTrophies(save)).toContain('first_win');
    expect(save.credits).toBe(credits + TROPHIES.find(t => t.id === 'first_win')!.credits);
    expect(checkTrophies(save)).not.toContain('first_win');
    expect(prog(save).fresh).toContain('first_win');
    expect(new Set(TROPHIES.map(t => t.id)).size).toBe(TROPHIES.length);
  });

  test('court styles unlock and fall back to the default', () => {
    const { save } = mk();
    prog(save).court = 'gold';
    expect(courtStyle(save).id).toBe('classic');
    save.coach.titles = 1;
    expect(courtStyle(save).id).toBe('gold');
    expect(COURTS[0].ok(save)).toBe(true);
    expect(coachLevel(save)).toBe(1);
  });

  test('difficulty adapts to how often you score in your key moments', () => {
    const { save } = mk();
    expect(challenge(save)).toBe(0.75); // a new coach starts on a forgiving court
    adaptChallenge(save, 10, 12);
    const up = challenge(save);
    expect(up).toBeGreaterThan(1);
    adaptChallenge(save, 2, 12);
    expect(challenge(save)).toBeLessThan(up);
    adaptChallenge(save, 3, 3); // too few moments to judge
    for (let i = 0; i < 30; i++) adaptChallenge(save, 12, 12);
    expect(challenge(save)).toBeLessThanOrEqual(2.6);
    for (let i = 0; i < 30; i++) adaptChallenge(save, 0, 12);
    expect(challenge(save)).toBe(0.5);
  });
});
