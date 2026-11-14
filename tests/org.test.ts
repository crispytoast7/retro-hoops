// Unit tests for the pure organisation logic: finance, roster, lineup, ratings, economy, people, offseason, migrate.
import { describe, expect, test } from 'vitest';
import {
  FIRST_APRON, LUXURY_TAX, MAX_SALARY, MIN_SALARY, MLE, ROSTER_MAX, SALARY_CAP, SAVE_VERSION, SECOND_APRON, SUPERMAX_SALARY, TAX_MLE,
} from '../src/core/constants';
import { EVENTS } from '../src/data/events';
import { genPlayer, newLeague } from '../src/core/gen/league';
import { askingContract, teamStrength } from '../src/core/gm/value';
import { autoLineup, fixLineup, slotValue } from '../src/core/lineup';
import {
  LOTTERY_WEIGHTS, advanceOffseason, beginOffseason, buildDraftOrder, chooseTeam, expiringPlayers, resignPlayer, startNewSeason, userDraftPick, userOnClock,
} from '../src/core/offseason/offseason';
import {
  FACILITY_COST, UPGRADE_POINTS, canHire, checkMilestones, effLevel, fireStaff, gameCredits, hireStaff, repairFacility,
  scoutProspect, scoutedRating, upgradeCost, upgradeFacility, upgradeRating, weeklyFacilities,
} from '../src/core/org/economy';
import { capSpace, capStatus, luxuryTax, matchLimit, maxOffer, mleStatus, payroll, signingPath, statusOf, taxBill } from '../src/core/org/finance';
import { prog } from '../src/core/org/progress';
import {
  afterUserGame, checkFired, evaluateGoals, healWeek, progressPlayer, resolveEvent, rollEvent, rollInjuries, setOwnerGoals, takeJob,
} from '../src/core/org/people';
import { movePlayer, releasePlayer, signPlayer } from '../src/core/org/roster';
import { POS_WEIGHTS, careerStats, emptyStats, overallOf, stars } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { migrate } from '../src/state/persist';
import type { BoxLine, GameResult, Player, Save, StaffMember, Team, Trait } from '../src/core/types';
import { FACILITY_KEYS, POSITIONS, RATING_KEYS } from '../src/core/types';

const ME = 3;
function mk(seed = 7): { save: Save; rng: Rng } {
  const save = newLeague({ seed, coachName: 'Test Coach', coachLook: { skin: 0, hair: 0, hairColor: 0 }, settings: { sound: false, difficulty: 'normal', haptics: false } });
  const rng = new Rng(save.rng);
  chooseTeam(save, ME, rng);
  return { save, rng };
}
const me = (s: Save) => s.teams[s.userTeamId];
/** Pin a team's payroll to a figure by adjusting dead money (negative is fine for a test). */
function setPayroll(s: Save, t: Team, target: number): void {
  t.deadCap = Math.round((target - (payroll(s, t) - t.deadCap)) * 10) / 10;
  expect(payroll(s, t)).toBeCloseTo(target, 1);
}
const roster = (s: Save, t = me(s)) => t.roster.map(id => s.players[id]);
function expectValidLineup(s: Save, t = me(s)): void {
  expect(t.lineup.length).toBe(5);
  expect(new Set(t.lineup).size).toBe(5);
  for (const id of t.lineup) expect(t.roster).toContain(id);
}
function box(playerId: number, min: number): BoxLine {
  return { ...emptyStats(), playerId, starter: true, min };
}
function result(homeId: number, awayId: number, h: number, a: number): GameResult {
  return { homeId, awayId, homeScore: h, awayScore: a, homeQ: [], awayQ: [], box: { home: [], away: [] }, ot: 0, topPerformer: 0 };
}
function staff(id: number, role: 'OC' | 'DC', stars_: number, cost: number): StaffMember {
  return { id, name: `Coach ${id}`, role, stars: stars_, cost, age: 45 };
}
function resetFacilities(s: Save): void {
  for (const k of FACILITY_KEYS) me(s).facilities[k] = { level: 2, condition: 100 };
}

