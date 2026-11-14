import { describe, expect, it } from 'vitest';
import {
  FA_DAYS, FIRST_APRON, LUXURY_TAX, MAX_FA_YEARS, MAX_SALARY, MIN_SALARY, MLE, NUM_TEAMS, ROSTER_MAX, ROSTER_MIN, ROSTER_NORMAL, SALARY_CAP,
  SAVE_VERSION, SECOND_APRON, SUPERMAX_SALARY, TAX_MLE,
} from '../src/core/constants';
import { aiDraftChoice, rookieContract } from '../src/core/gm/draft';
import { aiFillRosters, instantSigning, interestLevel, offerScore, runFreeAgencyDay } from '../src/core/gm/freeAgency';
import { aiMaintainRosters, aiResignPhase, updateStrategies } from '../src/core/gm/teamAi';
import type { TradeOffer } from '../src/core/gm/trade';
import { aiDumpSalary, aiOfferToUser, aiTradesWeek, evaluateTrade, executeTrade, suggestSweetener, tradeMatch, validateTrade } from '../src/core/gm/trade';
import { askingContract, marketSalary, pickValue, playerValue, supermaxEligible, teamNeeds } from '../src/core/gm/value';
import { autoLineup } from '../src/core/lineup';
import { capSpace, capStatus, luxuryTax, matchLimit, maxOffer, mleStatus, payroll, signingPath } from '../src/core/org/finance';
import { releasePlayer } from '../src/core/org/roster';
import { emptyStats, ovr, round1 } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import { CALENDARS, cal } from '../src/core/season/calendar';
import type { Facility, Player, Pos, Save, Team, Trait } from '../src/core/types';
import { POSITIONS } from '../src/core/types';

// ---------- fixture ----------

const USER = 0;

function mkPlayer(save: Save, pos: Pos, o: number, age: number, opts: { potential?: number; trait?: Trait } = {}): Player {
  const id = save.nextId++;
  const p: Player = {
    id, name: `P. Layer${id}`, pos, age,
    // Every rating equal means overall equals that number at any position.
    ratings: { sht: o, hnd: o, pas: o, spd: o, fin: o, def: o, reb: o },
    potential: opts.potential ?? o,
    trait: opts.trait ?? 'Quiet Pro',
    morale: 70,
    contract: { salary: MIN_SALARY, years: 1 },
    teamId: null, injury: null,
    season: emptyStats(), seasons: [], draft: null, awards: [], tenure: 1,
    look: { skin: 0, hair: 0, hairColor: 0, height: 1 }, num: id % 100,
  };
  save.players[id] = p;
  return p;
}

function addToTeam(save: Save, p: Player, team: Team, contract?: { salary: number; years: number }): Player {
  p.teamId = team.id;
  p.contract = contract ?? { salary: marketSalary(p), years: 2 };
  team.roster.push(p.id);
  return p;
}

const fac = (): Facility => ({ level: 3, condition: 100 });

function mkSave(seed = 1): Save {
  const rng = new Rng(seed);
  const save: Save = {
    version: SAVE_VERSION, createdAt: 0, savedAt: 0, rng: seed, nextId: 1,
    year: 1, phase: 'regular', week: 1,
    teams: [], players: {}, freeAgents: [], staffPool: [], schedule: [], playoffs: null,
    userTeamId: USER,
    coach: { name: 'Coach', rep: 50, w: 0, l: 0, playoffW: 0, playoffL: 0, titles: 0, seasons: 0, fired: 0, stops: [], look: { skin: 0, hair: 0, hairColor: 0 } },
    credits: 0, owner: { name: 'Owner', approval: 50, goals: [] }, fans: 50, captainId: null,
    news: [], pendingEvent: null, seenEvents: [], history: [], records: {}, hallOfFame: [],
    offseason: null, settings: { sound: false, difficulty: 'normal', haptics: false },
    tradeDemands: [], scoutPoints: 0, milestones: [], draftClass: [], tradeOffer: null,
  };
  const starters = [84, 77, 73, 70, 68];
  const bench = [65, 63, 61, 58, 55];
  for (let t = 0; t < NUM_TEAMS; t++) {
    const team: Team = {
      id: t, city: `City${t}`, name: `Team${t}`, abbr: `T${t}`, conf: t % 2,
      colors: { primary: '#000', secondary: '#fff' },
      roster: [], lineup: [], staff: { oc: null, dc: null },
      facilities: { arena: fac(), training: fac(), medical: fac(), scouting: fac() },
      picks: [], record: { w: 0, l: 0, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 },
      deadCap: 0, history: [], titles: [], strategy: 'middle', prestige: 50,
    };
    save.teams.push(team);
    const q = Math.round(((t * 7) % NUM_TEAMS) * (10 / (NUM_TEAMS - 1)) - 5); // -5..+5, spread across ids
    const sPos = rng.shuffle([...POSITIONS]);
    const bPos = rng.shuffle([...POSITIONS]);
    starters.forEach((o, i) => {
      const age = rng.int(22, 32);
      const p = mkPlayer(save, sPos[i], o + q, age);
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.8, 1)), years: rng.int(1, 4) });
    });
    bench.forEach((o, i) => {
      const age = rng.int(20, 34);
      const ov = o + Math.round(q / 2);
      const p = mkPlayer(save, bPos[i], ov, age, { potential: age <= 23 ? ov + rng.int(2, 12) : ov });
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.8, 1)), years: rng.int(1, 3) });
    });
    for (const year of [1, 2]) for (const round of [1, 2] as const) team.picks.push({ year, round, origTeamId: t });
    team.lineup = autoLineup(team.roster.map(id => save.players[id]));
  }
  return save;
}

function assertLegal(save: Save, opts: { minRoster?: number } = {}): void {
  const seen = new Set<number>();
  for (const team of save.teams) {
    expect(team.roster.length).toBeGreaterThanOrEqual(opts.minRoster ?? ROSTER_MIN);
    expect(team.roster.length).toBeLessThanOrEqual(ROSTER_MAX);
    expect(payroll(save, team)).toBeLessThanOrEqual(SECOND_APRON);
    expect(team.lineup.length).toBe(5);
    expect(new Set(team.lineup).size).toBe(5);
    for (const id of team.lineup) expect(team.roster).toContain(id);
    for (const id of team.roster) {
      expect(save.players[id].teamId).toBe(team.id);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(save.freeAgents).not.toContain(id);
    }
  }
  // Every pick is owned exactly once.
  const picks = save.teams.flatMap(t => t.picks.map(p => `${p.year}-${p.round}-${p.origTeamId}`));
  expect(new Set(picks).size).toBe(picks.length);
}

const userSnapshot = (save: Save): string => {
  const t = save.teams[USER];
  return JSON.stringify({ roster: t.roster, lineup: t.lineup, picks: t.picks, staff: t.staff });
};

const byOvr = (save: Save, team: Team): Player[] =>
  team.roster.map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a));

const empty = () => ({ players: [] as number[], picks: [] as TradeOffer['aGives']['picks'] });

/** Pin a team's payroll to a figure by adjusting dead money (negative is fine for a test). */
function setPayroll(save: Save, team: Team, target: number): void {
  team.deadCap = round1(target - (payroll(save, team) - team.deadCap));
  expect(payroll(save, team)).toBeCloseTo(target, 1);
}
/** Put everyone on these teams on the minimum, so money is never the reason a deal fails. */
function cheapen(save: Save, ...teams: Team[]): void {
  for (const t of teams) for (const id of t.roster) save.players[id].contract.salary = MIN_SALARY;
}

