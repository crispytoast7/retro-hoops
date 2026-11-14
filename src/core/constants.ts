export const SAVE_VERSION = 1;

export const NUM_TEAMS = 16;
export const REG_WEEKS = 14;
export const PLAYOFF_WEEKS = 3;
/** Trades are locked once this week has been played. */
export const TRADE_DEADLINE_WEEK = 7;

export const ROSTER_NORMAL = 10;
export const ROSTER_MAX = 12;
export const ROSTER_MIN = 8;

/** Salary cap, $M. Signing a free agent from another team needs room under it. A team may pass it only to re-sign its own players, for minimum deals and for draft picks. */
export const SALARY_CAP = 150;
/** No payroll may pass this, not even to re-sign the team's own players. Only minimum deals and draft picks can take a team beyond it. */
export const HARD_LIMIT = 190;
export const MIN_SALARY = 1.5;
/** 30% of the cap. */
export const MAX_SALARY = 45;
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
