// End-to-end: generate a league and run several full seasons and offseasons headlessly.
import { describe, expect, test } from 'vitest';
import { REG_WEEKS, ROSTER_MAX, SALARY_CAP } from '../src/core/constants';
import { newLeague } from '../src/core/gen/league';
import { advanceOffseason, chooseTeam, draftDone, expiringPlayers, faOver, faNextDay, resignPlayer, userDraftPick, userOnClock } from '../src/core/offseason/offseason';
import { payroll } from '../src/core/org/finance';
import { resolveEvent, takeJob } from '../src/core/org/people';
import { ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { endWeek } from '../src/core/season/flow';
import { genSchedule } from '../src/core/season/schedule';
import type { Save } from '../src/core/types';

function mk(seed: number): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'Test Coach', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false } });
  const rng = new Rng(save.rng);
  chooseTeam(save, 3, rng);
  return { save, rng };
}

function checkLeague(save: Save): void {
  for (const t of save.teams) {
    expect(t.roster.length, `${t.abbr} roster size`).toBeGreaterThanOrEqual(8);
    expect(t.roster.length, `${t.abbr} roster size`).toBeLessThanOrEqual(ROSTER_MAX);
    expect(new Set(t.roster).size).toBe(t.roster.length);
    expect(t.lineup.length, `${t.abbr} lineup`).toBe(5);
    expect(new Set(t.lineup).size).toBe(5);
    for (const id of t.lineup) expect(t.roster).toContain(id);
    for (const id of t.roster) { expect(save.players[id], `player ${id}`).toBeTruthy(); expect(save.players[id].teamId).toBe(t.id); }
    expect(payroll(save, t), `${t.abbr} payroll`).toBeLessThanOrEqual(SALARY_CAP + 0.01);
  }
  for (const id of save.freeAgents) expect(save.players[id].teamId).toBeNull();
}

function playSeason(save: Save, rng: Rng): void {
  let guard = 0;
  while (save.phase !== 'offseason' && guard++ < 40) {
    if (save.pendingEvent) resolveEvent(save, 0);
    if (save.fired) takeJob(save, save.fired.offers[0], true);
    endWeek(save, rng);
  }
  expect(save.phase).toBe('offseason');
}

function playOffseason(save: Save, rng: Rng): void {
  let guard = 0;
  while (save.phase === 'offseason' && guard++ < 60) {
    const off = save.offseason!;
    if (save.fired) takeJob(save, save.fired.offers[0], true);
    if (off.step === 'contracts') for (const p of expiringPlayers(save)) if (ovr(p) >= 68) resignPlayer(save, p.id);
    if (off.step === 'draft') {
      let g2 = 0;
      while (!draftDone(save) && g2++ < 40) {
        if (userOnClock(save)) { const best = off.prospects.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a))[0]; if (userDraftPick(save, best.id, rng)) userDraftPick(save, null, rng); }
        else break;
      }
      expect(draftDone(save)).toBe(true);
    }
    if (off.step === 'freeAgency' && !faOver(save)) { faNextDay(save, rng); continue; }
    advanceOffseason(save, rng);
  }
  expect(save.phase).toBe('regular');
}

describe('schedule', () => {
  test('14 games each, home and away balanced, one game a week', () => {
    const { save, rng } = mk(11);
    const s = genSchedule(save, rng);
    expect(s.length).toBe((16 * REG_WEEKS) / 2);
    for (const t of save.teams) {
      const mine = s.filter(g => g.homeId === t.id || g.awayId === t.id);
      expect(mine.length).toBe(REG_WEEKS);
      expect(new Set(mine.map(g => g.week)).size).toBe(REG_WEEKS);
      const home = mine.filter(g => g.homeId === t.id).length;
      expect(home).toBeGreaterThanOrEqual(6); expect(home).toBeLessThanOrEqual(8);
      const opps = mine.map(g => (g.homeId === t.id ? g.awayId : g.homeId));
      expect(new Set(opps).size).toBe(REG_WEEKS);
    }
  });
});

describe('full seasons', () => {
  test('new league is legal', () => { checkLeague(mk(5).save); });

  test('five seasons run end to end and the league stays legal', () => {
    const { save, rng } = mk(21);
    const avgs: number[] = [];
    for (let y = 1; y <= 5; y++) {
      expect(save.year).toBe(y);
      playSeason(save, rng);
      const h = save.history[save.history.length - 1];
      expect(h.year).toBe(y);
      expect(save.teams[h.championId].titles).toContain(y);
      for (const t of save.teams) expect(t.history[t.history.length - 1].w + t.history[t.history.length - 1].l).toBe(REG_WEEKS);
      expect(h.awards.find(a => a.award === 'MVP')).toBeTruthy();
      playOffseason(save, rng);
      checkLeague(save);
      expect(save.schedule.length).toBe(112);
      expect(save.draftClass.length).toBe(40);
      const all = save.teams.flatMap(t => t.lineup.map(id => ovr(save.players[id])));
      avgs.push(all.reduce((s, v) => s + v, 0) / all.length);
    }
    // talent level should not drift far over time
    expect(Math.abs(avgs[4] - avgs[0])).toBeLessThan(5);
    expect(save.coach.seasons).toBe(5);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
    console.log('starter ovr by season', avgs.map(a => a.toFixed(1)).join(' '), '| players', Object.keys(save.players).length, '| save KB', Math.round(JSON.stringify(save).length / 1024));
  }, 60000);
});
