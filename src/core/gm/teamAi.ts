import { HARD_LIMIT, MIN_SALARY, ROSTER_MAX, ROSTER_NORMAL } from '../constants';
import { autoLineup } from '../lineup';
import { payroll, signingPath } from '../org/finance';
import { releasePlayer } from '../org/roster';
import { ovr } from '../ratings';
import type { Rng } from '../rng';
import type { Save, Team } from '../types';
import { onRookieDeal } from './draft';
import { aiFillRosters } from './freeAgency';
import { aiDumpSalary } from './trade';
import { CORE_OVR, askingContract, keepCeiling, playerValue, teamStrength, teamSuccess, valueWithContract } from './value';

const aiTeams = (save: Save): Team[] => save.teams.filter(t => t.id !== save.userTeamId);

/** Salary on a team's books that the rules always allow, whatever the payroll: minimum deals and draft picks on their rookie contracts. */
export function exemptSalary(save: Save, team: Team): number {
  let t = 0;
  for (const id of team.roster) {
    const p = save.players[id];
    if (p.contract.years > 0 && (p.contract.salary <= MIN_SALARY || onRookieDeal(save, p))) t += p.contract.salary;
  }
  return Math.round(t * 10) / 10;
}

/** The contract a team would least mind losing among those that count against its limits: worst trade value per dollar. `below` restricts it to players weaker than that overall. */
function worstPaid(save: Save, team: Team, below = 200): number | null {
  let worst: number | null = null, ws = 1e9;
  for (const id of team.roster) {
    const p = save.players[id];
    if (p.contract.years <= 0 || p.contract.salary <= MIN_SALARY || onRookieDeal(save, p) || ovr(p) >= below) continue;
    const s = playerValue(save, p) / p.contract.salary;
    if (s < ws) { ws = s; worst = id; }
  }
  return worst;
}

/** Chance a core player declines to re-sign and tests free agency: the team's best player, and its other stars. */
const STAR_WALKS = [0.1, 0.25];

/** Offseason, before the draft: every AI team decides on players with contract.years === 0: re-sign at askingContract if he is worth it and fits, else release to free agency (no dead cap). A team may pass the cap to keep its own player but never the hard limit, and how far it goes depends on its plan (keepCeiling). Its best players come first: for a core player any team spends up to the hard limit, and moves lesser contracts out to make the room. */
export function aiResignPhase(save: Save, rng: Rng): void {
  for (const team of aiTeams(save)) {
    const expiring = team.roster.filter(id => save.players[id].contract.years <= 0);
    if (!expiring.length) continue;
    let kept = team.roster.length - expiring.length;
    const bestOvr = Math.max(...team.roster.map(id => ovr(save.players[id])));

    const order = expiring
      .map(id => ({ id, v: valueWithContract(save, save.players[id], { salary: 0, years: 1 }) }))
      .sort((a, b) => b.v - a.v);
    for (const { id } of order) {
      const p = save.players[id];
      const o = ovr(p);
      const core = o >= CORE_OVR || o >= bestOvr;
      const ask = askingContract(save, p, team.id);
      const worth = valueWithContract(save, p, { salary: ask.salary, years: ask.years });
      const ceiling = core ? HARD_LIMIT : keepCeiling(team);
      // What the payroll would be with him back, leaving minimum money for every roster spot still to fill.
      const after = () => payroll(save, team) + ask.salary + Math.max(0, ROSTER_NORMAL - kept - 1) * MIN_SALARY;

      let keep = !ask.refuses && (core || kept < ROSTER_MAX) && worth >= (core ? 0 : 4);
      if (keep && !core) {
        if (team.strategy === 'rebuild' && p.age >= 31 && ask.salary > 6) keep = false;
        if (team.strategy === 'contend' && o < 60 && p.age >= 30) keep = false;
        // Some good players test the market anyway.
        if (keep && rng.chance(o >= 75 ? 0.1 : 0.2)) keep = false;
      } else if (keep && rng.chance(o >= bestOvr ? STAR_WALKS[0] : STAR_WALKS[1])) {
        // Now and then even a star wants to see what is out there: that is how one reaches the market.
        keep = false;
      }
      // Clear room for a core player: lesser contracts go to a team with cap space, or are cut.
      let guard = 0;
      while (keep && core && (after() > ceiling || kept >= ROSTER_MAX) && guard++ < 6) {
        const out = worstPaid(save, team, o - 2);
        if (out === null) break;
        if (!aiDumpSalary(save, team.id, out)) releasePlayer(save, out, { deadCap: false });
        kept--;
      }
      if (keep && (after() > ceiling || kept >= ROSTER_MAX)) keep = false;
      if (keep && !signingPath(save, team, ask.salary, { ownPlayer: true, years: ask.years }).ok) keep = false;

      if (keep) {
        p.contract = { salary: ask.salary, years: ask.years };
        kept++;
        if (o >= 80) {
          save.news.unshift({
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

/** Release the least valuable players until the roster is down to `size`. */
function trimTo(save: Save, team: Team, size: number): void {
  let guard = 0;
  while (team.roster.length > size && guard++ < 30) {
    let worst = team.roster[0], wv = 1e9;
    for (const id of team.roster) {
      const v = playerValue(save, save.players[id]);
      if (v < wv) { wv = v; worst = id; }
    }
    releasePlayer(save, worst, { deadCap: false });
  }
}

/** After the draft, before free agency: every AI team clears the end of its bench so it has a roster spot to offer (the rookies it just drafted pushed most of them to the limit). */
export function aiMakeRoom(save: Save): void {
  for (const team of aiTeams(save)) {
    trimTo(save, team, ROSTER_MAX - 1);
    team.lineup = autoLineup(team.roster.map(id => save.players[id]));
  }
}

/** AI roster hygiene, safe to call any week: cut down to ROSTER_MAX; if the payroll is past the hard limit by more than the rules excuse (minimum deals and rookie contracts), move the worst value-per-dollar contracts until it is not (to a team with cap space if one will have him, else released: no dead cap for AI); fill via aiFillRosters; set lineup to autoLineup. Never touches the user's team. */
export function aiMaintainRosters(save: Save, rng: Rng): void {
  for (const team of aiTeams(save)) {
    trimTo(save, team, ROSTER_MAX);
    let guard = 0;
    while (payroll(save, team) - exemptSalary(save, team) > HARD_LIMIT && guard++ < 30) {
      const worst = worstPaid(save, team);
      if (worst === null) break;
      if (!aiDumpSalary(save, team.id, worst)) releasePlayer(save, worst, { deadCap: false });
    }
  }
  aiFillRosters(save, rng);
  for (const team of aiTeams(save)) {
    team.lineup = autoLineup(team.roster.map(id => save.players[id]));
  }
}
