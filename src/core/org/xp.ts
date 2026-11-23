// Player experience: your players earn XP in games and level up; you choose what improves.
import { clamp, gameScore, ovr, raiseRating } from '../ratings';
import type { BoxLine, Player, RatingKey, Save } from '../types';
import { effLevel } from './economy';
import { note } from './progress';

/** Rating points gained per level-up point spent. */
export const POINT_GAIN = 3;
/** Overall at which a player counts as a star. */
export const STAR_OVR = 80;
export const isStar = (p: Player): boolean => ovr(p) >= STAR_OVR;

type Xp = Player & { xp?: number; lvl?: number; pts?: number };
export const levelOfPlayer = (p: Player): number => (p as Xp).lvl ?? 1;
export const xpOfPlayer = (p: Player): number => Math.floor((p as Xp).xp ?? 0);
export const pointsOf = (p: Player): number => (p as Xp).pts ?? 0;
/** XP needed to go from this level to the next. */
export const xpNeed = (lvl: number): number => 50 + lvl * 20;
/** A player can only be trained up to his ceiling. */
export const atCeiling = (p: Player): boolean => ovr(p) >= p.potential;

/** Add XP; returns how many levels he gained. A maxed-out player turns level-ups into credits. */
export function grantXp(save: Save, p: Player, amount: number): number {
  const x = p as Xp;
  x.xp = (x.xp ?? 0) + amount;
  x.lvl = x.lvl ?? 1;
  let gained = 0;
  while (x.xp >= xpNeed(x.lvl)) {
    x.xp -= xpNeed(x.lvl);
    x.lvl++;
    gained++;
    if (atCeiling(p)) save.credits += 1; else x.pts = (x.pts ?? 0) + 1;
  }
  return gained;
}

/** XP for the user's players from one game. A better Training Center means more of it. */
export function gameXp(save: Save, lines: BoxLine[], scale: number): number[] {
  const training = effLevel(save.teams[save.userTeamId].facilities.training);
  const leveled: number[] = [];
  for (const l of lines) {
    const p = save.players[l.playerId];
    if (!p || l.min <= 0) continue;
    const base = 4 + l.min * 0.25 + Math.max(0, gameScore(l)) * 0.9;
    if (grantXp(save, p, base * scale * (1 + 0.12 * (training - 1))) > 0) leveled.push(p.id);
  }
  return leveled;
}

/** Spend one level-up point on a rating. */
export function spendPoint(save: Save, playerId: number, key: RatingKey): string | null {
  const p = save.players[playerId] as Xp;
  if (!p || (p.pts ?? 0) <= 0) return 'No level-up points. He earns them by playing.';
  if (p.ratings[key] >= 99) return 'Already maxed out.';
  if (atCeiling(p)) return 'He has reached his ceiling.';
  p.pts = (p.pts ?? 0) - 1;
  raiseRating(p, key, POINT_GAIN);
  note(save, 'train');
  return null;
}
/** Players on the user's team with points waiting to be spent. */
export const readyToLevel = (save: Save): Player[] =>
  save.teams[save.userTeamId].roster.map(id => save.players[id]).filter(p => pointsOf(p) > 0 && !atCeiling(p));

// ---- the choice after every game ------------------------------------------------------
export type AfterGame = 'team' | 'fans' | 'work';
export const AFTER_GAME: Record<'won' | 'lost', Record<AfterGame, { label: string; effect: string }>> = {
  won: {
    team: { label: 'Praise the players', effect: 'Team morale up' },
    fans: { label: 'Salute the fans', effect: 'Fan support up' },
    work: { label: 'Straight back to work', effect: 'Starters gain XP, morale dips' },
  },
  lost: {
    team: { label: 'Back your players', effect: 'Morale up, owner less impressed' },
    fans: { label: 'Apologise to the fans', effect: 'Fan support up, morale dips' },
    work: { label: 'Call extra practice', effect: 'Starters gain XP, morale down' },
  },
};
export function afterGameChoice(save: Save, choice: AfterGame, won: boolean): void {
  const team = save.teams[save.userTeamId];
  const morale = (v: number) => { for (const id of team.roster) { const p = save.players[id]; p.morale = clamp(p.morale + v, 0, 100); } };
  if (choice === 'team') { morale(won ? 3 : 2); if (!won) save.owner.approval = clamp(save.owner.approval - 1, 0, 100); }
  else if (choice === 'fans') { save.fans = clamp(save.fans + (won ? 3 : 2), 0, 100); if (!won) morale(-1); }
  else { morale(won ? -1 : -2); for (const id of team.lineup) { const p = save.players[id]; if (p) grantXp(save, p, won ? 12 : 15); } }
}