// ---------- value ----------

describe('value', () => {
  it('rises with overall, without going backwards', () => {
    const save = mkSave();
    let prevV = -Infinity, prevS = 0;
    for (let o = 40; o <= 99; o++) {
      const p = mkPlayer(save, 'SF', o, 27);
      p.contract = { salary: marketSalary(p), years: 2 };
      const v = playerValue(save, p), s = marketSalary(p);
      expect(v).toBeGreaterThanOrEqual(prevV);
      expect(s).toBeGreaterThanOrEqual(prevS);
      prevV = v; prevS = s;
    }
  });

  it('lands on the intended scale', () => {
    const save = mkSave();
    const at = (o: number, age = 27) => {
      const p = mkPlayer(save, 'SF', o, age);
      p.contract = { salary: marketSalary(p), years: 2 };
      return { v: playerValue(save, p), s: marketSalary(p) };
    };
    expect(at(58, 30).v).toBeGreaterThan(2);
    expect(at(58, 30).v).toBeLessThan(8);
    expect(at(70).v).toBeGreaterThan(25);
    expect(at(70).v).toBeLessThan(36);
    expect(at(85).v).toBeGreaterThan(70);
    expect(at(85).v).toBeLessThan(92);
    expect(at(93).v).toBeGreaterThan(120);
    // roughly: a 50 earns the minimum, 65 = 8, 70 = 14, 75 = 22, 82 = 36, 90+ the max
    expect(at(50).s).toBe(MIN_SALARY);
    expect(Math.abs(at(65).s - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(70).s - 14)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(at(75).s - 22)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(82).s - 36)).toBeLessThanOrEqual(2);
    expect(at(90).s).toBe(MAX_SALARY);
    expect(at(97).s).toBe(MAX_SALARY);
  });

  it('adjusts for age, potential, contract and injury', () => {
    const save = mkSave();
    const mk = (o: number, age: number, potential?: number) => {
      const p = mkPlayer(save, 'PG', o, age, { potential });
      p.contract = { salary: marketSalary(p), years: 2 };
      return p;
    };
    const young = mk(85, 25), old = mk(85, 33);
    expect(playerValue(save, old)).toBeLessThan(playerValue(save, young) * 0.6);
    expect(marketSalary(old)).toBeLessThan(marketSalary(young));

    const raw = mk(62, 20, 62), prospect = mk(62, 20, 85);
    expect(playerValue(save, prospect)).toBeGreaterThan(playerValue(save, raw) * 1.5);

    const fair = mk(75, 27), cheap = mk(75, 27), pricey = mk(75, 27);
    cheap.contract = { salary: 6, years: 3 };
    pricey.contract = { salary: 45, years: 4 };
    expect(playerValue(save, cheap)).toBeGreaterThan(playerValue(save, fair));
    expect(playerValue(save, pricey)).toBeLessThan(playerValue(save, fair));
    const albatross = mk(60, 31);
    albatross.contract = { salary: 30, years: 4 };
    expect(playerValue(save, albatross)).toBeLessThan(0);

    const hurt = mk(75, 27);
    hurt.injury = { weeks: 6, desc: 'knee' };
    expect(playerValue(save, hurt)).toBeLessThan(playerValue(save, fair));
  });

  it('prices a typical ten-man roster around the soft cap, a strong one in the tax, a weak one well under', () => {
    const save = mkSave();
    const cost = (os: number[]) => os.reduce((s, o) => s + marketSalary(mkPlayer(save, 'SF', o, 27)), 0);
    const typical = cost([82, 77, 74, 71, 69, 65, 63, 62, 60, 59]);
    expect(typical).toBeGreaterThan(SALARY_CAP - 12);
    expect(typical).toBeLessThan(SALARY_CAP + 20);
    const strong = cost([86, 81, 78, 75, 73, 69, 68, 66, 65, 63]);
    expect(strong).toBeGreaterThan(LUXURY_TAX);
    const weak = cost([77, 72, 69, 66, 64, 60, 59, 57, 56, 54]);
    expect(weak).toBeLessThan(SALARY_CAP - 30);
  });

  it('asks for up to 5 years and the supermax only from his own team, and only with the award', () => {
    const save = mkSave();
    const team = save.teams[3];
    const star = byOvr(save, team)[0];
    for (const k of Object.keys(star.ratings) as (keyof Player['ratings'])[]) star.ratings[k] = 94;
    star.age = 27; star.morale = 70; star.trait = 'Quiet Pro'; star.tenure = 0;
    expect(supermaxEligible(star)).toBe(false);
    const plain = askingContract(save, star, team.id);
    expect(plain.salary).toBe(MAX_SALARY);
    expect(plain.supermax).toBe(false);
    expect(plain.years).toBe(5);
    star.awards.push('Sixth Man (Y1)');
    expect(supermaxEligible(star)).toBe(false);
    star.awards.push('All-League (Y2)');
    expect(supermaxEligible(star)).toBe(true);
    const own = askingContract(save, star, team.id);
    expect(own.supermax).toBe(true);
    expect(own.salary).toBeGreaterThan(MAX_SALARY);
    expect(own.salary).toBeLessThanOrEqual(SUPERMAX_SALARY);
    // another team can only offer the normal max, and 4 years
    const other = askingContract(save, star, 5);
    expect(other.salary).toBe(MAX_SALARY);
    expect(other.supermax).toBe(false);
    expect(other.years).toBeLessThanOrEqual(MAX_FA_YEARS);
    // an MVP counts too; an eligible player who is not worth the max does not get it
    star.awards = ['MVP (Y3)'];
    expect(supermaxEligible(star)).toBe(true);
    const role = byOvr(save, team)[4];
    role.awards.push('All-League (Y1)');
    expect(askingContract(save, role, team.id).supermax).toBe(false);
    expect(askingContract(save, role, team.id).salary).toBeLessThan(MAX_SALARY);
  });

  it('prices asking contracts by trait, tenure and morale', () => {
    const save = mkSave();
    const team = save.teams[3];
    const p = byOvr(save, team)[1];
    const base = askingContract(save, p, team.id);
    expect(base.refuses).toBe(false);
    expect(base.years).toBeGreaterThanOrEqual(1);
    p.trait = 'Mercenary';
    expect(askingContract(save, p, team.id).salary).toBeGreaterThan(base.salary);
    p.trait = 'Loyal'; p.tenure = 5;
    expect(askingContract(save, p, team.id).salary).toBeLessThan(base.salary);
    p.trait = 'Quiet Pro'; p.morale = 10;
    expect(askingContract(save, p, team.id).refuses).toBe(true);
    expect(askingContract(save, p, 4).refuses).toBe(false);
  });

  it('values picks by round, team and year', () => {
    const save = mkSave();
    const strong = save.teams.reduce((a, b) => (ovr(byOvr(save, a)[0]) >= ovr(byOvr(save, b)[0]) ? a : b));
    const weak = save.teams.reduce((a, b) => (ovr(byOvr(save, a)[0]) <= ovr(byOvr(save, b)[0]) ? a : b));
    const r1s = pickValue(save, { year: 1, round: 1, origTeamId: strong.id });
    const r1w = pickValue(save, { year: 1, round: 1, origTeamId: weak.id });
    const r2w = pickValue(save, { year: 1, round: 2, origTeamId: weak.id });
    expect(r1s).toBeGreaterThanOrEqual(12);
    expect(r1w).toBeLessThanOrEqual(40);
    expect(r1w).toBeGreaterThan(r1s);
    expect(r2w).toBeLessThanOrEqual(8);
    expect(r2w).toBeGreaterThanOrEqual(3);
    expect(pickValue(save, { year: 2, round: 1, origTeamId: weak.id })).toBeLessThan(r1w);
  });

  it('reports needs between 0 and 1 and notices a hole', () => {
    const save = mkSave();
    const team = save.teams[5];
    const before = teamNeeds(save, team);
    for (const pos of POSITIONS) {
      expect(before[pos]).toBeGreaterThanOrEqual(0);
      expect(before[pos]).toBeLessThanOrEqual(1);
    }
    for (const id of [...team.roster]) if (save.players[id].pos === 'C') releasePlayer(save, id, { deadCap: false });
    expect(teamNeeds(save, team).C).toBe(1);
  });
});

