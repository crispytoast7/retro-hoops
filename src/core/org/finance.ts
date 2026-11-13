import { SALARY_CAP } from '../constants';
import { round1 } from '../ratings';
import type { Save, Team } from '../types';

export function payroll(save: Save, team: Team): number {
  let t = team.deadCap;
  // a deal with no years left has expired (offseason) and is off the books
  for (const id of team.roster) { const c = save.players[id].contract; if (c.years > 0) t += c.salary; }
  return round1(t);
}
export const capSpace = (save: Save, team: Team): number => round1(SALARY_CAP - payroll(save, team));
export const teamById = (save: Save, id: number): Team => save.teams[id];
export const userTeam = (save: Save): Team => save.teams[save.userTeamId];