describe('finance', () => {
  test('payroll includes dead cap and capSpace = cap - payroll', () => {
    const { save } = mk();
    const t = me(save);
    t.deadCap = 0;
    const base = roster(save).reduce((s, p) => s + p.contract.salary, 0);
    expect(payroll(save, t)).toBeCloseTo(base, 1);
    t.deadCap = 4.5;
    expect(payroll(save, t)).toBeCloseTo(base + 4.5, 1);
    expect(capSpace(save, t)).toBeCloseTo(SALARY_CAP - payroll(save, t), 1);
    // an expired deal is off the books
    const p = roster(save)[0];
    const before = payroll(save, t);
    p.contract.years = 0;
    expect(payroll(save, t)).toBeCloseTo(before - p.contract.salary, 1);
  });

  test('capStatus names where the payroll stands; a line is crossed only above it', () => {
    const { save } = mk();
    const t = me(save);
    const at = (pay: number) => { setPayroll(save, t, pay); return capStatus(save, t); };
    expect(at(90)).toBe('under cap');
    expect(at(SALARY_CAP)).toBe('under cap');
    expect(at(SALARY_CAP + 0.1)).toBe('over cap');
    expect(at(LUXURY_TAX)).toBe('over cap');
    expect(at(LUXURY_TAX + 0.1)).toBe('taxpayer');
    expect(at(FIRST_APRON)).toBe('taxpayer');
    expect(at(FIRST_APRON + 0.1)).toBe('first apron');
    expect(at(SECOND_APRON)).toBe('first apron');
    expect(at(SECOND_APRON + 0.1)).toBe('second apron');
    expect(statusOf(260)).toBe('second apron');
  });

  test('signingPath: cap space first', () => {
    const { save } = mk();
    const t = me(save);
    setPayroll(save, t, 120);
    expect(signingPath(save, t, 30)).toEqual({ ok: true, via: 'space' }); // lands exactly on the cap
    expect(signingPath(save, t, MIN_SALARY)).toEqual({ ok: true, via: 'space' });
    // more than the room, and more than any exception
    const no = signingPath(save, t, 30.1);
    expect(no).toEqual({ ok: false, reason: 'You have $30M of cap space: that is the most you can offer.' });
    // a team just under the cap can still reach for the mid-level
    setPayroll(save, t, 145);
    expect(signingPath(save, t, 5)).toEqual({ ok: true, via: 'space' });
    expect(signingPath(save, t, 12)).toEqual({ ok: true, via: 'mle' });
    expect(maxOffer(save, t)).toEqual({ salary: MLE, via: 'mle' });
    setPayroll(save, t, 100);
    expect(maxOffer(save, t)).toEqual({ salary: MAX_SALARY, via: 'space' });
    expect(signingPath(save, t, MAX_SALARY + 0.1)).toEqual({ ok: false, reason: `The maximum salary is $${MAX_SALARY}M.` });
    expect(signingPath(save, t, MIN_SALARY - 0.1)).toEqual({ ok: false, reason: `The minimum salary is $${MIN_SALARY}M.` });
  });

  test('signingPath: own free agents can always be re-signed, over the cap and both aprons', () => {
    const { save } = mk();
    const t = me(save);
    setPayroll(save, t, 100);
    expect(signingPath(save, t, 40, { ownPlayer: true })).toEqual({ ok: true, via: 'space' });
    for (const pay of [140, 185, 195, 230]) {
      setPayroll(save, t, pay);
      expect(signingPath(save, t, 40, { ownPlayer: true })).toEqual({ ok: true, via: 'bird' });
    }
    t.mleUsed = true;
    expect(signingPath(save, t, SUPERMAX_SALARY, { ownPlayer: true, years: 5 })).toEqual({ ok: true, via: 'bird' });
    expect(signingPath(save, t, SUPERMAX_SALARY + 0.1, { ownPlayer: true }).ok).toBe(false);
    expect(t.mleUsed).toBe(true);
  });

  test('signingPath: the mid-level once a season up to the first apron, the taxpayer mid-level up to the second', () => {
    const { save } = mk();
    const t = me(save);
    setPayroll(save, t, 160);
    expect(signingPath(save, t, MLE)).toEqual({ ok: true, via: 'mle' });
    expect(signingPath(save, t, MLE + 0.1)).toEqual({ ok: false, reason: `Over the cap: the most you can offer is the mid-level exception, $${MLE}M.` });
    expect(mleStatus(save, t)).toEqual({ available: true, amount: MLE, kind: 'mle' });
    // the full mid-level must leave the payroll at or under the first apron
    setPayroll(save, t, FIRST_APRON - MLE);
    expect(signingPath(save, t, MLE)).toEqual({ ok: true, via: 'mle' });
    setPayroll(save, t, FIRST_APRON - 10);
    expect(signingPath(save, t, 10)).toEqual({ ok: true, via: 'mle' });
    const tooBig = signingPath(save, t, 10.1);
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.reason).toBe(`Over the cap: the most you can offer is the mid-level exception, $10M.`);
    // close to the apron the smaller exception is the bigger one
    setPayroll(save, t, FIRST_APRON - 3);
    expect(signingPath(save, t, 3)).toEqual({ ok: true, via: 'mle' });
    expect(signingPath(save, t, TAX_MLE)).toEqual({ ok: true, via: 'taxMle' });
    expect(maxOffer(save, t)).toEqual({ salary: TAX_MLE, via: 'taxMle' });
    expect(mleStatus(save, t)).toEqual({ available: true, amount: TAX_MLE, kind: 'taxMle' });
    const past = signingPath(save, t, TAX_MLE + 1);
    expect(!past.ok && past.reason).toMatch(/past the first apron \(\$190M\), where only the taxpayer mid-level is allowed: up to \$6M/);
    // over the first apron: taxpayer mid-level only, and it must stay at or under the second apron
    setPayroll(save, t, FIRST_APRON + 2);
    expect(signingPath(save, t, TAX_MLE)).toEqual({ ok: true, via: 'taxMle' });
    const over1 = signingPath(save, t, TAX_MLE + 0.1);
    expect(!over1.ok && over1.reason).toBe(`Over the first apron only the taxpayer mid-level is left: up to $${TAX_MLE}M.`);
    setPayroll(save, t, SECOND_APRON - 4);
    expect(signingPath(save, t, 4)).toEqual({ ok: true, via: 'taxMle' });
    expect(signingPath(save, t, 4.1).ok).toBe(false);
    setPayroll(save, t, SECOND_APRON - 1);
    const squeeze = signingPath(save, t, 3);
    expect(!squeeze.ok && squeeze.reason).toMatch(/over the second apron \(\$200M\)/);
    expect(mleStatus(save, t).available).toBe(false);
    // not available above the second apron
    setPayroll(save, t, SECOND_APRON + 1);
    expect(signingPath(save, t, 3)).toEqual({ ok: false, reason: 'Over the second apron: only minimum deals and your own free agents.' });
    expect(maxOffer(save, t)).toEqual({ salary: MIN_SALARY, via: 'min' });
    // once used, it is gone until the next season
    setPayroll(save, t, 160);
    t.mleUsed = true;
    expect(signingPath(save, t, 5)).toEqual({ ok: false, reason: 'Over the cap with the mid-level exception already used: only minimum deals.' });
    expect(mleStatus(save, t)).toEqual({ available: false, amount: 0, kind: null });
    expect(maxOffer(save, t)).toEqual({ salary: MIN_SALARY, via: 'min' });
    // other pending offers count against the room, and can claim the exception
    t.mleUsed = false;
    expect(signingPath(save, t, 20, { pending: 0 }).ok).toBe(false);
    setPayroll(save, t, 120);
    expect(signingPath(save, t, 20, { pending: 5 })).toEqual({ ok: true, via: 'space' });
    expect(signingPath(save, t, 20, { pending: 15 }).ok).toBe(false);
    expect(signingPath(save, t, 12, { pending: 25 })).toEqual({ ok: true, via: 'mle' });
    expect(signingPath(save, t, 12, { pending: 25, mleTaken: true }).ok).toBe(false);
  });

  test('signingPath: a minimum deal is always allowed, for one or two years', () => {
    const { save } = mk();
    const t = me(save);
    t.mleUsed = true;
    for (const pay of [160, 185, 195, 240]) {
      setPayroll(save, t, pay);
      expect(signingPath(save, t, MIN_SALARY)).toEqual({ ok: true, via: 'min' });
      expect(signingPath(save, t, MIN_SALARY, { years: 2 })).toEqual({ ok: true, via: 'min' });
      expect(signingPath(save, t, MIN_SALARY, { years: 3 })).toEqual({ ok: false, reason: 'Over the cap, a minimum deal can run 2 years at most.' });
      expect(signingPath(save, t, MIN_SALARY + 0.1).ok).toBe(false);
    }
    expect(t.mleUsed).toBe(true);
  });

  test('signPlayer marks the mid-level used only for a mid-level deal', () => {
    const { save } = mk();
    const t = me(save);
    signPlayer(save, save.freeAgents[0], t.id, { salary: MIN_SALARY, years: 1 }, 'min');
    signPlayer(save, save.freeAgents[0], t.id, { salary: 4, years: 1 }, 'space');
    signPlayer(save, save.freeAgents[0], t.id, { salary: 4, years: 1 });
    expect(t.mleUsed).toBeFalsy();
    signPlayer(save, save.freeAgents[0], t.id, { salary: 4, years: 1 }, 'taxMle');
    expect(t.mleUsed).toBe(true);
    const other = save.teams[5];
    signPlayer(save, save.freeAgents[0], other.id, { salary: 9, years: 2 }, 'mle');
    expect(other.mleUsed).toBe(true);
  });

  test('luxury tax bill: 1 credit per full $3M over, owner approval -1 per $4M over and at least -2', () => {
    expect(taxBill(LUXURY_TAX)).toEqual({ over: 0, credits: 0, ownerHit: 0 });
    expect(taxBill(150)).toEqual({ over: 0, credits: 0, ownerHit: 0 });
    expect(taxBill(LUXURY_TAX + 0.1)).toEqual({ over: 0.1, credits: 0, ownerHit: 2 });
    expect(taxBill(LUXURY_TAX + 2.9)).toEqual({ over: 2.9, credits: 0, ownerHit: 2 });
    expect(taxBill(LUXURY_TAX + 3)).toEqual({ over: 3, credits: 1, ownerHit: 2 });
    expect(taxBill(LUXURY_TAX + 11.9)).toEqual({ over: 11.9, credits: 3, ownerHit: 2 });
    expect(taxBill(LUXURY_TAX + 12)).toEqual({ over: 12, credits: 4, ownerHit: 3 });
    expect(taxBill(LUXURY_TAX + 21)).toEqual({ over: 21, credits: 7, ownerHit: 5 });
    expect(taxBill(LUXURY_TAX + 40)).toEqual({ over: 40, credits: 13, ownerHit: 10 });
    const { save } = mk();
    setPayroll(save, me(save), LUXURY_TAX + 12);
    expect(luxuryTax(save, me(save))).toEqual({ over: 12, credits: 4, ownerHit: 3 });
  });

  test('matchLimit: what a trade may bring back for what it sends', () => {
    const { save } = mk();
    const t = me(save);
    const at = (pay: number, out: number) => { setPayroll(save, t, pay); return matchLimit(save, t, out); };
    expect(at(100, 0)).toBe(50); // cap space
    expect(at(100, 10)).toBe(60);
    expect(at(150, 0)).toBe(0.3); // 125% of nothing, plus the quarter million
    expect(at(160, 10)).toBe(12.8);
    expect(at(160, 40)).toBe(50.3);
    expect(at(185, 20)).toBe(25); // the first apron cuts 125% short
    expect(at(190, 20)).toBe(20);
    expect(at(196, 20)).toBe(20);
    expect(at(230, 20)).toBe(20);
    expect(at(230, 0)).toBe(0);
  });
});