// ---------- trades ----------

describe('validateTrade', () => {
  it('catches ownership, empty, roster, cap and deadline problems', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[1];
    const mine = byOvr(save, user), theirs = byOvr(save, other);
    const swap: TradeOffer = {
      aId: USER, bId: 1,
      aGives: { players: [mine[5].id], picks: [] },
      bGives: { players: [theirs[5].id], picks: [] },
    };
    expect(validateTrade(save, swap)).toBeNull();

    expect(validateTrade(save, { aId: USER, bId: 1, aGives: empty(), bGives: empty() })).not.toBeNull();
    expect(validateTrade(save, { ...swap, aGives: { players: [theirs[0].id], picks: [] } })).not.toBeNull();
    expect(validateTrade(save, { ...swap, aGives: { players: [], picks: [{ year: 1, round: 1, origTeamId: 9 }] } })).not.toBeNull();
    expect(validateTrade(save, { ...swap, bId: USER })).not.toBeNull();

    // Roster limits: three for nothing pushes one side under 8 and the other over 12.
    expect(validateTrade(save, {
      aId: USER, bId: 1,
      aGives: { players: mine.slice(5, 8).map(p => p.id), picks: [] }, bGives: empty(),
    })).not.toBeNull();

    // Money: a huge salary coming back to a team it would put over the cap.
    const big = theirs[5];
    const keep = big.contract.salary;
    big.contract.salary = keep + capSpace(save, user) + mine[5].contract.salary + 1;
    expect(validateTrade(save, swap)).toMatch(/over the cap/i);
    big.contract.salary = keep;

    // A player whose deal has run out cannot be traded.
    const years = mine[5].contract.years;
    mine[5].contract.years = 0;
    expect(validateTrade(save, swap)).toMatch(/expired/);
    mine[5].contract.years = years;

    save.week = cal(save).deadlineWeek;
    expect(validateTrade(save, swap)).toBeNull();
    save.week = cal(save).deadlineWeek + 1;
    expect(validateTrade(save, swap)).toMatch(/deadline/i);
    // an 82-game season has a later deadline
    save.calendar = CALENDARS.full;
    expect(validateTrade(save, swap)).toBeNull();
    save.week = CALENDARS.full.deadlineWeek + 1;
    expect(validateTrade(save, swap)).toMatch(/deadline/i);
    delete save.calendar;
    save.phase = 'playoffs';
    expect(validateTrade(save, swap)).not.toBeNull();
    save.phase = 'offseason';
    expect(validateTrade(save, swap)).toBeNull();
  });

  /** User and team 1 with one tradeable player each (plus a second for the user), everyone else on the minimum. */
  function matchFixture() {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[1];
    cheapen(save, user, other);
    const out = addToTeam(save, mkPlayer(save, 'SF', 70, 27), user, { salary: 10, years: 2 });
    const out2 = addToTeam(save, mkPlayer(save, 'PF', 66, 27), user, { salary: 5, years: 2 });
    const back = addToTeam(save, mkPlayer(save, 'SF', 70, 27), other, { salary: 10, years: 2 });
    const deal = (): TradeOffer => ({ aId: USER, bId: 1, aGives: { players: [out.id], picks: [] }, bGives: { players: [back.id], picks: [] } });
    /** The user at `userPay` before the deal sends `outSal` for `backSal`; the other team has room for anything. */
    const at = (userPay: number, outSal: number, backSal: number): string | null => {
      out.contract.salary = outSal; back.contract.salary = backSal;
      setPayroll(save, user, userPay); setPayroll(save, other, 90);
      return validateTrade(save, deal());
    };
    return { save, user, other, out, out2, back, deal, at };
  }

  it('lets a team under the cap take back anything that fits', () => {
    const { save, user, at } = matchFixture();
    expect(at(120, 10, 40)).toBeNull(); // lands exactly on the cap
    expect(matchLimit(save, user, 10)).toBe(40);
    expect(at(120, 10, 40.1)).toMatch(/Over the cap City0 can take back at most 125%/);
    expect(at(60, 10, 45)).toBeNull();
  });

  it('holds a team over the cap to 125% of outgoing salary plus 0.25', () => {
    const { save, user, deal, at } = matchFixture();
    expect(at(170, 10, 12.7)).toBeNull();
    expect(matchLimit(save, user, 10)).toBe(12.8); // 12.75, to one decimal
    expect(at(170, 10, 12.9)).toMatch(/125%/);
    expect(at(170, 10, 3)).toBeNull(); // taking back less is always fine
    // the same rule for a taxpayer still under the first apron
    expect(at(184, 20, 25.2)).toBeNull();
    expect(at(184, 20, 25.4)).toMatch(/125%/);
    const m = tradeMatch(save, deal(), USER);
    expect(m.out).toBe(20); expect(m.inn).toBe(25.4);
    expect(m.payAfter).toBeCloseTo(189.4, 1);
    expect(m.status).toBe('taxpayer');
    expect(m.problem).not.toBeNull();
    expect(tradeMatch(save, deal(), 1).problem).toBeNull();
    expect(tradeMatch(save, deal(), 1).status).toBe('under cap');
  });

  it('stops a team over the first apron taking back more than it sends', () => {
    const { save, user, at } = matchFixture();
    // 125% would allow 25.25, but that would cross the apron: the limit is what keeps it at the line
    expect(at(186, 20, 24)).toBeNull();
    expect(matchLimit(save, user, 20)).toBe(24);
    expect(at(186, 20, 24.1)).toBe('Over the first apron City0 cannot take back more salary than it sends.');
    expect(at(195, 20, 20)).toBeNull();
    expect(matchLimit(save, user, 20)).toBe(20);
    expect(at(195, 20, 20.1)).toMatch(/first apron/);
    expect(at(195, 20, 5)).toBeNull();
  });

  it('adds the second-apron limits: no extra salary, no combining players, no first-round picks out', () => {
    const { save, user, other, out, out2, back, deal, at } = matchFixture();
    expect(at(215, 10, 10)).toBeNull();
    expect(at(215, 10, 10.1)).toBe('Over the second apron City0 cannot take back more salary than it sends.');

    // two players out while still over the second apron afterwards
    expect(at(215, 10, 15)).toMatch(/second apron/);
    const two: TradeOffer = { ...deal(), aGives: { players: [out.id, out2.id], picks: [] } };
    expect(validateTrade(save, two)).toBe('Over the second apron City0 cannot combine players in a trade.');
    // the same two-for-one is fine when it ends at or under the second apron
    back.contract.salary = 9; setPayroll(save, user, 206);
    expect(validateTrade(save, two)).toBeNull();
    expect(tradeMatch(save, two, USER).status).toBe('first apron');

    // picks
    expect(at(215, 10, 10)).toBeNull();
    const r1 = user.picks.find(p => p.round === 1)!, r2 = user.picks.find(p => p.round === 2)!;
    expect(validateTrade(save, { ...deal(), aGives: { players: [out.id], picks: [r1] } })).toBe('Over the second apron City0 cannot trade first-round picks.');
    expect(validateTrade(save, { aId: USER, bId: 1, aGives: { players: [], picks: [r1] }, bGives: empty() })).toMatch(/first-round/);
    expect(validateTrade(save, { ...deal(), aGives: { players: [out.id], picks: [r2] } })).toBeNull();
    const theirR1 = other.picks.find(p => p.round === 1)!;
    expect(validateTrade(save, { ...deal(), bGives: { players: [back.id], picks: [theirR1] } })).toBeNull(); // receiving one is fine
    // under the second apron the pick can go
    expect(at(199, 10, 10)).toBeNull();
    expect(validateTrade(save, { ...deal(), aGives: { players: [out.id], picks: [r1] } })).toBeNull();

    // the rules bind the other team just the same
    out.contract.salary = 10; back.contract.salary = 10;
    setPayroll(save, user, 90); setPayroll(save, other, 215);
    expect(validateTrade(save, { ...deal(), bGives: { players: [back.id], picks: [theirR1] } })).toBe('Over the second apron City1 cannot trade first-round picks.');
    out.contract.salary = 12;
    expect(validateTrade(save, deal())).toBe('Over the second apron City1 cannot take back more salary than it sends.');
  });
});

