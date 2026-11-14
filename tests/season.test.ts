// End-to-end: generate a league and run several full seasons and offseasons headlessly.
import { describe, expect, test } from 'vitest';
import { FIRST_APRON, LUXURY_TAX, MAX_FA_YEARS, MAX_SALARY, MIN_SALARY, ROSTER_MAX, SALARY_CAP, SECOND_APRON, SUPERMAX_SALARY } from '../src/core/constants';
import { newLeague } from '../src/core/gen/league';
import { advanceOffseason, chooseTeam, draftDone, expiringPlayers, faOver, faNextDay, resignPlayer, userDraftPick, userOnClock } from '../src/core/offseason/offseason';
import { askingContract } from '../src/core/gm/value';
import { maxOffer, payroll } from '../src/core/org/finance';
import { resolveEvent, takeJob } from '../src/core/org/people';
import { ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { cal } from '../src/core/season/calendar';
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
    // the cap is soft, but no AI team starts a season above the second apron
    if (t.id !== save.userTeamId) expect(payroll(save, t), `${t.abbr} payroll`).toBeLessThanOrEqual(SECOND_APRON + 0.01);
    for (const id of t.roster) {
      const c = save.players[id].contract;
      expect(c.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(c.salary).toBeLessThanOrEqual(SUPERMAX_SALARY);
      expect(c.years).toBeGreaterThanOrEqual(1);
      expect(c.years).toBeLessThanOrEqual(5);
    }
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

interface Summer { signings: number; pool: number; lottery: string[]; midLevels: number }
function playOffseason(save: Save, rng: Rng): Summer {
  let guard = 0;
  const out: Summer = { signings: 0, pool: 0, lottery: [], midLevels: 0 };
  while (save.phase === 'offseason' && guard++ < 60) {
    const off = save.offseason!;
    const me = save.teams[save.userTeamId];
    if (save.fired) takeJob(save, save.fired.offers[0], true);
    if (off.step === 'contracts') for (const p of expiringPlayers(save)) if (ovr(p) >= 68) resignPlayer(save, p.id);
    if (off.step === 'draft') {
      let g2 = 0;
      while (!draftDone(save) && g2++ < 40) {
        if (userOnClock(save)) { const best = off.prospects.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a))[0]; if (userDraftPick(save, best.id, rng)) userDraftPick(save, null, rng); }
        else break;
      }
      expect(draftDone(save)).toBe(true);
      out.lottery = off.log.filter(l => l.startsWith('Lottery: '));
    }
    if (off.step === 'freeAgency' && !faOver(save)) {
      if (off.faDay === 1) {
        out.pool = save.freeAgents.filter(id => ovr(save.players[id]) >= 62).length;
        // the user goes after the best free agent the rules let him pay for
        const room = maxOffer(save, me).salary;
        const target = save.freeAgents.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a)).find(p => askingContract(save, p, me.id).salary <= room);
        if (target && me.roster.length < ROSTER_MAX) {
          const ask = askingContract(save, target, me.id);
          off.userOffers[target.id] = { teamId: me.id, salary: ask.salary, years: Math.min(ask.years, MAX_FA_YEARS) };
        }
      }
      const lines = faNextDay(save, rng);
      out.signings += lines.filter(l => l.includes(' signs with ')).length;
      expect(lines.some(l => l.includes('was not allowed')), lines.join('; ')).toBe(false);
      if (faOver(save)) out.midLevels = save.teams.filter(t => t.mleUsed).length;
      continue;
    }
    advanceOffseason(save, rng);
  }
  expect(save.phase).toBe('regular');
  return out;
}

