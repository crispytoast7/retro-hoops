import { describe, expect, test } from 'vitest';
import { OT_SECONDS, QUARTERS, QUARTER_SECONDS } from '../src/core/constants';
import { POS_WEIGHTS, emptyStats, gameScore, ovr } from '../src/core/ratings';
import { Rng } from '../src/core/rng';
import type { GameSetup, PlayEvent, SideInput } from '../src/core/sim/api';
import { createLiveGame, simulateGame, teamRatings } from '../src/core/sim/engine';
import { POSITIONS, RATING_KEYS, type BoxLine, type GameResult, type Player, type Pos, type Ratings, type Team } from '../src/core/types';

// ---- fixtures ----

/** Typical shape of each position, as offsets from a flat player. */
const PROFILE: Record<Pos, Ratings> = {
  PG: { sht: 3, hnd: 10, pas: 10, spd: 6, fin: -4, def: -4, reb: -18 },
  SG: { sht: 9, hnd: 3, pas: -3, spd: 4, fin: 1, def: -2, reb: -14 },
  SF: { sht: 2, hnd: -3, pas: -5, spd: 2, fin: 3, def: 3, reb: -3 },
  PF: { sht: -8, hnd: -14, pas: -10, spd: -6, fin: 6, def: 5, reb: 8 },
  C: { sht: -20, hnd: -22, pas: -12, spd: -12, fin: 8, def: 8, reb: 11 },
};
const FIRST = ['Darius', 'Marcus', 'Tony', 'Ray', 'Leo', 'Andre', 'Kofi', 'Jalen', 'Victor', 'Sam'];
const LAST = ['Okafor', 'Reyes', 'Banks', 'Vance', 'Stone', 'Price', 'Mensah', 'Cole', 'Novak', 'Hill'];

function makePlayer(id: number, pos: Pos, target: number, rng: Rng, teamId: number): Player {
  const w = POS_WEIGHTS[pos];
  const shape = {} as Ratings;
  let weighted = 0;
  for (const k of RATING_KEYS) {
    shape[k] = PROFILE[pos][k] + rng.int(-3, 3);
    weighted += shape[k] * w[k];
  }
  const ratings = {} as Ratings;
  for (const k of RATING_KEYS) ratings[k] = Math.max(15, Math.min(99, Math.round(target - weighted + shape[k])));
  return {
    id, name: `${FIRST[id % 10]} ${LAST[Math.floor(id / 10) % 10]}`, pos, age: 26, ratings,
    potential: target, trait: 'Quiet Pro', morale: 50, contract: { salary: 5, years: 2 }, teamId,
    injury: null, season: emptyStats(), seasons: [], draft: null, awards: [], tenure: 1,
    look: { skin: 0, hair: 0, hairColor: 0, height: 1 }, num: id % 100,
  };
}

interface Squad { team: Team; players: Player[] }

/** Ten players: five starters at `starters` overall, five backups at `bench`. */
function makeSquad(id: number, starters = 66, bench = 56, seed = id): Squad {
  const rng = new Rng(seed * 7919 + 13);
  const players: Player[] = [];
  POSITIONS.forEach((pos, i) => players.push(makePlayer(id * 100 + i, pos, starters, rng, id)));
  POSITIONS.forEach((pos, i) => players.push(makePlayer(id * 100 + 5 + i, pos, bench, rng, id)));
  const facility = { level: 1, condition: 100 };
  const team: Team = {
    id, city: `City${id}`, name: `Team${id}`, abbr: `T${id}`, conf: 0,
    colors: { primary: '#fff', secondary: '#000' },
    roster: players.map(p => p.id), lineup: players.slice(0, 5).map(p => p.id),
    staff: { oc: null, dc: null },
    facilities: { arena: { ...facility }, training: { ...facility }, medical: { ...facility }, scouting: { ...facility }, store: { ...facility }, trophy: { ...facility } },
    picks: [], record: { w: 0, l: 0, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 },
    deadCap: 0, history: [], titles: [], strategy: 'middle', prestige: 50,
  };
  return { team, players };
}