describe('evaluateTrade', () => {
  it('turns down two scrubs for a star', () => {
    const save = mkSave();
    const mine = byOvr(save, save.teams[USER]);
    for (const t of [1, 2, 3, 4]) {
      const star = byOvr(save, save.teams[t])[0];
      // Make the money work so only value decides: he comes in on the same money that goes out.
      const scrubs = [mine[8], mine[9]];
      const keep = star.contract.salary;
      star.contract.salary = round1(scrubs[0].contract.salary + scrubs[1].contract.salary);
      const offer: TradeOffer = {
        aId: USER, bId: t,
        aGives: { players: scrubs.map(p => p.id), picks: [] },
        bGives: { players: [star.id], picks: [] },
      };
      expect(validateTrade(save, offer)).toBeNull();
      const ev = evaluateTrade(save, offer, t);
      expect(ev.accept).toBe(false);
      expect(ev.score).toBeLessThan(0);
      expect(ev.message.length).toBeGreaterThan(3);
      star.contract.salary = keep;
    }
  });

  it('accepts a like-for-like swap that gives it about 10% more', () => {
    const save = mkSave();
    const user = save.teams[USER];
    let yes = 0, total = 0;
    for (let t = 1; t < NUM_TEAMS; t++) {
      const target = byOvr(save, save.teams[t])[2];
      // Same position, age and deal, a touch better: the AI gets a clear but modest win.
      const mineP = mkPlayer(save, target.pos, ovr(target) + 2, target.age);
      addToTeam(save, mineP, user, { ...target.contract });
      const offer: TradeOffer = {
        aId: USER, bId: t,
        aGives: { players: [mineP.id], picks: [] },
        bGives: { players: [target.id], picks: [] },
      };
      const ratio = playerValue(save, mineP) / playerValue(save, target);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(1.35);
      if (validateTrade(save, offer) === null) {
        total++;
        if (evaluateTrade(save, offer, t).accept) yes++;
      }
      releasePlayer(save, mineP.id, { deadCap: false });
    }
    expect(total).toBeGreaterThan(8);
    expect(yes / total).toBeGreaterThanOrEqual(0.8);
  });

  it('wants a sweetener to take a bad contract, and names one', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[2];
    // Clear room so the cap is not the reason.
    for (const id of other.roster) save.players[id].contract.salary = round1(save.players[id].contract.salary * 0.5);
    const dump = mkPlayer(save, 'SF', 60, 30);
    addToTeam(save, dump, user, { salary: 26, years: 3 });
    for (const id of user.roster) if (id !== dump.id) save.players[id].contract.salary = round1(save.players[id].contract.salary * 0.8);
    expect(playerValue(save, dump)).toBeLessThan(0);
    const offer: TradeOffer = { aId: USER, bId: 2, aGives: { players: [dump.id], picks: [] }, bGives: empty() };
    expect(validateTrade(save, offer)).toBeNull();
    const ev = evaluateTrade(save, offer, 2);
    expect(ev.accept).toBe(false);
    expect(ev.message).toMatch(/contract/i);

    const extra = suggestSweetener(save, offer, 2);
    expect(extra).not.toBeNull();
    const sweet: TradeOffer = {
      ...offer,
      aGives: {
        players: extra!.playerId !== undefined ? [dump.id, extra!.playerId] : [dump.id],
        picks: extra!.pick ? [extra!.pick] : [],
      },
    };
    expect(evaluateTrade(save, sweet, 2).accept).toBe(true);
    expect(suggestSweetener(save, sweet, 2)).toBeNull();

    // A rebuilder with the cap space to absorb him asks a smaller premium than a middle team does.
    other.strategy = 'middle';
    const asMiddle = evaluateTrade(save, offer, 2).score;
    other.strategy = 'rebuild';
    expect(payroll(save, other) + dump.contract.salary).toBeLessThanOrEqual(SALARY_CAP);
    const asRebuild = evaluateTrade(save, offer, 2).score;
    expect(asRebuild).toBeGreaterThan(asMiddle);
    expect(asRebuild).toBeLessThan(0);
  });

  it('weighs its tax position: contenders pay up to the second apron, the rest stay out of the tax', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[5];
    cheapen(save, user);
    // The user sends a good player on a big deal for a lesser one on a small deal: fine on talent, heavy on payroll.
    const good = mkPlayer(save, 'SF', 80, 26);
    addToTeam(save, good, user, { salary: 24, years: 2 });
    const lesser = byOvr(save, other).find(p => ovr(p) <= 72 && ovr(p) >= 66)!;
    lesser.contract = { salary: 20, years: 2 };
    const offer: TradeOffer = { aId: USER, bId: other.id, aGives: { players: [good.id], picks: [] }, bGives: { players: [lesser.id], picks: [] } };

    other.strategy = 'middle';
    setPayroll(save, other, 160);
    expect(validateTrade(save, offer)).toBeNull();
    expect(evaluateTrade(save, offer, other.id).accept).toBe(true);

    // The same deal when it would carry a middle team (or a rebuilder) into the tax: no.
    setPayroll(save, other, LUXURY_TAX - 2);
    expect(validateTrade(save, offer)).toBeNull();
    const no = evaluateTrade(save, offer, other.id);
    expect(no.accept).toBe(false);
    expect(no.message).toMatch(/luxury tax/i);
    other.strategy = 'rebuild';
    expect(evaluateTrade(save, offer, other.id).accept).toBe(false);

    // A contender takes it, tax and all...
    other.strategy = 'contend';
    expect(evaluateTrade(save, offer, other.id).accept).toBe(true);
    // ...right up to the first apron. Past it the rules stop anyone adding salary by trade, so the second apron is never crossed.
    setPayroll(save, other, FIRST_APRON - 4);
    expect(validateTrade(save, offer)).toBeNull();
    expect(evaluateTrade(save, offer, other.id).accept).toBe(true);
    setPayroll(save, other, FIRST_APRON - 3);
    expect(validateTrade(save, offer)).toMatch(/first apron/i);
    expect(evaluateTrade(save, offer, other.id).accept).toBe(false);
  });

  it('will not sell a contender\'s best player for picks, or an old star for a young one', () => {
    const save = mkSave();
    const user = save.teams[USER];
    const team = save.teams.filter(t => t.id !== USER).reduce((a, b) => (ovr(byOvr(save, a)[0]) >= ovr(byOvr(save, b)[0]) ? a : b));
    team.strategy = 'contend';
    const star = byOvr(save, team)[0];
    star.age = 26;
    const forPicks: TradeOffer = {
      aId: USER, bId: team.id,
      aGives: { players: [], picks: user.picks.filter(p => p.round === 1) },
      bGives: { players: [star.id], picks: [] },
    };
    // Money aside: give the user room.
    for (const id of user.roster) save.players[id].contract.salary = MIN_SALARY;
    expect(validateTrade(save, forPicks)).toBeNull();
    expect(evaluateTrade(save, forPicks, team.id).accept).toBe(false);

    const oldStar = mkPlayer(save, star.pos, ovr(star), 34);
    addToTeam(save, oldStar, user, { ...star.contract });
    const oldForYoung: TradeOffer = {
      aId: USER, bId: team.id,
      aGives: { players: [oldStar.id], picks: [] },
      bGives: { players: [star.id], picks: [] },
    };
    expect(validateTrade(save, oldForYoung)).toBeNull();
    expect(evaluateTrade(save, oldForYoung, team.id).accept).toBe(false);
  });

  it('says why when it has no use for the position', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[6];
    for (const id of other.roster) save.players[id].contract.salary = MIN_SALARY;
    // Stack them at center, then offer another one for a comparable wing.
    addToTeam(save, mkPlayer(save, 'C', 90, 26), other, { salary: 5, years: 2 });
    addToTeam(save, mkPlayer(save, 'C', 88, 26), other, { salary: 5, years: 2 });
    const target = byOvr(save, other).find(p => p.pos !== 'C' && ovr(p) < 80)!;
    const center = mkPlayer(save, 'C', ovr(target) + 1, target.age);
    addToTeam(save, center, user, { ...target.contract });
    const offer: TradeOffer = {
      aId: USER, bId: 6,
      aGives: { players: [center.id], picks: [] },
      bGives: { players: [target.id], picks: [] },
    };
    for (const id of user.roster) save.players[id].contract.salary = MIN_SALARY;
    expect(validateTrade(save, offer)).toBeNull();
    const ev = evaluateTrade(save, offer, 6);
    expect(ev.accept).toBe(false);
    expect(ev.message).toMatch(/center/);
  });
});

