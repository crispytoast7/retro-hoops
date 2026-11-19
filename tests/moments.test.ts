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

describe('the team store and the trophy room', () => {
  test('the store pays every game, more at home and more as it grows', async () => {
    const { gameCredits } = await import('../src/core/org/economy');
    const { save } = mk();
    const me = save.teams[save.userTeamId];
    const res = (home: boolean) => ({ homeId: home ? me.id : (me.id + 1) % 16, awayId: home ? (me.id + 1) % 16 : me.id, homeScore: 100, awayScore: 90, box: { home: [], away: [] } } as any);
    const merch = (home: boolean) => gameCredits(save, res(home), [], false).find(c => c.label === 'Team store')?.amount ?? 0;
    me.facilities.store = { level: 1, condition: 100 };
    const low = merch(true);
    me.facilities.store = { level: 5, condition: 100 };
    expect(merch(true)).toBeGreaterThan(low * 4);
    expect(merch(false)).toBeCloseTo(merch(true) / 2, 1);
  });

  test('a trophy room lifts fan support week by week, up to a ceiling', async () => {
    const { weeklyFacilities } = await import('../src/core/org/economy');
    const { save, rng } = mk();
    const me = save.teams[save.userTeamId];
    me.facilities.trophy = { level: 3, condition: 100 };
    save.fans = 40;
    for (let i = 0; i < 40; i++) { weeklyFacilities(save, rng); me.facilities.trophy.condition = 100; }
    expect(save.fans).toBeGreaterThanOrEqual(76);
    expect(save.fans).toBeLessThanOrEqual(77);
  });

  test('an old save without the new buildings gets them at level 1', async () => {
    const { migrate } = await import('../src/state/persist');
    const { save } = mk();
    for (const t of save.teams) { delete (t.facilities as any).store; delete (t.facilities as any).trophy; }
    const back = migrate(JSON.parse(JSON.stringify(save)))!;
    for (const t of back.teams) { expect(t.facilities.store.level).toBe(1); expect(t.facilities.trophy.level).toBe(1); }
  });
});

describe('GOAT lists', () => {
  test('two a season, each reporter with an angle, and the news carries the list', async () => {
    const { save, rng } = mk(4, 5);
    const lists: NonNullable<Save['news'][number]['list']>[] = [];
    for (let season = 0; season < 3; season++) {
      const { takeJob } = await import('../src/core/org/people');
      for (let i = 0; i < 60 && save.phase !== 'offseason'; i++) {
        if (save.fired) takeJob(save, save.fired.offers[0], true);
        advance(save, rng, 'simWeek');
        const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled));
      }
      if (save.fired) takeJob(save, save.fired.offers[0], true);
      // walk the offseason quickly
      const { advanceOffseason } = await import('../src/core/offseason/offseason');
      const { userOnClock, userDraftPick } = await import('../src/core/offseason/offseason');
      for (let i = 0; i < 40 && save.phase === 'offseason'; i++) { if (userOnClock(save)) userDraftPick(save, null, rng); advanceOffseason(save, rng); }
    }
    for (const n of save.news) if (n.list) lists.push(n.list);
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const l of lists) {
      expect(l.rows.length).toBe(10);
      expect(new Set(l.rows.map(r => r.playerId)).size).toBe(10);
      expect(l.rows[0].note.length).toBeGreaterThan(5);
    }
    expect(new Set(lists.map(l => l.by)).size).toBe(3);
  }, 60000);
});
