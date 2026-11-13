// Possession-by-possession game simulation. Pure logic: no DOM, no storage.
import { OT_SECONDS, QUARTERS, QUARTER_SECONDS, SHOT_CLOCK } from '../constants';
import { clamp, emptyStats, gameScore } from '../ratings';
import type { Rng } from '../rng';
import type { BoxLine, GameResult, Player } from '../types';
import type {
  GameSetup, LiveGame, PlayEvent, PossessionResult, ShotType, SideInput, SimStep,
  TurnoverKind, UserPossessionOutcome, UserPossessionSetup,
} from './api';
import { availablePlayers, pickBackups, resolveLineup, scorerRating, teamRatings } from './team';

export { teamRatings };

// ---------------------------------------------------------------------------------------
// Tuning. Every number the sim uses lives here.
// ---------------------------------------------------------------------------------------

/** Seconds a simulated possession takes (uniform). */
const POSS_MIN_SECONDS = 8;
const POSS_MAX_SECONDS = 21;
/** A possession that would leave less than this on the clock runs the period out instead. */
const END_PERIOD_SLACK = 4;
/** Shot attempts allowed in one possession (offensive rebounds give more). */
const MAX_CHANCES = 4;

/** Rotation: each backup plays two stints of this length, staggered slot by slot. */
const BENCH_STINT_SECONDS = 200;
const BENCH_STINT_STARTS = [250, 970]; // game seconds elapsed
const BENCH_STAGGER_SECONDS = 20;

/** Shot usage: scorer composite to this power. */
const USAGE_POWER = 1.7;

/** Turnovers. */
const BASE_TURNOVER = 0.11;
const K_TURNOVER = 0.001; // per point of (defensive pressure - ball security)
const SECOND_CHANCE_TO_MULT = 0.45;
const STEAL_SHARE = 0.55; // share of turnovers that are live-ball steals
const DEAD_BALL_KINDS: TurnoverKind[] = ['badpass', 'oob', 'travel', 'offfoul', 'shotclock'];
const DEAD_BALL_WEIGHTS = [0.34, 0.26, 0.17, 0.15, 0.08];

/** Shot selection: weight = base * (rating / RATING_MID) ^ power. */
const RATING_MID = 60;
const SHOT_TYPES: ShotType[] = ['three', 'mid', 'layup', 'dunk'];
const SHOT_WEIGHT: Record<ShotType, number> = { three: 0.36, mid: 0.17, layup: 0.36, dunk: 0.1 };
const SHOT_POWER: Record<ShotType, number> = { three: 3, mid: 1.5, layup: 2, dunk: 4 };

/** Make chance = base + K * (shooter skill - defense faced) + modifiers. */
const BASE_MAKE: Record<ShotType, number> = { three: 0.335, mid: 0.36, layup: 0.492, dunk: 0.69 };
const K_MAKE: Record<ShotType, number> = { three: 0.0033, mid: 0.0037, layup: 0.0042, dunk: 0.0035 };
const MATCHUP_SHARE = 0.55; // rest is the team's average defense
const K_CREATION = 0.0009; // per point of (offense playmaking - defense mobility)
const MAKE_MIN = 0.05;
const MAKE_MAX = 0.95;

/** Shooting fouls. */
const FOUL_CHANCE: Record<ShotType, number> = { three: 0.025, mid: 0.06, layup: 0.18, dunk: 0.15 };
const AND_ONE_MULT = 0.45; // make chance multiplier when fouled
const BASE_FT = 0.76;
const K_FT = 0.004; // per point of shooting above RATING_MID
const FT_MIN = 0.4;
const FT_MAX = 0.95;

/** Blocks: share of misses that were blocked. */
const BLOCK_SHARE: Record<ShotType, number> = { three: 0.02, mid: 0.06, layup: 0.17, dunk: 0.08 };
const BLOCKER_POWER = 4;

/** Assists. */
const ASSIST_CHANCE: Record<ShotType, number> = { three: 0.78, mid: 0.42, layup: 0.5, dunk: 0.68 };
const K_ASSIST = 0.004; // per point of team passing above RATING_MID
const PASSER_POWER = 3;

/** Rebounds. */
const BASE_OREB = 0.26;
const K_OREB = 0.0032; // per point of rebounding edge
const REBOUNDER_POWER = 3;

