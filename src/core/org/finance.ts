import { SALARY_CAP } from '../constants';
import { round1 } from '../ratings';
import type { Save, Team } from '../types';

export function payroll(save: Save, team: Team): number {
  let t = team.deadCap;
  for (const id of team.roster) t += save.players[id].contract.salary;
  return round1(t);
}
export const capSpace = (save: Save, team: Team): number => round1(SALARY_CAP - payroll(save, team));
export const teamById = (save: Save, id: number): Team => save.teams[id];
export const userTeam = (save: Save): Team => save.teams[save.userTeamId];
