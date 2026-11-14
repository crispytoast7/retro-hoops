import type { Calendar, Save } from '../types';

export const CALENDARS: Record<'classic' | 'full', Calendar> = {
  /** One game a week, single-game playoffs. */
  classic: { games: 14, perWeek: 1, regWeeks: 14, deadlineWeek: 7, seriesWins: 1 },
  /** 82 games, four a week (two in the last week), best-of-seven playoffs. */
  full: { games: 82, perWeek: 4, regWeeks: 21, deadlineWeek: 13, seriesWins: 4 },
};
export const cal = (save: Save): Calendar => save.calendar ?? CALENDARS.classic;
/** Multiplier for per-game effects so a long season moves meters and credits like a short one. */
export const perGame = (save: Save): number => 14 / cal(save).games;
export const ROUND_NAMES = ['', 'Conference Semifinals', 'Conference Finals', 'Championship'];
export const playoffRound = (save: Save): number => save.week - cal(save).regWeeks;
