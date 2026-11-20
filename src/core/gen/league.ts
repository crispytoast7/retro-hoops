// League, team and player generation.
import { HARD_LIMIT, MAX_SALARY, MIN_SALARY, NUM_TEAMS, PROSPECTS, SAVE_VERSION } from '../constants';
import { marketSalary } from '../gm/value';
import { autoLineup } from '../lineup';
import { payroll } from '../org/finance';
import { clamp, emptyStats, overallOf, round1 } from '../ratings';
import { Rng } from '../rng';
import type {
  Calendar, CoachCareer, Facility, FacilityKey, Player, Pos, RatingKey, Ratings, Save, Settings, StaffMember, Team,
} from '../types';
import { FACILITY_KEYS, POSITIONS, RATING_KEYS, TRAITS } from '../types';
import { FEATURED_NAMES, FIRST_NAMES, LAST_NAMES, OWNER_NAMES } from '../../data/names';
import { CLUBS, COLLEGES, DEV_TEAMS } from '../../data/origins';
import { TEAM_TEMPLATES } from '../../data/teams';

const ARCHETYPE: Record<Pos, Ratings> = {
  PG: { sht: 66, hnd: 80, pas: 80, spd: 78, fin: 56, def: 56, reb: 36 },
  SG: { sht: 80, hnd: 68, pas: 58, spd: 72, fin: 65, def: 58, reb: 42 },
  SF: { sht: 68, hnd: 58, pas: 55, spd: 68, fin: 70, def: 68, reb: 58 },
  PF: { sht: 52, hnd: 42, pas: 48, spd: 56, fin: 74, def: 72, reb: 76 },
  C:  { sht: 38, hnd: 32, pas: 45, spd: 46, fin: 76, def: 76, reb: 82 },
};

export function genName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}
export const shortName = (name: string): string => {
  const i = name.indexOf(' ');
  return i < 0 ? name : `${name[0]}. ${name.slice(i + 1)}`;
};

/** Ratings shaped like the position's archetype, shifted so overall lands on `target`. */
export function genRatings(rng: Rng, pos: Pos, target: number): Ratings {
  const r = {} as Ratings;
  for (const k of RATING_KEYS) r[k] = ARCHETYPE[pos][k] + rng.gauss() * 8;
  for (let i = 0; i < 4; i++) {
    const d = target - overallOf(r, pos);
    for (const k of RATING_KEYS) r[k] = clamp(r[k] + d, 18, 99);
  }
  for (const k of RATING_KEYS) r[k] = Math.round(r[k]);
  return r;
}

export function genPlayer(save: { nextId: number }, rng: Rng, pos: Pos, target: number, age: number): Player {
  const ratings = genRatings(rng, pos, clamp(target, 30, 97));
  const o = overallOf(ratings, pos);
  const room = age <= 20 ? rng.int(4, 16) : age <= 23 ? rng.int(2, 10) : age <= 26 ? rng.int(0, 4) : 0;
  const p: Player = {
    id: save.nextId++,
    name: genName(rng), pos, age, ratings,
    potential: clamp(o + room, o, 99),
    trait: rng.pick(TRAITS),
    morale: rng.int(55, 80),
    contract: { salary: MIN_SALARY, years: 1 },
    teamId: null, injury: null,
    season: emptyStats(), seasons: [], draft: null, awards: [], tenure: 0,
    look: {
      skin: rng.int(0, 4), hair: rng.int(0, 5), hairColor: rng.weighted([5, 3, 2, 1, 1]),
      height: pos === 'C' ? 2 : pos === 'PF' ? rng.int(1, 2) : pos === 'SF' ? 1 : pos === 'PG' ? 0 : rng.int(0, 1),
    },
    num: rng.int(0, 55),
  };
  return p;
}

function genAge(rng: Rng): number {
  return clamp(Math.round(26.5 + rng.gauss() * 3.6), 20, 36);
}

export function genStaff(save: { nextId: number }, rng: Rng, role: 'OC' | 'DC', stars: number): StaffMember {
  return { id: save.nextId++, name: genName(rng), role, stars, cost: [0, 2, 5, 9, 14, 20][stars], age: rng.int(34, 62) };
}

