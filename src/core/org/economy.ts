// Credits, facilities, staff, rating upgrades, scouting.
import { clamp, overallOf, raiseRating, starLevel } from '../ratings';
import type { Rng } from '../rng';
import type { Facility, FacilityKey, GameResult, Player, RatingKey, Save, StaffMember, Team } from '../types';
import { FACILITY_KEYS } from '../types';
import { NEWS } from '../../data/news';
import { note, perk } from './progress';

export function pushNews(save: Save, kind: Save['news'][number]['kind'], text: string, mine = false): void {
  save.news.unshift({ year: save.year, week: save.week, kind, text, mine });
  if (save.news.length > 200) save.news.length = 200;
}
export function headline(rng: Rng, key: string, tokens: Record<string, string | number>): string {
  const tpl = rng.pick(NEWS[key] ?? ['{team}']);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(tokens[k] ?? ''));
}
export const teamName = (t: Team): string => `${t.city} ${t.name}`;

// ---- facilities ----------------------------------------------------------------------
export const FACILITY_INFO: Record<FacilityKey, { name: string; desc: string; perks: string[] }> = {
  arena: { name: 'Arena', desc: 'Fan support and home-court advantage.', perks: ['Small home edge', 'Louder crowd, more gate credits', 'Fans grow faster', 'Strong home edge', 'Fortress: best home edge and gate'] },
  training: { name: 'Training Center', desc: 'Faster player progression.', perks: ['Basic gym', 'Young players develop faster', 'Veterans hold their ratings longer', 'Cheaper rating upgrades', 'Elite development'] },
  medical: { name: 'Medical Center', desc: 'Fewer and shorter injuries.', perks: ['First-aid kit', 'Fewer injuries', 'Shorter recoveries', 'Far fewer injuries', 'Players rarely miss time'] },
  store: { name: 'Team Store', desc: 'Sells your jerseys: credits every game, more at home and when fans love you.', perks: ['A merch cart: a little extra every game', 'A real shop: more from every game', 'Jerseys in the window: more again', 'Two floors of gear: a lot more', 'The flagship megastore: the most of all'] },
  trophy: { name: 'Trophy Room', desc: 'Shows off your titles, awards and legends. Fans and free agents notice.', perks: ['A display case in the hallway', 'Fans drift up a little every week', 'Free agents are impressed by the tour', 'Fans drift up faster and higher', 'A hall of legends: fans and free agents love it'] },
  scouting: { name: 'Scouting Office', desc: 'Better draft info and free-agent interest.', perks: ['3 scouting reports a season', '6 reports, tighter rating estimates', '9 reports, free agents take notice', '12 reports, sharp estimates', '15 reports, nothing stays hidden'] },
};
/** Cost in credits to reach level L from L-1. */
export const FACILITY_COST = [0, 0, 8, 14, 22, 32];
/** Level that actually applies: run-down buildings (condition < 50) act one level lower. */
export const effLevel = (f: Facility): number => Math.max(1, f.level - (f.condition < 50 ? 1 : 0));
export const repairCost = (f: Facility): number => (f.condition >= 95 ? 0 : 1 + f.level);

/** Credits a home game earns at the team store, by level, before the fans multiplier. */
export const STORE_PER_GAME = [0, 0.25, 0.5, 0.8, 1.15, 1.6];

export function upgradeFacility(save: Save, key: FacilityKey): string | null {
  const f = save.teams[save.userTeamId].facilities[key];
  const next = (f.pending ?? f.level) + 1;
  if (f.pending) return 'An upgrade is already under way.';
  if (next > 5) return 'Already at the top level.';
  const cost = FACILITY_COST[next];
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  f.pending = next;
  note(save, 'facility');
  return null;
}
export function repairFacility(save: Save, key: FacilityKey): string | null {
  const f = save.teams[save.userTeamId].facilities[key];
  const cost = repairCost(f);
  if (cost === 0) return 'Already in good shape.';
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  f.condition = 100;
  note(save, 'facility');
  return null;
}
/** Weekly: finish pending upgrades and wear the user's buildings down a little. */
export function weeklyFacilities(save: Save, rng: Rng): void {
  const team = save.teams[save.userTeamId];
  for (const k of FACILITY_KEYS) {
    const f = team.facilities[k];
    if (f.pending) {
      f.level = f.pending; delete f.pending; f.condition = 100;
      pushNews(save, 'team', `${FACILITY_INFO[k].name} upgrade complete: now level ${f.level}.`, true);
    } else {
      const before = f.condition;
      f.condition = clamp(f.condition - rng.int(1, 3), 0, 100);
      // a trophy room pulls the city in, week after week, up to a point
      if (k === 'trophy') { const lv = effLevel(f); if (lv >= 2 && save.fans < 40 + 12 * lv) save.fans = clamp(save.fans + (lv >= 4 ? 2 : 1), 0, 100); }
      if (before >= 50 && f.condition < 50) pushNews(save, 'team', `The ${FACILITY_INFO[k].name} is run down and working a level below its best. Maintenance needed.`, true);
    }
  }
}