describe('roster', () => {
  test('signPlayer moves a free agent onto the team and keeps the lineup valid', () => {
    const { save } = mk();
    const t = me(save);
    const id = save.freeAgents[0];
    signPlayer(save, id, t.id, { salary: 1.04, years: 2 });
    expect(save.freeAgents).not.toContain(id);
    expect(t.roster).toContain(id);
    expect(save.players[id].teamId).toBe(t.id);
    expect(save.players[id].contract).toEqual({ salary: 1, years: 2 });
    expectValidLineup(save);
  });

  test('releasePlayer without dead cap', () => {
    const { save } = mk();
    const t = me(save);
    const p = save.players[t.lineup[0]];
    save.captainId = p.id; save.tradeDemands = [p.id];
    const before = t.deadCap;
    expect(releasePlayer(save, p.id, { deadCap: false })).toBe(0);
    expect(t.deadCap).toBe(before);
    expect(t.roster).not.toContain(p.id);
    expect(p.teamId).toBeNull();
    expect(save.freeAgents).toContain(p.id);
    expect(save.captainId).toBeNull();
    expect(save.tradeDemands).not.toContain(p.id);
    expectValidLineup(save);
  });

  test('releasePlayer with dead cap is half of one season of salary', () => {
    const { save } = mk();
    const t = me(save);
    const [a, b] = roster(save);
    a.contract = { salary: 10, years: 3 };
    b.contract = { salary: 4, years: 5 };
    t.deadCap = 0;
    expect(releasePlayer(save, a.id, { deadCap: true })).toBe(5);
    expect(t.deadCap).toBe(5);
    const d = releasePlayer(save, b.id, { deadCap: true });
    expect(d).toBeLessThanOrEqual(4);
    expect(d).toBeGreaterThan(0);
    expect(t.deadCap).toBeCloseTo(5 + d, 1);
  });

  test('releasing someone with no team is a no-op', () => {
    const { save } = mk();
    expect(releasePlayer(save, save.freeAgents[0], { deadCap: true })).toBe(0);
  });

  test('movePlayer transfers roster membership and clears captaincy and demands', () => {
    const { save } = mk();
    const from = me(save), to = save.teams[0];
    const p = save.players[from.lineup[1]];
    save.captainId = p.id; save.tradeDemands = [p.id];
    movePlayer(save, p.id, to.id);
    expect(from.roster).not.toContain(p.id);
    expect(to.roster).toContain(p.id);
    expect(p.teamId).toBe(to.id);
    expect(save.captainId).toBeNull();
    expect(save.tradeDemands).toEqual([]);
    // movePlayer itself leaves the giving team's lineup stale (callers run fixLineup)
    fixLineup(save, from);
    expectValidLineup(save, from);
  });
});

describe('lineup', () => {
  test('autoLineup returns 5 unique players, one per slot, skipping injured', () => {
    const { save } = mk();
    const ps = roster(save);
    const l = autoLineup(ps);
    expect(l.length).toBe(5);
    expect(new Set(l).size).toBe(5);
    ps[0].injury = { weeks: 3, desc: 'x' };
    ps[1].injury = { weeks: 3, desc: 'x' };
    const l2 = autoLineup(ps);
    expect(l2.length).toBe(5);
    expect(new Set(l2).size).toBe(5);
    expect(l2).not.toContain(ps[0].id);
    expect(l2).not.toContain(ps[1].id);
  });

  test('autoLineup falls back to injured players when fewer than 5 are healthy', () => {
    const { save } = mk();
    const ps = roster(save);
    ps.forEach((p, i) => { if (i >= 3) p.injury = { weeks: 2, desc: 'x' }; });
    const l = autoLineup(ps);
    expect(l.length).toBe(5);
    expect(new Set(l).size).toBe(5);
    for (const id of l) expect(ps.map(p => p.id)).toContain(id);
  });

  test('fixLineup leaves a valid lineup untouched', () => {
    const { save } = mk();
    const t = me(save);
    const before = t.lineup.slice();
    fixLineup(save, t);
    expect(t.lineup).toEqual(before);
  });

  test('fixLineup repairs after a starter is removed or injured', () => {
    const { save } = mk();
    const t = me(save);
    const gone = t.lineup[2];
    t.roster = t.roster.filter(id => id !== gone);
    fixLineup(save, t);
    expectValidLineup(save);
    expect(t.lineup).not.toContain(gone);
    const hurt = t.lineup[0];
    save.players[hurt].injury = { weeks: 4, desc: 'x' };
    fixLineup(save, t);
    expectValidLineup(save);
    expect(t.lineup).not.toContain(hurt);
  });

  test('slotValue penalises out-of-position play', () => {
    const { save } = mk();
    const p = roster(save).find(x => x.pos === 'SG')!;
    expect(slotValue(p, 'SG')).toBe(overallOf(p.ratings, 'SG'));
    expect(slotValue(p, 'PG')).toBe(overallOf(p.ratings, 'PG') - 4);
    expect(slotValue(p, 'SF')).toBe(overallOf(p.ratings, 'SF') - 4);
    expect(slotValue(p, 'C')).toBe(overallOf(p.ratings, 'C') - 10);
    expect(slotValue(p, 'PF')).toBe(overallOf(p.ratings, 'PF') - 10);
  });
});