describe('executeTrade', () => {
  it('moves players and picks and leaves valid lineups', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[1];
    const mine = byOvr(save, user)[0], theirs = byOvr(save, other)[0];
    const myPick = user.picks[0], theirPick = other.picks[3];
    save.captainId = mine.id;
    save.tradeDemands.push(mine.id);
    const offer: TradeOffer = {
      aId: USER, bId: 1,
      aGives: { players: [mine.id], picks: [myPick] },
      bGives: { players: [theirs.id], picks: [theirPick] },
    };
    const news = save.news.length;
    executeTrade(save, offer);
    expect(mine.teamId).toBe(1);
    expect(theirs.teamId).toBe(USER);
    expect(other.roster).toContain(mine.id);
    expect(user.roster).toContain(theirs.id);
    expect(user.roster).not.toContain(mine.id);
    expect(other.picks).toContainEqual(myPick);
    expect(user.picks).toContainEqual(theirPick);
    expect(user.picks).not.toContainEqual(myPick);
    expect(user.picks.length).toBe(4);
    expect(other.picks.length).toBe(4);
    expect(save.captainId).toBeNull();
    expect(save.tradeDemands).not.toContain(mine.id);
    expect(save.news.length).toBe(news + 1);
    expect(save.news[news].kind).toBe('trade');
    expect(save.news[news].mine).toBe(true);
    assertLegal(save);
  });
});

describe('AI trading', () => {
  it('trades for seven weeks without breaking a team or touching the user', () => {
    let trades = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const save = mkSave(seed);
      updateStrategies(save);
      const rng = new Rng(seed * 101);
      const before = userSnapshot(save);
      for (let week = 1; week <= cal(save).deadlineWeek; week++) {
        save.week = week;
        aiTradesWeek(save, rng);
        assertLegal(save);
      }
      expect(userSnapshot(save)).toBe(before);
      const made = save.news.filter(n => n.kind === 'trade');
      for (const n of made) expect(n.mine).toBeUndefined();
      trades += made.length;

      // Nothing after the deadline.
      const count = save.news.length;
      for (let week = cal(save).deadlineWeek + 1; week <= cal(save).regWeeks; week++) {
        save.week = week;
        aiTradesWeek(save, rng);
      }
      expect(save.news.length).toBe(count);
    }
    // A few per season league-wide.
    expect(trades).toBeGreaterThanOrEqual(8);
    expect(trades).toBeLessThanOrEqual(8 * 8);
  });

  it('makes the user offers that are legal and that it would accept', () => {
    const save = mkSave(3);
    const rng = new Rng(77);
    const before = userSnapshot(save);
    let offers = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      save.week = 1 + (i % cal(save).deadlineWeek);
      const offer = aiOfferToUser(save, rng);
      if (!offer) continue;
      offers++;
      expect(offer.bId).toBe(USER);
      expect(offer.aId).not.toBe(USER);
      expect(validateTrade(save, offer)).toBeNull();
      expect(evaluateTrade(save, offer, offer.aId).accept).toBe(true);
    }
    expect(userSnapshot(save)).toBe(before);
    // About once every 3-4 weeks.
    expect(offers / N).toBeGreaterThan(0.12);
    expect(offers / N).toBeLessThan(0.4);

    const unhappy = byOvr(save, save.teams[USER])[1];
    save.tradeDemands.push(unhappy.id);
    let forHim = 0, any = 0;
    for (let i = 0; i < 100; i++) {
      const offer = aiOfferToUser(save, rng);
      if (!offer) continue;
      any++;
      if (offer.bGives.players.includes(unhappy.id)) forHim++;
    }
    expect(any).toBeGreaterThan(0);
    expect(forHim).toBe(any);

    save.week = cal(save).deadlineWeek + 1;
    for (let i = 0; i < 30; i++) expect(aiOfferToUser(save, rng)).toBeNull();
  });
});

// ---------- free agency ----------

