import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { markTip } from '../src/core/org/progress';
import { honorNow, weekState } from '../src/core/org/week';
import { Rng } from '../src/core/rng';
import { bracketView, playoffMoment } from '../src/core/season/bracket';
import { CALENDARS } from '../src/core/season/calendar';
import { advance } from '../src/core/season/flow';
import { standings } from '../src/core/season/schedule';
import type { Save } from '../src/core/types';

function mk(seed: number, team: number): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  return { save, rng };
}
const step = (save: Save, rng: Rng) => advance(save, rng, 'simWeek');

describe('the bracket', () => {
  test('before the playoffs it is projected from the standings: 1 v 4 and 2 v 3', () => {
    const { save, rng } = mk(4, 5);
    for (let i = 0; i < 6; i++) step(save, rng);
    const v = bracketView(save);
    expect(v.projected).toBe(true);
    for (const conf of [0, 1]) {
      const t = standings(save, conf);
      const c = v.confs[conf];
      expect([c.semis[0].a.teamId, c.semis[0].b.teamId]).toEqual([t[0].id, t[3].id]);
      expect([c.semis[1].a.teamId, c.semis[1].b.teamId]).toEqual([t[1].id, t[2].id]);
      expect(c.semis[0].a.seed).toBe(1); expect(c.semis[1].b.seed).toBe(3);
      expect(c.final.a.teamId).toBeNull();
    }
    expect(v.final.a.label).toMatch(/East/);
    expect(playoffMoment(save)).toBeNull();
  });

  test('it fills in round by round and ends with a champion', () => {
    const { save, rng } = mk(4, 5);
    while (save.phase === 'regular') step(save, rng);
    let v = bracketView(save);
    expect(v.projected).toBe(false);
    expect(v.confs[0].semis.every(m => m.a.teamId !== null && !m.decided)).toBe(true);
    step(save, rng);
    v = bracketView(save);
    for (const c of v.confs) {
      expect(c.semis.every(m => m.decided && m.a.won !== m.b.won && m.a.score !== null)).toBe(true);
      const winners = c.semis.map(m => (m.a.won ? m.a.teamId : m.b.teamId));
      expect([c.final.a.teamId, c.final.b.teamId].sort()).toEqual(winners.slice().sort());
    }
    step(save, rng); step(save, rng);
    v = bracketView(save);
    expect(v.championId).not.toBeNull();
    expect(v.final.decided).toBe(true);
    expect([v.final.a, v.final.b].find(s => s.won)!.teamId).toBe(v.championId);
  });
});

describe('playoff moments', () => {
  test('every run is told once: in or out at the start, then each step, and never twice', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const { save, rng } = mk(seed, (seed * 5) % 16);
      while (save.phase === 'regular') step(save, rng);
      const me = save.teams[save.userTeamId];
      const made = save.playoffs!.series.some(s => s.highId === me.id || s.lowId === me.id);
      const first = playoffMoment(save)!;
      expect(first.kind).toBe(made ? 'begin' : 'missed');
      expect(first.text.length).toBeGreaterThan(20);
      kinds.add(first.kind);
      markTip(save, first.id);
      expect(playoffMoment(save)).toBeNull();
      const seen = [first.id];
      for (let i = 0; i < 4; i++) {
        if (save.phase === 'playoffs') step(save, rng);
        const m = playoffMoment(save);
        if (m) {
          expect(seen).not.toContain(m.id);
          kinds.add(m.kind); seen.push(m.id); markTip(save, m.id);
          if (m.kind === 'champion') expect(save.playoffs!.championId).toBe(me.id);
          if (m.kind === 'out') expect(save.playoffs!.series.some(s => (s.highId === me.id || s.lowId === me.id) && s.winnerId !== undefined && s.winnerId !== me.id)).toBe(true);
        }
        if (save.phase === 'offseason') break;
      }
      // a team that made it always ends as champion or eliminated
      if (made) expect(seen.some(id => id.endsWith(':champ') || id.endsWith(':out'))).toBe(true);
    }
    expect(kinds.has('begin')).toBe(true);
    expect(kinds.has('missed')).toBe(true);
    expect(kinds.has('out')).toBe(true);
  }, 30000);
});

describe('player of the week', () => {
  test('one is named every week; when he is yours the club is paid and the hub says so', () => {
    const { save, rng } = mk(2, 3);
    let named = 0, mine = 0;
    for (let seed = 0; save.phase === 'regular'; seed++) {
      const before = save.news.length ? save.news[0].text : '';
      const credits = save.credits;
      step(save, rng);
      const item = save.news.find(n => n.text.startsWith('Player of the Week'));
      if (item && item.text !== before) named++;
      if (honorNow(save)) { mine++; expect(save.credits).toBeGreaterThan(credits); expect(weekState(save).honor!.text).toMatch(/pts/); }
    }
    expect(named).toBeGreaterThanOrEqual(13);
    expect(mine).toBeLessThan(8);
  });
});
