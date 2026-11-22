import { expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { Rng } from '../src/core/rng';
import { CALENDARS, seriesNeed } from '../src/core/season/calendar';
import { advance, buildSetup, finishUserGame, playoffsUnsettled, settlePlayoffs } from '../src/core/season/flow';
import { userGame } from '../src/core/season/schedule';
import { simulateGame } from '../src/core/sim/engine';
import type { Save } from '../src/core/types';

test('the Championship is a best of three; the rounds before it are single games', () => {
  const lens = new Set<number>();
  for (let seed = 1; seed <= 6; seed++) {
    const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
    const rng = new Rng(save.rng); chooseTeam(save, 3, rng);
    expect(seriesNeed(save, 1)).toBe(1); expect(seriesNeed(save, 3)).toBe(2);
    let po = save.playoffs;
    for (let i = 0; i < 60 && save.phase !== 'offseason'; i++) { advance(save, rng, 'simWeek'); po = save.playoffs ?? po; }
    expect(po).toBeTruthy();
    for (const s of po!.series) {
      if (s.round < 3) { expect(s.games.length).toBe(1); continue; }
      expect(Math.max(s.highW, s.lowW)).toBe(2);
      expect(s.games.length).toBe(s.highW + s.lowW);
      const gs = s.games.map(id => save.schedule.find(g => g.id === id)!);
      // the better team hosts games one and three
      expect(gs[0].homeId).toBe(s.highId); expect(gs[1].homeId).toBe(s.lowId); if (gs[2]) expect(gs[2].homeId).toBe(s.highId);
      expect(po!.championId).toBe(s.winnerId);
      lens.add(s.games.length);
    }
  }
  // some finals are sweeps and some go the distance
  expect([...lens].every(n => n === 2 || n === 3)).toBe(true);
}, 120000);

/** A league whose user team is good enough to reach the Championship, simulated up to the playoffs. */
function contender(seed: number): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng); chooseTeam(save, 3, rng);
  for (const id of save.teams[save.userTeamId].roster) for (const k in save.players[id].ratings) (save.players[id].ratings as Record<string, number>)[k] = 92;
  for (let i = 0; i < 30 && save.phase === 'regular'; i++) advance(save, rng, 'simWeek');
  return { save, rng };
}
/** Play the user's next game the way the game screen does: the game is finished first, the day is closed after. */
function byHand(save: Save, rng: Rng): void {
  const g = userGame(save)!;
  finishUserGame(save, g, simulateGame(buildSetup(save, g, 0), rng), [], rng);
  advance(save, rng, 'afterUser');
}

test('a whole playoff run played by hand, Championship included, ends with a champion', () => {
  const { save, rng } = contender(11);
  let games = 0;
  for (let i = 0; i < 12 && save.phase === 'playoffs' && userGame(save); i++) { byHand(save, rng); games++; }
  // either he was knocked out on the way, or the season is over: never stuck in between
  const final = save.playoffs!.series.find(s => s.round === 3);
  if (final && (final.highId === save.userTeamId || final.lowId === save.userTeamId)) {
    expect(save.phase).toBe('offseason');
    expect(Math.max(final.highW, final.lowW)).toBe(2);
    expect(final.games.length).toBe(final.highW + final.lowW);
    expect(save.playoffs!.championId).toBe(final.winnerId);
    expect(games).toBeGreaterThanOrEqual(4);
  } else expect(userGame(save)).toBeUndefined();
}, 120000);

test('a save left stuck by the old bug (a Championship game played but never counted) repairs itself', () => {
  const { save, rng } = contender(11);
  while (save.phase === 'playoffs' && save.week < CALENDARS.classic.regWeeks + 3 && userGame(save)) byHand(save, rng);
  const final = save.playoffs!.series.find(s => s.round === 3)!;
  if (!(final.highId === save.userTeamId || final.lowId === save.userTeamId) || save.phase !== 'playoffs') return; // knocked out early: nothing to check
  // the old bug: game one is finished, but the series never heard about it
  const g = userGame(save)!;
  finishUserGame(save, g, simulateGame(buildSetup(save, g, 0), rng), [], rng);
  expect(userGame(save)).toBeUndefined();
  expect(final.highW + final.lowW).toBe(0);
  expect(playoffsUnsettled(save)).toBe(true);
  settlePlayoffs(save, rng);
  expect(playoffsUnsettled(save)).toBe(false);
  expect(final.highW + final.lowW).toBe(1);
  expect(userGame(save)).toBeDefined();
  // counting twice changes nothing
  settlePlayoffs(save, rng);
  expect(final.highW + final.lowW).toBe(1);
  expect(final.games.length).toBe(2);
  // and "Sim Championship" now finishes the series
  advance(save, rng, 'simWeek');
  expect(save.phase).toBe('offseason');
  expect(save.playoffs!.championId).toBe(final.winnerId);
}, 120000);