function startFreeAgency(save: Save, rng: Rng): Player[] {
  save.phase = 'offseason';
  save.offseason = {
    step: 'freeAgency', draftOrder: [], draftIdx: 0, prospects: [],
    faDay: 1, userOffers: {}, retired: [], campSpent: 0, log: [],
  };
  // Every team lets its two weakest players walk, and a fresh class hits the market.
  for (const team of save.teams) {
    const worst = byOvr(save, team).slice(-2);
    for (const p of worst) releasePlayer(save, p.id, { deadCap: false });
  }
  const fresh: Player[] = [];
  for (let i = 0; i < 24; i++) {
    const p = mkPlayer(save, POSITIONS[i % 5], 56 + ((i * 7) % 27), rng.int(22, 31));
    save.freeAgents.push(p.id);
    fresh.push(p);
  }
  return fresh;
}

describe('free agency', () => {
  it('scores offers by money first, with context on top', () => {
    const save = mkSave();
    const p = mkPlayer(save, 'SG', 76, 27);
    save.freeAgents.push(p.id);
    const ask = askingContract(save, p, 4);
    const at = (teamId: number, mult: number) => offerScore(save, p, { teamId, salary: round1(ask.salary * mult), years: ask.years });
    expect(at(4, 1)).toBeGreaterThan(55);
    expect(at(4, 1)).toBeLessThan(85);
    expect(at(4, 1.4)).toBeGreaterThanOrEqual(95);
    expect(at(4, 0.5)).toBeLessThan(45);
    expect(at(4, 1.2)).toBeGreaterThan(at(4, 1));

    const plain = at(4, 1);
    for (const k of ['arena', 'training', 'medical', 'scouting'] as const) save.teams[4].facilities[k].level = 5;
    save.teams[4].prestige = 95;
    save.teams[4].history.push({ year: 0, w: 12, l: 2, playoff: 'champ' });
    expect(at(4, 1)).toBeGreaterThan(plain);
    p.trait = 'Mercenary';
    const merc = askingContract(save, p, 4);
    expect(offerScore(save, p, { teamId: 4, salary: merc.salary, years: 1 })).toBe(70);

    expect(interestLevel(save, p, { teamId: USER, salary: MIN_SALARY, years: 1 })).toBe('none');
    expect(interestLevel(save, p, { teamId: USER, salary: MAX_SALARY, years: 4 })).toBe('high');
  });

  it('signs most good free agents over the period and resolves the user\'s offers', () => {
    const save = mkSave(5);
    const rng = new Rng(55);
    const fresh = startFreeAgency(save, rng);
    const user = save.teams[USER];
    const good = save.freeAgents.filter(id => ovr(save.players[id]) >= 70);
    expect(good.length).toBeGreaterThan(6);

    // One generous offer, one lowball.
    const mid = fresh.filter(p => ovr(p) >= 62 && ovr(p) <= 68);
    const wanted = mid[0], insulted = fresh.find(p => ovr(p) >= 78)!;
    const ask = askingContract(save, wanted, USER);
    const generous = { teamId: USER, salary: round1(ask.salary * 1.6), years: ask.years };
    expect(generous.salary).toBeLessThanOrEqual(capSpace(save, user));
    expect(offerScore(save, wanted, generous)).toBeGreaterThanOrEqual(100);
    save.offseason!.userOffers[wanted.id] = generous;
    save.offseason!.userOffers[insulted.id] = { teamId: USER, salary: round1(askingContract(save, insulted, USER).salary * 0.35), years: 2 };

    const userBefore = [...user.roster];
    const startPay = save.teams.map(t => payroll(save, t));
    expect(startPay.some(v => v > SALARY_CAP)).toBe(true);
    const logs: string[] = [];
    for (let day = 1; day <= FA_DAYS; day++) {
      save.offseason!.faDay = day;
      const out = runFreeAgencyDay(save, rng);
      logs.push(...out);
      if (day === 1) {
        expect(out).toContain(`${wanted.name} signs with ${user.city} (${generous.years} yr${generous.years === 1 ? '' : 's'}, $${generous.salary}M)`);
        expect(out).toContain(`${insulted.name} turned down your offer.`);
        expect(save.offseason!.userOffers[wanted.id]).toBeUndefined();
        expect(save.offseason!.userOffers[insulted.id]).toBeUndefined();
      }
      for (const team of save.teams) {
        expect(team.roster.length).toBeLessThanOrEqual(ROSTER_MAX);
        // nobody is signed past the second apron, and a mid-level deal is by definition one that goes over the cap
        expect(payroll(save, team)).toBeLessThanOrEqual(Math.max(SECOND_APRON, startPay[team.id]));
        if (team.mleUsed) expect(payroll(save, team)).toBeGreaterThan(SALARY_CAP);
        // an AI team that is not contending does not sign its way into the tax
        if (team.id !== USER && team.strategy !== 'contend') expect(payroll(save, team)).toBeLessThanOrEqual(Math.max(LUXURY_TAX, startPay[team.id]));
      }
    }
    // every deal is for 4 years at most
    for (const id of good) expect(save.players[id].contract.years).toBeLessThanOrEqual(MAX_FA_YEARS);
    // teams over the cap were in the market too, through the mid-level
    expect(save.teams.some(t => t.mleUsed)).toBe(true);
    expect(wanted.teamId).toBe(USER);
    expect(wanted.contract).toEqual({ salary: generous.salary, years: generous.years });
    expect(insulted.teamId).not.toBe(USER);
    // The user only gained the player they bid for.
    expect(user.roster).toEqual([...userBefore, wanted.id]);
    expect(Object.keys(save.offseason!.userOffers).length).toBe(0);

    const signed = good.filter(id => save.players[id].teamId !== null);
    expect(signed.length / good.length).toBeGreaterThanOrEqual(0.7);
    expect(logs.filter(l => l.includes('signs with')).length).toBeGreaterThan(10);
    expect(save.news.some(n => n.kind === 'signing' && n.mine)).toBe(true);

    aiFillRosters(save, rng);
    for (const team of save.teams) {
      if (team.id === USER) continue;
      expect(team.roster.length).toBeGreaterThanOrEqual(ROSTER_NORMAL);
      expect(team.roster.length).toBeLessThanOrEqual(ROSTER_MAX);
      expect(new Set(team.roster.map(id => save.players[id].pos)).size).toBe(5);
    }
    expect(user.roster).toEqual([...userBefore, wanted.id]);
  });

  it('fills AI rosters with one-year minimum deals, whatever the payroll', () => {
    const save = mkSave(4);
    const rng = new Rng(3);
    startFreeAgency(save, rng);
    const team = save.teams[9];
    setPayroll(save, team, SECOND_APRON + 5);
    const before = [...team.roster];
    expect(before.length).toBe(8);
    aiFillRosters(save, rng);
    expect(team.roster.length).toBe(ROSTER_NORMAL);
    for (const id of team.roster) if (!before.includes(id)) expect(save.players[id].contract).toEqual({ salary: MIN_SALARY, years: 1 });
    expect(team.mleUsed).toBeFalsy();
  });

  /** The last day of free agency with the user at a given payroll and one offer on a player who will take it if it is allowed. */
  function lastDay(pay: number, offer: (ask: number) => { salary: number; years: number }, seed = 6) {
    const save = mkSave(seed);
    const rng = new Rng(9);
    const fresh = startFreeAgency(save, rng);
    save.offseason!.faDay = FA_DAYS;
    const user = save.teams[USER];
    setPayroll(save, user, pay);
    // useful role players whose ask is well inside the mid-level, cheapest first
    const role = fresh.filter(x => ovr(x) >= 60 && ovr(x) <= 64).sort((a, b) => ovr(a) - ovr(b));
    const p = role[0];
    const o = offer(askingContract(save, p, USER).salary);
    save.offseason!.userOffers[p.id] = { teamId: USER, ...o };
    return { save, rng, user, p, o, role };
  }

  it('signs a user offer through cap space when it fits under the cap', () => {
    const { save, rng, user, p, o } = lastDay(120, () => ({ salary: 20, years: 3 }));
    expect(signingPath(save, user, 20, { years: 3 })).toEqual({ ok: true, via: 'space' });
    runFreeAgencyDay(save, rng);
    expect(p.teamId).toBe(USER);
    expect(p.contract).toEqual(o);
    expect(user.mleUsed).toBeFalsy();
  });

  it('signs a user offer with the mid-level when over the cap, marks it used, and allows only one', () => {
    const { save, rng, user, p, role } = lastDay(170, () => ({ salary: MLE, years: 2 }));
    const second = role[1];
    save.offseason!.userOffers[second.id] = { teamId: USER, salary: MLE, years: 2 };
    const out = runFreeAgencyDay(save, rng);
    const got = [p, second].filter(x => x.teamId === USER);
    expect(got.length).toBe(1);
    expect(user.mleUsed).toBe(true);
    expect(payroll(save, user)).toBeCloseTo(170 + MLE, 1);
    const missed = [p, second].find(x => x.teamId !== USER)!;
    expect(out).toContain(`Your offer to ${missed.name} was not allowed and has been withdrawn: Over the cap with the mid-level exception already used: only minimum deals.`);
    expect(save.offseason!.userOffers).toEqual({});
    expect(save.news.some(n => n.mine && n.kind === 'signing' && n.text.includes('mid-level exception'))).toBe(true);
  });

  it('rejects a user offer that is not legal when the day resolves, and says why', () => {
    // over the cap, more than the mid-level
    let r = lastDay(170, () => ({ salary: 20, years: 3 }));
    let out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out).toContain(`Your offer to ${r.p.name} was not allowed and has been withdrawn: Over the cap: the most you can offer is the mid-level exception, $${MLE}M.`);
    expect(r.save.offseason!.userOffers[r.p.id]).toBeUndefined();
    expect(payroll(r.save, r.user)).toBeCloseTo(170, 1);
    expect(r.user.mleUsed).toBeFalsy();

    // past the first apron only the taxpayer mid-level is left
    r = lastDay(FIRST_APRON - 4, () => ({ salary: 10, years: 2 }));
    out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out.find(l => l.startsWith('Your offer'))).toMatch(/first apron.*taxpayer mid-level.*\$6M/);
    r = lastDay(FIRST_APRON - 4, () => ({ salary: TAX_MLE, years: 2 }));
    runFreeAgencyDay(r.save, r.rng);
    expect(r.user.mleUsed).toBe(true);

    // over the second apron: minimum deals only
    r = lastDay(SECOND_APRON + 3, () => ({ salary: TAX_MLE, years: 2 }));
    out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out.find(l => l.startsWith('Your offer'))).toMatch(/second apron: only minimum deals/);

    // a full roster
    r = lastDay(120, ask => ({ salary: round1(ask * 1.5), years: 2 }));
    while (r.user.roster.length < ROSTER_MAX) addToTeam(r.save, mkPlayer(r.save, 'C', 50, 25), r.user, { salary: MIN_SALARY, years: 1 });
    out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out.find(l => l.startsWith('Your offer'))).toMatch(/roster is full/);
  });

  it('lets anyone sign a minimum deal, but only for one or two years', () => {
    const save = mkSave(6);
    const user = save.teams[USER];
    setPayroll(save, user, SECOND_APRON + 20);
    user.mleUsed = true;
    expect(signingPath(save, user, MIN_SALARY, { years: 1 })).toEqual({ ok: true, via: 'min' });
    expect(signingPath(save, user, MIN_SALARY, { years: 2 })).toEqual({ ok: true, via: 'min' });
    expect(signingPath(save, user, MIN_SALARY)).toEqual({ ok: true, via: 'min' });
    const long = signingPath(save, user, MIN_SALARY, { years: 3 });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.reason).toMatch(/minimum deal can run 2 years/);
  });

  it('signs in-season pickups by the same paths, and lets a fringe player settle for the minimum', () => {
    const save = mkSave(6);
    const user = save.teams[USER];
    const role = mkPlayer(save, 'SG', 62, 27), starter = mkPlayer(save, 'PF', 74, 27);
    save.freeAgents.push(role.id, starter.id);
    const ask = askingContract(save, role, USER);
    expect(ask.salary).toBeGreaterThan(TAX_MLE);
    expect(ask.salary).toBeLessThan(MLE);

    setPayroll(save, user, 100);
    expect(instantSigning(save, role, USER)).toMatchObject({ ok: true, salary: ask.salary, via: 'space', settled: false });
    setPayroll(save, user, 170);
    expect(instantSigning(save, role, USER)).toMatchObject({ ok: true, salary: ask.salary, via: 'mle', settled: false });
    // too rich for a capped-out team, and too good to come for the minimum
    const no = instantSigning(save, starter, USER);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.reason).toMatch(/mid-level exception/);
    user.mleUsed = true;
    expect(instantSigning(save, role, USER).ok).toBe(false);
    // a fringe player takes a one-year minimum once the market has closed...
    const fringe = mkPlayer(save, 'C', 56, 29);
    save.freeAgents.push(fringe.id);
    expect(askingContract(save, fringe, USER).salary).toBeLessThanOrEqual(TAX_MLE);
    expect(instantSigning(save, fringe, USER)).toEqual({ ok: true, salary: MIN_SALARY, years: 1, via: 'min', settled: true });
    // ...but not while teams are still bidding
    save.phase = 'offseason';
    save.offseason = { step: 'freeAgency', draftOrder: [], draftIdx: 0, prospects: [], faDay: 2, userOffers: {}, retired: [], campSpent: 0, log: [] };
    expect(instantSigning(save, fringe, USER).ok).toBe(false);
    save.offseason.step = 'camp';
    expect(instantSigning(save, fringe, USER).ok).toBe(true);
    // and never onto a full roster
    while (user.roster.length < ROSTER_MAX) addToTeam(save, mkPlayer(save, 'C', 50, 25), user, { salary: MIN_SALARY, years: 1 });
    const full = instantSigning(save, fringe, USER);
    expect(!full.ok && full.reason).toMatch(/roster is full/i);
  });
});