/** Coaching (at five stars, scaled linearly). */
const DC_MAKE = 0.04;
const DC_TURNOVER = 0.015;
const OC_MAKE = 0.02;
const MAX_STARS = 5;

/** Home court. */
const HOME_MAKE_BASE = 0.01; // arena level 1
const HOME_MAKE_PER_LEVEL = 0.005; // each level above 1 (level 5 = +3%)
const FANS_MAKE = 0.01; // at fans = 100
const CROWD_MAKE = 0.02; // at crowd = 100

/** Morale, clutch, captain. */
const MORALE_MAKE = 0.02; // at morale 0 or 100
const CLUTCH_SECONDS = 120;
const CLUTCH_MARGIN = 6;
const CLUTCH_MAKE = 0.05;
const CAPTAIN_MAKE = 0.005;

/** Crowd energy. */
const CROWD_START = 50;
const CROWD_SCORE = 2;
const CROWD_RUN = 3; // extra when the same side scored on its previous possession too
const CROWD_STOP = 2;
const CROWD_EMPTY_TRIP = 1;
const CROWD_USER_SCORE = 6;
const CROWD_USER_BIG = 10; // user dunk or three
const CROWD_DRIFT = 0.06; // share of the gap to 50 closed each possession

/** Hand-played possessions. */
const USER_CYCLE_SECONDS = 29; // one user trip plus one opponent trip
const USER_MAX_EXTRA = 3;
const USER_LATE_EXTRA = 2; // late-game extras stop here so one buzzer-beater slot is left
const USER_LATE_SECONDS = 180;
const USER_LATE_MARGIN = 8;
const USER_LATE_CHANCE = 0.6;
const USER_LAST_SHOT_MARGIN = 3;

// ---------------------------------------------------------------------------------------

interface Side {
  input: SideInput;
  id: number;
  isHome: boolean;
  byId: Map<number, Player>;
  pool: Player[];
  starters: number[];
  backups: (number | null)[];
  box: Map<number, BoxLine>;
  seconds: Map<number, number>;
  /** Consecutive offensive possessions with points. */
  streak: number;
}

interface Pending { off: Side; def: Side; offFloor: Player[]; defFloor: Player[]; lastShot: boolean }

const mean = (ps: Player[], f: (p: Player) => number, fallback = RATING_MID): number =>
  ps.length ? ps.reduce((s, p) => s + f(p), 0) / ps.length : fallback;

const ballSecurity = (p: Player) => 0.6 * p.ratings.hnd + 0.4 * p.ratings.pas;
const pressure = (p: Player) => 0.6 * p.ratings.def + 0.4 * p.ratings.spd;
const playmaking = (p: Player) => 0.6 * p.ratings.pas + 0.4 * p.ratings.spd;
const mobility = (p: Player) => 0.5 * p.ratings.def + 0.5 * p.ratings.spd;

function shotSkill(p: Player, type: ShotType): number {
  const r = p.ratings;
  if (type === 'three' || type === 'mid') return r.sht;
  if (type === 'layup') return 0.8 * r.fin + 0.2 * r.spd;
  return r.fin;
}