// ---- staff ---------------------------------------------------------------------------
/** Coach reputation needed to attract a coordinator of this many stars. */
export const REP_FOR_STARS = [0, 0, 0, 12, 32, 58];
export function canHire(save: Save, s: StaffMember): string | null {
  if (save.coach.rep < REP_FOR_STARS[s.stars]) return `Needs reputation ${REP_FOR_STARS[s.stars]}.`;
  if (save.credits < s.cost) return `Needs ${s.cost} credits.`;
  return null;
}
export function hireStaff(save: Save, staffId: number): string | null {
  const s = save.staffPool.find(x => x.id === staffId);
  if (!s) return 'No longer available.';
  const err = canHire(save, s);
  if (err) return err;
  const team = save.teams[save.userTeamId];
  const slot = s.role === 'OC' ? 'oc' : 'dc';
  const old = team.staff[slot];
  save.credits -= s.cost;
  save.staffPool = save.staffPool.filter(x => x.id !== staffId);
  if (old) save.staffPool.push(old);
  team.staff[slot] = s;
  note(save, 'hire');
  pushNews(save, 'staff', `${teamName(team)} hire ${s.name} as ${s.role === 'OC' ? 'offensive' : 'defensive'} coordinator.`, true);
  return null;
}
export function fireStaff(save: Save, role: 'OC' | 'DC'): void {
  const team = save.teams[save.userTeamId];
  const slot = role === 'OC' ? 'oc' : 'dc';
  const old = team.staff[slot];
  if (!old) return;
  team.staff[slot] = null;
  save.staffPool.push(old);
}
/** Good coordinators on a winning team sometimes leave for a bigger job. */
export function maybePoach(save: Save, rng: Rng): void {
  const team = save.teams[save.userTeamId];
  for (const slot of ['oc', 'dc'] as const) {
    const s = team.staff[slot];
    if (!s || s.stars < 4) continue;
    const winPct = team.record.w / Math.max(1, team.record.w + team.record.l);
    if (rng.chance(0.12 + (s.stars - 4) * 0.08 + (winPct > 0.6 ? 0.1 : 0))) {
      team.staff[slot] = null;
      const other = rng.pick(save.teams.filter(t => t.id !== team.id));
      pushNews(save, 'staff', headline(rng, 'staffPoached', { name: s.name, team: teamName(other), role: s.role }), true);
    }
  }
}

// ---- rating upgrades -----------------------------------------------------------------
export const UPGRADE_POINTS = 4;
/** Training-camp sessions one player can take in a summer: camp sharpens a player, it does not rebuild him. */
export const CAMP_SESSIONS = 3;
type CampCount = { campUps?: Record<number, number> };
/** Sessions this player has left at the current camp. */
export const campSessionsLeft = (save: Save, p: Player): number =>
  Math.max(0, CAMP_SESSIONS - ((save.offseason as CampCount | null)?.campUps?.[p.id] ?? 0));
/** Nobody can be trained past his ceiling, with credits or with level-ups. */
const reachedCeiling = (p: Player): boolean => overallOf(p.ratings, p.pos) >= p.potential;
export function upgradeCost(save: Save, p: Player, key: RatingKey): number {
  const base = [0, 2, 3, 5, 8, 12][starLevel(p.ratings[key])];
  const training = effLevel(save.teams[save.userTeamId].facilities.training);
  let c = base * (training >= 4 ? 0.8 : 1) - perk(save, 'develop');
  if (save.phase === 'offseason' && save.offseason?.step === 'camp') c *= 0.75;
  return Math.max(1, Math.round(c));
}
/** Why this player cannot be trained right now, or null if he can. */
export function upgradeBlock(save: Save, p: Player): string | null {
  if (reachedCeiling(p)) return 'He has reached his ceiling.';
  if (save.offseason && campSessionsLeft(save, p) <= 0) return `He has done his ${CAMP_SESSIONS} sessions for this camp.`;
  return null;
}
export function upgradeRating(save: Save, playerId: number, key: RatingKey): string | null {
  const p = save.players[playerId];
  if (p.ratings[key] >= 99) return 'Already maxed out.';
  const block = upgradeBlock(save, p);
  if (block) return block;
  const cost = upgradeCost(save, p, key);
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  raiseRating(p, key, UPGRADE_POINTS);
  if (save.offseason) {
    save.offseason.campSpent += cost;
    const off = save.offseason as CampCount;
    (off.campUps ??= {})[p.id] = (off.campUps[p.id] ?? 0) + 1;
  }
  note(save, 'train');
  return null;
}

