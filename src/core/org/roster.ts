import { DEAD_CAP_RATE } from '../constants';
import { fixLineup } from '../lineup';
import { round1 } from '../ratings';
import type { Contract, Save } from '../types';

/** Put a free agent (or prospect) on a team with a contract. */
export function signPlayer(save: Save, playerId: number, teamId: number, contract: Contract): void {
  const p = save.players[playerId];
  const team = save.teams[teamId];
  save.freeAgents = save.freeAgents.filter(id => id !== playerId);
  p.teamId = teamId;
  p.contract = { salary: round1(contract.salary), years: contract.years };
  p.tenure = 0;
  if (!team.roster.includes(playerId)) team.roster.push(playerId);
  fixLineup(save, team);
}

/** Remove a player from his team into free agency. Dead cap = half a season's salary, charged until the next offseason. Returns it ($M). */
export function releasePlayer(save: Save, playerId: number, opts: { deadCap: boolean }): number {
  const p = save.players[playerId];
  if (p.teamId === null) return 0;
  const team = save.teams[p.teamId];
  let dead = 0;
  if (opts.deadCap) {
    dead = p.contract.years > 0 ? round1(p.contract.salary * DEAD_CAP_RATE) : 0;
    team.deadCap = round1(team.deadCap + dead);
  }
  team.roster = team.roster.filter(id => id !== playerId);
  p.teamId = null;
  p.tenure = 0;
  if (!save.freeAgents.includes(playerId)) save.freeAgents.push(playerId);
  if (save.captainId === playerId) save.captainId = null;
  save.tradeDemands = save.tradeDemands.filter(id => id !== playerId);
  fixLineup(save, team);
  return dead;
}

/** Move a player between teams (trade). Contract carries over. */
export function movePlayer(save: Save, playerId: number, toTeamId: number): void {
  const p = save.players[playerId];
  if (p.teamId !== null) {
    const from = save.teams[p.teamId];
    from.roster = from.roster.filter(id => id !== playerId);
  }
  p.teamId = toTeamId;
  p.tenure = 0;
  save.teams[toTeamId].roster.push(playerId);
  if (save.captainId === playerId) save.captainId = null;
  save.tradeDemands = save.tradeDemands.filter(id => id !== playerId);
}