function shortName(p: Player | undefined): string {
  if (!p) return 'Someone';
  const parts = p.name.trim().split(/\s+/);
  return parts.length < 2 ? p.name : `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function makeSide(input: SideInput, isHome: boolean): Side {
  const pool = availablePlayers(input.players);
  const starters = resolveLineup(input.team.lineup, pool);
  const box = new Map<number, BoxLine>();
  const seconds = new Map<number, number>();
  for (const p of pool) {
    box.set(p.id, { ...emptyStats(), playerId: p.id, starter: starters.includes(p.id) });
    seconds.set(p.id, 0);
  }
  return {
    input, id: input.team.id, isHome,
    byId: new Map(pool.map(p => [p.id, p])),
    pool, starters, backups: pickBackups(pool, starters),
    box, seconds, streak: 0,
  };
}

class Game implements LiveGame {
  readonly setup: GameSetup;
  quarter = 1;
  clock = QUARTER_SECONDS;
  homeScore = 0;
  awayScore = 0;
  homeQ: number[] = [0];
  awayQ: number[] = [0];
  crowd = CROWD_START;
  done = false;
  userPossessions = 0;

  private rng: Rng;
  private home: Side;
  private away: Side;
  private homeBall: boolean;
  private pending: Pending | null = null;
  private finalNext = false;
  /** Game seconds in completed periods. */
  private elapsedBefore = 0;
  private lastUserTripHandPlayed = false;

  constructor(setup: GameSetup, rng: Rng) {
    this.setup = setup;
    this.rng = rng;
    this.home = makeSide(setup.home, true);
    this.away = makeSide(setup.away, false);
    this.homeBall = rng.chance(0.5);
  }

  // ---- stepping ----

  next(): SimStep {
    if (this.done || this.finalNext) {
      this.finalNext = false;
      this.done = true;
      return { kind: 'final' };
    }
    if (this.pending) return { kind: 'possession', result: this.simUser() };
    if (this.clock <= 0) return this.endPeriod();

    const off = this.homeBall ? this.home : this.away;
    const def = this.homeBall ? this.away : this.home;
    const offFloor = this.floor(off);
    const defFloor = this.floor(def);
    const isUserBall = this.setup.controlled > 0 && this.setup.userTeamId === off.id;

    if (isUserBall && offFloor.length && this.shouldHandPlay()) {
      const lastShot = this.clock <= SHOT_CLOCK;
      this.pending = { off, def, offFloor, defFloor, lastShot };
      this.userPossessions++;
      this.lastUserTripHandPlayed = true;
      return { kind: 'user', setup: this.userSetup(this.pending) };
    }
    if (isUserBall) this.lastUserTripHandPlayed = false;
    return { kind: 'possession', result: this.simulate(off, def, offFloor, defFloor) };
  }

  simUser(): PossessionResult {
    const p = this.pending;
    if (!p) throw new Error('No user possession is pending');
    this.pending = null;
    this.userPossessions--;
    this.lastUserTripHandPlayed = false;
    return this.simulate(p.off, p.def, p.offFloor, p.defFloor);
  }

  resolveUser(outcome: UserPossessionOutcome): PossessionResult {
    const p = this.pending;
    if (!p) throw new Error('No user possession is pending');
    this.pending = null;
    const events = this.sanitize(outcome.events, p.offFloor, p.defFloor);
    // A missed last shot nobody on offense rebounded goes to the defense.
    let lastShot = -1;
    for (let i = 0; i < events.length; i++) if (events[i].t === 'shot') lastShot = i;
    if (lastShot >= 0 && p.defFloor.length) {
      const shot = events[lastShot];
      const reboundAfter = events.slice(lastShot + 1).some(e => e.t === 'oreb' || e.t === 'dreb' || e.t === 'ft');
      if (shot.t === 'shot' && !shot.made && !reboundAfter) {
        events.push({ t: 'dreb', by: this.pickBy(p.defFloor, q => q.ratings.reb, REBOUNDER_POWER).id });
      }
    }
    const raw = Number.isFinite(outcome.seconds) ? Math.round(outcome.seconds) : SHOT_CLOCK;
    const seconds = clamp(raw, 0, this.clock);
    return this.finish(p.off, p.def, p.offFloor, p.defFloor, events, seconds, true);
  }

  result(): GameResult {
    const homeWon = this.homeScore >= this.awayScore;
    const winner = homeWon ? this.home : this.away;
    const box = { home: this.boxLines(this.home), away: this.boxLines(this.away) };
    let top = -1;
    let best = -Infinity;
    for (const line of homeWon ? box.home : box.away) {
      const gs = gameScore(line);
      if (line.gp > 0 && gs > best) { best = gs; top = line.playerId; }
    }
    if (top < 0) top = winner.starters[0] ?? winner.pool[0]?.id ?? -1;
    return {
      homeId: this.home.id, awayId: this.away.id,
      homeScore: this.homeScore, awayScore: this.awayScore,
      homeQ: this.homeQ.slice(), awayQ: this.awayQ.slice(),
      box, ot: Math.max(0, this.quarter - QUARTERS), topPerformer: top,
    };
  }

  private endPeriod(): SimStep {
    const ended = this.quarter;
    if (ended >= QUARTERS && this.homeScore !== this.awayScore) {
      this.finalNext = true;
    } else {
      this.elapsedBefore += ended > QUARTERS ? OT_SECONDS : QUARTER_SECONDS;
      this.quarter++;
      this.clock = this.quarter > QUARTERS ? OT_SECONDS : QUARTER_SECONDS;
      this.homeQ.push(0);
      this.awayQ.push(0);
    }
    return { kind: 'period', ended, ot: ended > QUARTERS };
  }

  // ---- rotation ----

  /** The five on the floor right now, in slot order. Starters close games and play all of OT. */
  private floor(side: Side): Player[] {
    const periodLength = this.quarter > QUARTERS ? OT_SECONDS : QUARTER_SECONDS;
    const elapsed = this.elapsedBefore + periodLength - this.clock;
    const out: Player[] = [];
    side.starters.forEach((starterId, slot) => {
      let id = starterId;
      const backup = side.backups[slot];
      if (backup !== null && this.quarter <= QUARTERS) {
        const offset = (slot - 2) * BENCH_STAGGER_SECONDS;
        for (const start of BENCH_STINT_STARTS) {
          if (elapsed >= start + offset && elapsed < start + offset + BENCH_STINT_SECONDS) id = backup;
        }
      }
      const p = side.byId.get(id);
      if (p) out.push(p);
    });
    return out;
  }

  // ---- hand-played possessions ----

  private isClutch(): boolean {
    return this.quarter >= QUARTERS && this.clock <= CLUTCH_SECONDS
      && Math.abs(this.homeScore - this.awayScore) <= CLUTCH_MARGIN;
  }

  private shouldHandPlay(): boolean {
    const { controlled } = this.setup;
    const margin = Math.abs(this.homeScore - this.awayScore);
    const late = this.quarter >= QUARTERS;
    if (this.userPossessions >= controlled + USER_MAX_EXTRA) return false;
    // The last shot of a tight game is always the user's.
    if (late && this.clock <= SHOT_CLOCK && margin <= USER_LAST_SHOT_MARGIN) return true;
    if (!late && this.lastUserTripHandPlayed) return false;
    // Scheduled ones: keep pace with controlled/4 per quarter, spread over the trips left.
    const target = late ? controlled : Math.round((controlled * this.quarter) / QUARTERS);
    const need = target - this.userPossessions;
    if (need > 0) {
      const tripsLeft = Math.max(1, Math.ceil(this.clock / USER_CYCLE_SECONDS));
      // Before the 4th every other trip is off limits, so ask twice as often.
      const p = (need / tripsLeft) * (late ? 1 : 2);
      if (this.rng.chance(p)) return true;
    }
    // Extras when a close game is being decided.
    if (late && this.clock <= USER_LATE_SECONDS && margin <= USER_LATE_MARGIN
      && this.userPossessions < controlled + USER_LATE_EXTRA) {
      return this.rng.chance(USER_LATE_CHANCE);
    }
    return false;
  }

  private userSetup(p: Pending): UserPossessionSetup {
    const userScore = p.off.isHome ? this.homeScore : this.awayScore;
    const oppScore = p.off.isHome ? this.awayScore : this.homeScore;
    return {
      quarter: this.quarter, clock: this.clock, userScore, oppScore,
      offense: p.offFloor.map(q => q.id), defense: p.defFloor.map(q => q.id),
      clutch: this.isClutch(), lastShot: p.lastShot,
      crowd: Math.round(p.off.isHome ? this.crowd : 100 - this.crowd),
    };
  }

  // ---- simulating one possession ----

  private simulate(off: Side, def: Side, offFloor: Player[], defFloor: Player[]): PossessionResult {
    let seconds = this.rng.int(POSS_MIN_SECONDS, POSS_MAX_SECONDS);
    if (this.clock - seconds < END_PERIOD_SLACK) seconds = this.clock;
    const events = this.sanitize(this.simEvents(off, def, offFloor, defFloor), offFloor, defFloor);
    return this.finish(off, def, offFloor, defFloor, events, seconds, false);
  }

  private pickBy(floor: Player[], f: (p: Player) => number, power: number, skip?: Player): Player {
    const weights = floor.map(p => (p === skip ? 0 : Math.pow(Math.max(1, f(p)), power)));
    return floor[this.rng.weighted(weights)];
  }

  /** Flat make-chance bonus for the offense: coaching, home court, crowd, morale, captain. */
  private teamMakeBonus(off: Side, def: Side, offFloor: Player[]): number {
    let b = (OC_MAKE * clamp(off.input.ocStars, 0, MAX_STARS)) / MAX_STARS
      - (DC_MAKE * clamp(def.input.dcStars, 0, MAX_STARS)) / MAX_STARS;
    if (off.isHome) {
      b += HOME_MAKE_BASE + HOME_MAKE_PER_LEVEL * (clamp(off.input.arenaLevel, 1, 5) - 1);
      b += (FANS_MAKE * clamp(this.setup.fans, 0, 100)) / 100;
      b += (CROWD_MAKE * Math.max(0, this.crowd - 50)) / 50;
    }
    b += (MORALE_MAKE * (clamp(mean(offFloor, p => p.morale, 50), 0, 100) - 50)) / 50;
    if (off.input.captainId != null && offFloor.some(p => p.id === off.input.captainId)) b += CAPTAIN_MAKE;
    return b;
  }

  private simEvents(off: Side, def: Side, offFloor: Player[], defFloor: Player[]): PlayEvent[] {
    const rng = this.rng;
    const events: PlayEvent[] = [];
    if (!offFloor.length) return events;

    const clutch = this.isClutch();
    const teamDefense = mean(defFloor, p => p.ratings.def);
    const makeBonus = this.teamMakeBonus(off, def, offFloor)
      + K_CREATION * (mean(offFloor, playmaking) - mean(defFloor, mobility));
    const turnover = BASE_TURNOVER
      + K_TURNOVER * (mean(defFloor, pressure) - mean(offFloor, ballSecurity))
      + (DC_TURNOVER * clamp(def.input.dcStars, 0, MAX_STARS)) / MAX_STARS;
    const oreb = clamp(
      BASE_OREB + K_OREB * (mean(offFloor, p => p.ratings.reb) - mean(defFloor, p => p.ratings.reb)), 0.05, 0.6);
    const teamPassing = mean(offFloor, p => p.ratings.pas);

    for (let chance = 0; chance < MAX_CHANCES; chance++) {
      // Turnover?
      const toChance = clamp(turnover * (chance > 0 ? SECOND_CHANCE_TO_MULT : 1), 0.01, 0.4);
      if (rng.chance(toChance)) {
        const by = this.pickBy(offFloor, p => scorerRating(p) * (130 - ballSecurity(p)), 1);
        if (defFloor.length && rng.chance(STEAL_SHARE)) {
          const thief = this.pickBy(defFloor, pressure, 3);
          events.push({ t: 'tov', by: by.id, kind: rng.chance(0.6) ? 'steal' : 'intercept', stealBy: thief.id });
        } else {
          events.push({ t: 'tov', by: by.id, kind: DEAD_BALL_KINDS[rng.weighted(DEAD_BALL_WEIGHTS)] });
        }
        return events;
      }

      // Who shoots, and what.
      const shooter = this.pickBy(offFloor, scorerRating, USAGE_POWER);
      const r = shooter.ratings;
      const type = SHOT_TYPES[rng.weighted(SHOT_TYPES.map(t =>
        SHOT_WEIGHT[t] * Math.pow((t === 'three' || t === 'mid' ? r.sht : r.fin) / RATING_MID, SHOT_POWER[t])))];
      const defender = defFloor[offFloor.indexOf(shooter)];
      const faced = defender ? MATCHUP_SHARE * defender.ratings.def + (1 - MATCHUP_SHARE) * teamDefense : teamDefense;
      let make = BASE_MAKE[type] + K_MAKE[type] * (shotSkill(shooter, type) - faced) + makeBonus;
      if (clutch && shooter.trait === 'Clutch') make += CLUTCH_MAKE;
      make = clamp(make, MAKE_MIN, MAKE_MAX);

      const assistOf = (): number | undefined => {
        if (offFloor.length < 2) return undefined;
        const p = clamp(ASSIST_CHANCE[type] + K_ASSIST * (teamPassing - RATING_MID), 0.1, 0.95);
        return rng.chance(p) ? this.pickBy(offFloor, q => q.ratings.pas, PASSER_POWER, shooter).id : undefined;
      };

      let missLive: boolean; // a miss that can be rebounded
      if (defFloor.length && rng.chance(FOUL_CHANCE[type])) {
        // Shooting foul: and-one if it drops, otherwise two or three shots.
        const made = rng.chance(make * AND_ONE_MULT);
        if (made) {
          const assist = assistOf();
          events.push(assist === undefined ? { t: 'shot', by: shooter.id, type, made: true }
            : { t: 'shot', by: shooter.id, type, made: true, assist });
        }
        const att = made ? 1 : type === 'three' ? 3 : 2;
        const ft = clamp(BASE_FT + K_FT * (r.sht - RATING_MID), FT_MIN, FT_MAX);
        let ftMade = 0;
        let lastIn = true;
        for (let i = 0; i < att; i++) {
          lastIn = rng.chance(ft);
          if (lastIn) ftMade++;
        }
        events.push({ t: 'ft', by: shooter.id, made: ftMade, att });
        missLive = !lastIn;
      } else if (rng.chance(make)) {
        const assist = assistOf();
        events.push(assist === undefined ? { t: 'shot', by: shooter.id, type, made: true }
          : { t: 'shot', by: shooter.id, type, made: true, assist });
        missLive = false;
      } else {
        if (defFloor.length && rng.chance(BLOCK_SHARE[type])) {
          const blocker = this.pickBy(defFloor, p => 0.6 * p.ratings.def + 0.4 * p.ratings.reb, BLOCKER_POWER);
          events.push({ t: 'shot', by: shooter.id, type, made: false, blockBy: blocker.id });
        } else {
          events.push({ t: 'shot', by: shooter.id, type, made: false });
        }
        missLive = true;
      }
      if (!missLive) return events;

      // Rebound.
      if (chance < MAX_CHANCES - 1 && (!defFloor.length || rng.chance(oreb))) {
        events.push({ t: 'oreb', by: this.pickBy(offFloor, p => p.ratings.reb, REBOUNDER_POWER).id });
        continue;
      }
      if (defFloor.length) events.push({ t: 'dreb', by: this.pickBy(defFloor, p => p.ratings.reb, REBOUNDER_POWER).id });
      return events;
    }
    return events;
  }

  // ---- applying events ----

  /** Drop events (or parts of them) that name players who are not on the floor. */
  private sanitize(events: PlayEvent[], offFloor: Player[], defFloor: Player[]): PlayEvent[] {
    const onOff = new Set(offFloor.map(p => p.id));
    const onDef = new Set(defFloor.map(p => p.id));
    const out: PlayEvent[] = [];
    for (const e of events) {
      if (e.t === 'dreb') {
        if (onDef.has(e.by)) out.push({ t: 'dreb', by: e.by });
        continue;
      }
      if (!onOff.has(e.by)) continue;
      if (e.t === 'shot') {
        const made = !!e.made;
        const clean: PlayEvent = { t: 'shot', by: e.by, type: e.type, made };
        if (made && e.assist !== undefined && e.assist !== e.by && onOff.has(e.assist)) clean.assist = e.assist;
        if (!made && e.blockBy !== undefined && onDef.has(e.blockBy)) clean.blockBy = e.blockBy;
        out.push(clean);
      } else if (e.t === 'ft') {
        const att = Math.max(0, Math.floor(Number(e.att) || 0));
        const made = clamp(Math.floor(Number(e.made) || 0), 0, att);
        if (att > 0) out.push({ t: 'ft', by: e.by, made, att });
      } else if (e.t === 'oreb') {
        out.push({ t: 'oreb', by: e.by });
      } else {
        const clean: PlayEvent = { t: 'tov', by: e.by, kind: e.kind };
        if (e.stealBy !== undefined && onDef.has(e.stealBy)) clean.stealBy = e.stealBy;
        out.push(clean);
      }
    }
    return out;
  }

  /** Book a finished possession: box score, score, clock, crowd, whose ball. */
  private finish(
    off: Side, def: Side, offFloor: Player[], defFloor: Player[],
    events: PlayEvent[], seconds: number, user: boolean,
  ): PossessionResult {
    let points = 0;
    let bigPlay = false;
    for (const e of events) {
      if (e.t === 'shot') {
        const line = off.box.get(e.by)!;
        const three = e.type === 'three';
        line.fga++;
        if (three) line.tpa++;
        if (e.made) {
          const worth = three ? 3 : 2;
          line.fgm++;
          if (three) line.tpm++;
          line.pts += worth;
          points += worth;
          if (three || e.type === 'dunk') bigPlay = true;
          if (e.assist !== undefined) off.box.get(e.assist)!.ast++;
        } else if (e.blockBy !== undefined) {
          def.box.get(e.blockBy)!.blk++;
        }
      } else if (e.t === 'ft') {
        const line = off.box.get(e.by)!;
        line.fta += e.att;
        line.ftm += e.made;
        line.pts += e.made;
        points += e.made;
      } else if (e.t === 'oreb') {
        off.box.get(e.by)!.orb++;
      } else if (e.t === 'dreb') {
        def.box.get(e.by)!.drb++;
      } else {
        off.box.get(e.by)!.tov++;
        if (e.stealBy !== undefined) def.box.get(e.stealBy)!.stl++;
      }
    }

    for (const p of offFloor) off.seconds.set(p.id, off.seconds.get(p.id)! + seconds);
    for (const p of defFloor) def.seconds.set(p.id, def.seconds.get(p.id)! + seconds);

    const clockStart = this.clock;
    this.clock -= seconds;
    if (off.isHome) {
      this.homeScore += points;
      this.homeQ[this.homeQ.length - 1] += points;
    } else {
      this.awayScore += points;
      this.awayQ[this.awayQ.length - 1] += points;
    }
    this.moveCrowd(off, points > 0, user, bigPlay);
    this.homeBall = !off.isHome;

    return {
      offense: off.id, quarter: this.quarter, clockStart, clockEnd: this.clock,
      events, points, text: this.describe(events, off, def), user,
      homeScore: this.homeScore, awayScore: this.awayScore,
    };
  }

  private moveCrowd(off: Side, scored: boolean, user: boolean, bigPlay: boolean): void {
    let swing: number; // in favour of the team with the ball
    if (scored) {
      off.streak++;
      swing = user ? (bigPlay ? CROWD_USER_BIG : CROWD_USER_SCORE) : CROWD_SCORE;
      if (off.streak >= 2) swing += CROWD_RUN;
    } else {
      off.streak = 0;
      swing = off.isHome ? -CROWD_EMPTY_TRIP : -CROWD_STOP;
    }
    const moved = clamp(this.crowd + (off.isHome ? swing : -swing), 0, 100);
    this.crowd = moved + (CROWD_START - moved) * CROWD_DRIFT;
  }

  // ---- ticker text ----

  private describe(events: PlayEvent[], off: Side, def: Side): string {
    const rng = this.rng;
    const o = (id: number) => shortName(off.byId.get(id));
    const d = (id: number) => shortName(def.byId.get(id));
    if (!events.length) return 'Shot clock violation';

    let idx = events.length - 1;
    while (idx > 0 && (events[idx].t === 'dreb' || events[idx].t === 'oreb')) idx--;
    const main = events[idx];
    const prev = idx > 0 ? events[idx - 1] : undefined;
    const tail = events[events.length - 1];
    const secondChance = events.slice(0, idx).some(e => e.t === 'oreb');
    const lead = secondChance ? rng.pick(['Second chance: ', 'Off the offensive board, ', 'Extra possession: ']) : '';

    if (main.t === 'tov') {
      if (main.stealBy !== undefined) {
        return lead + rng.pick([
          `Steal by ${d(main.stealBy)}`,
          `${d(main.stealBy)} picks off ${o(main.by)}`,
          `${d(main.stealBy)} strips ${o(main.by)}`,
        ]);
      }
      const lines: Record<TurnoverKind, string[]> = {
        steal: [`${o(main.by)} loses the ball`],
        intercept: [`${o(main.by)}'s pass is picked off`],
        badpass: [`${o(main.by)} throws it away`, `Bad pass by ${o(main.by)}`],
        oob: [`${o(main.by)} steps out of bounds`, `${o(main.by)} loses it out of bounds`],
        travel: [`${o(main.by)} called for travelling`, `Travel on ${o(main.by)}`],
        offfoul: [`Offensive foul on ${o(main.by)}`, `${o(main.by)} charges`],
        shotclock: ['Shot clock violation', `${o(main.by)} can't beat the shot clock`],
      };
      return lead + rng.pick(lines[main.kind] ?? [`Turnover by ${o(main.by)}`]);
    }

    const madeLine = (by: number, type: ShotType, assist?: number): string => {
      const n = o(by);
      const verbs: Record<ShotType, string[]> = {
        three: [`${n} hits a three`, `${n} drains a three`, `${n} buries it from deep`],
        mid: [`${n} hits the jumper`, `${n} knocks down a mid-range shot`, `${n} pulls up and scores`],
        layup: [`${n} lays it in`, `${n} scores at the rim`, `${n} finishes the layup`],
        dunk: [`${n} dunks it!`, `${n} throws it down!`, `${n} slams it home!`],
      };
      return rng.pick(verbs[type]) + (assist !== undefined ? ` (${o(assist)} assist)` : '');
    };

    if (main.t === 'ft') {
      const board = tail.t === 'oreb' ? `, ${o(tail.by)} grabs the miss` : '';
      if (prev && prev.t === 'shot' && prev.made && main.att === 1) {
        const extra = main.made ? rng.pick([' and one!', ' plus the foul!']) : ', misses the free throw';
        return lead + madeLine(prev.by, prev.type, prev.assist) + extra + board;
      }
      const n = o(main.by);
      return lead + rng.pick([
        `${n} fouled, makes ${main.made} of ${main.att}`,
        `${n} goes ${main.made} for ${main.att} at the line`,
      ]) + board;
    }

    if (main.t === 'shot') {
      if (main.made) return lead + madeLine(main.by, main.type, main.assist);
      const n = o(main.by);
      const what: Record<ShotType, string> = { three: 'a three', mid: 'the jumper', layup: 'the layup', dunk: 'the dunk' };
      const miss = main.blockBy !== undefined
        ? rng.pick([`${n} blocked by ${d(main.blockBy)}`, `${d(main.blockBy)} rejects ${n}`])
        : rng.pick([`${n} misses ${what[main.type]}`, `${n} can't hit ${what[main.type]}`]);
      if (tail.t === 'dreb') return lead + `${miss}, ${d(tail.by)} rebounds`;
      if (tail.t === 'oreb') return lead + `${miss}, ${o(tail.by)} keeps it alive`;
      return lead + miss;
    }
    return lead + (main.t === 'oreb' ? `${o(main.by)} with the offensive board` : `${d(main.by)} rebounds`);
  }

  // ---- box score ----

  /** Box lines, starters first. Whole minutes by largest remainder so they sum correctly. */
  private boxLines(side: Side): BoxLine[] {
    const order = side.starters
      .map(id => side.byId.get(id))
      .filter((p): p is Player => !!p)
      .concat(side.pool.filter(p => !side.starters.includes(p.id)));
    let total = 0;
    for (const p of order) total += side.seconds.get(p.id)!;
    const target = Math.round(total / 60);
    const mins = order.map(p => Math.floor(side.seconds.get(p.id)! / 60));
    let left = target - mins.reduce((s, m) => s + m, 0);
    const byRemainder = order
      .map((p, i) => ({ i, rem: side.seconds.get(p.id)! % 60 }))
      .sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i, rem } of byRemainder) {
      if (left <= 0 || rem <= 0) break;
      mins[i]++;
      left--;
    }
    return order.map((p, i) => {
      const line = side.box.get(p.id)!;
      const played = side.seconds.get(p.id)! > 0;
      return { ...line, min: mins[i], gp: played ? 1 : 0, gs: played && line.starter ? 1 : 0 };
    });
  }
}

/** A game that can pause for hand-played possessions. */
export function createLiveGame(setup: GameSetup, rng: Rng): LiveGame {
  return new Game(setup, rng);
}

/** Simulate a whole game. Ignores userTeamId / controlled. */
export function simulateGame(setup: GameSetup, rng: Rng): GameResult {
  const game = new Game({ ...setup, userTeamId: null, controlled: 0 }, rng);
  // The bound is a guard against an endless tie between teams that cannot score.
  for (let i = 0; i < 100000 && !game.done; i++) game.next();
  return game.result();
}
