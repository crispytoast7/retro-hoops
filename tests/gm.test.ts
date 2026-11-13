import { describe, expect, it } from 'vitest';
import { FA_DAYS, NUM_TEAMS, ROSTER_MAX, ROSTER_MIN, ROSTER_NORMAL, SALARY_CAP, SAVE_VERSION, TRADE_DEADLINE_WEEK } from '../src/core/constants';
import { aiDraftChoice, rookieContract } from '../src/core/gm/draft';
import { aiFillRosters, interestLevel, offerScore, runFreeAgencyDay } from '../src/core/gm/freeAgency';
import { aiMaintainRosters, aiResignPhase, updateStrategies } from '../src/core/gm/teamAi';
import type { TradeOffer } from '../src/core/gm/trade';
import { aiOfferToUser, aiTradesWeek, evaluateTrade, executeTrade, suggestSweetener, validateTrade } from '../src/core/gm/trade';
import { askingContract, marketSalary, pickValue, playerValue, teamNeeds } from '../src/core/gm/value';
import { autoLineup } from '../src/core/lineup';
import { capSpace, payroll } from '../src/core/org/finance';
import { releasePlayer } from '../src/core/org/roster';
import { emptyStats, ovr, round1 } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
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
    contract: { salary: 0.5, years: 1 },
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
    tradeDemands: [], scoutPoints: 0, milestones: [],
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
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.85, 1.05)), years: rng.int(1, 4) });
    });
    bench.forEach((o, i) => {
      const age = rng.int(20, 34);
      const ov = o + Math.round(q / 2);
      const p = mkPlayer(save, bPos[i], ov, age, { potential: age <= 23 ? ov + rng.int(2, 12) : ov });
      addToTeam(save, p, team, { salary: round1(marketSalary(p) * rng.range(0.85, 1.05)), years: rng.int(1, 3) });
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
    expect(payroll(save, team)).toBeLessThanOrEqual(SALARY_CAP);
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
    expect(at(50).s).toBeCloseTo(0.5, 1);
    expect(at(65).s).toBeCloseTo(4, 1);
    expect(at(75).s).toBeCloseTo(10, 1);
    expect(at(82).s).toBeCloseTo(18, 1);
    expect(at(91).s).toBeGreaterThanOrEqual(26);
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
    cheap.contract = { salary: 3, years: 3 };
    pricey.contract = { salary: 22, years: 4 };
    expect(playerValue(save, cheap)).toBeGreaterThan(playerValue(save, fair));
    expect(playerValue(save, pricey)).toBeLessThan(playerValue(save, fair));
    const albatross = mk(60, 31);
    albatross.contract = { salary: 14, years: 4 };
    expect(playerValue(save, albatross)).toBeLessThan(0);

    const hurt = mk(75, 27);
    hurt.injury = { weeks: 6, desc: 'knee' };
    expect(playerValue(save, hurt)).toBeLessThan(playerValue(save, fair));
  });

  it('builds league payrolls that fit the cap', () => {
    const save = mkSave();
    for (const team of save.teams) {
      const total = team.roster.reduce((s, id) => s + marketSalary(save.players[id]), 0);
      expect(total).toBeLessThanOrEqual(SALARY_CAP);
      expect(payroll(save, team)).toBeLessThanOrEqual(SALARY_CAP);
    }
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

    // Cap: a huge salary coming back.
    const big = theirs[5];
    const keep = big.contract.salary;
    big.contract.salary = keep + capSpace(save, user) + mine[5].contract.salary + 1;
    expect(validateTrade(save, swap)).toMatch(/cap/i);
    big.contract.salary = keep;

    save.week = TRADE_DEADLINE_WEEK;
    expect(validateTrade(save, swap)).toBeNull();
    save.week = TRADE_DEADLINE_WEEK + 1;
    expect(validateTrade(save, swap)).toMatch(/deadline/i);
    save.phase = 'playoffs';
    expect(validateTrade(save, swap)).not.toBeNull();
    save.phase = 'offseason';
    expect(validateTrade(save, swap)).toBeNull();
  });
});