const side = (s: Squad, extra: Partial<SideInput> = {}): SideInput =>
  ({ team: s.team, players: s.players, ocStars: 0, dcStars: 0, arenaLevel: 1, ...extra });

const setupOf = (home: Squad, away: Squad, extra: Partial<GameSetup> = {}): GameSetup => ({
  home: side(home), away: side(away), userTeamId: null, controlled: 0,
  playoff: false, fans: 50, difficulty: 'normal', ...extra,
});

const sum = (lines: BoxLine[], k: keyof BoxLine): number => lines.reduce((s, l) => s + (l[k] as number), 0);

function checkBox(lines: BoxLine[], score: number, quarters: number[], ot: number): void {
  expect(sum(lines, 'pts')).toBe(score);
  expect(quarters.reduce((a, b) => a + b, 0)).toBe(score);
  expect(quarters.length).toBe(QUARTERS + ot);
  for (const l of lines) {
    expect(l.pts).toBe(2 * (l.fgm - l.tpm) + 3 * l.tpm + l.ftm);
    expect(l.fgm).toBeLessThanOrEqual(l.fga);
    expect(l.tpm).toBeLessThanOrEqual(l.tpa);
    expect(l.tpa).toBeLessThanOrEqual(l.fga);
    expect(l.ftm).toBeLessThanOrEqual(l.fta);
    expect(l.gs).toBe(l.starter && l.gp ? 1 : 0);
  }
  expect(lines.filter(l => l.starter).length).toBe(5);
  expect(sum(lines, 'min')).toBe(Math.round((5 * (QUARTERS * QUARTER_SECONDS + ot * OT_SECONDS)) / 60));
}

/** Win share of `a` over n games, alternating home court. */
function winRate(a: Squad, b: Squad, n: number, seed: number): number {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const aHome = i % 2 === 0;
    const r = simulateGame(aHome ? setupOf(a, b) : setupOf(b, a), new Rng(seed + i));
    if ((r.homeScore > r.awayScore) === aHome) wins++;
  }
  return wins / n;
}

// ---- tests ----