describe('schedule', () => {
  test('14 games each, home and away balanced, one game a week', () => {
    const { save, rng } = mk(11);
    const s = genSchedule(save, rng);
    const REG_WEEKS = cal(save).regWeeks;
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
      for (const t of save.teams) expect(t.history[t.history.length - 1].w + t.history[t.history.length - 1].l).toBe(cal(save).games);
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
    console.log('five seasons: starter ovr by season', avgs.map(a => a.toFixed(1)).join(' '), '| players', Object.keys(save.players).length, '| save KB', Math.round(JSON.stringify(save).length / 1024));
  }, 60000);

  test('twelve seasons under the soft cap: aprons hold, teams go over the cap, free agents sign, talent holds steady', () => {
    const { save, rng } = mk(33);
    const avgs: number[] = [];
    const report: string[] = [];
    let taxpayerSeasons = 0, midLevels = 0, signings = 0;
    const census = () => {
      const ai = save.teams.filter(t => t.id !== save.userTeamId).map(t => payroll(save, t));
      const n = (lo: number, hi: number) => ai.filter(p => p > lo && p <= hi).length;
      return { avg: ai.reduce((s, v) => s + v, 0) / ai.length, overCap: n(SALARY_CAP, 1e9), tax: n(LUXURY_TAX, 1e9), apron1: n(FIRST_APRON, 1e9), apron2: n(SECOND_APRON, 1e9) };
    };
    for (let y = 1; y <= 12; y++) {
      expect(save.year).toBe(y);
      // each season starts with every AI team at or under the second apron, and a good few over the cap
      const c = census();
      expect(c.apron2, `season ${y}: AI teams above the second apron`).toBe(0);
      expect(c.overCap, `season ${y}: AI teams over the cap`).toBeGreaterThanOrEqual(2);
      expect(c.avg, `season ${y}: average AI payroll`).toBeGreaterThan(125);
      expect(c.avg, `season ${y}: average AI payroll`).toBeLessThan(185);
      for (const t of save.teams) {
        expect(t.mleUsed, `season ${y}: mid-level reset`).toBeFalsy();
        // after its first summer, a team that is not contending does not carry a tax bill into the season
        if (y > 1 && t.id !== save.userTeamId && t.strategy !== 'contend') expect(payroll(save, t), `${t.abbr} season ${y}`).toBeLessThanOrEqual(LUXURY_TAX + 0.01);
      }
      if (c.tax > 0) taxpayerSeasons++;
      if (y === 1 || y === 6 || y === 11) report.push(`start of season ${y}: avg ${c.avg.toFixed(0)}, over cap ${c.overCap}, taxpayers ${c.tax}, over apron 1 ${c.apron1}, over apron 2 ${c.apron2}`);
      const all = save.teams.flatMap(t => t.lineup.map(id => ovr(save.players[id])));
      avgs.push(all.reduce((s, v) => s + v, 0) / all.length);

      playSeason(save, rng);
      const summer = playOffseason(save, rng);
      checkLeague(save);
      // the market works: free agents find teams every summer, and the lottery ran
      expect(summer.signings, `summer ${y}: signings`).toBeGreaterThanOrEqual(3);
      expect(summer.lottery.length, `summer ${y}: lottery lines`).toBeGreaterThanOrEqual(3);
      signings += summer.signings;
      midLevels += summer.midLevels;
      for (const t of save.teams) for (const id of t.roster) expect(save.players[id].contract.salary).toBeLessThanOrEqual(SUPERMAX_SALARY);
    }
    // the league's talent level does not drift
    expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThan(5);
    expect(Math.abs(avgs[11] - avgs[0])).toBeLessThan(5);
    expect(signings).toBeGreaterThanOrEqual(60);
    // teams over the cap use the mid-level, and some pay the tax
    expect(midLevels).toBeGreaterThan(6);
    expect(taxpayerSeasons).toBeGreaterThanOrEqual(6);
    expect(save.news.length).toBeGreaterThan(0);
    void MAX_SALARY;
    console.log(`twelve seasons: ${report.join(' | ')} | FA signings ${signings}, mid-level deals ${midLevels}, starter ovr ${avgs[0].toFixed(1)} -> ${avgs[11].toFixed(1)}`);
  }, 120000);
});
