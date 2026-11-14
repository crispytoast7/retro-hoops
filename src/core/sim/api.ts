// Contract between the simulation engine (core/sim/engine.ts), the arcade game (src/game)
// and the season code. Types only.
import type { GameResult, Player, Team, Difficulty } from '../types';

export interface SideInput {
  team: Team;
  /** Everyone on the roster. The sim leaves out injured players itself. */
  players: Player[];
  /** Coordinator stars, 0 if the seat is empty. */
  ocStars: number;
  dcStars: number;
  /** Effective arena level 1-5 (matters for the home side). */
  arenaLevel: number;
  captainId?: number | null;
}

export interface GameSetup {
  home: SideInput;
  away: SideInput;
  /** Team whose offensive possessions can be hand-played, or null for a pure sim. */
  userTeamId: number | null;
  /** Target number of hand-played possessions (about 10-14). 0 = none. */
  controlled: number;
  playoff: boolean;
  /** 0-100 fan support of the home team when it is the user's, else 50. */
  fans: number;
  difficulty: Difficulty;
}

export type ShotType = 'three' | 'mid' | 'layup' | 'dunk';
export type TurnoverKind = 'steal' | 'oob' | 'shotclock' | 'intercept' | 'badpass' | 'travel' | 'offfoul';

/** One thing that happened inside a possession. Ids are player ids. */
export type PlayEvent =
  | { t: 'shot'; by: number; type: ShotType; made: boolean; assist?: number; blockBy?: number }
  | { t: 'ft'; by: number; made: number; att: number }
  | { t: 'oreb'; by: number }
  | { t: 'dreb'; by: number }
  | { t: 'tov'; by: number; kind: TurnoverKind; stealBy?: number };

export interface PossessionResult {
  /** Team id on offense. */
  offense: number;
  quarter: number;
  /** Seconds left in the period when it started / ended. */
  clockStart: number;
  clockEnd: number;
  events: PlayEvent[];
  points: number;
  /** Short ticker line, e.g. "D. Okafor hits a three (R. Vance assist)". */
  text: string;
  /** True if the user played it by hand. */
  user: boolean;
  homeScore: number;
  awayScore: number;
}

export interface UserPossessionSetup {
  quarter: number;
  /** Seconds left in the period. */
  clock: number;
  userScore: number;
  oppScore: number;
  /** Five user player ids on the floor in PG, SG, SF, PF, C slot order. */
  offense: number[];
  /** Five opponent ids, matched up slot for slot. */
  defense: number[];
  /** Final two minutes of Q4/OT within 6 points. */
  clutch: boolean;
  /** This possession will run out the period clock (buzzer-beater chance). */
  lastShot: boolean;
  /** Crowd energy 0-100 for the user's side. */
  crowd: number;
}

export interface UserPossessionOutcome {
  /**
   * What happened, in order. A missed final shot with no 'oreb' after it means the defense
   * rebounded; the sim credits the defensive rebound, so the arcade never sends 'dreb'.
   */
  events: PlayEvent[];
  /** Game-clock seconds the possession used. */
  seconds: number;
}

export type SimStep =
  | { kind: 'possession'; result: PossessionResult }
  | { kind: 'user'; setup: UserPossessionSetup }
  | { kind: 'period'; ended: number; ot: boolean }
  | { kind: 'final' };

export interface LiveGame {
  readonly setup: GameSetup;
  quarter: number;
  clock: number;
  homeScore: number;
  awayScore: number;
  homeQ: number[];
  awayQ: number[];
  /** Crowd energy 0-100 for the home side; rises on home runs, falls on away runs. */
  crowd: number;
  done: boolean;
  /** Momentum from the user's key moments, -100..100 in his favour: it tilts the simulated play that follows. */
  momentum: number;
  /** Call a timeout: stops the opponent's run (momentum back to level). */
  timeout(): void;
  /** Halftime adjustment: the opponent shoots this much worse in simulated play for the rest of the game. */
  tightenDefense(amount: number): void;
  /** Hand-played possessions so far. */
  userPossessions: number;
  /** Advance one step. After a 'user' step you must call resolveUser or simUser before next(). */
  next(): SimStep;
  resolveUser(outcome: UserPossessionOutcome): PossessionResult;
  /** Simulate the pending user possession instead of playing it. */
  simUser(): PossessionResult;
  /** Final result; valid once done. */
  result(): GameResult;
}
