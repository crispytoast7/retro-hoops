import { expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { Rng } from '../src/core/rng';
import { CALENDARS, seriesNeed } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';

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
