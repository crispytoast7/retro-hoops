export const SAVE_VERSION = 1;

export const NUM_TEAMS = 16;
export const REG_WEEKS = 14;
export const PLAYOFF_WEEKS = 3;
/** Trades are locked once this week has been played. */
export const TRADE_DEADLINE_WEEK = 7;

export const ROSTER_NORMAL = 10;
export const ROSTER_MAX = 12;
export const ROSTER_MIN = 8;

/** Soft cap, $M. Teams may go over it with their own free agents, minimum deals and the mid-level exception. */
export const SALARY_CAP = 150;
/** Payroll above this at season end is taxed (credits and owner approval). */
export const LUXURY_TAX = 180;
/** Above this: no full mid-level, and trades may not bring back more salary than they send. */
export const FIRST_APRON = 190;
/** Above this: no mid-level at all, one player per trade, no trading first-round picks. */
export const SECOND_APRON = 200;
export const MIN_SALARY = 1.5;
/** 30% of the cap. */
export const MAX_SALARY = 45;
/** 35% of the cap: own team only, for a player with an MVP or All-League award. */
export const SUPERMAX_SALARY = 52.5;
/** Mid-level exception: one signing a season up to this, for a team that stays at or under the first apron. */
export const MLE = 13;
/** Taxpayer mid-level: the smaller version for a team that stays at or under the second apron. */
export const TAX_MLE = 6;
/** Longest deal when re-signing with his own team. */
export const MAX_CONTRACT_YEARS = 5;
/** Longest deal with any other team. */
export const MAX_FA_YEARS = 4;
/** Longest minimum-salary deal. */
export const MIN_DEAL_YEARS = 2;
/** Share of remaining salary charged as dead cap when a player is cut. */
export const DEAD_CAP_RATE = 0.5;

/** Game shape: 4 quarters of 12:00, about 100 possessions per team, scores around 110. */
export const QUARTERS = 4;
export const QUARTER_SECONDS = 720;
export const OT_SECONDS = 300;
export const SHOT_CLOCK = 24;

export const FA_DAYS = 5;
export const DRAFT_ROUNDS = 2;
export const PROSPECTS = 40;