describe('evaluateTrade', () => {
  it('turns down two scrubs for a star', () => {
    const save = mkSave();
    const mine = byOvr(save, save.teams[USER]);
    for (const t of [1, 2, 3, 4]) {
      const star = byOvr(save, save.teams[t])[0];
      // Make the money work so only value decides.
      const scrubs = [mine[8], mine[9]];
      const keep = star.contract.salary;
      star.contract.salary = 1;
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
    addToTeam(save, dump, user, { salary: 12, years: 3 });
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
    for (const id of user.roster) save.players[id].contract.salary = 0.5;
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
    for (const id of other.roster) save.players[id].contract.salary = 0.5;
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
    for (const id of user.roster) save.players[id].contract.salary = 0.5;
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
      for (let week = 1; week <= TRADE_DEADLINE_WEEK; week++) {
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
      for (let week = TRADE_DEADLINE_WEEK + 1; week <= 14; week++) {
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
      save.week = 1 + (i % TRADE_DEADLINE_WEEK);
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

    save.week = TRADE_DEADLINE_WEEK + 1;
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

    expect(interestLevel(save, p, { teamId: USER, salary: 0.5, years: 1 })).toBe('none');
    expect(interestLevel(save, p, { teamId: USER, salary: 30, years: 4 })).toBe('high');
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
        expect(payroll(save, team)).toBeLessThanOrEqual(SALARY_CAP);
      }
    }
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
      expect(payroll(save, team)).toBeLessThanOrEqual(SALARY_CAP);
      expect(new Set(team.roster.map(id => save.players[id].pos)).size).toBe(5);
    }
    expect(user.roster).toEqual([...userBefore, wanted.id]);
  });

  it('never lets a user offer break the cap', () => {
    const save = mkSave(6);
    const rng = new Rng(9);
    const fresh = startFreeAgency(save, rng);
    const user = save.teams[USER];
    const star = fresh.reduce((a, b) => (ovr(a) >= ovr(b) ? a : b));
    save.offseason!.userOffers[star.id] = { teamId: USER, salary: 30, years: 4 };
    user.deadCap = round1(capSpace(save, user) - 5); // leaves $5M of room
    const out = runFreeAgencyDay(save, rng);
    expect(star.teamId).not.toBe(USER);
    expect(payroll(save, user)).toBeLessThanOrEqual(SALARY_CAP);
    expect(save.offseason!.userOffers[star.id]).toBeUndefined();
    expect(out.some(l => l.includes(star.name))).toBe(true);
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
    expect(rookieContract(1, 1)).toEqual({ salary: 4, years: 3 });
    expect(rookieContract(1, 16)).toEqual({ salary: 1.2, years: 3 });
    expect(rookieContract(1, 8).salary).toBeLessThan(4);
    expect(rookieContract(1, 8).salary).toBeGreaterThan(1.2);
    expect(rookieContract(2, 5)).toEqual({ salary: 0.6, years: 2 });
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
      for (const team of save.teams) if (team.id !== USER) expect(team.deadCap).toBe(0);

      aiMaintainRosters(save, rng);
      expect(userSnapshot(save)).toBe(before);
      for (const team of save.teams) {
        if (team.id === USER) continue;
        expect(team.roster.length).toBeGreaterThanOrEqual(ROSTER_NORMAL);
        expect(team.roster.length).toBeLessThanOrEqual(ROSTER_MAX);
        expect(payroll(save, team)).toBeLessThanOrEqual(SALARY_CAP);
        expect(team.lineup.length).toBe(5);
        expect(new Set(team.lineup).size).toBe(5);
        for (const id of team.lineup) expect(team.roster).toContain(id);
      }
    }
  });

  it('fixes an oversized, over-the-cap roster', () => {
    const save = mkSave(2);
    const rng = new Rng(8);
    const team = save.teams[7];
    for (let i = 0; i < 4; i++) addToTeam(save, mkPlayer(save, POSITIONS[i], 60, 29), team, { salary: 15, years: 3 });
    for (let i = 0; i < 6; i++) save.freeAgents.push(mkPlayer(save, POSITIONS[i % 5], 58, 26).id);
    expect(team.roster.length).toBe(14);
    expect(payroll(save, team)).toBeGreaterThan(SALARY_CAP);
    const before = userSnapshot(save);
    aiMaintainRosters(save, rng);
    expect(userSnapshot(save)).toBe(before);
    assertLegal(save, { minRoster: ROSTER_NORMAL });
  });
});
