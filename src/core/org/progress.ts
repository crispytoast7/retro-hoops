// Coach progression: levels, perks, trophies, unlockable court styles.
import type { Save } from '../types';

/** Multiplier on what the user's own players ask for when re-signing (perk: Negotiator). */
export const resignDiscount = (_save: Save): number => 1;