/** Fresh pool of coordinators available to hire. */
export function genStaffPool(save: { nextId: number }, rng: Rng): StaffMember[] {
  const out: StaffMember[] = [];
  for (const role of ['OC', 'DC'] as const) {
    for (const stars of [1, 2, 2, 3, 3, 4, 5]) out.push(genStaff(save, rng, role, stars));
  }
  return out;
}

function facility(level: number, rng: Rng): Facility {
  return { level, condition: rng.int(70, 100) };
}

/** Give the featured names to some of `ids` if nobody in the league has them yet. No rng, so leagues stay as they were. */
export function placeFeatured(save: Save, ids: number[], salt: number): void {
  const taken = new Set(Object.values(save.players).map(p => p.name));
  const todo = FEATURED_NAMES.filter(n => !taken.has(n));
  todo.forEach((name, i) => {
    const id = ids[(salt + i * 7) % ids.length];
    if (id !== undefined && !FEATURED_NAMES.includes(save.players[id].name)) save.players[id].name = name;
  });
}

export function genProspects(save: Save, rng: Rng): number[] {
  const ids: number[] = [];
  for (let i = 0; i < PROSPECTS; i++) {
    const pos = POSITIONS[i % 5];
    // top of the class is ready to start; the tail are projects
    const tier = i / PROSPECTS;
    const target = Math.round(70 - tier * 22 + rng.gauss() * 4);
    const p = genPlayer(save, rng, pos, target, rng.int(19, 22));
    // most prospects top out as role players; a few each year have star ceilings
    p.potential = clamp(overallOf(p.ratings, pos) + 3 + Math.round(Math.abs(rng.gauss()) * 8 * (1 - tier * 0.4)), overallOf(p.ratings, pos), 99);
    p.scouted = false;
    const src = rng.next();
    p.origin = src < 0.68 ? rng.pick(COLLEGES) : src < 0.92 ? rng.pick(CLUBS) : rng.pick(DEV_TEAMS);
    save.players[p.id] = p;
    ids.push(p.id);
  }
  // first-round talent: picks 3 to 12
  placeFeatured(save, ids.slice(2, 12), save.year);
  return ids;
}

export function genFreeAgents(save: Save, rng: Rng, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = genPlayer(save, rng, POSITIONS[i % 5], Math.round(58 + rng.gauss() * 6), genAge(rng) + 1);
    p.contract = { salary: marketSalary(p), years: 0 };
    save.players[p.id] = p;
    save.freeAgents.push(p.id);
  }
}

/** Starting contracts vs market value: the league-wide level, and how much it leans against team strength. */
const DEAL_BASE = 1.14;
const DEAL_SLOPE = 0.03;

export interface NewGameOpts {
  seed: number;
  coachName: string;
  coachLook: CoachCareer['look'];
  settings: Settings;
  calendar?: Calendar;
}