describe('ratings', () => {
  test('position weights sum to 1', () => {
    for (const pos of POSITIONS) {
      const sum = RATING_KEYS.reduce((s, k) => s + POS_WEIGHTS[pos][k], 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
  test('overallOf of a flat rating line equals that rating', () => {
    const flat = { sht: 60, hnd: 60, pas: 60, spd: 60, fin: 60, def: 60, reb: 60 };
    for (const pos of POSITIONS) expect(overallOf(flat, pos)).toBe(60);
  });
  test('stars maps 30 to 0.5 and 92+ to 5 and is monotonic in half steps', () => {
    expect(stars(30)).toBe(0.5);
    expect(stars(92)).toBe(5);
    expect(stars(99)).toBe(5);
    let prev = 0;
    for (let v = 1; v <= 100; v++) {
      const s = stars(v);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect((s * 2) % 1).toBe(0);
      expect(s).toBeGreaterThanOrEqual(0.5);
      expect(s).toBeLessThanOrEqual(5);
      prev = s;
    }
  });
  test('careerStats sums completed seasons plus the current one', () => {
    const { save } = mk();
    const p = roster(save)[0];
    const s1 = { ...emptyStats(), gp: 10, pts: 100, ast: 7 }, s2 = { ...emptyStats(), gp: 5, pts: 40 };
    p.seasons = [
      { year: 1, teamId: 0, age: 22, ovr: 60, stats: s1 },
      { year: 2, teamId: 0, age: 23, ovr: 62, stats: s2 },
    ];
    p.season = { ...emptyStats(), gp: 2, pts: 9, ast: 1 };
    const c = careerStats(p);
    expect(c.gp).toBe(17); expect(c.pts).toBe(149); expect(c.ast).toBe(8);
    // inputs not mutated
    expect(s1.pts).toBe(100);
    expect(p.season.pts).toBe(9);
  });
});

describe('economy: facilities', () => {
  test('upgradeFacility deducts credits, sets pending, level changes only after weeklyFacilities', () => {
    const { save, rng } = mk();
    resetFacilities(save);
    save.credits = 100;
    const f = me(save).facilities.training;
    expect(upgradeFacility(save, 'training')).toBeNull();
    expect(save.credits).toBe(100 - FACILITY_COST[3]);
    expect(f.pending).toBe(3);
    expect(f.level).toBe(2);
    expect(upgradeFacility(save, 'training')).toMatch(/under way/);
    weeklyFacilities(save, rng);
    expect(f.level).toBe(3);
    expect(f.pending).toBeUndefined();
    expect(f.condition).toBe(100);
  });
  test('upgradeFacility is blocked without credits and at level 5', () => {
    const { save } = mk();
    resetFacilities(save);
    save.credits = 0;
    expect(upgradeFacility(save, 'arena')).toMatch(/credits/);
    expect(me(save).facilities.arena.pending).toBeUndefined();
    save.credits = 100;
    me(save).facilities.arena.level = 5;
    expect(upgradeFacility(save, 'arena')).toMatch(/top level/);
    expect(save.credits).toBe(100);
  });
  test('repairFacility restores condition for credits', () => {
    const { save } = mk();
    resetFacilities(save);
    save.credits = 10;
    const f = me(save).facilities.medical;
    expect(repairFacility(save, 'medical')).toMatch(/good shape/);
    f.condition = 40;
    save.credits = 0;
    expect(repairFacility(save, 'medical')).toMatch(/credits/);
    expect(f.condition).toBe(40);
    save.credits = 10;
    expect(repairFacility(save, 'medical')).toBeNull();
    expect(f.condition).toBe(100);
    expect(save.credits).toBe(10 - 3);
  });
  test('effLevel drops one level under 50 condition but never below 1', () => {
    expect(effLevel({ level: 3, condition: 50 })).toBe(3);
    expect(effLevel({ level: 3, condition: 49 })).toBe(2);
    expect(effLevel({ level: 1, condition: 0 })).toBe(1);
  });
  test('weeklyFacilities degrades condition', () => {
    const { save, rng } = mk();
    resetFacilities(save);
    weeklyFacilities(save, rng);
    for (const k of FACILITY_KEYS) {
      const c = me(save).facilities[k].condition;
      expect(c).toBeGreaterThanOrEqual(97);
      expect(c).toBeLessThan(100);
    }
  });
});

describe('economy: staff', () => {
  test('canHire gates on reputation then credits', () => {
    const { save } = mk();
    const s = staff(9001, 'OC', 5, 10);
    save.coach.rep = 0; save.credits = 100;
    expect(canHire(save, s)).toMatch(/reputation/);
    save.coach.rep = 100; save.credits = 5;
    expect(canHire(save, s)).toMatch(/credits/);
    save.credits = 10;
    expect(canHire(save, s)).toBeNull();
  });
  test('hireStaff pays, installs him and returns the old coordinator to the pool', () => {
    const { save } = mk();
    const old = staff(9100, 'OC', 2, 3), nu = staff(9101, 'OC', 3, 6);
    me(save).staff.oc = old;
    save.staffPool = [nu];
    save.coach.rep = 100; save.credits = 20;
    expect(hireStaff(save, 9101)).toBeNull();
    expect(save.credits).toBe(14);
    expect(me(save).staff.oc).toBe(nu);
    expect(save.staffPool.map(x => x.id)).toEqual([9100]);
    expect(hireStaff(save, 9101)).toMatch(/available/);
  });
  test('hireStaff refuses when gated and changes nothing', () => {
    const { save } = mk();
    const nu = staff(9102, 'DC', 5, 10);
    save.staffPool = [nu];
    save.coach.rep = 0; save.credits = 50;
    const before = me(save).staff.dc;
    expect(hireStaff(save, 9102)).toMatch(/reputation/);
    expect(me(save).staff.dc).toBe(before);
    expect(save.credits).toBe(50);
    expect(save.staffPool).toEqual([nu]);
  });
  test('fireStaff sends him to the pool', () => {
    const { save } = mk();
    const s = staff(9200, 'DC', 3, 4);
    me(save).staff.dc = s;
    save.staffPool = [];
    fireStaff(save, 'DC');
    expect(me(save).staff.dc).toBeNull();
    expect(save.staffPool).toEqual([s]);
    fireStaff(save, 'DC'); // nothing to fire
    expect(save.staffPool.length).toBe(1);
  });
});

describe('economy: rating upgrades and scouting', () => {
  test('upgradeRating spends credits and adds UPGRADE_POINTS, capped at 99', () => {
    const { save } = mk();
    resetFacilities(save);
    save.credits = 100;
    const p = roster(save)[0];
    p.ratings.sht = 50;
    const cost = upgradeCost(save, p, 'sht');
    expect(upgradeRating(save, p.id, 'sht')).toBeNull();
    expect(p.ratings.sht).toBe(50 + UPGRADE_POINTS);
    expect(save.credits).toBe(100 - cost);
    p.ratings.sht = 97;
    expect(upgradeRating(save, p.id, 'sht')).toBeNull();
    expect(p.ratings.sht).toBe(99);
    expect(upgradeRating(save, p.id, 'sht')).toMatch(/maxed/);
  });
  test('upgradeRating refuses without credits', () => {
    const { save } = mk();
    resetFacilities(save);
    const p = roster(save)[0];
    p.ratings.def = 60;
    save.credits = 0;
    expect(upgradeRating(save, p.id, 'def')).toMatch(/credits/);
    expect(p.ratings.def).toBe(60);
  });
  test('cost rises with stars and is cheaper at camp', () => {
    const { save } = mk();
    resetFacilities(save);
    const p = roster(save)[0];
    const costs = [30, 50, 65, 80, 95].map(v => { p.ratings.reb = v; return upgradeCost(save, p, 'reb'); });
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    expect(costs[4]).toBeGreaterThan(costs[0]);
    const normal = upgradeCost(save, p, 'reb');
    save.phase = 'offseason';
    save.offseason = { step: 'camp', draftOrder: [], draftIdx: 0, prospects: [], faDay: 1, userOffers: {}, retired: [], campSpent: 0, log: [] };
    expect(upgradeCost(save, p, 'reb')).toBeLessThan(normal);
    save.credits = 100;
    upgradeRating(save, p.id, 'reb');
    expect(save.offseason.campSpent).toBe(upgradeCost(save, { ...p, ratings: { ...p.ratings, reb: p.ratings.reb - UPGRADE_POINTS } }, 'reb'));
  });
  test('scoutProspect uses a point, then a credit, then errors', () => {
    const { save } = mk();
    const [a, b, c] = save.draftClass.map(id => save.players[id]);
    expect(a.scouted).toBe(false);
    save.scoutPoints = 1; save.credits = 1;
    expect(scoutProspect(save, a.id)).toBeNull();
    expect(save.scoutPoints).toBe(0); expect(save.credits).toBe(1); expect(a.scouted).toBe(true);
    expect(scoutProspect(save, a.id)).toMatch(/Already/);
    expect(scoutProspect(save, b.id)).toBeNull();
    expect(save.credits).toBe(0);
    expect(scoutProspect(save, c.id)).toMatch(/left/);
    expect(c.scouted).toBe(false);
  });
  test('scoutedRating is exact once scouted and a stable ordered range otherwise', () => {
    const { save } = mk();
    const p = save.players[save.draftClass[0]];
    for (const k of RATING_KEYS) {
      const r = scoutedRating(save, p, k);
      expect(r.lo).toBeLessThanOrEqual(r.hi);
      expect(r.lo).toBeGreaterThanOrEqual(1);
      expect(r.hi).toBeLessThanOrEqual(99);
      expect(scoutedRating(save, p, k)).toEqual(r);
    }
    p.scouted = true;
    for (const k of RATING_KEYS) expect(scoutedRating(save, p, k)).toEqual({ lo: p.ratings[k], hi: p.ratings[k] });
  });
});

describe('economy: credits', () => {
  test('win vs loss, home gate only at home, playoff win pays more', () => {
    const { save } = mk();
    resetFacilities(save);
    save.fans = 100;
    const sum = (l: { amount: number }[]) => l.reduce((s, x) => s + x.amount, 0);
    const homeWin = gameCredits(save, result(ME, 0, 90, 80), [], false);
    const awayWin = gameCredits(save, result(0, ME, 80, 90), [], false);
    const homeLoss = gameCredits(save, result(ME, 0, 80, 90), [], false);
    const playoffWin = gameCredits(save, result(0, ME, 80, 90), [], true);
    expect(homeWin.some(l => l.label === 'Home gate')).toBe(true);
    expect(awayWin.some(l => l.label === 'Home gate')).toBe(false);
    expect(sum(awayWin)).toBe(3);
    expect(sum(homeLoss)).toBe(1 + (homeLoss.find(l => l.label === 'Home gate')?.amount ?? 0));
    expect(sum(playoffWin)).toBeGreaterThan(sum(awayWin));
    expect(sum(gameCredits(save, result(0, ME, 90, 80), [], false))).toBeLessThan(sum(awayWin));
  });
  test('checkMilestones pays each milestone once', () => {
    const { save } = mk();
    me(save).record.w = 8;
    const first = checkMilestones(save);
    expect(first.map(l => l.label)).toContain('Winning season');
    expect(checkMilestones(save)).toEqual([]);
    me(save).record.w = 11; me(save).record.streak = 7;
    const more = checkMilestones(save).map(l => l.label);
    expect(more).toContain('11 wins');
    expect(more).toContain('7-game win streak');
    expect(more).not.toContain('Winning season');
    save.coach.w = 25;
    expect(checkMilestones(save).map(l => l.label)).toContain('25 career wins');
    expect(checkMilestones(save).map(l => l.label)).not.toContain('25 career wins');
  });
});

describe('people', () => {
  test('afterUserGame moves approval and fans the right way and stays in bounds', () => {
    const { save } = mk();
    save.owner.approval = 50; save.fans = 50; me(save).record.streak = 0;
    afterUserGame(save, true, 10, false);
    expect(save.owner.approval).toBeGreaterThan(50);
    expect(save.fans).toBeGreaterThan(50);
    save.owner.approval = 50; save.fans = 50;
    afterUserGame(save, false, 10, false);
    expect(save.owner.approval).toBeLessThan(50);
    expect(save.fans).toBeLessThan(50);
  });
  test('meters and morale stay within 0-100 at the extremes', () => {
    const { save } = mk();
    for (const p of roster(save)) p.morale = 100;
    save.owner.approval = 100; save.fans = 100; save.coach.rep = 100;
    for (let i = 0; i < 5; i++) afterUserGame(save, true, 2, true);
    const check = () => {
      expect(save.owner.approval).toBeGreaterThanOrEqual(0); expect(save.owner.approval).toBeLessThanOrEqual(100);
      expect(save.fans).toBeGreaterThanOrEqual(0); expect(save.fans).toBeLessThanOrEqual(100);
      expect(save.coach.rep).toBeGreaterThanOrEqual(0); expect(save.coach.rep).toBeLessThanOrEqual(100);
      for (const p of roster(save)) { expect(p.morale).toBeGreaterThanOrEqual(0); expect(p.morale).toBeLessThanOrEqual(100); }
    };
    check();
    for (const p of roster(save)) p.morale = 0;
    save.owner.approval = 0; save.fans = 0; save.coach.rep = 0; me(save).record.streak = -5;
    for (let i = 0; i < 5; i++) afterUserGame(save, false, 20, true);
    check();
  });
  test('setOwnerGoals gives two goals', () => {
    const { save } = mk();
    for (let t = 0; t < 16; t++) { save.userTeamId = t; setOwnerGoals(save); expect(save.owner.goals.length).toBe(2); }
  });
  test('evaluateGoals marks done and failed and moves approval', () => {
    const { save } = mk();
    const t = me(save);
    t.record.w = 10;
    t.history.push({ year: 1, w: 10, l: 4, playoff: 'none' });
    save.owner.goals = [
      { kind: 'wins', target: 6, text: 'six' },
      { kind: 'wins', target: 12, text: 'twelve' },
      { kind: 'playoffs', text: 'po' },
    ];
    save.owner.approval = 50;
    const lines = evaluateGoals(save);
    expect(save.owner.goals.map(g => [g.done, g.failed])).toEqual([[true, false], [false, true], [false, true]]);
    expect(lines[0]).toMatch(/MET/);
    expect(lines[1]).toMatch(/MISSED/);
    expect(save.owner.approval).toBe(50 + 12 - 14 - 14);
  });
  test('checkFired triggers at approval 0 with 3 offers; takeJob moves the coach', () => {
    const { save } = mk();
    save.owner.approval = 5;
    expect(checkFired(save)).toBe(false);
    save.owner.approval = 0;
    expect(checkFired(save)).toBe(true);
    expect(save.fired!.offers.length).toBe(3);
    expect(save.fired!.offers).not.toContain(ME);
    const target = save.fired!.offers[0];
    const stops = save.coach.stops.length;
    save.captainId = roster(save)[0].id;
    takeJob(save, target, true);
    expect(save.userTeamId).toBe(target);
    expect(save.owner.approval).toBe(55);
    expect(save.coach.fired).toBe(1);
    expect(save.fired).toBeNull();
    expect(save.captainId).toBeNull();
    expect(save.coach.stops.length).toBe(stops + 1);
    expect(save.coach.stops[stops - 1].to).toBe(save.year);
    expect(save.coach.stops[stops].teamId).toBe(target);
    expect(save.owner.goals.length).toBe(2);
  });

  test('rollEvent eventually produces an event for the user', () => {
    const { save } = mk();
    const rng = new Rng(99);
    let seen = 0;
    for (let i = 0; i < 80; i++) {
      save.pendingEvent = null; save.seenEvents = [];
      rollEvent(save, rng);
      const pe = save.pendingEvent as Save['pendingEvent'];
      if (pe) {
        seen++;
        expect(EVENTS.some(e => e.id === pe.templateId)).toBe(true);
        expect(save.seenEvents).toContain(pe.templateId);
      }
    }
    expect(seen).toBeGreaterThan(20);
    // never overwrites a pending event
    save.pendingEvent = { templateId: 'x', playerId: null };
    rollEvent(save, rng);
    expect((save.pendingEvent as { templateId: string } | null)?.templateId).toBe('x');
  });

  test('every event template x choice x trait resolves cleanly and stays in bounds', () => {
    const { save } = mk();
    const t = me(save);
    for (const tpl of EVENTS) {
      tpl.choices.forEach((choice, ci) => {
        const traits: (Trait | null)[] = [null, ...(Object.keys(choice.byTrait ?? {}) as Trait[])];
        for (const trait of traits) {
          const p = save.players[t.lineup[0]];
          p.injury = null;
          if (trait) p.trait = trait;
          save.pendingEvent = { templateId: tpl.id, playerId: tpl.subject === 'none' ? null : p.id, oppId: 0 };
          save.owner.approval = 50; save.fans = 50; save.credits = 10; save.coach.rep = 50;
          p.morale = 50;
          const out = resolveEvent(save, ci);
          expect(out, `${tpl.id}/${ci}`).not.toBeNull();
          expect(save.pendingEvent).toBeNull();
          expect(out!.result).not.toMatch(/\{\w+\}/);
          expect(save.owner.approval).toBeGreaterThanOrEqual(0); expect(save.owner.approval).toBeLessThanOrEqual(100);
          expect(save.fans).toBeGreaterThanOrEqual(0); expect(save.fans).toBeLessThanOrEqual(100);
          expect(save.coach.rep).toBeGreaterThanOrEqual(0); expect(save.coach.rep).toBeLessThanOrEqual(100);
          expect(save.credits).toBeGreaterThanOrEqual(0);
          for (const r of roster(save)) { expect(r.morale).toBeGreaterThanOrEqual(0); expect(r.morale).toBeLessThanOrEqual(100); }
          expectValidLineup(save);
          for (const r of roster(save)) r.injury = null;
          save.tradeDemands = [];
          fixLineup(save, t);
        }
      });
    }
  });

  test('resolveEvent with no pending event returns null', () => {
    const { save } = mk();
    save.pendingEvent = null;
    expect(resolveEvent(save, 0)).toBeNull();
    save.pendingEvent = { templateId: 'does_not_exist', playerId: null };
    expect(resolveEvent(save, 0)).toBeNull();
    expect(save.pendingEvent).toBeNull();
  });

  test('rollInjuries injures players over many games, healWeek heals them, lineup is repaired', () => {
    const { save, rng } = mk();
    const t = me(save);
    let injuredEver = 0;
    for (let g = 0; g < 400; g++) {
      rollInjuries(save, t, t.roster.map(id => box(id, 36)), rng);
      const hurt = roster(save).filter(p => p.injury);
      injuredEver = Math.max(injuredEver, hurt.length);
      if (t.roster.length - hurt.length >= 5) for (const id of t.lineup) expect(save.players[id].injury).toBeNull();
      expect(new Set(t.lineup).size).toBe(t.lineup.length);
      if (hurt.length >= 3) break;
    }
    expect(injuredEver).toBeGreaterThan(0);
    for (const p of roster(save)) if (p.injury) expect(p.injury.weeks).toBeGreaterThanOrEqual(1);
    let guard = 0;
    while (roster(save).some(p => p.injury) && guard++ < 60) healWeek(save, rng);
    expect(roster(save).every(p => !p.injury)).toBe(true);
  });

  test('healWeek counts injuries down exactly', () => {
    const { save, rng } = mk();
    const p = roster(save)[0];
    p.injury = { weeks: 2, desc: 'x' };
    healWeek(save, rng);
    expect(p.injury!.weeks).toBe(1);
    healWeek(save, rng);
    expect(p.injury).toBeNull();
  });

  test('rollInjuries ignores players who did not play', () => {
    const { save, rng } = mk();
    const t = me(save);
    for (let i = 0; i < 300; i++) rollInjuries(save, t, t.roster.map(id => box(id, 0)), rng);
    expect(roster(save).every(p => !p.injury)).toBe(true);
  });

  test('progressPlayer: young high-potential players improve, 34-year-olds decline, ratings bounded', () => {
    const { save } = mk();
    const rng = new Rng(1234);
    let young = 0, old = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const y: Player = genPlayer(save, rng, 'SF', 60, 20);
      y.potential = 90;
      young += progressPlayer(y, rng, 2, 0.5);
      const o: Player = genPlayer(save, rng, 'SF', 70, 34);
      old += progressPlayer(o, rng, 2, 0.5);
      for (const p of [y, o]) for (const k of RATING_KEYS) { expect(p.ratings[k]).toBeGreaterThanOrEqual(15); expect(p.ratings[k]).toBeLessThanOrEqual(99); }
    }
    expect(young / N).toBeGreaterThan(0.5);
    expect(old / N).toBeLessThan(-0.5);
  });
  test('progressPlayer clamps ratings at the floor and ceiling', () => {
    const { save } = mk();
    const rng = new Rng(5);
    const hi = genPlayer(save, rng, 'C', 99, 20);
    for (const k of RATING_KEYS) hi.ratings[k] = 99;
    hi.potential = 99;
    const lo = genPlayer(save, rng, 'C', 20, 38);
    for (const k of RATING_KEYS) lo.ratings[k] = 15;
    for (let i = 0; i < 20; i++) { progressPlayer(hi, rng, 5, 1); progressPlayer(lo, rng, 1, 0); }
    for (const k of RATING_KEYS) { expect(hi.ratings[k]).toBeLessThanOrEqual(99); expect(lo.ratings[k]).toBeGreaterThanOrEqual(15); }
  });
});

describe('offseason', () => {
  function startOffseason(save: Save, step: 'contracts' | 'draft' = 'contracts'): void {
    save.phase = 'offseason';
    save.offseason = { step, draftOrder: [], draftIdx: 0, prospects: [], faDay: 1, userOffers: {}, retired: [], campSpent: 0, log: [] };
  }

  test('expiringPlayers lists only the user players with 0 years left', () => {
    const { save } = mk();
    expect(expiringPlayers(save)).toEqual([]);
    const p = roster(save)[4];
    p.contract.years = 0;
    expect(expiringPlayers(save).map(x => x.id)).toEqual([p.id]);
  });

  test('resignPlayer honours refusal and cap space', () => {
    const { save } = mk();
    const t = me(save);
    const p = roster(save)[4];
    p.contract.years = 0;
    p.morale = 100;
    save.tradeDemands = [p.id];
    const old = { ...p.contract };
    expect(askingContract(save, p, t.id).refuses).toBe(true);
    expect(resignPlayer(save, p.id)).toMatch(/not interested/);
    expect(p.contract).toEqual(old);
    save.tradeDemands = [];
    expect(askingContract(save, p, t.id).refuses).toBe(false);
    // only the roster limit can stop it
    const extra: number[] = [];
    while (t.roster.length <= ROSTER_MAX) { const id = save.freeAgents[0]; extra.push(id); signPlayer(save, id, t.id, { salary: MIN_SALARY, years: 1 }); }
    expect(resignPlayer(save, p.id)).toMatch(/over the limit/);
    expect(p.contract).toEqual(old);
    for (const id of extra) releasePlayer(save, id, { deadCap: false });
    // no cap space at all, far past the second apron, mid-level spent: his own team may still re-sign him
    t.deadCap = 500;
    t.mleUsed = true;
    expect(payroll(save, t)).toBeGreaterThan(SECOND_APRON);
    const ask = askingContract(save, p, t.id);
    expect(resignPlayer(save, p.id)).toBeNull();
    expect(p.contract).toEqual({ salary: ask.salary, years: ask.years });
    expect(p.contract.years).toBeGreaterThan(0);
    expect(t.mleUsed).toBe(true);
    expect(expiringPlayers(save)).toEqual([]);
    // someone else's player is not yours to re-sign
    expect(resignPlayer(save, save.teams[0].roster[0])).not.toBeNull();
  });

  test('a star with an All-League or MVP award asks his own team for the supermax, and can be given it', () => {
    const { save } = mk();
    const t = me(save);
    const p = roster(save).sort((a, b) => b.contract.salary - a.contract.salary)[0];
    for (const k of RATING_KEYS) p.ratings[k] = 95;
    p.age = 27; p.morale = 80; p.trait = 'Quiet Pro'; p.tenure = 0;
    p.contract.years = 0;
    expect(askingContract(save, p, t.id)).toMatchObject({ salary: MAX_SALARY, supermax: false, years: 5 });
    p.awards.push('MVP (Y1)');
    const ask = askingContract(save, p, t.id);
    expect(ask.supermax).toBe(true);
    expect(ask.salary).toBeGreaterThan(MAX_SALARY);
    expect(ask.salary).toBeLessThanOrEqual(SUPERMAX_SALARY);
    // nobody else can offer it
    expect(askingContract(save, p, 0)).toMatchObject({ salary: MAX_SALARY, supermax: false });
    expect(askingContract(save, p, 0).years).toBeLessThanOrEqual(4);
    setPayroll(save, t, FIRST_APRON);
    expect(resignPlayer(save, p.id)).toBeNull();
    expect(p.contract).toEqual({ salary: ask.salary, years: 5 });
  });

  test('the Negotiator perk discounts what the user\'s own players ask, and nobody else\'s', () => {
    const { save } = mk();
    const t = me(save);
    const p = roster(save)[2];
    const theirs = save.players[save.teams[0].roster[2]];
    const base = askingContract(save, p, t.id).salary, baseTheirs = askingContract(save, theirs, 0).salary, baseFa = askingContract(save, theirs, t.id).salary;
    prog(save).perks.negotiator = 2;
    expect(askingContract(save, p, t.id).salary).toBeCloseTo(base * 0.9, 0);
    expect(askingContract(save, p, t.id).salary).toBeLessThan(base);
    expect(askingContract(save, theirs, 0).salary).toBe(baseTheirs);
    expect(askingContract(save, theirs, t.id).salary).toBe(baseFa);
  });

  /** A finished season: team i has i wins, the best eight made the playoffs, `champ` won it. */
  function lotterySave(champ = 15): { save: Save; restore: () => void } {
    const { save } = mk();
    save.teams.forEach((t, i) => { t.record = { w: i, l: 15 - i, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 }; });
    const series = [[15, 8], [14, 9], [13, 10], [12, 11]].map(([h, l]) => ({ round: 1 as const, conf: 0, highId: h, lowId: l, highW: 0, lowW: 0, games: [] }));
    save.playoffs = { series, championId: champ };
    startOffseason(save);
    const picks = save.teams.map(t => t.picks.slice());
    const cls = save.draftClass.slice();
    const restore = () => { save.teams.forEach((t, i) => { t.picks = picks[i].slice(); }); save.draftClass = cls.slice(); save.offseason!.log = []; save.news = []; };
    return { save, restore };
  }

  test('lottery: the worst team wins the first pick about a quarter of the time, and only the bottom eight can move up', () => {
    const { save, restore } = lotterySave(12);
    expect(LOTTERY_WEIGHTS).toEqual([25, 20, 16, 13, 10, 7, 5, 4]);
    expect(LOTTERY_WEIGHTS.reduce((s, v) => s + v, 0)).toBe(100);
    const N = 4000;
    const first = new Array(16).fill(0);
    let worstTop3 = 0;
    for (let seed = 1; seed <= N; seed++) {
      restore();
      buildDraftOrder(save, new Rng(seed * 7919));
      const order = save.offseason!.draftOrder;
      expect(order.length).toBe(32);
      const r1 = order.filter(s => s.round === 1), r2 = order.filter(s => s.round === 2);
      expect(r1.map(s => s.pick)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      expect(r2.map(s => s.pick)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      expect(new Set(r1.map(s => s.teamId)).size).toBe(16);
      // nobody outside the bottom eight picks in the top three
      const top3 = r1.slice(0, 3).map(s => s.teamId);
      for (const id of top3) expect(id).toBeLessThan(8);
      // the rest of the lottery teams follow by record, worst first
      const rest = r1.slice(3, 8).map(s => s.teamId);
      expect(rest).toEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(id => !top3.includes(id)));
      // so the worst team can fall no lower than fourth
      expect(r1.findIndex(s => s.teamId === 0)).toBeLessThanOrEqual(3);
      // playoff teams after them by record, the champion last
      expect(r1.slice(8).map(s => s.teamId)).toEqual([8, 9, 10, 11, 13, 14, 15, 12]);
      // round 2 is strict reverse record
      expect(r2.map(s => s.teamId)).toEqual(Array.from({ length: 16 }, (_, i) => i));
      first[top3[0]]++;
      if (top3.includes(0)) worstTop3++;
      // this year's picks are used up, and the board is set
      for (const t of save.teams) expect(t.picks.some(pk => pk.year === save.year)).toBe(false);
      expect(save.offseason!.prospects.length).toBe(40);
    }
    LOTTERY_WEIGHTS.forEach((w, i) => expect(Math.abs(first[i] / N - w / 100)).toBeLessThan(0.03));
    expect(first[0] / N).toBeGreaterThan(0.22);
    expect(first[0] / N).toBeLessThan(0.28);
    for (let i = 8; i < 16; i++) expect(first[i]).toBe(0);
    // the worst team lands in the top three roughly 60% of the time
    expect(worstTop3 / N).toBeGreaterThan(0.5);
    expect(worstTop3 / N).toBeLessThan(0.72);
  });

  test('lottery: results are logged and reported, and a traded pick goes to its owner wherever it lands', () => {
    const { save, restore } = lotterySave();
    restore();
    // team 9 holds the worst team's first-round pick; team 2 holds the champion's second
    const move = (from: number, to: number, round: 1 | 2) => {
      const i = save.teams[from].picks.findIndex(pk => pk.year === save.year && pk.round === round && pk.origTeamId === from);
      save.teams[to].picks.push(save.teams[from].picks.splice(i, 1)[0]);
    };
    move(0, 9, 1); move(15, 2, 2);
    buildDraftOrder(save, new Rng(5));
    const order = save.offseason!.draftOrder, log = save.offseason!.log;
    const r1 = order.filter(s => s.round === 1), r2 = order.filter(s => s.round === 2);
    expect(order.length).toBe(32);
    expect(r1.filter(s => s.teamId === 0).length).toBe(0);
    expect(r1.filter(s => s.teamId === 9).length).toBe(2);
    expect(r1.findIndex(s => s.teamId === 9)).toBeLessThanOrEqual(3); // the worst team's slot, which is top four
    expect(r1[15].teamId).toBe(15);
    expect(r2[15].teamId).toBe(2);
    expect(r2.filter(s => s.teamId === 15).length).toBe(0);
    // one line for each of the top three, and for anyone pushed out of it
    const lines = log.filter(l => l.startsWith('Lottery: '));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(6);
    for (const n of [1, 2, 3]) expect(lines.filter(l => l.includes(`the #${n} pick`)).length).toBe(1);
    expect(lines.every(l => /(keep|jump from \d(st|nd|rd|th) to|fall from \d(st|nd|rd|th) to) the #\d pick/.test(l))).toBe(true);
    const worst = lines.find(l => l.startsWith(`Lottery: ${save.teams[0].city} `))!;
    expect(worst).toContain(`(the pick belongs to ${save.teams[9].city})`);
    const news = save.news.find(n => n.kind === 'draft' && n.text.startsWith('Draft lottery: '))!;
    expect(news).toBeTruthy();
    expect(news.text).toMatch(/win the #1 pick\. Then .* second, .* third\./);
    // a jump is described from the seed to the pick
    let jumped = false;
    for (let seed = 1; seed <= 40 && !jumped; seed++) {
      restore();
      buildDraftOrder(save, new Rng(seed));
      const top = save.offseason!.draftOrder[0].teamId;
      if (top === 0) { expect(save.offseason!.log).toContain(`Lottery: ${save.teams[0].city} keep the #1 pick`); continue; }
      jumped = true;
      const nth = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][top];
      expect(save.offseason!.log).toContain(`Lottery: ${save.teams[top].city} jump from ${nth} to the #1 pick`);
      expect(save.offseason!.log.some(l => l.startsWith(`Lottery: ${save.teams[0].city} fall from 1st to the #`))).toBe(true);
    }
    expect(jumped).toBe(true);
  });

  test('a draft pick can always be signed, even far over the cap', () => {
    const { save, rng } = mk();
    const t = me(save);
    startOffseason(save, 'draft');
    const off = save.offseason!;
    off.prospects = save.draftClass.slice();
    off.draftOrder = [{ teamId: t.id, round: 1, pick: 1 }];
    t.deadCap = 300; t.mleUsed = true;
    const pid = off.prospects[0];
    expect(userDraftPick(save, pid, rng)).toBeNull();
    expect(t.roster).toContain(pid);
    expect(save.players[pid].contract).toEqual({ salary: 10, years: 3 });
  });

  /** End a season with the user's team at a given payroll (and not in the final). */
  function endSeasonAt(pay: number, credits: number): Save {
    const { save, rng } = mk();
    const t = me(save);
    for (const x of save.teams) x.record = { w: 7, l: 7, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 };
    save.playoffs = { series: [{ round: 3, conf: 2, highId: 0, lowId: 1, winnerId: 0, highW: 1, lowW: 0, games: [] }], championId: 0 };
    save.credits = credits;
    save.owner.approval = 60;
    setPayroll(save, t, pay);
    beginOffseason(save, rng);
    return save;
  }

  test('the luxury tax is charged to the user at season end: credits, owner approval, a headline', () => {
    const clean = endSeasonAt(LUXURY_TAX, 10);
    expect(clean.credits).toBe(10);
    expect(clean.offseason!.log.some(l => l.startsWith('Luxury tax'))).toBe(false);
    expect(clean.news.some(n => n.text.startsWith('Luxury tax'))).toBe(false);

    const taxed = endSeasonAt(LUXURY_TAX + 12, 10);
    expect(taxed.credits).toBe(6);
    expect(taxed.owner.approval).toBe(clean.owner.approval - 3);
    const line = taxed.offseason!.log.find(l => l.startsWith('Luxury tax'))!;
    expect(line).toBe(`Luxury tax: ${me(taxed).city} finished $12M over the tax line. It cost 4 credits and 3 owner approval.`);
    expect(taxed.news.find(n => n.text === line)).toMatchObject({ kind: 'owner', mine: true });

    // a small overage still costs the owner's patience, and credits never go below zero
    const small = endSeasonAt(LUXURY_TAX + 1, 10);
    expect(small.credits).toBe(10);
    expect(small.owner.approval).toBe(clean.owner.approval - 2);
    const broke = endSeasonAt(LUXURY_TAX + 30, 3);
    expect(broke.credits).toBe(0);
    expect(broke.offseason!.log.find(l => l.startsWith('Luxury tax'))).toContain('It cost 3 credits and 7 owner approval.');
  });

  test('after a loss a taxpaying team with a losing record costs one more owner approval', () => {
    const run = (pay: number, won: boolean, w: number, l: number): number => {
      const { save } = mk();
      const t = me(save);
      t.record = { w, l, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 };
      save.owner.approval = 50;
      setPayroll(save, t, pay);
      afterUserGame(save, won, 5, false);
      return save.owner.approval;
    };
    expect(run(LUXURY_TAX + 1, false, 3, 6)).toBe(run(LUXURY_TAX, false, 3, 6) - 1);
    expect(run(LUXURY_TAX + 25, false, 3, 6)).toBe(run(LUXURY_TAX, false, 3, 6) - 1);
    expect(run(LUXURY_TAX + 5, false, 6, 3)).toBe(run(LUXURY_TAX, false, 6, 3)); // winning record: no complaint
    expect(run(LUXURY_TAX + 5, true, 3, 6)).toBe(run(LUXURY_TAX, true, 3, 6)); // not after a win
    expect(run(SALARY_CAP + 20, false, 3, 6)).toBe(run(100, false, 3, 6)); // over the cap is not the tax
  });

  test('the mid-level exception comes back when the new season starts', () => {
    const { save, rng } = mk();
    for (const t of save.teams) t.mleUsed = true;
    startNewSeason(save, rng);
    for (const t of save.teams) expect(t.mleUsed).toBe(false);
  });

  test('draft order has 32 slots and honours a traded pick', () => {
    const { save, rng } = mk();
    const t = me(save);
    const other = save.teams[5];
    const pick = other.picks.find(p => p.year === save.year && p.round === 1)!;
    other.picks = other.picks.filter(p => p !== pick);
    t.picks.push(pick);
    startOffseason(save);
    advanceOffseason(save, rng); // contracts -> draft builds the order
    const order = save.offseason!.draftOrder;
    expect(order.length).toBe(32);
    const r1 = order.filter(s => s.round === 1), r2 = order.filter(s => s.round === 2);
    expect(r1.length).toBe(16); expect(r2.length).toBe(16);
    expect(r1.map(s => s.pick).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(r1.filter(s => s.teamId === t.id).length).toBe(2);
    expect(r1.filter(s => s.teamId === other.id).length).toBe(0);
    expect(r2.filter(s => s.teamId === other.id).length).toBe(1);
    expect(save.draftClass).toEqual([]);
  });

  test('userDraftPick errors when it is not your pick and when the roster is full', () => {
    const { save, rng } = mk();
    const t = me(save);
    startOffseason(save, 'draft');
    const off = save.offseason!;
    off.prospects = save.draftClass.slice();
    off.draftOrder = [{ teamId: 0, round: 1, pick: 1 }, { teamId: t.id, round: 1, pick: 2 }];
    off.draftIdx = 0;
    expect(userOnClock(save)).toBe(false);
    expect(userDraftPick(save, off.prospects[0], rng)).toMatch(/Not your pick/);
    off.draftIdx = 1;
    expect(userOnClock(save)).toBe(true);
    let i = 0;
    while (t.roster.length < ROSTER_MAX) signPlayer(save, save.freeAgents[i++], t.id, { salary: MIN_SALARY, years: 1 });
    const pid = off.prospects[0];
    expect(userDraftPick(save, pid, rng)).toMatch(/full/);
    expect(off.prospects).toContain(pid);
    expect(off.draftIdx).toBe(1);
    // passing is still allowed
    expect(userDraftPick(save, null, rng)).toBeNull();
    expect(off.draftIdx).toBe(2);
  });

  test('userDraftPick signs the prospect when there is room', () => {
    const { save, rng } = mk();
    const t = me(save);
    startOffseason(save, 'draft');
    const off = save.offseason!;
    off.prospects = save.draftClass.slice();
    off.draftOrder = [{ teamId: t.id, round: 2, pick: 16 }];
    for (const p of roster(save)) p.contract.salary = MIN_SALARY;
    while (t.roster.length > 9) releasePlayer(save, t.roster[t.roster.length - 1], { deadCap: false });
    const pid = off.prospects[0];
    expect(userDraftPick(save, pid, rng)).toBeNull();
    expect(t.roster).toContain(pid);
    expect(save.players[pid].draft).toMatchObject({ year: 1, round: 2, pick: 16, teamId: t.id });
    expect(off.prospects).not.toContain(pid);
    expectValidLineup(save);
  });

  test('startNewSeason resets records, bumps the year, builds a 112-game schedule and a 40-player class', () => {
    const { save, rng } = mk();
    for (const t of save.teams) t.record = { w: 9, l: 5, pf: 100, pa: 90, confW: 5, confL: 2, streak: 3 };
    save.week = 15;
    const year = save.year;
    startNewSeason(save, rng);
    expect(save.year).toBe(year + 1);
    expect(save.week).toBe(1);
    expect(save.phase).toBe('regular');
    expect(save.playoffs).toBeNull();
    expect(save.offseason).toBeNull();
    for (const t of save.teams) expect(t.record).toEqual({ w: 0, l: 0, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 });
    expect(save.schedule.length).toBe(112);
    expect(save.schedule.every(g => !g.played)).toBe(true);
    expect(save.draftClass.length).toBe(40);
    for (const id of save.draftClass) expect(save.players[id].scouted).toBe(false);
    expect(save.owner.goals.length).toBe(2);
    expect(save.scoutPoints).toBeGreaterThan(0);
    for (const t of save.teams) expectValidLineup(save, t);
  });
});

describe('a freshly generated league', () => {
  test('payrolls spread around the soft cap: strong teams in or near the tax, weak teams with room, nobody above the second apron', () => {
    const all: number[] = [];
    let topAvg = 0, bottomAvg = 0;
    const N = 25;
    for (let seed = 1; seed <= N; seed++) {
      const { save } = mk(seed * 13);
      const rows = save.teams.map(t => ({ pay: payroll(save, t), str: teamStrength(save, t) })).sort((a, b) => b.str - a.str);
      const avg = rows.reduce((s, r) => s + r.pay, 0) / rows.length;
      expect(avg, `seed ${seed} average payroll`).toBeGreaterThan(140);
      expect(avg, `seed ${seed} average payroll`).toBeLessThan(170);
      for (const r of rows) { expect(r.pay).toBeLessThanOrEqual(SECOND_APRON); all.push(r.pay); }
      expect(rows.filter(r => r.pay > SALARY_CAP).length).toBeGreaterThanOrEqual(4);
      expect(rows.filter(r => r.pay <= SALARY_CAP).length).toBeGreaterThanOrEqual(3);
      topAvg += rows.slice(0, 4).reduce((s, r) => s + r.pay, 0) / 4 / N;
      bottomAvg += rows.slice(-4).reduce((s, r) => s + r.pay, 0) / 4 / N;
      for (const t of save.teams) for (const id of t.roster) {
        const c = save.players[id].contract;
        expect(c.salary).toBeGreaterThanOrEqual(MIN_SALARY);
        expect(c.salary).toBeLessThanOrEqual(MAX_SALARY);
        expect(c.years).toBeGreaterThanOrEqual(1);
        expect(c.years).toBeLessThanOrEqual(4);
      }
      for (const t of save.teams) expect(t.mleUsed).toBeFalsy();
    }
    const mean = all.reduce((s, v) => s + v, 0) / all.length;
    expect(mean).toBeGreaterThan(148);
    expect(mean).toBeLessThan(162);
    expect(topAvg).toBeGreaterThan(172);
    expect(topAvg).toBeLessThan(SECOND_APRON);
    expect(bottomAvg).toBeGreaterThan(112);
    expect(bottomAvg).toBeLessThan(138);
    // some teams start as taxpayers
    expect(all.filter(v => v > LUXURY_TAX).length).toBeGreaterThan(N);
  });
});

describe('persist.migrate', () => {
  test('rejects junk', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate(undefined)).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate('save')).toBeNull();
    expect(migrate(42)).toBeNull();
    expect(migrate([])).toBeNull();
    expect(migrate({ version: '1', teams: [], players: {} })).toBeNull();
    expect(migrate({ version: 1, teams: {}, players: {} })).toBeNull();
    expect(migrate({ version: 1, teams: [] })).toBeNull();
    expect(migrate({ teams: [], players: {} })).toBeNull();
  });
  test('rejects a save from a newer version', () => {
    const { save } = mk();
    save.version = SAVE_VERSION + 1;
    expect(migrate(JSON.parse(JSON.stringify(save)))).toBeNull();
  });
  test('accepts a real save round-tripped through JSON', () => {
    const { save } = mk();
    const back = migrate(JSON.parse(JSON.stringify(save)));
    expect(back).not.toBeNull();
    expect(back).toEqual(JSON.parse(JSON.stringify(save)));
    expect(back!.teams.length).toBe(16);
  });
  test('fills in missing optional fields', () => {
    const { save } = mk();
    const raw = JSON.parse(JSON.stringify(save));
    delete raw.draftClass; delete raw.tradeOffer;
    const back = migrate(raw)!;
    expect(back.draftClass).toEqual([]);
    expect(back.tradeOffer).toBeNull();
  });
});