// ---------- draft ----------

describe('draft', () => {
  it('picks a prospect who is on the board, and usually a good one', () => {
    const save = mkSave();
    const rng = new Rng(4);
    save.phase = 'offseason';
    const prospects: number[] = [];
    for (let i = 0; i < 40; i++) {
      const o = 45 + ((i * 11) % 26);
      prospects.push(mkPlayer(save, POSITIONS[i % 5], o, 19 + (i % 4), { potential: o + 5 + ((i * 5) % 20) }).id);
    }
    save.offseason = {
      step: 'draft', draftOrder: [], draftIdx: 0, prospects,
      faDay: 1, userOffers: {}, retired: [], campSpent: 0, log: [],
    };
    const snapshot = JSON.stringify(save);
    const rank = (id: number) => ovr(save.players[id]) + save.players[id].potential;
    const sorted = [...prospects].sort((a, b) => rank(b) - rank(a));
    const picks = new Set<number>();
    for (let t = 1; t < NUM_TEAMS; t++) {
      const id = aiDraftChoice(save, t, rng);
      expect(prospects).toContain(id);
      expect(sorted.indexOf(id)).toBeLessThan(10);
      picks.add(id);
    }
    expect(JSON.stringify(save)).toBe(snapshot);
    save.offseason.prospects = [];
    expect(aiDraftChoice(save, 1, rng)).toBe(-1);
  });

  it('pays rookies on a sliding scale', () => {
    expect(rookieContract(1, 1)).toEqual({ salary: 10, years: 3 });
    expect(rookieContract(1, 16)).toEqual({ salary: 3, years: 3 });
    expect(rookieContract(1, 8).salary).toBeLessThan(10);
    expect(rookieContract(1, 8).salary).toBeGreaterThan(3);
    for (let pick = 2; pick <= 16; pick++) expect(rookieContract(1, pick).salary).toBeLessThan(rookieContract(1, pick - 1).salary);
    expect(rookieContract(2, 5)).toEqual({ salary: MIN_SALARY, years: 2 });
  });
});

