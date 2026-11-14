// End-to-end: generate a league and run several full seasons and offseasons headlessly.
import { describe, expect, test } from 'vitest';
import { HARD_LIMIT, MAX_FA_YEARS, MAX_SALARY, MIN_SALARY, ROSTER_MAX, SALARY_CAP } from '../src/core/constants';
import { newLeague } from '../src/core/gen/league';
import { advanceOffseason, chooseTeam, draftDone, expiringPlayers, faOver, faNextDay, resignPlayer, userDraftPick, userOnClock } from '../src/core/offseason/offseason';
import { interestLevel } from '../src/core/gm/freeAgency';
import { exemptSalary } from '../src/core/gm/teamAi';
import { askingContract } from '../src/core/gm/value';
import { capSpace, maxOffer, payroll } from '../src/core/org/finance';
import { resolveEvent, takeJob } from '../src/core/org/people';
import { ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { cal } from '../src/core/season/calendar';
import { endWeek } from '../src/core/season/flow';
import { genSchedule } from '../src/core/season/schedule';
import type { Player, Save } from '../src/core/types';

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
    // nothing but minimum deals and rookie contracts takes an AI team past the hard limit
    if (t.id !== save.userTeamId) expect(payroll(save, t) - exemptSalary(save, t), `${t.abbr} payroll`).toBeLessThanOrEqual(HARD_LIMIT + 0.01);
    for (const id of t.roster) {
      const c = save.players[id].contract;
      expect(c.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(c.salary).toBeLessThanOrEqual(MAX_SALARY);
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

interface Summer {
  signings: number; lottery: string[];
  /** At the start of free agency: teams with room under the cap for a max contract, and free agents of 85+ overall. */
  maxRoom: number; stars: number;
  /** What a star makes of an offer from each kind of team (interest levels). */
  bottomAtAsk: string[]; bottomPlus10: string[]; topPlus15: string[];
}
function playOffseason(save: Save, rng: Rng): Summer {
  let guard = 0;
  const out: Summer = { signings: 0, lottery: [], maxRoom: 0, stars: 0, bottomAtAsk: [], bottomPlus10: [], topPlus15: [] };
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
        out.maxRoom = save.teams.filter(t => capSpace(save, t) >= MAX_SALARY).length;
        out.stars = save.freeAgents.filter(id => ovr(save.players[id]) >= 85).length;
        // how would a star free agent take an offer? ask every 85+ player in the league as if he were on the market
        const byRecord = save.teams.slice().sort((a, b) => { const x = a.history[a.history.length - 1], y = b.history[b.history.length - 1]; return x.w - y.w || a.id - b.id; });
        // (a bottom-four team at exactly .500 only happens in a freak season of ties: leave it out)
        const bottom = byRecord.slice(0, 4).filter(t => { const h = t.history[t.history.length - 1]; return h.w < h.l; }), top = byRecord.slice(-4);
        const starPlayers = Object.values(save.players).filter(p => !p.retired && (p.teamId !== null || save.freeAgents.includes(p.id)) && ovr(p) >= 85);
        for (const real of starPlayers) {
          const p: Player = { ...real, teamId: null };
          const offer = (teamId: number, mult: number) => {
            const ask = askingContract(save, p, teamId);
            return interestLevel(save, p, { teamId, salary: Math.min(MAX_SALARY, Math.round(ask.salary * mult * 10) / 10), years: ask.years });
          };
          for (const t of bottom) { out.bottomAtAsk.push(offer(t.id, 1)); out.bottomPlus10.push(offer(t.id, 1.1)); }
          // (only where the max salary leaves room for a real 15% premium)
          for (const t of top) if (askingContract(save, p, t.id).salary * 1.15 <= MAX_SALARY) out.topPlus15.push(offer(t.id, 1.15));
        }
        // the user goes after the best free agent he has the cap space for
        const room = maxOffer(save, me).salary;
        const target = save.freeAgents.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a)).find(p => askingContract(save, p, me.id).salary <= room);
        if (target && me.roster.length < ROSTER_MAX) {
          const ask = askingContract(save, target, me.id);
          off.userOffers[target.id] = { teamId: me.id, salary: ask.salary, years: Math.min(ask.years, MAX_FA_YEARS) };
        }
      }
      const before = save.teams.map(t => ({ pay: payroll(save, t), size: t.roster.length, roster: t.roster.slice() }));
      const lines = faNextDay(save, rng);
      out.signings += lines.filter(l => l.includes(' signs with ')).length;
      expect(lines.some(l => l.includes('was not allowed')), lines.join('; ')).toBe(false);
      // every signing obeyed the rules: other teams' players fitted under the cap; only a team's own free agent took it over, inside the hard limit; the rest were minimum deals
      save.teams.forEach((t, i) => {
        const added = t.roster.filter(id => !before[i].roster.includes(id)).map(id => save.players[id]).filter(p => p.contract.salary > MIN_SALARY);
        const own = added.filter(p => p.seasons[p.seasons.length - 1]?.teamId === t.id && p.seasons[p.seasons.length - 1]?.year === save.year);
        const others = added.filter(p => !own.includes(p));
        const spent = (ps: Player[]) => ps.reduce((sum, p) => sum + p.contract.salary, 0);
        if (others.length) expect(before[i].pay + spent(others), `${t.abbr} signed ${others.map(p => p.name).join(', ')} without the cap space`).toBeLessThanOrEqual(SALARY_CAP + 0.01);
        if (own.length) expect(before[i].pay + spent(added), `${t.abbr} re-signed past the hard limit`).toBeLessThanOrEqual(HARD_LIMIT + 0.01);
      });
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

  test('twelve seasons, three leagues: the hard limit holds, cap room is scarce, stars are hard to sign, free agents still sign, talent holds steady', () => {
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const maxRoom: number[] = [], stars: number[] = [], signings: number[] = [], overCap: number[] = [], pay: number[] = [];
    const bottomAtAsk: string[] = [], bottomPlus10: string[] = [], topPlus15: string[] = [];
    for (const seed of [33, 7, 58]) {
      const { save, rng } = mk(seed);
      const avgs: number[] = [];
      for (let y = 1; y <= 12; y++) {
        expect(save.year).toBe(y);
        // each season starts with every AI team inside the hard limit (minimum deals and rookie contracts aside)
        for (const t of save.teams) {
          if (t.id !== save.userTeamId) expect(payroll(save, t) - exemptSalary(save, t), `seed ${seed} season ${y} ${t.abbr}`).toBeLessThanOrEqual(HARD_LIMIT + 0.01);
        }
        const over = save.teams.filter(t => payroll(save, t) > SALARY_CAP).length;
        expect(over, `seed ${seed} season ${y}: teams over the cap`).toBeGreaterThanOrEqual(2);
        overCap.push(over);
        pay.push(mean(save.teams.map(t => payroll(save, t))));
        avgs.push(mean(save.teams.flatMap(t => t.lineup.map(id => ovr(save.players[id])))));

        playSeason(save, rng);
        const summer = playOffseason(save, rng);
        checkLeague(save);
        expect(summer.lottery.length, `seed ${seed} summer ${y}: lottery lines`).toBeGreaterThanOrEqual(3);
        // the market never freezes
        expect(summer.signings, `seed ${seed} summer ${y}: signings`).toBeGreaterThanOrEqual(1);
        signings.push(summer.signings); maxRoom.push(summer.maxRoom); stars.push(summer.stars);
        bottomAtAsk.push(...summer.bottomAtAsk); bottomPlus10.push(...summer.bottomPlus10); topPlus15.push(...summer.topPlus15);
      }
      // the league's talent level does not drift
      expect(Math.max(...avgs) - Math.min(...avgs), `seed ${seed} starter drift`).toBeLessThan(5);
    }
    // cap room is scarce: few teams could fit a max contract, and few stars reach the market
    expect(mean(maxRoom)).toBeLessThanOrEqual(4);
    expect(mean(stars)).toBeLessThanOrEqual(2);
    expect(Math.max(...stars)).toBeLessThanOrEqual(4);
    // but free agents do sign
    expect(mean(signings)).toBeGreaterThanOrEqual(3.5);
    // a star does not jump at a bad team's money: at his asking price a bottom-four team gets a lukewarm hearing, never a keen one
    expect(bottomAtAsk.length).toBeGreaterThan(100);
    for (const lvl of bottomAtAsk) expect(['low', 'medium']).toContain(lvl);
    // even 10% over his price does not make him keen; a top-four team paying 15% over usually does
    expect(bottomPlus10).not.toContain('high');
    expect(topPlus15.length).toBeGreaterThan(30);
    expect(topPlus15.filter(l => l === 'high').length / topPlus15.length).toBeGreaterThan(0.6);
    const share = (a: string[], k: string) => `${Math.round(a.filter(x => x === k).length / a.length * 100)}%`;
    console.log(`twelve seasons x 3: teams with max room at FA start ${mean(maxRoom).toFixed(2)} (most ${Math.max(...maxRoom)}); 85+ free agents ${mean(stars).toFixed(2)} a summer (most ${Math.max(...stars)}); signings ${mean(signings).toFixed(1)} a summer (fewest ${Math.min(...signings)}); at season start avg payroll ${mean(pay).toFixed(0)}, ${mean(overCap).toFixed(1)} teams over the cap; bottom-four at ask low ${share(bottomAtAsk, 'low')} medium ${share(bottomAtAsk, 'medium')} high ${share(bottomAtAsk, 'high')}; top-four at +15% high ${share(topPlus15, 'high')}`);
  }, 180000);
});
