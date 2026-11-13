import { MIN_SALARY, ROSTER_MAX, ROSTER_NORMAL, SALARY_CAP } from '../constants';
import { autoLineup } from '../lineup';
import { payroll } from '../org/finance';
import { releasePlayer } from '../org/roster';
import { ovr } from '../ratings';
import type { Rng } from '../rng';
import type { Save, Team } from '../types';
import { aiFillRosters, worstContract } from './freeAgency';
import { askingContract, playerValue, teamStrength, teamSuccess, valueWithContract } from './value';

const aiTeams = (save: Save): Team[] => save.teams.filter(t => t.id !== save.userTeamId);

/** Offseason, before the draft: every AI team decides on players with contract.years === 0: re-sign at askingContract if he is worth it and fits the cap/plan, else release to free agency (no dead cap). */
export function aiResignPhase(save: Save, rng: Rng): void {
  for (const team of aiTeams(save)) {
    const expiring = team.roster.filter(id => save.players[id].contract.years <= 0);
    if (!expiring.length) continue;
    // Money already committed for next season.
    let committed = team.deadCap;
    for (const id of team.roster) {
      const p = save.players[id];
      if (p.contract.years > 0) committed += p.contract.salary;
    }
    let kept = team.roster.length - expiring.length;
    const bestOvr = Math.max(...team.roster.map(id => ovr(save.players[id])));

    const order = expiring
      .map(id => ({ id, v: valueWithContract(save, save.players[id], { salary: 0, years: 1 }) }))
      .sort((a, b) => b.v - a.v);
    for (const { id } of order) {
      const p = save.players[id];
      const o = ovr(p);
      const ask = askingContract(save, p, team.id);
      const worth = valueWithContract(save, p, { salary: ask.salary, years: ask.years });
      // Leave minimum money for every roster spot still to fill.
      const reserve = Math.max(0, ROSTER_NORMAL - kept - 1) * MIN_SALARY;
      const fits = committed + ask.salary + reserve <= SALARY_CAP;

      let keep = !ask.refuses && fits && worth >= 4 && kept < ROSTER_MAX;
      if (keep && team.strategy === 'rebuild' && p.age >= 31 && ask.salary > 3) keep = false;
      if (keep && team.strategy === 'contend' && o < 60 && p.age >= 30) keep = false;
      // Some good players test the market anyway; the franchise player does not.
      if (keep && o < bestOvr && rng.chance(o >= 75 ? 0.1 : 0.2)) keep = false;

      if (keep) {
        p.contract = { salary: ask.salary, years: ask.years };
        committed += ask.salary;
        kept++;
        if (o >= 80) {
          save.news.push({
            year: save.year, week: save.week, kind: 'signing',
            text: `${p.name} re-signs with ${team.city} (${ask.years} yr${ask.years === 1 ? '' : 's'}, $${ask.salary}M).`,
          });
        }
      } else {
        releasePlayer(save, id, { deadCap: false });
      }
    }
  }
}

/** Set each AI team's strategy from roster age/quality and last record. */
export function updateStrategies(save: Save): void {
  const ranked = save.teams
    .map(t => ({ id: t.id, q: teamStrength(save, t) + (teamSuccess(t) - 0.5) * 6 }))
    .sort((a, b) => b.q - a.q || a.id - b.id);
  const n = ranked.length;
  ranked.forEach((r, rank) => {
    if (r.id === save.userTeamId) return;
    const team = save.teams[r.id];
    const core = team.roster
      .map(id => save.players[id])
      .sort((a, b) => ovr(b) - ovr(a))
      .slice(0, 6);
    const coreAge = core.length ? core.reduce((s, p) => s + p.age, 0) / core.length : 27;
    const frac = n > 1 ? rank / (n - 1) : 0.5; // 0 best, 1 worst
    let strategy: Team['strategy'] = 'middle';
    if (frac <= 0.3 || (frac <= 0.45 && coreAge >= 28.5)) strategy = 'contend';
    else if (frac >= 0.72 || (frac >= 0.58 && coreAge >= 29.5)) strategy = 'rebuild';
    team.strategy = strategy;
  });
}

/** AI roster hygiene, safe to call any week: cut down to ROSTER_MAX, shed salary if over the cap (release worst value-per-dollar, no dead cap for AI), fill via aiFillRosters, set lineup to autoLineup. Never touches the user's team. */
export function aiMaintainRosters(save: Save, rng: Rng): void {
  for (const team of aiTeams(save)) {
    let guard = 0;
    while (team.roster.length > ROSTER_MAX && guard++ < 30) {
      let worst = team.roster[0], wv = 1e9;
      for (const id of team.roster) {
        const v = playerValue(save, save.players[id]);
        if (v < wv) { wv = v; worst = id; }
      }
      releasePlayer(save, worst, { deadCap: false });
    }
    guard = 0;
    while (payroll(save, team) > SALARY_CAP && guard++ < 30) {
      const worst = worstContract(save, team);
      if (worst === null) break;
      releasePlayer(save, worst, { deadCap: false });
    }
  }
  aiFillRosters(save, rng);
  for (const team of aiTeams(save)) {
    team.lineup = autoLineup(team.roster.map(id => save.players[id]));
  }
}