// ---------- team AI ----------

describe('team AI', () => {
  it('sets a spread of strategies and leaves the user alone', () => {
    const save = mkSave();
    save.teams[USER].strategy = 'middle';
    updateStrategies(save);
    const kinds = new Set(save.teams.filter(t => t.id !== USER).map(t => t.strategy));
    expect(kinds.has('contend')).toBe(true);
    expect(kinds.has('rebuild')).toBe(true);
    expect(save.teams[USER].strategy).toBe('middle');
  });

  it('re-signs or releases expiring players and ends with legal rosters', () => {
    let overCap = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const save = mkSave(seed);
      const rng = new Rng(seed + 40);
      save.phase = 'offseason';
      updateStrategies(save);
      const expiring: number[] = [];
      for (const team of save.teams) {
        const ps = byOvr(save, team);
        for (const p of [ps[1], ps[4], ps[6], ps[9]]) { p.contract.years = 0; expiring.push(p.id); }
      }
      const before = userSnapshot(save);
      aiResignPhase(save, rng);
      expect(userSnapshot(save)).toBe(before);

      let kept = 0, released = 0;
      for (const id of expiring) {
        const p = save.players[id];
        if (p.teamId === USER) { expect(p.contract.years).toBe(0); continue; }
        if (p.teamId === null) { released++; expect(save.freeAgents).toContain(id); }
        else { kept++; expect(p.contract.years).toBeGreaterThan(0); }
      }
      expect(kept).toBeGreaterThan(released);
      expect(released).toBeGreaterThan(0);
      overCap += save.teams.filter(t => t.id !== USER && payroll(save, t) > SALARY_CAP).length;
      for (const team of save.teams) if (team.id !== USER) expect(team.deadCap).toBe(0);

      aiMaintainRosters(save, rng);
      expect(userSnapshot(save)).toBe(before);
      for (const team of save.teams) {
        if (team.id === USER) continue;
        expect(team.roster.length).toBeGreaterThanOrEqual(ROSTER_NORMAL);
        expect(team.roster.length).toBeLessThanOrEqual(ROSTER_MAX);
        // contenders may sit in the tax up to the second apron; nobody else stays above the tax line
        expect(payroll(save, team)).toBeLessThanOrEqual(team.strategy === 'contend' ? SECOND_APRON : LUXURY_TAX);
        expect(team.lineup.length).toBe(5);
        expect(new Set(team.lineup).size).toBe(5);
        for (const id of team.lineup) expect(team.roster).toContain(id);
      }
    }
    // re-signing their own players is how teams end up over the soft cap
    expect(overCap).toBeGreaterThan(4);
  });

  it('fixes an oversized roster that is over the second apron, and no more than it has to', () => {
    const save = mkSave(2);
    const rng = new Rng(8);
    const team = save.teams[7];
    for (let i = 0; i < 4; i++) addToTeam(save, mkPlayer(save, POSITIONS[i], 60, 29), team, { salary: 15, years: 3 });
    for (let i = 0; i < 6; i++) save.freeAgents.push(mkPlayer(save, POSITIONS[i % 5], 58, 26).id);
    expect(team.roster.length).toBe(14);
    // once the two extra bodies are gone it is still $12M over the second apron
    setPayroll(save, team, SECOND_APRON + 42);
    const before = userSnapshot(save);
    team.strategy = 'contend';
    aiMaintainRosters(save, rng);
    expect(userSnapshot(save)).toBe(before);
    assertLegal(save, { minRoster: ROSTER_NORMAL });
    // a contender only gets back under the second apron: it stays a taxpayer
    expect(payroll(save, team)).toBeGreaterThan(LUXURY_TAX);
    // the same team with no title hopes gets under the tax line
    team.strategy = 'middle';
    aiMaintainRosters(save, rng);
    expect(payroll(save, team)).toBeLessThanOrEqual(LUXURY_TAX);
    assertLegal(save, { minRoster: ROSTER_NORMAL });
  });

  it('leaves a payroll that is over the cap but inside its limit alone', () => {
    const save = mkSave(2);
    const rng = new Rng(8);
    for (const team of save.teams) {
      if (team.id === USER) continue;
      team.strategy = team.id % 2 ? 'contend' : 'middle';
      setPayroll(save, team, team.strategy === 'contend' ? SECOND_APRON - 1 : LUXURY_TAX - 1);
    }
    const rosters = JSON.stringify(save.teams.map(t => t.roster));
    aiMaintainRosters(save, rng);
    expect(JSON.stringify(save.teams.map(t => t.roster))).toBe(rosters);
  });

  it('trades a contract it must shed into another team\'s cap space rather than cutting him, when someone wants him', () => {
    const save = mkSave(2);
    const team = save.teams[7], taker = save.teams[9];
    const useful = addToTeam(save, mkPlayer(save, 'SF', 74, 26), team, { salary: 22, years: 2 });
    const albatross = addToTeam(save, mkPlayer(save, 'C', 58, 33), team, { salary: 30, years: 3 });
    for (const t of save.teams) if (t.id !== team.id) setPayroll(save, t, t.id === taker.id ? 110 : 175);
    expect(aiDumpSalary(save, team.id, albatross.id)).toBe(false);
    expect(albatross.teamId).toBe(team.id);
    expect(aiDumpSalary(save, team.id, useful.id)).toBe(true);
    expect(useful.teamId).toBe(taker.id);
    expect(save.news[0].text).toMatch(/for cap relief/);
    // never to the user
    const other = addToTeam(save, mkPlayer(save, 'SF', 74, 26), team, { salary: 22, years: 2 });
    for (const t of save.teams) if (t.id !== team.id) setPayroll(save, t, t.id === USER ? 100 : 175);
    expect(aiDumpSalary(save, team.id, other.id)).toBe(false);
  });
});
