import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { momentState, pendingMoment, resolveMoment, rollMoment, stakesFor } from '../src/core/org/moments';
import { progressPlayer } from '../src/core/org/people';
import { emptyStats, ovr, raiseRating } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { SIM_PAY, advance, buildSetup, finishUserGame } from '../src/core/season/flow';
import { userGame } from '../src/core/season/schedule';
import { simulateGame } from '../src/core/sim/engine';
import type { GameResult, Save } from '../src/core/types';
import { RATING_KEYS } from '../src/core/types';

function mk(seed = 6, team = 5): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  return { save, rng };
}
const answer = (save: Save) => { const m = pendingMoment(save); if (m) resolveMoment(save, m.choices.findIndex(c => !c.disabled)); };
/** The same game with the score turned round, so the user wins or loses as the test needs. */
function decided(save: Save, r: GameResult, userWins: boolean): GameResult {
  const home = r.homeId === save.userTeamId;
  const hi = Math.max(r.homeScore, r.awayScore), lo = Math.min(r.homeScore, r.awayScore) - (r.homeScore === r.awayScore ? 1 : 0);
  return { ...r, homeScore: home === userWins ? hi : lo, awayScore: home === userWins ? lo : hi };
}

describe('drama', () => {
  test('every new moment turns up, and every answer to it works', () => {
    const want = ['feud', 'minutes', 'nightout', 'hurt', 'refs', 'vow', 'revenge', 'rumour', 'ultimatum', 'wantsout'];
    const seen = new Map<string, Set<number>>();
    for (const seed of [6, 9]) {
      const { save, rng } = mk(seed);
      const me = save.teams[save.userTeamId];
      for (let w = 0; w < 12 && save.phase === 'regular'; w++) {
        advance(save, rng, 'simWeek'); answer(save);
        for (let k = 0; k < 60; k++) {
          // a fresh slate each time, with the conditions the rarer moments need
          const st = momentState(save);
          st.pending = null; st.count = 0; st.done = []; st.stakes = undefined;
          for (const id of me.roster) { save.players[id].injury = null; save.players[id].morale = 60; }
          save.coach.rep = 60;
          save.owner.approval = k % 7 === 0 ? 20 : 60;
          me.record.streak = k % 3 === 0 ? -2 : 2;
          save.tradeDemands = [];
          if (k % 4 === 0) { me.record.w = 1; me.record.l = 6; } else { me.record.w = 5; me.record.l = 2; }
          const g = userGame(save);
          if (!g) break;
          // someone on the other bench used to play here
          const opp = save.teams[g.homeId === me.id ? g.awayId : g.homeId];
          const ex = save.players[opp.roster[0]];
          for (const key of RATING_KEYS) ex.ratings[key] = Math.max(ex.ratings[key], 75);
          if (!ex.seasons.some(s => s.teamId === me.id)) ex.seasons.push({ year: 0, teamId: me.id, age: ex.age - 1, ovr: ovr(ex), stats: emptyStats() });
          // and a veteran on the user's bench is as good as the man ahead of him
          const sub = me.roster.map(id => save.players[id]).find(p => !me.lineup.includes(p.id));
          if (sub) { sub.age = 29; for (const key of RATING_KEYS) sub.ratings[key] = 80; }
          rollMoment(save, rng);
          const m = pendingMoment(save);
          if (!m) continue;
          expect(m.choices.length).toBeGreaterThanOrEqual(2);
          expect(m.text.length).toBeGreaterThan(40);
          const open = m.choices.map((c, i) => (c.disabled ? -1 : i)).filter(i => i >= 0);
          const tried = seen.get(m.kind) ?? new Set<number>();
          const idx = open.find(i => !tried.has(i)) ?? open[k % open.length];
          const r = resolveMoment(save, idx, rng);
          expect(r).not.toBeNull();
          expect(r!.text.length).toBeGreaterThan(10);
          expect(pendingMoment(save)).toBeNull();
          tried.add(idx); seen.set(m.kind, tried);
          // whatever happened, he can still put five on the floor
          expect(new Set(me.lineup).size).toBe(5);
          expect(me.lineup.every(id => me.roster.includes(id))).toBe(true);
        }
      }
    }
    for (const kind of want) expect([...seen.keys()]).toContain(kind);
    // and every choice of every one of them was taken at least once
    expect(seen.get('feud')!.size).toBe(3);
    expect(seen.get('nightout')!.size).toBe(3);
    expect(seen.get('hurt')!.size).toBe(2);
    expect(seen.get('wantsout')!.size).toBe(3);
  }, 120000);

  test('a guarantee rides on the next game: paid when it is won, punished when it is lost', () => {
    for (const userWins of [true, false]) {
      const { save, rng } = mk(6);
      const me = save.teams[save.userTeamId];
      for (let i = 0; i < 3; i++) { advance(save, rng, 'simWeek'); answer(save); }
      let found = false;
      for (let k = 0; k < 400 && !found; k++) {
        const st = momentState(save); st.pending = null; st.count = 0; st.done = []; st.stakes = undefined;
        for (const id of me.roster) save.players[id].injury = null;
        rollMoment(save, rng);
        if (pendingMoment(save)?.kind === 'vow') found = true;
      }
      expect(found).toBe(true);
      const g = userGame(save)!;
      expect(resolveMoment(save, 0, rng)).not.toBeNull();
      expect(stakesFor(save, g.id)?.label).toMatch(/guarantee/);
      const fans = save.fans;
      const post = finishUserGame(save, g, decided(save, simulateGame(buildSetup(save, g, 0), rng), userWins), [], rng);
      expect(post.won).toBe(userWins);
      expect(post.notes.some(n => /guaranteed/.test(n.text) && n.good === userWins)).toBe(true);
      expect(post.credits.some(c => /guarantee/.test(c.label))).toBe(userWins);
      if (!userWins) expect(save.fans).toBeLessThan(fans);
      expect(stakesFor(save, g.id)).toBeNull();
    }
  }, 60000);
});