describe('simulateGame', () => {
  test('is deterministic for a fixed seed', () => {
    const a = makeSquad(1), b = makeSquad(2);
    const r1 = simulateGame(setupOf(a, b), new Rng(42));
    const r2 = simulateGame(setupOf(a, b), new Rng(42));
    const r3 = simulateGame(setupOf(a, b), new Rng(43));
    expect(r1).toEqual(r2);
    expect(r1).not.toEqual(r3);
  });

  test('box scores add up', () => {
    const a = makeSquad(1), b = makeSquad(2);
    a.players[7].injury = { weeks: 2, desc: 'ankle' };
    for (let i = 0; i < 60; i++) {
      const r = simulateGame(setupOf(a, b), new Rng(1000 + i));
      expect(r.homeScore).not.toBe(r.awayScore);
      checkBox(r.box.home, r.homeScore, r.homeQ, r.ot);
      checkBox(r.box.away, r.awayScore, r.awayQ, r.ot);
      expect(r.box.home.length).toBe(9);
      expect(r.box.home.some(l => l.playerId === a.players[7].id)).toBe(false);
      expect(r.box.away.length).toBe(10);
      // Rebounds cannot outnumber misses; assists cannot outnumber makes.
      expect(sum(r.box.home, 'ast')).toBeLessThanOrEqual(sum(r.box.home, 'fgm'));
      expect(sum(r.box.home, 'stl')).toBeLessThanOrEqual(sum(r.box.away, 'tov'));
      const winners = r.homeScore > r.awayScore ? r.box.home : r.box.away;
      const best = Math.max(...winners.map(gameScore));
      expect(gameScore(winners.find(l => l.playerId === r.topPerformer)!)).toBe(best);
    }
  });

  test('an injured starter in the lineup is replaced', () => {
    const a = makeSquad(1), b = makeSquad(2);
    a.players[0].injury = { weeks: 1, desc: 'knee' };
    const r = simulateGame(setupOf(a, b), new Rng(5));
    expect(r.box.home.some(l => l.playerId === a.players[0].id)).toBe(false);
    expect(r.box.home.filter(l => l.starter).length).toBe(5);
  });

  test('league-average rates look like basketball', () => {
    const teams = [1, 2, 3, 4, 5, 6, 7, 8].map(i => makeSquad(i));
    const games = 400;
    const t = emptyStats();
    let poss = 0, points = 0, starterMin = 0, ots = 0;
    for (let i = 0; i < games; i++) {
      const home = teams[i % 8], away = teams[(i * 3 + 1 + (i % 8)) % 8 === i % 8 ? (i + 1) % 8 : (i * 3 + 1 + (i % 8)) % 8];
      const g = createLiveGame(setupOf(home, away), new Rng(50000 + i));
      for (let step = g.next(); step.kind !== 'final'; step = g.next()) if (step.kind === 'possession') poss++;
      const r: GameResult = g.result();
      expect(r.homeScore).not.toBe(r.awayScore);
      ots += r.ot;
      points += r.homeScore + r.awayScore;
      for (const l of [...r.box.home, ...r.box.away]) {
        for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += l[k];
        if (l.starter) starterMin += l.min;
      }
    }
    const misses = t.fga - t.fgm;
    const m = {
      ppg: points / (2 * games),
      possPerTeam: poss / (2 * games),
      ppp: points / poss,
      tov: t.tov / poss,
      threeShare: t.tpa / t.fga,
      fg: t.fgm / t.fga,
      three: t.tpm / t.tpa,
      two: (t.fgm - t.tpm) / (t.fga - t.tpa),
      ft: t.ftm / t.fta,
      ftaPerFga: t.fta / t.fga,
      oreb: t.orb / (t.orb + t.drb),
      assisted: t.ast / t.fgm,
      blkPerGame: t.blk / (2 * games),
      stlPerGame: t.stl / (2 * games),
      starterShare: starterMin / t.min,
      otRate: ots / games,
    };
    console.log('league averages', JSON.stringify(m, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
    expect(misses).toBeGreaterThan(0);
    expect(m.ppg).toBeGreaterThan(100); expect(m.ppg).toBeLessThan(122);
    expect(m.possPerTeam).toBeGreaterThan(94); expect(m.possPerTeam).toBeLessThan(106);
    expect(m.ppp).toBeGreaterThan(1.04); expect(m.ppp).toBeLessThan(1.12);
    expect(m.tov).toBeGreaterThan(0.115); expect(m.tov).toBeLessThan(0.135);
    expect(m.threeShare).toBeGreaterThan(0.34); expect(m.threeShare).toBeLessThan(0.41);
    expect(m.three).toBeGreaterThan(0.335); expect(m.three).toBeLessThan(0.365);
    expect(m.two).toBeGreaterThan(0.50); expect(m.two).toBeLessThan(0.54);
    expect(m.ft).toBeGreaterThan(0.73); expect(m.ft).toBeLessThan(0.79);
    expect(m.oreb).toBeGreaterThan(0.24); expect(m.oreb).toBeLessThan(0.30); // a few defensive boards are team rebounds, credited to nobody
    expect(m.assisted).toBeGreaterThan(0.54); expect(m.assisted).toBeLessThan(0.61);
    expect(m.starterShare).toBeGreaterThan(0.69); expect(m.starterShare).toBeLessThan(0.76);
  });

  test('ratings decide games', { timeout: 30000 }, () => {
    const base = makeSquad(1);
    const plus5 = makeSquad(2, 71, 61), plus10 = makeSquad(3, 76, 66);
    const starters5 = makeSquad(4, 71, 56), starters10 = makeSquad(5, 76, 56);
    const n = 1000;
    const even = winRate(makeSquad(6), base, n, 9000);
    const w5 = winRate(plus5, base, n, 10000), w10 = winRate(plus10, base, n, 20000);
    const s5 = winRate(starters5, base, n, 30000), s10 = winRate(starters10, base, n, 40000);
    console.log('win rates', JSON.stringify({ even, starters5: s5, starters10: s10, roster5: w5, roster10: w10 }));
    expect(even).toBeGreaterThan(0.45); expect(even).toBeLessThan(0.55);
    // Better starters only.
    expect(s5).toBeGreaterThan(0.66); expect(s5).toBeLessThan(0.82);
    expect(s10).toBeGreaterThan(0.84); expect(s10).toBeLessThan(0.97);
    // A better bench as well is worth a little more.
    expect(w5).toBeGreaterThan(0.72); expect(w5).toBeLessThan(0.9);
    expect(w10).toBeGreaterThan(0.88); expect(w10).toBeLessThan(0.995);
  });

  test('home court helps a little', () => {
    const a = makeSquad(1), b = makeSquad(2);
    let home = 0;
    const n = 1200;
    for (let i = 0; i < n; i++) {
      const [h, w] = i % 2 === 0 ? [a, b] : [b, a];
      const r = simulateGame(setupOf(h, w, { home: side(h, { arenaLevel: 1 }) }), new Rng(70000 + i));
      if (r.homeScore > r.awayScore) home++;
    }
    let big = 0;
    for (let i = 0; i < n; i++) {
      const [h, w] = i % 2 === 0 ? [a, b] : [b, a];
      const r = simulateGame(setupOf(h, w, { home: side(h, { arenaLevel: 5 }), fans: 100 }), new Rng(75000 + i));
      if (r.homeScore > r.awayScore) big++;
    }
    console.log('home win rate (arena 1, fans 50)', home / n, '(arena 5, fans 100)', big / n);
    expect(big).toBeGreaterThan(home);
    expect(home / n).toBeGreaterThan(0.525);
    expect(home / n).toBeLessThan(0.585);
  });

  test('a star leads the box score', () => {
    const a = makeSquad(1), b = makeSquad(2);
    a.players[1] = makePlayer(a.players[1].id, 'SG', 90, new Rng(3), 1);
    expect(ovr(a.players[1])).toBeGreaterThanOrEqual(89);
    let pts = 0, led = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const r = simulateGame(i % 2 ? setupOf(a, b) : setupOf(b, a), new Rng(80000 + i));
      const lines = i % 2 ? r.box.home : r.box.away;
      const star = lines.find(l => l.playerId === a.players[1].id)!;
      pts += star.pts;
      if (star.pts >= Math.max(...lines.map(l => l.pts))) led++;
    }
    console.log('star ppg', pts / n, 'led team in', led / n);
    expect(pts / n).toBeGreaterThan(25); expect(pts / n).toBeLessThan(35);
    expect(led / n).toBeGreaterThan(0.6);
  });

  test('coordinators matter', () => {
    const a = makeSquad(1), b = makeSquad(2);
    let wins = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      const coached = side(a, { dcStars: 5, ocStars: 5 });
      const s = i % 2 ? setupOf(a, b, { home: coached }) : setupOf(b, a, { away: coached });
      const r = simulateGame(s, new Rng(90000 + i));
      if ((r.homeScore > r.awayScore) === (i % 2 === 1)) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.58);
    expect(wins / n).toBeLessThan(0.86);
  });

  test('four healthy players does not crash', () => {
    const a = makeSquad(1), b = makeSquad(2);
    a.players.forEach((p, i) => { if (i >= 4) p.injury = { weeks: 3, desc: 'flu' }; });
    const r = simulateGame(setupOf(a, b), new Rng(7));
    expect(r.box.home.length).toBe(5);
    expect(r.homeScore).not.toBe(r.awayScore);
    checkBox(r.box.home, r.homeScore, r.homeQ, r.ot);
    // Tiny and empty rosters must not throw either.
    const tiny = makeSquad(3);
    tiny.players = tiny.players.slice(0, 3);
    tiny.team.roster = tiny.players.map(p => p.id);
    expect(() => simulateGame(setupOf(tiny, b), new Rng(8))).not.toThrow();
    const empty = makeSquad(4);
    empty.players = [];
    expect(() => simulateGame(setupOf(empty, b), new Rng(9))).not.toThrow();
  });

  test('teamRatings', () => {
    const avg = makeSquad(1), good = makeSquad(2, 80, 60);
    const r1 = teamRatings(avg.players, avg.team.lineup), r2 = teamRatings(good.players, good.team.lineup);
    expect(Math.abs(r1.ovr - 66)).toBeLessThanOrEqual(1);
    expect(r2.off).toBeGreaterThan(r1.off);
    expect(r2.def).toBeGreaterThan(r1.def);
    expect(teamRatings(avg.players, [])).toEqual(r1);
  });
});

