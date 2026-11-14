import { describe, expect, it } from 'vitest';
import {
  FA_DAYS, HARD_LIMIT, MAX_CONTRACT_YEARS, MAX_FA_YEARS, MAX_SALARY, MIN_SALARY, NUM_TEAMS, ROSTER_MAX, ROSTER_MIN, ROSTER_NORMAL, SALARY_CAP,
  SAVE_VERSION,
} from '../src/core/constants';
import { aiDraftChoice, onRookieDeal, rookieContract } from '../src/core/gm/draft';
import { FRINGE_ASK, aiFillRosters, instantSigning, interestLevel, isOwnFreeAgent, offerScore, runFreeAgencyDay } from '../src/core/gm/freeAgency';
import { aiMaintainRosters, aiResignPhase, exemptSalary, updateStrategies } from '../src/core/gm/teamAi';
import type { TradeOffer } from '../src/core/gm/trade';
import { aiDumpSalary, aiOfferToUser, aiTradesWeek, evaluateTrade, executeTrade, suggestSweetener, tradeMatch, validateTrade } from '../src/core/gm/trade';
import { CORE_OVR, askingContract, keepCeiling, marketSalary, pickValue, playerValue, teamNeeds } from '../src/core/gm/value';
import { autoLineup } from '../src/core/lineup';
import { capSpace, matchLimit, payroll, signingPath } from '../src/core/org/finance';
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
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.76, 0.96)), years: rng.int(1, 4) });
    });
    bench.forEach((o, i) => {
      const age = rng.int(20, 34);
      const ov = o + Math.round(q / 2);
      const p = mkPlayer(save, bPos[i], ov, age, { potential: age <= 23 ? ov + rng.int(2, 12) : ov });
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.76, 0.96)), years: rng.int(1, 3) });
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
    // nothing but minimum deals and rookie contracts can carry a payroll past the hard limit
    expect(payroll(save, team) - exemptSalary(save, team)).toBeLessThanOrEqual(HARD_LIMIT);
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

  it('prices a typical ten-man roster around the cap, a strong one near the hard limit, a weak one well under the cap', () => {
    const save = mkSave();
    const cost = (os: number[]) => os.reduce((s, o) => s + marketSalary(mkPlayer(save, 'SF', o, 27)), 0);
    const typical = cost([82, 77, 74, 71, 69, 65, 63, 62, 60, 59]);
    expect(typical).toBeGreaterThan(SALARY_CAP - 12);
    expect(typical).toBeLessThan(SALARY_CAP + 20);
    const strong = cost([86, 81, 78, 75, 73, 69, 68, 66, 65, 63]);
    expect(strong).toBeGreaterThan(HARD_LIMIT - 10);
    expect(strong).toBeLessThan(HARD_LIMIT + 20);
    const weak = cost([77, 72, 69, 66, 64, 60, 59, 57, 56, 54]);
    expect(weak).toBeLessThan(SALARY_CAP - 30);
  });

  it('asks for up to 5 years only from his own team, and never for more than the max', () => {
    const save = mkSave();
    const team = save.teams[3];
    const star = byOvr(save, team)[0];
    for (const k of Object.keys(star.ratings) as (keyof Player['ratings'])[]) star.ratings[k] = 94;
    star.age = 27; star.morale = 70; star.trait = 'Quiet Pro'; star.tenure = 0;
    star.awards.push('MVP (Y1)', 'All-League (Y2)');
    const own = askingContract(save, star, team.id);
    expect(own.salary).toBe(MAX_SALARY);
    expect(own.years).toBe(MAX_CONTRACT_YEARS);
    const other = askingContract(save, star, 5);
    expect(other.salary).toBe(MAX_SALARY);
    expect(other.years).toBe(MAX_FA_YEARS);
    star.trait = 'Diva';
    expect(askingContract(save, star, team.id).salary).toBe(MAX_SALARY);
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
    expect(validateTrade(save, swap)).toMatch(/would be over the cap/i);
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
    expect(at(120, 10, 40.1)).toBe('City0 would be over the cap, so it cannot take back more salary than it sends.');
    expect(at(60, 10, 45)).toBeNull();
    // a team over the cap can trade its way back under it
    expect(at(160, 30, 20)).toBeNull();
  });

  it('stops a team that ends over the cap taking back more salary than it sends', () => {
    const { save, user, deal, at } = matchFixture();
    expect(at(170, 10, 10)).toBeNull();
    expect(matchLimit(save, user, 10)).toBe(10);
    expect(at(170, 10, 10.1)).toBe('City0 would be over the cap, so it cannot take back more salary than it sends.');
    expect(at(170, 10, 3)).toBeNull(); // taking back less is always fine
    // from under the cap to over it is the same thing: the part above the cap has to be matched
    expect(at(140, 10, 20)).toBeNull();
    expect(at(140, 10, 20.1)).toMatch(/would be over the cap/);
    const m = tradeMatch(save, deal(), USER);
    expect(m).toMatchObject({ out: 10, inn: 20.1, payBefore: 140, limit: 20, status: 'over the cap' });
    expect(m.payAfter).toBeCloseTo(150.1, 1);
    expect(m.problem).not.toBeNull();
    expect(tradeMatch(save, deal(), 1)).toMatchObject({ problem: null, status: 'under the cap' });
    // there are no other matching rules: two players and a first-round pick can go out in one deal
    expect(at(170, 10, 15)).not.toBeNull();
  });

  it('never lets a trade take a payroll past the hard limit; a team already past it can only shed', () => {
    const { save, user, other, out, out2, back, deal, at } = matchFixture();
    expect(at(HARD_LIMIT - 1, 10, 10)).toBeNull();
    expect(at(HARD_LIMIT - 1, 10, 11.5)).toBe(`City0 would end up over the hard limit ($${HARD_LIMIT}M).`);
    // past the limit already (minimum deals and rookies can do that): it may trade, but only downwards
    expect(at(HARD_LIMIT + 5, 20, 5)).toBeNull();
    expect(at(HARD_LIMIT + 5, 20, 20)).toBeNull();
    expect(at(HARD_LIMIT + 5, 20, 20.1)).toMatch(/hard limit/);
    // combining players and trading first-round picks is never a problem in itself
    expect(at(HARD_LIMIT + 5, 10, 15)).toMatch(/hard limit/);
    const r1 = user.picks.find(p => p.round === 1)!;
    expect(validateTrade(save, { ...deal(), aGives: { players: [out.id, out2.id], picks: [r1] } })).toBeNull();
    // the rule binds the other team just the same
    out.contract.salary = 12; back.contract.salary = 10;
    setPayroll(save, user, 90); setPayroll(save, other, 170);
    expect(validateTrade(save, deal())).toBe('City1 would be over the cap, so it cannot take back more salary than it sends.');
    out.contract.salary = 10;
    expect(validateTrade(save, deal())).toBeNull();
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

  it('cannot be talked into a deal that breaks the cap, and a rebuilder charges for its cap space', () => {
    const save = mkSave();
    const user = save.teams[USER], other = save.teams[5];
    cheapen(save, user);
    // The user sends a good player on a big deal for a lesser one on a smaller deal: the AI gains talent and payroll.
    const good = addToTeam(save, mkPlayer(save, 'SF', 80, 26), user, { salary: 24, years: 2 });
    const lesser = byOvr(save, other).find(p => ovr(p) <= 72 && ovr(p) >= 66)!;
    lesser.contract = { salary: 20, years: 2 };
    const offer: TradeOffer = { aId: USER, bId: other.id, aGives: { players: [good.id], picks: [] }, bGives: { players: [lesser.id], picks: [] } };

    other.strategy = 'middle';
    setPayroll(save, other, 130);
    expect(validateTrade(save, offer)).toBeNull();
    const asMiddle = evaluateTrade(save, offer, other.id);
    expect(asMiddle.accept).toBe(true);
    // a rebuilder likes the same deal a little less: it uses up cap space
    other.strategy = 'rebuild';
    good.age = 23;
    const young = evaluateTrade(save, offer, other.id).score;
    setPayroll(save, other, 160); // over the cap already, so no cap space is spent... and the deal is not legal either
    expect(evaluateTrade(save, offer, other.id)).toMatchObject({ accept: false, score: 0 });
    setPayroll(save, other, 130);
    lesser.contract.salary = 24; // money-neutral: no space used
    expect(evaluateTrade(save, offer, other.id).score).toBeGreaterThan(young);

    // Any team that would end over the cap with more salary than it sent says no, whatever the talent.
    other.strategy = 'contend';
    lesser.contract.salary = 20;
    setPayroll(save, other, 148);
    const no = evaluateTrade(save, offer, other.id);
    expect(no.accept).toBe(false);
    expect(no.message).toMatch(/over the cap/);
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
    // two teams are over the cap already: they can only add minimum deals
    setPayroll(save, save.teams[5], 162); setPayroll(save, save.teams[10], 175);
    const prevPay = save.teams.map(t => payroll(save, t)), prevSize = save.teams.map(t => t.roster.length);
    expect(prevPay.some(v => v > SALARY_CAP)).toBe(true);
    expect(prevPay.filter(v => v <= SALARY_CAP - 15).length).toBeGreaterThan(3);
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
        // another team's free agent needs cap space: a team that ends the day over the cap added minimum deals at most
        const now = payroll(save, team), added = team.roster.length - prevSize[team.id];
        if (now > SALARY_CAP + 0.01) expect(now - prevPay[team.id]).toBeLessThanOrEqual(added * MIN_SALARY + 0.01);
        prevPay[team.id] = now; prevSize[team.id] = team.roster.length;
      }
    }
    // every deal is for 4 years at most
    for (const id of good) expect(save.players[id].contract.years).toBeLessThanOrEqual(MAX_FA_YEARS);
    expect(wanted.teamId).toBe(USER);
    expect(wanted.contract).toEqual({ salary: generous.salary, years: generous.years });
    expect(insulted.teamId).not.toBe(USER);
    // The user only gained the player they bid for.
    expect(user.roster).toEqual([...userBefore, wanted.id]);
    expect(Object.keys(save.offseason!.userOffers).length).toBe(0);

    const signed = good.filter(id => save.players[id].teamId !== null);
    // only teams with cap space can bid, so not everyone finds a deal, but the market moves
    expect(signed.length / good.length).toBeGreaterThanOrEqual(0.4);
    expect(logs.filter(l => l.includes('signs with')).length).toBeGreaterThan(6);
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
    setPayroll(save, team, HARD_LIMIT + 5);
    const before = [...team.roster];
    expect(before.length).toBe(8);
    aiFillRosters(save, rng);
    expect(team.roster.length).toBe(ROSTER_NORMAL);
    for (const id of team.roster) if (!before.includes(id)) expect(save.players[id].contract).toEqual({ salary: MIN_SALARY, years: 1 });
  });

  /** The last day of free agency with the user at a given payroll and one offer on a player who will take it if it is allowed. */
  function lastDay(pay: number, offer: (ask: number) => { salary: number; years: number }, seed = 6) {
    const save = mkSave(seed);
    const rng = new Rng(9);
    const fresh = startFreeAgency(save, rng);
    save.offseason!.faDay = FA_DAYS;
    const user = save.teams[USER];
    setPayroll(save, user, pay);
    // useful role players, cheapest first
    const role = fresh.filter(x => ovr(x) >= 60 && ovr(x) <= 64).sort((a, b) => ovr(a) - ovr(b));
    const p = role[0];
    const o = offer(askingContract(save, p, USER).salary);
    save.offseason!.userOffers[p.id] = { teamId: USER, ...o };
    return { save, rng, user, p, o, role };
  }

  it('signs a user offer through cap space when it fits under the cap', () => {
    const { save, rng, user, p, o } = lastDay(120, () => ({ salary: 20, years: 3 }));
    expect(capSpace(save, user)).toBe(30);
    expect(signingPath(save, user, 20, { years: 3 })).toEqual({ ok: true, via: 'space' });
    runFreeAgencyDay(save, rng);
    expect(p.teamId).toBe(USER);
    expect(p.contract).toEqual(o);
    expect(payroll(save, user)).toBeCloseTo(140, 1);
  });

  it('lets a team go over the cap, up to the hard limit, for the player who has just left it', () => {
    const { save, rng, user, p, role } = lastDay(170, () => ({ salary: 12, years: 3 }));
    const stranger = role[1];
    save.offseason!.userOffers[stranger.id] = { teamId: USER, salary: 12, years: 3 };
    // p finished last season with the user; the other man did not
    p.seasons.push({ year: save.year, teamId: USER, age: p.age - 1, ovr: ovr(p), stats: emptyStats() });
    stranger.seasons.push({ year: save.year, teamId: 4, age: stranger.age - 1, ovr: ovr(stranger), stats: emptyStats() });
    expect(isOwnFreeAgent(save, p, USER)).toBe(true);
    expect(isOwnFreeAgent(save, p, 4)).toBe(false);
    expect(isOwnFreeAgent(save, stranger, USER)).toBe(false);
    const out = runFreeAgencyDay(save, rng);
    expect(p.teamId).toBe(USER);
    expect(p.contract).toEqual({ salary: 12, years: 3 });
    expect(payroll(save, user)).toBeCloseTo(182, 1);
    expect(stranger.teamId).not.toBe(USER);
    expect(out).toContain(`Your offer to ${stranger.name} was not allowed and has been withdrawn: You are over the cap: only minimum deals ($${MIN_SALARY}M) for other teams' free agents.`);
    expect(save.offseason!.userOffers).toEqual({});
    // a season later he is nobody's own any more
    save.year++;
    releasePlayer(save, p.id, { deadCap: false });
    expect(isOwnFreeAgent(save, p, USER)).toBe(false);
  });

  it('rejects a user offer that is not legal when the day resolves, and says why', () => {
    // under the cap, but not by enough
    let r = lastDay(140, () => ({ salary: 20, years: 3 }));
    let out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out).toContain(`Your offer to ${r.p.name} was not allowed and has been withdrawn: You have $10M of cap space: that is the most you can offer another team's free agent.`);
    expect(r.save.offseason!.userOffers[r.p.id]).toBeUndefined();
    expect(payroll(r.save, r.user)).toBeCloseTo(140, 1);

    // over the cap: minimum deals only
    r = lastDay(170, () => ({ salary: 8, years: 2 }));
    out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out.find(l => l.startsWith('Your offer'))).toMatch(/over the cap: only minimum deals/);

    // his old team may pass the cap for him, but not the hard limit
    r = lastDay(HARD_LIMIT - 5, () => ({ salary: 10, years: 2 }));
    r.p.seasons.push({ year: r.save.year, teamId: USER, age: r.p.age - 1, ovr: ovr(r.p), stats: emptyStats() });
    out = runFreeAgencyDay(r.save, r.rng);
    expect(r.p.teamId).not.toBe(USER);
    expect(out.find(l => l.startsWith('Your offer'))).toMatch(/past the hard limit of \$190M\. You have \$5M of room under it/);

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
    setPayroll(save, user, HARD_LIMIT + 20);
    expect(signingPath(save, user, MIN_SALARY, { years: 1 })).toEqual({ ok: true, via: 'min' });
    expect(signingPath(save, user, MIN_SALARY, { years: 2 })).toEqual({ ok: true, via: 'min' });
    expect(signingPath(save, user, MIN_SALARY)).toEqual({ ok: true, via: 'min' });
    const long = signingPath(save, user, MIN_SALARY, { years: 3 });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.reason).toMatch(/minimum deal can run 2 years/);
  });

  it('signs in-season pickups under the same rules, and lets a fringe player settle for the minimum', () => {
    const save = mkSave(6);
    const user = save.teams[USER];
    const role = mkPlayer(save, 'SG', 62, 27);
    save.freeAgents.push(role.id);
    const ask = askingContract(save, role, USER);
    expect(ask.salary).toBeGreaterThan(FRINGE_ASK);

    setPayroll(save, user, 100);
    expect(instantSigning(save, role, USER)).toMatchObject({ ok: true, salary: ask.salary, via: 'space', settled: false });
    // over the cap there is no room for him, and he is too good to come for the minimum
    setPayroll(save, user, 170);
    const no = instantSigning(save, role, USER);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.reason).toMatch(/over the cap: only minimum deals/);
    // a fringe player takes a one-year minimum once the market has closed...
    const fringe = mkPlayer(save, 'C', 56, 29);
    save.freeAgents.push(fringe.id);
    expect(askingContract(save, fringe, USER).salary).toBeLessThanOrEqual(FRINGE_ASK);
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
      // a team may pass the cap to keep its own players, never the hard limit
      for (const team of save.teams) if (team.id !== USER) expect(payroll(save, team)).toBeLessThanOrEqual(HARD_LIMIT);

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
        expect(payroll(save, team) - exemptSalary(save, team)).toBeLessThanOrEqual(HARD_LIMIT);
        expect(team.lineup.length).toBe(5);
        expect(new Set(team.lineup).size).toBe(5);
        for (const id of team.lineup) expect(team.roster).toContain(id);
      }
    }
    // re-signing their own players is how teams end up over the cap
    expect(overCap).toBeGreaterThan(4);
  });

  it('fixes an oversized roster that is past the hard limit, and no more than it has to', () => {
    const save = mkSave(2);
    const rng = new Rng(8);
    const team = save.teams[7];
    for (let i = 0; i < 4; i++) addToTeam(save, mkPlayer(save, POSITIONS[i], 60, 29), team, { salary: 15, years: 3 });
    for (let i = 0; i < 6; i++) save.freeAgents.push(mkPlayer(save, POSITIONS[i % 5], 58, 26).id);
    expect(team.roster.length).toBe(14);
    // once the two extra bodies are gone it is still $12M past the hard limit
    setPayroll(save, team, HARD_LIMIT + 42);
    const before = userSnapshot(save);
    aiMaintainRosters(save, rng);
    expect(userSnapshot(save)).toBe(before);
    assertLegal(save, { minRoster: ROSTER_NORMAL });
    // it stops as soon as it is legal: still well over the cap
    expect(payroll(save, team)).toBeGreaterThan(HARD_LIMIT - 16);
  });

  it('leaves alone a payroll that is over the cap but inside the hard limit, or past it only through minimum deals and rookies', () => {
    const save = mkSave(2);
    const rng = new Rng(8);
    for (const team of save.teams) if (team.id !== USER) setPayroll(save, team, HARD_LIMIT - 1);
    // one team is past the limit, but only because of a rookie contract and a minimum deal
    const team = save.teams[6];
    const rookie = addToTeam(save, mkPlayer(save, 'SF', 66, 20), team, rookieContract(1, 3));
    rookie.draft = { year: save.year, round: 1, pick: 3, teamId: team.id };
    addToTeam(save, mkPlayer(save, 'C', 55, 30), team, { salary: MIN_SALARY, years: 1 });
    expect(onRookieDeal(save, rookie)).toBe(true);
    expect(payroll(save, team)).toBeGreaterThan(HARD_LIMIT + 8);
    expect(exemptSalary(save, team)).toBeGreaterThanOrEqual(rookieContract(1, 3).salary + MIN_SALARY);
    const rosters = JSON.stringify(save.teams.map(t => t.roster));
    aiMaintainRosters(save, rng);
    expect(JSON.stringify(save.teams.map(t => t.roster))).toBe(rosters);
    // once he signs a new deal it is an ordinary contract again
    rookie.contract = { salary: 12, years: 3 };
    expect(onRookieDeal(save, rookie)).toBe(false);
  });

  it('clears room under the hard limit to keep a core player, and lets lesser players go when the money runs out', () => {
    let kept = 0, runs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const save = mkSave(2);
      const rng = new Rng(seed);
      save.phase = 'offseason';
      const team = save.teams[7];
      team.strategy = 'rebuild';
      const star = addToTeam(save, mkPlayer(save, 'SF', 90, 27), team, { salary: 30, years: 0 });
      const role = addToTeam(save, mkPlayer(save, 'PG', 70, 27), team, { salary: 10, years: 0 });
      expect(ovr(star)).toBeGreaterThanOrEqual(CORE_OVR);
      // two bad contracts have the payroll near the limit: his $45M cannot fit unless they go
      addToTeam(save, mkPlayer(save, 'C', 62, 31), team, { salary: 40, years: 3 });
      addToTeam(save, mkPlayer(save, 'PF', 63, 30), team, { salary: 38, years: 2 });
      expect(payroll(save, team)).toBeGreaterThan(HARD_LIMIT - 45);
      expect(payroll(save, team)).toBeLessThanOrEqual(HARD_LIMIT);
      const before = team.roster.length;
      aiResignPhase(save, rng);
      runs++;
      expect(payroll(save, team)).toBeLessThanOrEqual(HARD_LIMIT);
      // the role player is over a rebuilder's ceiling: he is never kept
      expect(keepCeiling(team)).toBeLessThan(HARD_LIMIT - 20);
      expect(role.teamId).toBeNull();
      if (star.teamId === team.id) {
        kept++;
        expect(star.contract).toEqual({ salary: MAX_SALARY, years: MAX_CONTRACT_YEARS });
        expect(team.roster.length).toBeLessThan(before - 1); // someone made way for him
      } else {
        expect(save.freeAgents).toContain(star.id); // now and then a star tests the market
      }
    }
    expect(kept).toBeGreaterThanOrEqual(runs - 3);
  });

  it('trades a contract it must shed into another team\'s cap space rather than cutting him, when someone wants him', () => {
    const save = mkSave(2);
    const team = save.teams[7], taker = save.teams[9];
    const useful = addToTeam(save, mkPlayer(save, 'SF', 74, 26), team, { salary: 22, years: 2 });
    const albatross = addToTeam(save, mkPlayer(save, 'C', 58, 33), team, { salary: 30, years: 3 });
    for (const t of save.teams) if (t.id !== team.id) setPayroll(save, t, t.id === taker.id ? 100 : 175);
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
