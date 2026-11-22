import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { DUNKS, DUNK_TRIES, JUDGES, STARS_PER_CONF, THREE_MAX, allStarPending, allStarState, allStarWeek, finishAllStar, judgeDunk, simDunk, simThree } from '../src/core/org/allstar';
import { pendingMoment, resolveMoment } from '../src/core/org/moments';
import { prog } from '../src/core/org/progress';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(seed = 6): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, 5, rng);
  return { save, rng };
}
const week = (save: Save, rng: Rng) => { advance(save, rng, 'simWeek'); const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled)); };
const toBreak = (save: Save, rng: Rng) => { for (let i = 0; i < 20 && !allStarPending(save); i++) week(save, rng); };

describe('All-Star weekend', () => {
  test('at mid-season the All-Stars are named and both contests wait for the user', () => {
    const { save, rng } = mk();
    toBreak(save, rng);
    expect(save.week).toBe(allStarWeek(save));
    const st = allStarState(save)!;
    expect(st.open).toBe(true);
    expect(st.stars.length).toBe(STARS_PER_CONF * 2);
    for (const conf of [0, 1]) expect(st.stars.filter(id => save.teams[save.players[id].teamId!].conf === conf).length).toBe(STARS_PER_CONF);
    for (const id of st.stars) expect(save.players[id].awards).toContain(`All-Star (Y${save.year})`);
    // his own best shooter and dunker, against three from other clubs
    const me = save.teams[save.userTeamId];
    expect(save.players[st.shooterId].teamId).toBe(me.id);
    expect(save.players[st.dunkerId].teamId).toBe(me.id);
    expect(st.rivals3.length).toBe(3); expect(st.rivalsDunk.length).toBe(3);
    for (const id of [...st.rivals3, ...st.rivalsDunk]) expect(save.players[id].teamId).not.toBe(me.id);
  }, 60000);

  test('winning a contest pays, makes the news, gives the player the award and counts toward a trophy', () => {
    const { save, rng } = mk();
    toBreak(save, rng);
    const st = allStarState(save)!;
    const credits = save.credits, fans = save.fans;
    const out = finishAllStar(save, { three: THREE_MAX, dunk: DUNK_TRIES * JUDGES * 10 })!;
    expect(out.open).toBe(false);
    expect(out.three![0].mine).toBe(true); expect(out.dunk![0].mine).toBe(true);
    expect(out.three!.length).toBe(4);
    expect(save.credits).toBe(credits + 6);
    expect(save.fans).toBeGreaterThanOrEqual(Math.min(100, fans + 5));
    expect(save.players[st.shooterId].awards).toContain(`3-Point Champion (Y${save.year})`);
    expect(save.players[st.dunkerId].awards).toContain(`Dunk Champion (Y${save.year})`);
    expect(prog(save).counters.three_win).toBe(1); expect(prog(save).counters.dunk_win).toBe(1);
    expect(save.news.filter(n => n.text.includes('contest')).length).toBeGreaterThanOrEqual(2);
    // settled once: a second call changes nothing
    finishAllStar(save, { three: 0, dunk: 0 });
    expect(save.credits).toBe(credits + 6);
  }, 60000);

  test('a poor showing pays nothing, and a weekend he ignores is settled when the week ends', () => {
    const a = mk();
    toBreak(a.save, a.rng);
    const credits = a.save.credits;
    const out = finishAllStar(a.save, { three: 0, dunk: 0 })!;
    expect(out.three![3].mine).toBe(true); expect(out.dunk![3].mine).toBe(true);
    expect(a.save.credits).toBe(credits);
    const b = mk();
    toBreak(b.save, b.rng);
    week(b.save, b.rng);
    expect(allStarPending(b.save)).toBe(false);
    expect(allStarState(b.save)!.three!.length).toBe(4);
    // and it happens once a season
    const before = allStarState(b.save)!.stars.slice();
    week(b.save, b.rng);
    expect(allStarState(b.save)!.stars).toEqual(before);
  }, 60000);

  test('rival scores are in range and better players score more; harder dunks are worth more', () => {
    const { save } = mk();
    const ps = Object.values(save.players).filter(p => p.teamId !== null);
    const best = (k: 'sht' | 'fin') => ps.slice().sort((x, y) => y.ratings[k] - x.ratings[k])[0];
    const worst = (k: 'sht' | 'fin') => ps.slice().sort((x, y) => x.ratings[k] - y.ratings[k])[0];
    const rng = new Rng(7);
    const avg = (f: () => number) => { let s = 0; for (let i = 0; i < 300; i++) { const v = f(); s += v; } return s / 300; };
    for (let i = 0; i < 100; i++) { const t = simThree(best('sht'), rng); expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(THREE_MAX); const d = simDunk(best('fin'), rng); expect(d).toBeGreaterThanOrEqual(DUNK_TRIES * JUDGES * 5); expect(d).toBeLessThanOrEqual(DUNK_TRIES * JUDGES * 10); }
    expect(avg(() => simThree(best('sht'), rng))).toBeGreaterThan(avg(() => simThree(worst('sht'), rng)) + 1);
    expect(avg(() => simDunk(best('fin'), rng))).toBeGreaterThan(avg(() => simDunk(worst('fin'), rng)) + 5);
    const total = (style: (typeof DUNKS)[number]['style'], q: number) => avg(() => judgeDunk(style, q, rng).reduce((s, v) => s + v, 0));
    expect(total('legs', 3)).toBeGreaterThan(total('windmill', 3));
    expect(total('windmill', 3)).toBeGreaterThan(total('twohand', 3));
    expect(total('windmill', 3)).toBeGreaterThan(total('windmill', 2));
    // a missed dunk scores worse than the safest dunk made
    expect(total('legs', 1)).toBeLessThan(total('twohand', 2));
  });
});