describe('createLiveGame', () => {
  test('hands out about the requested number of user possessions', () => {
    const a = makeSquad(1), b = makeSquad(2);
    let total = 0, lastShots = 0;
    const n = 150;
    for (const controlled of [10, 12, 14]) {
      for (let i = 0; i < n; i++) {
        const userHome = i % 2 === 0;
        const g = createLiveGame(setupOf(a, b, { userTeamId: userHome ? 1 : 2, controlled }), new Rng(3000 + i));
        const rng = new Rng(i);
        let count = 0, prevUserTripWasHand = false, steps = 0;
        for (let step = g.next(); step.kind !== 'final'; step = g.next()) {
          expect(++steps).toBeLessThan(2000);
          if (step.kind === 'user') {
            count++;
            const s = step.setup;
            expect(s.offense.length).toBe(5);
            expect(s.defense.length).toBe(5);
            expect(s.clock).toBe(g.clock);
            if (s.quarter < 4) expect(prevUserTripWasHand).toBe(false);
            if (s.lastShot) lastShots++;
            prevUserTripWasHand = true;
            const made = rng.chance(0.45);
            const res = g.resolveUser({
              events: [{ t: 'shot', by: s.offense[rng.int(0, 4)], type: 'mid', made }],
              seconds: rng.int(5, 22),
            });
            expect(res.user).toBe(true);
            expect(res.points).toBe(made ? 2 : 0);
            expect(res.clockEnd).toBeGreaterThanOrEqual(0);
            expect(res.text.length).toBeGreaterThan(3);
          } else if (step.kind === 'possession' && step.result.offense === (userHome ? 1 : 2)) {
            prevUserTripWasHand = false;
          }
        }
        expect(g.done).toBe(true);
        expect(g.userPossessions).toBe(count);
        expect(count).toBeGreaterThanOrEqual(controlled - 2);
        expect(count).toBeLessThanOrEqual(controlled + 3);
        total += count - controlled;
        const r = g.result();
        expect(r.homeScore).not.toBe(r.awayScore);
        checkBox(r.box.home, r.homeScore, r.homeQ, r.ot);
        checkBox(r.box.away, r.awayScore, r.awayQ, r.ot);
      }
    }
    console.log('user possessions vs target', total / (3 * n), 'last shots per game', lastShots / (3 * n));
  });

  test('resolveUser books a made three for the right team and player', () => {
    const a = makeSquad(1), b = makeSquad(2);
    for (const userId of [1, 2]) {
      const g = createLiveGame(setupOf(a, b, { userTeamId: userId, controlled: 12 }), new Rng(11));
      let step = g.next();
      while (step.kind !== 'user') step = g.next();
      const s = step.setup;
      const before = { home: g.homeScore, away: g.awayScore, crowd: g.crowd, clock: g.clock };
      const events: PlayEvent[] = [
        { t: 'shot', by: s.offense[2], type: 'mid', made: false },
        { t: 'oreb', by: s.offense[4] },
        { t: 'shot', by: 999999, type: 'dunk', made: true }, // not on the floor: ignored
        { t: 'shot', by: s.offense[1], type: 'three', made: true, assist: s.offense[0] },
      ];
      const res = g.resolveUser({ events, seconds: 9999 });
      expect(res.points).toBe(3);
      expect(res.offense).toBe(userId);
      expect(res.clockEnd).toBe(0);
      expect(res.events.length).toBe(3);
      expect(g.homeScore).toBe(before.home + (userId === 1 ? 3 : 0));
      expect(g.awayScore).toBe(before.away + (userId === 2 ? 3 : 0));
      if (userId === 1) expect(g.crowd).toBeGreaterThan(before.crowd);
      else expect(g.crowd).toBeLessThan(before.crowd);
      while (!g.done) g.next();
      const lines = userId === 1 ? g.result().box.home : g.result().box.away;
      const line = (id: number) => lines.find(l => l.playerId === id)!;
      expect(line(s.offense[1]).tpm).toBeGreaterThanOrEqual(1);
      expect(line(s.offense[1]).pts).toBeGreaterThanOrEqual(3);
      expect(line(s.offense[0]).ast).toBeGreaterThanOrEqual(1);
      expect(line(s.offense[4]).orb).toBeGreaterThanOrEqual(1);
      expect(line(s.offense[2]).fga).toBeGreaterThanOrEqual(1);
    }
  });

  test('a missed user shot gives the defense the rebound, and next() sims a pending one', () => {
    const a = makeSquad(1), b = makeSquad(2);
    const g = createLiveGame(setupOf(a, b, { userTeamId: 1, controlled: 12 }), new Rng(21));
    let step = g.next();
    while (step.kind !== 'user') step = g.next();
    const res = g.resolveUser({ events: [{ t: 'shot', by: step.setup.offense[0], type: 'layup', made: false }], seconds: 12 });
    const last = res.events[res.events.length - 1];
    expect(last.t).toBe('dreb');
    expect(step.setup.defense).toContain((last as { by: number }).by);
    expect(res.clockStart - res.clockEnd).toBe(12);

    step = g.next();
    while (step.kind !== 'user') step = g.next();
    const played = g.userPossessions;
    const simmed = g.next();
    expect(simmed.kind).toBe('possession');
    if (simmed.kind === 'possession') {
      expect(simmed.result.user).toBe(false);
      expect(simmed.result.offense).toBe(1);
    }
    expect(g.userPossessions).toBe(played - 1);
    expect(() => g.resolveUser({ events: [], seconds: 5 })).toThrow();
    let periods = 0, finals = 0;
    for (let i = 0; i < 2000 && !g.done; i++) {
      const s = g.next();
      if (s.kind === 'period') periods++;
      if (s.kind === 'final') finals++;
      if (s.kind === 'user') g.simUser();
    }
    expect(finals).toBe(1);
    expect(periods).toBeGreaterThanOrEqual(QUARTERS - 1);
    expect(g.next().kind).toBe('final');
  });

  test('a tight finish with the ball is hand-played as the last shot', () => {
    const a = makeSquad(1), b = makeSquad(2);
    let tight = 0, offered = 0;
    for (let i = 0; i < 300; i++) {
      const g = createLiveGame(setupOf(a, b, { userTeamId: 1, controlled: 12 }), new Rng(6000 + i));
      let lastUserBall: { clock: number; margin: number; quarter: number } | null = null;
      for (let step = g.next(); step.kind !== 'final'; step = g.next()) {
        const state = { clock: g.clock, margin: Math.abs(g.homeScore - g.awayScore), quarter: g.quarter };
        if (step.kind === 'user') {
          if (step.setup.lastShot && step.setup.quarter >= 4 && Math.abs(step.setup.userScore - step.setup.oppScore) <= 3) offered++;
          expect(step.setup.lastShot).toBe(step.setup.clock <= 24);
          lastUserBall = null;
          g.resolveUser({ events: [{ t: 'shot', by: step.setup.offense[0], type: 'mid', made: false }], seconds: 24 });
        } else if (step.kind === 'possession' && step.result.offense === 1) {
          lastUserBall = { clock: step.result.clockStart, margin: Math.abs(step.result.homeScore - step.result.points - step.result.awayScore), quarter: step.result.quarter };
          // A simulated user trip in a tight endgame only happens once the extras cap is hit.
          if (lastUserBall.quarter >= 4 && lastUserBall.clock <= 24 && lastUserBall.margin <= 3) {
            tight++;
            expect(g.userPossessions).toBe(15);
          }
        }
        void state;
      }
    }
    expect(offered).toBeGreaterThan(3);
    console.log('last-shot possessions offered', offered, 'simulated because of the cap', tight);
  });
});
