import { describe, expect, test } from 'vitest';
import { newLeague } from '../src/core/gen/league';
import { chooseTeam } from '../src/core/offseason/offseason';
import { Rng } from '../src/core/rng';
import { CALENDARS } from '../src/core/season/calendar';
import { buildSetup } from '../src/core/season/flow';
import { userGame } from '../src/core/season/schedule';
import { simulateGame } from '../src/core/sim/engine';
import { availablePlayers, resolveLineup, rotationPlan } from '../src/core/sim/team';
import type { Save } from '../src/core/types';
import { RATING_KEYS } from '../src/core/types';

function mk(seed = 6, team = 5): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'T', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false }, calendar: CALENDARS.classic });
  const rng = new Rng(save.rng);
  chooseTeam(save, team, rng);
  return { save, rng };
}
const planOf = (save: Save) => { const me = save.teams[save.userTeamId]; const pool = availablePlayers(me.roster.map(id => save.players[id])); return rotationPlan(pool, resolveLineup(me.lineup, pool), { backups: me.backups, depth: me.depth }); };

describe('the bench', () => {
  test('a reserve who could start plays a lot, a deep reserve only spells his man', () => {
    const { save } = mk();
    const me = save.teams[save.userTeamId];
    const bench = me.roster.filter(id => !me.lineup.includes(id)).map(id => save.players[id]);
    const [good, weak] = bench;
    // one reserve as good as the starters, one far behind them
    for (const k of RATING_KEYS) { good.ratings[k] = 88; weak.ratings[k] = 35; }
    const plan = planOf(save);
    const g = plan.find(s => s.backupId === good.id)!, w = plan.find(s => s.backupId === weak.id);
    expect(g.backupMin).toBeGreaterThanOrEqual(14);
    if (w) expect(w.backupMin).toBeLessThan(g.backupMin);
    expect(g.backupMin).toBeGreaterThan(Math.round(800 / 60));
    for (const s of plan) expect(s.starterMin + s.backupMin).toBe(48);
  });

  test('the backup you name is the one who comes in, until he is hurt or starting', () => {
    const { save } = mk();
    const me = save.teams[save.userTeamId];
    const bench = me.roster.filter(id => !me.lineup.includes(id));
    const auto = planOf(save);
    // name the man the staff would not have picked for the first slot
    const other = bench.find(id => id !== auto[0].backupId)!;
    me.backups = [other, null, null, null, null];
    let plan = planOf(save);
    expect(plan[0].backupId).toBe(other);
    expect(new Set(plan.map(s => s.backupId).filter(x => x !== null)).size).toBe(plan.filter(s => s.backupId !== null).length);
    save.players[other].injury = { weeks: 2, desc: 'sprained ankle' };
    plan = planOf(save);
    expect(plan.every(s => s.backupId !== other)).toBe(true);
  });

  test('a tight rotation leans on the starters, a deep one shares the minutes, and the box score agrees', () => {
    const minutes = (depth: 'tight' | 'normal' | 'deep') => {
      const { save, rng } = mk();
      const me = save.teams[save.userTeamId];
      me.depth = depth;
      const g = userGame(save)!;
      const plan = planOf(save);
      const r = simulateGame(buildSetup(save, g, 0), rng);
      const box = g.homeId === me.id ? r.box.home : r.box.away;
      const startersMin = me.lineup.reduce((s, id) => s + (box.find(l => l.playerId === id)?.min ?? 0), 0);
      const used = box.filter(l => l.min > 0).length;
      return { plan, startersMin, used, ot: r.homeScore + r.awayScore > 0 && box.reduce((s, l) => s + l.min, 0) > 240 };
    };
    const t = minutes('tight'), n = minutes('normal'), d = minutes('deep');
    expect(t.plan.filter(s => s.backupId !== null).length).toBe(2);
    expect(n.plan.filter(s => s.backupId !== null).length).toBe(5);
    const planned = (p: typeof t.plan) => p.reduce((s, x) => s + x.starterMin, 0);
    expect(planned(t.plan)).toBeGreaterThan(planned(n.plan));
    expect(planned(n.plan)).toBeGreaterThan(planned(d.plan));
    // and the game that was played followed the plan (overtime aside)
    if (!t.ot) { expect(t.used).toBe(7); expect(Math.abs(t.startersMin - planned(t.plan))).toBeLessThanOrEqual(6); }
    if (!d.ot) expect(Math.abs(d.startersMin - planned(d.plan))).toBeLessThanOrEqual(6);
    expect(t.startersMin).toBeGreaterThan(d.startersMin);
  });
});
