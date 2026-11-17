// The chores of running a club, and an assistant who can do them for you: maintenance,
// spending level-up points, a healthy starting five, scouting reports.
import { autoLineup } from '../lineup';
import { POS_WEIGHTS, ovr } from '../ratings';
import type { Player, RatingKey, Save } from '../types';
import { FACILITY_KEYS, RATING_KEYS } from '../types';
import { FACILITY_INFO, repairCost, repairFacility, scoutProspect } from './economy';
import { isUnlocked } from './progress';
import { POINT_GAIN, atCeiling, pointsOf, readyToLevel, spendPoint } from './xp';

/** The rating that helps him most right now: weighted by his position, cheaper where he is weaker. */
export function bestRatingFor(p: Player): RatingKey {
  const w = POS_WEIGHTS[p.pos];
  let best: RatingKey = 'sht', score = -1;
  for (const k of RATING_KEYS) {
    if (p.ratings[k] > 99 - POINT_GAIN) continue;
    // a point is worth more where the position leans, and a little more where he is still raw
    const s = w[k] * (1 + (90 - p.ratings[k]) / 120);
    if (s > score) { score = s; best = k; }
  }
  return best;
}
/** Spend all of one player's level-up points the way the assistant would. Returns what went up. */
export function autoSpend(save: Save, playerId: number): RatingKey[] {
  const p = save.players[playerId];
  const out: RatingKey[] = [];
  for (let i = 0; i < 20 && p && pointsOf(p) > 0 && !atCeiling(p); i++) {
    const k = bestRatingFor(p);
    if (spendPoint(save, playerId, k)) break;
    out.push(k);
  }
  return out;
}

export interface Chore { id: 'repair' | 'level' | 'lineup' | 'scout'; text: string; cost: number }
const facilitiesToFix = (save: Save) => FACILITY_KEYS.filter(k => repairCost(save.teams[save.userTeamId].facilities[k]) > 0 && save.teams[save.userTeamId].facilities[k].condition < 75);
const hurtStarters = (save: Save) => save.teams[save.userTeamId].lineup.filter(id => save.players[id]?.injury).length;
const unscouted = (save: Save) => save.draftClass.map(id => save.players[id]).filter(p => p && p.scouted === false);

/** The jobs waiting right now, each one tap. */
export function choresList(save: Save): Chore[] {
  if (save.phase === 'offseason') return [];
  const out: Chore[] = [];
  const fix = facilitiesToFix(save);
  if (fix.length && isUnlocked(save, 'facilities')) {
    const cost = fix.reduce((s, k) => s + repairCost(save.teams[save.userTeamId].facilities[k]), 0);
    out.push({ id: 'repair', text: fix.length === 1 ? `Maintain the ${FACILITY_INFO[fix[0]].name}` : `Maintain ${fix.length} facilities`, cost });
  }
  const lv = readyToLevel(save);
  if (lv.length) out.push({ id: 'level', text: lv.length === 1 ? `Spend ${lv[0].name}'s level-up` : `Spend level-ups for ${lv.length} players`, cost: 0 });
  const hurt = hurtStarters(save);
  if (hurt) out.push({ id: 'lineup', text: `Replace ${hurt} injured starter${hurt === 1 ? '' : 's'}`, cost: 0 });
  if (save.scoutPoints > 0 && isUnlocked(save, 'scouting') && unscouted(save).length) out.push({ id: 'scout', text: `Use ${Math.min(save.scoutPoints, unscouted(save).length)} scouting report${save.scoutPoints === 1 ? '' : 's'}`, cost: 0 });
  return out;
}

/** Do one chore, or all of them. Returns a line per thing done. */
export function doChores(save: Save, only?: Chore['id']): string[] {
  const me = save.teams[save.userTeamId];
  const out: string[] = [];
  const want = (id: Chore['id']) => !only || only === id;
  if (want('repair') && isUnlocked(save, 'facilities')) {
    // worst first, while the credits last
    const fix = facilitiesToFix(save).sort((a, b) => me.facilities[a].condition - me.facilities[b].condition);
    for (const k of fix) if (!repairFacility(save, k)) out.push(`${FACILITY_INFO[k].name} maintained`);
  }
  if (want('level')) {
    for (const p of readyToLevel(save)) {
      const ks = autoSpend(save, p.id);
      if (ks.length) out.push(`${p.name}: ${ks.map(k => k.toUpperCase()).join(', ')} up`);
    }
  }
  if (want('lineup') && hurtStarters(save)) {
    me.lineup = autoLineup(me.roster.map(id => save.players[id]));
    out.push('Healthy starting five set');
  }
  if (want('scout') && isUnlocked(save, 'scouting')) {
    // the prospects who look best on paper first
    const est = (p: Player) => ovr(p) + (p.potential - ovr(p)) * 0.5;
    const pool = unscouted(save).sort((a, b) => est(b) - est(a));
    let n = 0;
    for (const p of pool) { if (save.scoutPoints <= 0) break; if (!scoutProspect(save, p.id)) n++; }
    if (n) out.push(`${n} prospect${n === 1 ? '' : 's'} scouted`);
  }
  return out;
}
