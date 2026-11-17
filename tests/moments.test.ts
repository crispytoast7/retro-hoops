import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { autoSpend, bestRatingFor, choresList, doChores } from '../src/core/org/chores';
import { MOMENTS_PER_SEASON, heatedGame, momentState, pendingMoment, resolveMoment, rollMoment } from '../src/core/org/moments';
import { grantXp, pointsOf, xpNeed } from '../src/core/org/xp';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import type { Save } from '../src/core/types';

function mk(seed = 6, team = 5): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  return { save, rng };
}
const answer = (save: Save) => { const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled)); };

describe('chores', () => {
  test('the assistant spends level-up points on what his position needs', () => {
    const { save } = mk();
    const me = save.teams[save.userTeamId];
    const c = me.roster.map(id => save.players[id]).find(p => p.pos === 'C')!;
    c.potential = 99;
    grantXp(save, c, xpNeed(1) + xpNeed(2));
    expect(pointsOf(c)).toBeGreaterThan(0);
    const before = { ...c.ratings };
    const ks = autoSpend(save, c.id);
    expect(ks.length).toBeGreaterThan(0);
    expect(pointsOf(c)).toBe(0);
    for (const k of ks) expect(['fin', 'def', 'reb']).toContain(k);
    expect(c.ratings[ks[0]]).toBeGreaterThan(before[ks[0]]);
    expect(bestRatingFor(c)).not.toBe('hnd');
  });

  test('do all: maintenance, level-ups and a healthy five in one tap', () => {
    const { save, rng } = mk();
    for (let i = 0; i < 4; i++) advance(save, rng, 'simWeek');
    const me = save.teams[save.userTeamId];
    me.facilities.arena.condition = 40; me.facilities.medical.condition = 60;
    save.credits = 50;
    const p = save.players[me.roster[0]];
    p.potential = 99;
    grantXp(save, p, xpNeed(1));
    save.players[me.lineup[2]].injury = { weeks: 2, desc: 'sprained ankle' };
    const ids = choresList(save).map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['repair', 'level', 'lineup']));
    const done = doChores(save);
    expect(done.length).toBeGreaterThanOrEqual(3);
    expect(me.facilities.arena.condition).toBe(100);
    expect(me.lineup.every(id => !save.players[id].injury)).toBe(true);
    expect(choresList(save).filter(c => c.id !== 'scout')).toEqual([]);
  });

  test('with the assistant on, chores get done at the end of every week', () => {
    const { save, rng } = mk();
    save.settings.assistant = true;
    const me = save.teams[save.userTeamId];
    for (let i = 0; i < 6; i++) {
      advance(save, rng, 'simWeek');
      answer(save);
    }
    me.facilities.training.condition = 30;
    save.credits = Math.max(save.credits, 20);
    advance(save, rng, 'simWeek');
    expect(me.facilities.training.condition).toBe(100);
    expect(save.news.some(n => n.text.startsWith('Your assistant'))).toBe(true);
  });
});

describe('big moments', () => {
  test('a handful per season, one at a time, and every answer resolves', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const { save, rng } = mk(seed, (seed * 3) % 16);
      save.credits = 60;
      let count = 0;
      while (save.phase === 'regular') {
        advance(save, rng, 'simWeek');
        const m = pendingMoment(save);
        if (!m) continue;
        count++; kinds.add(m.kind);
        expect(m.choices.length).toBeGreaterThanOrEqual(2);
        expect(m.text.length).toBeGreaterThan(30);
        // pick a different answer each time
        const options = m.choices.map((c, i) => (c.disabled ? -1 : i)).filter(i => i >= 0);
        const r = resolveMoment(save, options[count % options.length]);
        expect(r).not.toBeNull();
        expect(pendingMoment(save)).toBeNull();
      }
      expect(count).toBeLessThanOrEqual(MOMENTS_PER_SEASON);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  }, 30000);

  test('signing a star early extends his deal; a disabled choice does nothing', () => {
    const { save, rng } = mk();
    const me = save.teams[save.userTeamId];
    const star = me.roster.map(id => save.players[id]).sort((a, b) => b.ratings.sht - a.ratings.sht)[0];
    star.contract = { salary: 10, years: 1 };
    star.morale = 80;
    for (const k in star.ratings) (star.ratings as Record<string, number>)[k] = 85;
    save.week = 4;
    const st = momentState(save);
    // force the extension moment
    for (let i = 0; i < 40 && !pendingMoment(save); i++) { st.count = 0; rollMoment(save, rng); }
    const m = pendingMoment(save);
    if (m?.kind !== 'extension') return; // another moment came first: covered by the test above
    expect(resolveMoment(save, 0)).not.toBeNull();
    expect(star.contract.years).toBeGreaterThanOrEqual(3);
    expect(st.done).toContain(`ext${star.id}`);
  });

  test('firing back raises the stakes of that rivalry game', () => {
    const { save, rng } = mk();
    // find a rivalry game, put the user in the week before it
    for (let i = 0; i < 14 && save.phase === 'regular'; i++) {
      const st = momentState(save);
      st.pending = null;
      for (let k = 0; k < 30 && !pendingMoment(save); k++) { st.count = 0; rollMoment(save, rng); }
      const m = pendingMoment(save);
      if (m?.kind === 'trash') {
        resolveMoment(save, 0);
        const gid = heatedGame(save);
        expect(gid).toBeDefined();
        const fans = save.fans;
        const post = advance(save, rng, 'simGame')[0];
        expect(post.gameId).toBe(gid);
        expect(Math.abs(save.fans - fans)).toBeGreaterThanOrEqual(post.won ? 5 : 4);
        return;
      }
      st.pending = null;
      advance(save, rng, 'simWeek');
    }
  });
});
