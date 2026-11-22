// Player badges: a rare player is born with a gift, and earns its badge once the matching rating is high enough.
// A badge is a visible special skill on the court, and a small edge in simulated games.
import { pushNews } from './org/economy';
import type { BadgeId, Player, RatingKey, Save } from './types';

export type Badge = BadgeId;
export interface BadgeInfo { id: Badge; name: string; key: RatingKey; court: string; desc: string }
export const BADGES: Record<Badge, BadgeInfo> = {
  sniper: { id: 'sniper', name: 'Sniper', key: 'sht', court: 'SNIPER', desc: 'His crosshair swings a fifth less on every jump shot and free throw.' },
  posterizer: { id: 'posterizer', name: 'Posterizer', key: 'fin', court: 'POSTERIZER', desc: 'Dunks through contact, finishes more often at the rim, and gets the slam cam far more.' },
  handles: { id: 'handles', name: 'Ankle Breaker', key: 'hnd', court: 'ANKLE BREAKER', desc: 'His crossovers almost always beat the defender, and leave him standing longer.' },
  dimer: { id: 'dimer', name: 'Floor General', key: 'pas', court: 'FLOOR GENERAL', desc: 'Faster passes that are rarely picked off, and the man who catches one gets a longer open look.' },
  lockdown: { id: 'lockdown', name: 'Lockdown', key: 'def', court: 'LOCKDOWN', desc: 'A defender who is hard to shake or fool. When he is on the other team, go at someone else.' },
  glass: { id: 'glass', name: 'Glass Cleaner', key: 'reb', court: 'GLASS CLEANER', desc: 'Wins far more rebounds, which means more putbacks for you.' },
};
const BY_KEY: Partial<Record<RatingKey, Badge>> = { sht: 'sniper', fin: 'posterizer', hnd: 'handles', pas: 'dimer', def: 'lockdown', reb: 'glass' };

/** The rating a gifted player needs to reach before the badge is his. */
export const BADGE_AT = 85;
/** Share of players born with a gift. */
export const GIFT_SHARE = 0.15;
/** Bumped whenever the two numbers above change, so older saves are recounted under the new rule. */
export const BADGE_RULE = 2;
/** What a badge is worth to its rating in simulated games. */
export const BADGE_SIM = 4;

/** A steady 0..1 from the player's id: who has a gift never changes, and no save field or rng is needed. */
function roll(id: number): number {
  let h = Math.imul(id ^ 0x5bd1e995, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** The badge this player could earn: the one for his best skill, if he was born with a gift. Null for most players. */
export function giftOf(p: Player): Badge | null {
  if (roll(p.id) >= GIFT_SHARE) return null;
  let best: RatingKey | null = null;
  for (const k of Object.keys(BY_KEY) as RatingKey[]) if (best === null || p.ratings[k] > p.ratings[best]) best = k;
  return best ? BY_KEY[best]! : null;
}
export const badgeOf = (p: Player): Badge | null => p.badge ?? null;
export const hasBadge = (p: Player, b: Badge): boolean => badgeOf(p) === b;
/** How far a gifted player is from his badge: null when he has it already or has no gift. */
export function badgeProgress(p: Player): { badge: BadgeInfo; now: number; need: number } | null {
  if (badgeOf(p)) return null;
  const g = giftOf(p);
  if (!g) return null;
  return { badge: BADGES[g], now: p.ratings[BADGES[g].key], need: BADGE_AT };
}

/** Hand out badges that have been earned. Once earned, a badge is kept for good. Returns the players who just got one. */
export function refreshBadges(save: Save): Player[] {
  const out: Player[] = [];
  const h = save as Save & { badgeRule?: number };
  if (h.badgeRule !== BADGE_RULE) {
    // a save from before the current rule: everyone is judged again from scratch
    for (const id in save.players) delete save.players[id].badge;
    h.badgeRule = BADGE_RULE;
  }
  for (const id in save.players) {
    const p = save.players[id];
    if (p.badge || p.retired) continue;
    const g = giftOf(p);
    if (g && p.ratings[BADGES[g].key] >= BADGE_AT) { p.badge = g; out.push(p); }
  }
  return out;
}
/** The player as a simulated game sees him: a badge lifts its own rating a little. */
export function withBadge(p: Player): Player {
  const b = badgeOf(p);
  if (!b) return p;
  const k = BADGES[b].key;
  return { ...p, ratings: { ...p.ratings, [k]: Math.min(99, p.ratings[k] + BADGE_SIM) } };
}

/** Hand out newly earned badges, and tell the user about his own players'. */
export function announceBadges(save: Save): Player[] {
  const earned = refreshBadges(save);
  for (const p of earned) {
    if (p.teamId !== save.userTeamId) continue;
    const b = BADGES[p.badge!];
    pushNews(save, 'team', `${p.name} has earned the ${b.name} badge. ${b.desc}`, true);
  }
  return earned;
}