describe('simming is not free', () => {
  test('a game left to the assistant pays half; the same game played by hand pays in full', () => {
    const base = mk(6);
    for (let i = 0; i < 2; i++) { advance(base.save, base.rng, 'simWeek'); answer(base.save); }
    const pay = (simmed: boolean) => {
      const save: Save = JSON.parse(JSON.stringify(base.save));
      const rng = new Rng(base.rng.state);
      const g = userGame(save)!;
      const result = simulateGame(buildSetup(save, g, 0), rng);
      return finishUserGame(save, g, result, [], rng, null, simmed);
    };
    const hand = pay(false), sim = pay(true);
    expect(hand.credits.some(c => /Simulated/.test(c.label))).toBe(false);
    const cut = sim.credits.find(c => /Simulated/.test(c.label))!;
    expect(cut.amount).toBeLessThan(0);
    const takings = (post: typeof hand) => post.credits.filter(c => ['Win', 'Showed up', 'Home gate', 'Team store'].includes(c.label)).reduce((s, c) => s + c.amount, 0);
    expect(takings(sim)).toBeCloseTo(takings(hand), 5);
    expect(-cut.amount).toBeCloseTo(takings(sim) * (1 - SIM_PAY), 1);
    expect(sim.xp).toBeLessThan(hand.xp);
    // the Sim button goes through the same door
    const { save, rng } = mk(6);
    const posts = advance(save, rng, 'simGame');
    expect(posts.length).toBe(1);
    expect(posts[0].credits.some(c => /Simulated/.test(c.label))).toBe(true);
  }, 60000);
});

describe('the ceiling is physical', () => {
  test('no rating raise takes a player past his ceiling', () => {
    const { save } = mk(6);
    const p = save.players[save.teams[save.userTeamId].roster[0]];
    p.potential = ovr(p) + 1;
    let gained = 0;
    for (let i = 0; i < 40; i++) for (const k of RATING_KEYS) gained += raiseRating(p, k, 4);
    expect(gained).toBeGreaterThan(0);
    expect(ovr(p)).toBeLessThanOrEqual(p.potential);
    // at the ceiling a raise does nothing at all
    const before = { ...p.ratings };
    p.potential = ovr(p);
    for (const k of RATING_KEYS) if (raiseRating(p, k, 4) > 0) expect(ovr(p)).toBeLessThanOrEqual(p.potential);
    expect(ovr(p)).toBe(p.potential);
    expect(Object.values(p.ratings).reduce((s, v) => s + v, 0)).toBeGreaterThanOrEqual(Object.values(before).reduce((s, v) => s + v, 0));
  });
  test('a summer of growth stops at the ceiling, and the ceiling comes down with age', () => {
    const { save, rng } = mk(6);
    const all = Object.values(save.players);
    let grew = 0;
    for (const p of all) {
      const before = ovr(p), cap = Math.max(p.potential, before);
      progressPlayer(p, rng, 5, 1);
      expect(ovr(p)).toBeLessThanOrEqual(cap);
      if (ovr(p) > before) grew++;
      if (p.age >= 30) { expect(p.potential).toBeGreaterThanOrEqual(ovr(p)); expect(p.potential).toBeLessThanOrEqual(ovr(p) + 2); }
    }
    expect(grew).toBeGreaterThan(20);
  });
});
