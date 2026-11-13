// Credits, facilities, staff, rating upgrades, scouting.
import { clamp, starLevel } from '../ratings';
import type { Rng } from '../rng';
import type { Facility, FacilityKey, GameResult, Player, RatingKey, Save, StaffMember, Team } from '../types';
import { FACILITY_KEYS } from '../types';
import { NEWS } from '../../data/news';

export function pushNews(save: Save, kind: Save['news'][number]['kind'], text: string, mine = false): void {
  save.news.unshift({ year: save.year, week: save.week, kind, text, mine });
  if (save.news.length > 120) save.news.length = 120;
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
  scouting: { name: 'Scouting Office', desc: 'Better draft info and free-agent interest.', perks: ['3 scouting reports a season', '6 reports, tighter rating estimates', '9 reports, free agents take notice', '12 reports, sharp estimates', '15 reports, nothing stays hidden'] },
};
/** Cost in credits to reach level L from L-1. */
export const FACILITY_COST = [0, 0, 8, 14, 22, 32];
/** Level that actually applies: run-down buildings (condition < 50) act one level lower. */
export const effLevel = (f: Facility): number => Math.max(1, f.level - (f.condition < 50 ? 1 : 0));
export const repairCost = (f: Facility): number => (f.condition >= 95 ? 0 : 1 + f.level);

export function upgradeFacility(save: Save, key: FacilityKey): string | null {
  const f = save.teams[save.userTeamId].facilities[key];
  const next = (f.pending ?? f.level) + 1;
  if (f.pending) return 'An upgrade is already under way.';
  if (next > 5) return 'Already at the top level.';
  const cost = FACILITY_COST[next];
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  f.pending = next;
  return null;
}
export function repairFacility(save: Save, key: FacilityKey): string | null {
  const f = save.teams[save.userTeamId].facilities[key];
  const cost = repairCost(f);
  if (cost === 0) return 'Already in good shape.';
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  f.condition = 100;
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
export function upgradeCost(save: Save, p: Player, key: RatingKey): number {
  const base = [0, 2, 3, 5, 8, 12][starLevel(p.ratings[key])];
  const training = effLevel(save.teams[save.userTeamId].facilities.training);
  let c = base * (training >= 4 ? 0.8 : 1);
  if (save.phase === 'offseason' && save.offseason?.step === 'camp') c *= 0.75;
  return Math.max(1, Math.round(c));
}
export function upgradeRating(save: Save, playerId: number, key: RatingKey): string | null {
  const p = save.players[playerId];
  if (p.ratings[key] >= 99) return 'Already maxed out.';
  const cost = upgradeCost(save, p, key);
  if (save.credits < cost) return `Needs ${cost} credits.`;
  save.credits -= cost;
  p.ratings[key] = clamp(p.ratings[key] + UPGRADE_POINTS, 1, 99);
  if (save.offseason) save.offseason.campSpent += cost;
  return null;
}

// ---- scouting ------------------------------------------------------------------------
export const scoutPointsPerSeason = (save: Save): number => effLevel(save.teams[save.userTeamId].facilities.scouting) * 3;
export function scoutProspect(save: Save, playerId: number): string | null {
  const p = save.players[playerId];
  if (p.scouted) return 'Already scouted.';
  if (save.scoutPoints > 0) save.scoutPoints--;
  else if (save.credits >= 1) save.credits--;
  else return 'No scouting reports or credits left.';
  p.scouted = true;
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
export function gameCredits(save: Save, result: GameResult, highlights: string[], playoff: boolean): CreditLine[] {
  const me = save.userTeamId;
  const home = result.homeId === me;
  const won = home ? result.homeScore > result.awayScore : result.awayScore > result.homeScore;
  const out: CreditLine[] = [];
  out.push(won ? { label: playoff ? 'Playoff win' : 'Win', amount: playoff ? 5 : 3 } : { label: 'Showed up', amount: 1 });
  if (home) {
    const arena = effLevel(save.teams[me].facilities.arena);
    const gate = Math.round((save.fans / 100) * (1 + arena) * 0.75);
    if (gate > 0) out.push({ label: 'Home gate', amount: gate });
  }
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
  if (t.record.streak >= 4) give('streak4', '4-game win streak', 2);
  if (t.record.streak >= 7) give('streak7', '7-game win streak', 4);
  if (t.record.w >= 8) give('w8', 'Winning season', 3);
  if (t.record.w >= 11) give('w11', '11 wins', 4);
  if (save.coach.w === 1 && !save.milestones.includes('firstwin')) { save.milestones.push('firstwin'); out.push({ label: 'First career win', amount: 3 }); }
  for (const n of [25, 50, 100, 200]) if (save.coach.w >= n && !save.milestones.includes(`cw${n}`)) { save.milestones.push(`cw${n}`); out.push({ label: `${n} career wins`, amount: 5 }); }
  return out;
}