// ---- scouting ------------------------------------------------------------------------
export const scoutPointsPerSeason = (save: Save): number => effLevel(save.teams[save.userTeamId].facilities.scouting) * 3 + 3 * perk(save, 'scout');
export function scoutProspect(save: Save, playerId: number): string | null {
  const p = save.players[playerId];
  if (p.scouted) return 'Already scouted.';
  if (save.scoutPoints > 0) save.scoutPoints--;
  else if (save.credits >= 1) save.credits--;
  else return 'No scouting reports or credits left.';
  p.scouted = true;
  note(save, 'scout');
  return null;
}
/** What the user sees for an unscouted prospect: each rating blurred by a fixed, per-player error. */
export function scoutedRating(save: Save, p: Player, key: RatingKey): { lo: number; hi: number } {
  const v = p.ratings[key];
  if (p.scouted !== false) return { lo: v, hi: v };
  const lvl = effLevel(save.teams[save.userTeamId].facilities.scouting);
  const spread = 18 - lvl * 3;
  let h = (p.id * 2654435761 + key.charCodeAt(0) * 40503 + key.charCodeAt(1) * 97) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  const off = ((h % 1000) / 1000 - 0.5) * spread;
  const mid = clamp(v + off, 1, 99);
  return { lo: Math.round(clamp(mid - spread / 2, 1, 99)), hi: Math.round(clamp(mid + spread / 2, 1, 99)) };
}

// ---- credits from games --------------------------------------------------------------
export interface CreditLine { label: string; amount: number }
/** `scale` shrinks per-game pay in long seasons; highlight bonuses are always paid in full. */
export function gameCredits(save: Save, result: GameResult, highlights: string[], playoff: boolean, scale = 1): CreditLine[] {
  const me = save.userTeamId;
  const home = result.homeId === me;
  const won = home ? result.homeScore > result.awayScore : result.awayScore > result.homeScore;
  const out: CreditLine[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  out.push(won ? { label: playoff ? 'Playoff win' : 'Win', amount: r2((playoff ? 5 : 3) * scale) } : { label: 'Showed up', amount: r2(scale) });
  if (home) {
    const arena = effLevel(save.teams[me].facilities.arena);
    const gate = r2((save.fans / 100) * (1 + arena) * 0.75 * scale * (1 + 0.25 * perk(save, 'gate')));
    if (gate > 0) out.push({ label: 'Home gate', amount: gate });
  }
  // the team store sells every game, twice as much at home, more when the fans love you
  const store = effLevel(save.teams[me].facilities.store ?? { level: 1, condition: 100 });
  const merch = r2(STORE_PER_GAME[store] * (home ? 1 : 0.5) * (0.6 + save.fans / 125) * scale);
  if (merch > 0) out.push({ label: 'Team store', amount: merch });
  const big = highlights.filter(h => h === 'dunk' || h === 'buzzer' || h === 'andone' || h === 'ankles' || h === 'perfect').length;
  if (big >= 3) out.push({ label: 'Highlight plays', amount: Math.min(3, Math.floor(big / 3)) });
  if (highlights.includes('buzzer')) out.push({ label: 'Buzzer beater', amount: 2 });
  return out;
}
/** One-off payouts. Returns lines for anything newly earned. */
export function checkMilestones(save: Save): CreditLine[] {
  const t = save.teams[save.userTeamId];
  const out: CreditLine[] = [];
  const give = (id: string, label: string, amount: number) => {
    const key = `${save.year}:${id}`;
    if (save.milestones.includes(key)) return;
    save.milestones.push(key);
    out.push({ label, amount });
  };
  const n = save.calendar?.games ?? 14;
  const long = n > 20;
  if (t.record.streak >= (long ? 6 : 4)) give('streak4', `${long ? 6 : 4}-game win streak`, 2);
  if (t.record.streak >= (long ? 10 : 7)) give('streak7', `${long ? 10 : 7}-game win streak`, 4);
  if (t.record.w > n / 2) give('w8', 'Winning season', 3);
  if (t.record.w >= Math.round(n * 0.75)) give('w11', `${Math.round(n * 0.75)} wins`, 4);
  if (save.coach.w === 1 && !save.milestones.includes('firstwin')) { save.milestones.push('firstwin'); out.push({ label: 'First career win', amount: 3 }); }
  for (const n of long ? [100, 250, 500, 1000] : [25, 50, 100, 200]) if (save.coach.w >= n && !save.milestones.includes(`cw${n}`)) { save.milestones.push(`cw${n}`); out.push({ label: `${n} career wins`, amount: 5 }); }
  return out;
}
