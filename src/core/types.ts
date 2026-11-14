// Every saved data shape. Plain JSON only (no classes, Maps, Dates) so saves round-trip.

export type Pos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POSITIONS: Pos[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** sht=Shooting hnd=Handles pas=Passing spd=Speed fin=Finishing def=Defense reb=Rebounding */
export type RatingKey = 'sht' | 'hnd' | 'pas' | 'spd' | 'fin' | 'def' | 'reb';
export const RATING_KEYS: RatingKey[] = ['sht', 'hnd', 'pas', 'spd', 'fin', 'def', 'reb'];
export const RATING_NAMES: Record<RatingKey, string> = {
  sht: 'Shooting', hnd: 'Handles', pas: 'Passing', spd: 'Speed',
  fin: 'Finishing', def: 'Defense', reb: 'Rebounding',
};
/** Hidden 1-100 values. */
export type Ratings = Record<RatingKey, number>;

export type Trait =
  | 'Leader' | 'Diva' | 'Hard Worker' | 'Clutch' | 'Hothead'
  | 'Loyal' | 'Mercenary' | 'Quiet Pro' | 'Showman' | 'Lazy';
export const TRAITS: Trait[] = [
  'Leader', 'Diva', 'Hard Worker', 'Clutch', 'Hothead',
  'Loyal', 'Mercenary', 'Quiet Pro', 'Showman', 'Lazy',
];

export interface StatLine {
  gp: number; gs: number; min: number; pts: number;
  fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; ast: number; stl: number; blk: number; tov: number;
}

export interface Contract {
  /** $M per season, one decimal. */
  salary: number;
  /** Seasons remaining including the current one. 0 = expired (offseason). */
  years: number;
}

export interface Injury { weeks: number; desc: string; /** Picked up this week: the first weekly heal is skipped. */ fresh?: boolean }

export interface PlayerSeason { year: number; teamId: number; age: number; ovr: number; stats: StatLine }

export interface Player {
  id: number;
  name: string;
  pos: Pos;
  age: number;
  ratings: Ratings;
  /** Hidden ceiling for overall (1-100). */
  potential: number;
  trait: Trait;
  /** 0-100 */
  morale: number;
  contract: Contract;
  /** null = free agent / undrafted prospect / retired */
  teamId: number | null;
  injury: Injury | null;
  /** Current season totals. */
  season: StatLine;
  /** Completed seasons (current season not included until it ends). */
  seasons: PlayerSeason[];
  draft: { year: number; round: number; pick: number; teamId: number } | null;
  awards: string[];
  /** Seasons spent with current team. */
  tenure: number;
  /** Sprite look: skin tone index 0-4, hair style 0-5, hair colour 0-4, height 0-2. */
  look: { skin: number; hair: number; hairColor: number; height: number };
  /** Jersey number. */
  num: number;
  retired?: boolean;
  /** College, overseas club or academy he was drafted from. */
  origin?: string;
  /** Draft prospects only: which ratings the user's scouts have revealed. */
  scouted?: boolean;
}

export interface StaffMember {
  id: number;
  name: string;
  role: 'OC' | 'DC';
  /** 1-5 */
  stars: number;
  /** $M per season (counts against credits upkeep, not the cap): credits per season. */
  cost: number;
  age: number;
}

export type FacilityKey = 'arena' | 'training' | 'medical' | 'scouting';
export const FACILITY_KEYS: FacilityKey[] = ['arena', 'training', 'medical', 'scouting'];
export interface Facility {
  /** 1-5 (effective level) */
  level: number;
  /** 0-100. Degrades each week; below 50 the facility acts one level lower. */
  condition: number;
  /** Level purchased this week, takes effect next week. */
  pending?: number;
}

export interface DraftPick {
  /** Draft year (the season number whose offseason holds the draft). */
  year: number;
  round: 1 | 2;
  /** Team whose record decides the slot. */
  origTeamId: number;
}

export interface TeamRecord {
  w: number; l: number; pf: number; pa: number;
  confW: number; confL: number;
  /** positive = win streak, negative = losing streak */
  streak: number;
}

export interface TeamSeason {
  year: number; w: number; l: number;
  /** 'none' | 'R1' | 'SF' | 'F' | 'champ' = furthest playoff round reached */
  playoff: 'none' | 'R1' | 'SF' | 'F' | 'champ';
}

export interface Team {
  id: number;
  city: string;
  name: string;
  abbr: string;
  /** 0 or 1 */
  conf: number;
  colors: { primary: string; secondary: string };
  /** Player ids. 10 normal, 12 max. */
  roster: number[];
  /** Five starter ids in PG, SG, SF, PF, C slot order. */
  lineup: number[];
  staff: { oc: StaffMember | null; dc: StaffMember | null };
  facilities: Record<FacilityKey, Facility>;
  picks: DraftPick[];
  record: TeamRecord;
  /** Dead cap from cut players, $M, charged this season. */
  deadCap: number;
  history: TeamSeason[];
  titles: number[];
  /** AI direction, re-evaluated each season. */
  strategy: 'contend' | 'middle' | 'rebuild';
  /** 0-100 market size/prestige; affects attendance and FA interest. */
  prestige: number;
  /** Mid-level exception already used this season. */
  mleUsed?: boolean;
}

export interface BoxLine extends StatLine { playerId: number; starter: boolean }

export interface GameResult {
  homeId: number; awayId: number;
  homeScore: number; awayScore: number;
  /** Points per quarter (plus OT periods). */
  homeQ: number[]; awayQ: number[];
  box: { home: BoxLine[]; away: BoxLine[] };
  ot: number;
  /** Player id of the game's top performer. */
  topPerformer: number;
}

export interface ScheduledGame {
  id: number;
  /** Week number: regular-season weeks, then one playoff round per week. */
  week: number;
  /** Game day within the season (every team plays at most once a day). */
  day: number;
  homeId: number; awayId: number;
  played: boolean;
  homeScore?: number; awayScore?: number;
  /** Full result kept only for the user's games this season. */
  result?: GameResult;
  playoff?: boolean;
}

export interface PlayoffSeries {
  round: 1 | 2 | 3;
  /** conf 0/1, or 2 for the final */
  conf: number;
  highId: number; lowId: number;
  winnerId?: number;
  /** Most recent game of the series. */
  gameId?: number;
  highW: number; lowW: number;
  games: number[];
}
export interface Playoffs { series: PlayoffSeries[]; championId?: number }

export interface NewsItem {
  year: number; week: number;
  kind: 'game' | 'trade' | 'injury' | 'signing' | 'award' | 'league' | 'team' | 'owner' | 'draft' | 'staff';
  text: string;
  /** True if it concerns the user's team. */
  mine?: boolean;
}

export type EffectKind =
  | 'morale'      // the featured player's morale
  | 'teamMorale'  // everyone on the roster
  | 'fans' | 'owner' | 'credits' | 'rep'
  | 'injury'      // featured player injured for v weeks
  | 'suspend'     // featured player unavailable for v weeks
  | 'tradeDemand';// featured player asks out (v ignored)
export interface Effect { k: EffectKind; v: number }

export interface EventChoice {
  label: string;
  result: string;
  effects: Effect[];
  /** Different outcome when the featured player has this trait. */
  byTrait?: Partial<Record<Trait, { result: string; effects: Effect[] }>>;
}
export interface EventTemplate {
  id: string;
  title: string;
  /** Tokens: {player} {team} {city} {coach} {owner} {opp} */
  text: string;
  /** Who the event features. */
  subject: 'star' | 'rookie' | 'benched' | 'captain' | 'unhappy' | 'veteran' | 'any' | 'none';
  /** Only fires if the subject has one of these traits. */
  traits?: Trait[];
  choices: EventChoice[];
}
export interface PendingEvent { templateId: string; playerId: number | null; oppId?: number }

export interface OwnerGoal {
  kind: 'wins' | 'playoffs' | 'semis' | 'finals' | 'title' | 'develop';
  /** wins target for 'wins' */
  target?: number;
  text: string;
  done?: boolean; failed?: boolean;
}

export interface CoachCareer {
  name: string;
  /** 0-100 reputation */
  rep: number;
  w: number; l: number; playoffW: number; playoffL: number;
  titles: number; seasons: number; fired: number;
  stops: { teamId: number; from: number; to: number | null; w: number; l: number; titles: number }[];
  look: { skin: number; hair: number; hairColor: number };
}

export interface SeasonHistory {
  year: number;
  championId: number; runnerUpId: number;
  mvp: { playerId: number; name: string; teamId: number; line: string } | null;
  awards: { award: string; playerId: number; name: string; teamId: number; line?: string }[];
  userTeamId: number; userW: number; userL: number; userPlayoff: TeamSeason['playoff'];
}

export interface RecordEntry { value: number; playerId: number; name: string; year: number; teamId: number }
/** Franchise records for the user's current team, keyed e.g. 'game.pts', 'season.pts', 'career.pts'. */
export type RecordBook = Record<string, RecordEntry>;

export interface HallOfFamer {
  playerId: number; name: string; pos: Pos; yearRetired: number;
  teamId: number; career: StatLine; seasons: number; awards: string[]; peakOvr: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export interface Settings { sound: boolean; difficulty: Difficulty; haptics: boolean; /** Soundtrack on/off (on when missing). */ music?: boolean }

/** Season shape, chosen at New Game. */
export interface Calendar {
  /** Regular-season games per team. */
  games: number;
  /** Game days per week. */
  perWeek: number;
  regWeeks: number;
  /** Trades close once this week has been played. */
  deadlineWeek: number;
  /** Wins needed to take a playoff series. */
  seriesWins: number;
}

export type Phase = 'regular' | 'playoffs' | 'offseason';
export type OffseasonStep = 'awards' | 'retirements' | 'contracts' | 'draft' | 'freeAgency' | 'camp' | 'done';

export interface FreeAgentOffer { teamId: number; salary: number; years: number }

export interface OffseasonState {
  step: OffseasonStep;
  /** Draft order as team ids (2 rounds, 32 entries) and index of the pick on the clock. */
  draftOrder: { teamId: number; round: 1 | 2; pick: number }[];
  draftIdx: number;
  /** Prospect player ids still on the board. */
  prospects: number[];
  /** Free agency day 1..FA_DAYS; user offers awaiting decision. */
  faDay: number;
  userOffers: Record<number, FreeAgentOffer>;
  retired: number[];
  campSpent: number;
  /** Log lines shown on the step screens. */
  log: string[];
  jobOffers?: number[];
}

export interface Save {
  version: number;
  createdAt: number;
  savedAt: number;
  /** Seeded RNG state (uint32). */
  rng: number;
  nextId: number;
  /** Season number starting at 1. */
  year: number;
  phase: Phase;
  /** Next week to play: 1-14 regular, 15-17 playoffs. */
  week: number;
  teams: Team[];
  /** All players ever (active, free agents, prospects, retired with history). */
  players: Record<number, Player>;
  freeAgents: number[];
  staffPool: StaffMember[];
  schedule: ScheduledGame[];
  playoffs: Playoffs | null;
  userTeamId: number;
  coach: CoachCareer;
  credits: number;
  owner: { name: string; approval: number; goals: OwnerGoal[] };
  /** 0-100 fan support for the user's team. */
  fans: number;
  captainId: number | null;
  news: NewsItem[];
  pendingEvent: PendingEvent | null;
  /** Event template ids already seen this season. */
  seenEvents: string[];
  history: SeasonHistory[];
  records: RecordBook;
  hallOfFame: HallOfFamer[];
  offseason: OffseasonState | null;
  settings: Settings;
  /** Set when the owner fires the coach: team ids offering a job. */
  fired?: { offers: number[] } | null;
  /** Players who have asked for a trade. */
  tradeDemands: number[];
  /** Scouting points left this season. */
  scoutPoints: number;
  /** Milestones already paid out, e.g. 'wins10'. */
  milestones: string[];
  calendar?: Calendar;
  /** Fractions of a credit earned but not yet paid out. */
  creditCarry?: number;
  /** Next draft's prospects (player ids); scoutable during the season. */
  draftClass: number[];
  /** A trade an AI team has put to the user, waiting for an answer. */
  tradeOffer: { aId: number; bId: number; aGives: { players: number[]; picks: DraftPick[] }; bGives: { players: number[]; picks: DraftPick[] } } | null;
}