/** Build a whole league. The user's team is chosen afterwards with `chooseTeam`. */
export function newLeague(opts: NewGameOpts): Save {
  const rng = new Rng(opts.seed);
  const save: Save = {
    version: SAVE_VERSION, createdAt: Date.now(), savedAt: Date.now(),
    rng: 0, nextId: 1, year: 1, phase: 'regular', week: 1,
    teams: [], players: {}, freeAgents: [], staffPool: [], schedule: [], playoffs: null,
    userTeamId: 0,
    coach: { name: opts.coachName, rep: 20, w: 0, l: 0, playoffW: 0, playoffL: 0, titles: 0, seasons: 0, fired: 0, stops: [], look: opts.coachLook },
    credits: 10,
    owner: { name: rng.pick(OWNER_NAMES), approval: 60, goals: [] },
    fans: 50, captainId: null, news: [], pendingEvent: null, seenEvents: [], history: [], records: {},
    hallOfFame: [], offseason: null, settings: opts.settings, fired: null, tradeDemands: [], scoutPoints: 0, milestones: [], draftClass: [], tradeOffer: null, calendar: opts.calendar, creditCarry: 0,
  };
  const templates = rng.shuffle(TEAM_TEMPLATES.slice()).slice(0, NUM_TEAMS);
  // spread of team strength: a few contenders, a few bottom-feeders
  const bases = rng.shuffle(Array.from({ length: NUM_TEAMS }, (_, i) => 66 + (i / (NUM_TEAMS - 1)) * 9 + rng.gauss() * 0.8));
  templates.forEach((t, id) => {
    const base = bases[id];
    const facLevel = () => clamp(Math.round(1 + (base - 64.5) / 5 + rng.gauss() * 0.7), 1, 4);
    const team: Team = {
      id, city: t.city, name: t.name, abbr: t.abbr, conf: id % 2,
      colors: { primary: t.primary, secondary: t.secondary },
      roster: [], lineup: [],
      staff: { oc: genStaff(save, rng, 'OC', clamp(Math.round(2 + rng.gauss()), 1, 4)), dc: genStaff(save, rng, 'DC', clamp(Math.round(2 + rng.gauss()), 1, 4)) },
      // the store and the trophy room are new everywhere: every club starts them at level 1
      facilities: Object.fromEntries(FACILITY_KEYS.map(k => [k, k === 'store' || k === 'trophy' ? { level: 1, condition: 100 } : facility(facLevel(), rng)])) as Record<FacilityKey, Facility>,
      picks: [],
      record: { w: 0, l: 0, pf: 0, pa: 0, confW: 0, confL: 0, streak: 0 },
      deadCap: 0, history: [], titles: [], strategy: 'middle',
      prestige: clamp(Math.round(50 + (base - 70.5) * 5 + rng.gauss() * 10), 10, 95),
    };
    for (const year of [1, 2, 3]) for (const round of [1, 2] as const) team.picks.push({ year, round, origTeamId: id });
    // five starters (one per position) then five bench
    const startBoost = rng.shuffle([11, 6, 3, 0, -2]);
    const benchPos = rng.shuffle(POSITIONS.slice());
    const add = (pos: Pos, target: number, age: number) => {
      const p = genPlayer(save, rng, pos, target, age);
      p.teamId = id; p.tenure = rng.int(0, Math.max(0, Math.min(6, age - 21)));
      save.players[p.id] = p;
      team.roster.push(p.id);
    };
    POSITIONS.forEach((pos, i) => add(pos, base + startBoost[i] + rng.gauss() * 2, genAge(rng)));
    benchPos.forEach((pos, i) => add(pos, base - 6 - i * 1.5 + rng.gauss() * 2.5, i >= 3 ? rng.int(20, 23) : genAge(rng)));
    // contracts: around market value. Good teams got there on team-friendly deals; bad teams had to overpay
    // to get anyone to come, so payrolls spread less than talent does.
    const dealMood = DEAL_BASE - (base - 70.5) * DEAL_SLOPE;
    for (const pid of team.roster) {
      const p = save.players[pid];
      p.contract = { salary: round1(clamp(marketSalary(p) * dealMood * rng.range(0.88, 1.12), MIN_SALARY, MAX_SALARY)), years: rng.int(1, 4) };
    }
    // nobody starts over the hard limit: the strongest teams have spent right up to it, a few million short
    const ceiling = HARD_LIMIT - 1 - ((id * 5) % 7);
    let guard = 0;
    while (payroll(save, team) > ceiling && guard++ < 40) {
      const f = Math.max(0.9, ceiling / payroll(save, team));
      for (const pid of team.roster) { const p = save.players[pid]; p.contract.salary = round1(Math.max(MIN_SALARY, p.contract.salary * f - 0.05)); }
    }
    team.lineup = autoLineup(team.roster.map(pid => save.players[pid]));
    const used = new Set<number>();
    for (const pid of team.roster) { const p = save.players[pid]; while (used.has(p.num)) p.num = rng.int(0, 55); used.add(p.num); }
    save.teams.push(team);
  });
  // a starter or sixth man on two different clubs
  placeFeatured(save, save.teams.flatMap(t => t.roster.slice(0, 6)), opts.seed % 97);
  genFreeAgents(save, rng, 24);
  save.staffPool = genStaffPool(save, rng);
  save.draftClass = genProspects(save, rng);
  save.rng = rng.state;
  return save;
}
