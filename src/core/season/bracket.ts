// The playoff bracket as something a screen can draw, and the moments of a playoff run the
// player should be stopped and told about: it begins, you advance, you are out, you are champions.
import { prog } from '../org/progress';
import type { PlayoffSeries, Save, ScheduledGame, Team } from '../types';
import { cal, seriesNeed } from './calendar';
import { standings } from './schedule';

export interface Slot {
  teamId: number | null;
  seed: number | null;
  /** Points in a one-off game, games won in a series; null until played. */
  score: number | null;
  won: boolean;
  /** Shown while the team is not known yet, e.g. "Winner 1 / 4". */
  label: string;
}
export interface Match { round: 1 | 2 | 3; conf: number; a: Slot; b: Slot; decided: boolean }
export interface ConfBracket { conf: number; semis: [Match, Match]; final: Match }
export interface BracketView {
  /** True in the regular season: this is how it would look if the season ended today. */
  projected: boolean;
  confs: [ConfBracket, ConfBracket];
  final: Match;
  championId: number | null;
}

const tbd = (label: string): Slot => ({ teamId: null, seed: null, score: null, won: false, label });
const seedOf = (save: Save, t: Team): number => standings(save, t.conf).indexOf(t) + 1;

function seriesGame(save: Save, s: PlayoffSeries): ScheduledGame | undefined {
  return s.gameId != null ? save.schedule.find(g => g.id === s.gameId) : undefined;
}
function slotOf(save: Save, s: PlayoffSeries, teamId: number): Slot {
  const single = seriesNeed(save, s.round) === 1;
  const g = seriesGame(save, s);
  const score = single ? (g?.played ? (g.homeId === teamId ? g.homeScore ?? null : g.awayScore ?? null) : null) : teamId === s.highId ? s.highW : s.lowW;
  return { teamId, seed: seedOf(save, save.teams[teamId]), score, won: s.winnerId === teamId, label: '' };
}
const matchOf = (save: Save, s: PlayoffSeries): Match =>
  ({ round: s.round, conf: s.conf, a: slotOf(save, s, s.highId), b: slotOf(save, s, s.lowId), decided: s.winnerId !== undefined });

/** The whole bracket: real once the playoffs start, projected from the standings before that. */
export function bracketView(save: Save): BracketView {
  const po = save.playoffs;
  const confs = [0, 1].map(conf => {
    const table = standings(save, conf);
    const seedSlot = (i: number): Slot => ({ teamId: table[i].id, seed: i + 1, score: null, won: false, label: '' });
    const pairs: [number, number][] = [[0, 3], [1, 2]];
    const semis = pairs.map(([hi, lo]) => {
      const s = po?.series.find(x => x.round === 1 && x.conf === conf && x.highId === table[hi].id);
      return s ? matchOf(save, s) : { round: 1 as const, conf, a: seedSlot(hi), b: seedSlot(lo), decided: false };
    }) as [Match, Match];
    const f = po?.series.find(x => x.round === 2 && x.conf === conf);
    const final: Match = f ? matchOf(save, f) : {
      round: 2, conf, decided: false,
      a: semis[0].decided ? { ...(semis[0].a.won ? semis[0].a : semis[0].b), score: null, won: false } : tbd('Winner 1 / 4'),
      b: semis[1].decided ? { ...(semis[1].a.won ? semis[1].a : semis[1].b), score: null, won: false } : tbd('Winner 2 / 3'),
    };
    return { conf, semis, final };
  }) as [ConfBracket, ConfBracket];
  const f = po?.series.find(x => x.round === 3);
  const final: Match = f ? matchOf(save, f) : { round: 3, conf: 2, decided: false, a: tbd('East champion'), b: tbd('West champion') };
  return { projected: !po, confs, final, championId: po?.championId ?? null };
}

// ---- the moments of a playoff run -------------------------------------------------------
export interface Moment {
  /** Stored in the save once shown, so it is shown once. */
  id: string;
  kind: 'begin' | 'missed' | 'advance' | 'out' | 'champion';
  title: string;
  text: string;
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const ROUND = ['', 'Conference Semifinal', 'Conference Final', 'Championship'];
const confName = (c: number): string => (c === 0 ? 'East' : 'West');

/** The playoff news the player has not been shown yet, most important first. Null when there is none. */
export function playoffMoment(save: Save): Moment | null {
  const po = save.playoffs;
  if (!po || save.fired || (save.phase !== 'playoffs' && save.phase !== 'offseason')) return null;
  const seen = prog(save).seen;
  const me = save.teams[save.userTeamId];
  const key = (k: string) => `po${save.year}:${k}`;
  const fresh = (m: Moment): Moment | null => (seen.includes(m.id) ? null : m);
  const mine = po.series.filter(s => s.highId === me.id || s.lowId === me.id).sort((a, b) => a.round - b.round);
  if (!mine.length) {
    if (save.phase !== 'playoffs') return null;
    const table = standings(save, me.conf);
    const pos = table.indexOf(me), gap = table[3].record.w - me.record.w;
    return fresh({ id: key('missed'), kind: 'missed', title: 'NO PLAYOFFS', text: `You finished ${ORD[pos]} in the ${confName(me.conf)}, ${gap <= 0 ? 'losing out on the tiebreak' : `${gap} win${gap === 1 ? '' : 's'} short of 4th`}. The top four go through. You can follow the bracket, or simulate to the offseason.` });
  }
  const oppOf = (s: PlayoffSeries) => save.teams[s.highId === me.id ? s.lowId : s.highId];
  const scoreOf = (s: PlayoffSeries): string => {
    const g = seriesGame(save, s);
    if (seriesNeed(save, s.round) > 1) { const w = s.highId === me.id ? s.highW : s.lowW, l = s.highId === me.id ? s.lowW : s.highW; return `${Math.max(w, l)}-${Math.min(w, l)}`; }
    return g?.played ? `${Math.max(g.homeScore ?? 0, g.awayScore ?? 0)}-${Math.min(g.homeScore ?? 0, g.awayScore ?? 0)}` : '';
  };
  if (po.championId === me.id) {
    return fresh({ id: key('champ'), kind: 'champion', title: 'CHAMPIONS!', text: `The ${me.city} ${me.name} are champions of Season ${save.year}.` });
  }
  const lost = mine.find(s => s.winnerId !== undefined && s.winnerId !== me.id);
  if (lost) {
    const opp = oppOf(lost);
    return fresh({ id: key('out'), kind: 'out', title: lost.round === 3 ? 'SO CLOSE' : 'ELIMINATED', text: `The ${opp.name} beat you ${scoreOf(lost)} in the ${ROUND[lost.round]}. ${lost.round === 3 ? 'The title was right there.' : 'Your season is over.'}` });
  }
  if (save.phase !== 'playoffs') return null;
  const next = mine[mine.length - 1];
  const opp = oppOf(next);
  const g = seriesGame(save, next);
  const where = g ? (g.homeId === me.id ? 'at home to' : 'away at') : 'against';
  const line = `${ROUND[next.round]}: ${where} the ${opp.name}, the ${confName(opp.conf)}'s #${seedOf(save, opp)} seed.`;
  if (next.round === 1) {
    return fresh({ id: key('begin'), kind: 'begin', title: 'THE PLAYOFFS', text: `You are in as the #${seedOf(save, me)} seed in the ${confName(me.conf)}. ${cal(save).seriesWins === 1 ? 'One game decides each round, until the Championship: that is a best of three. ' : ''}${line}` });
  }
  const prev = mine[mine.length - 2];
  return fresh({ id: key(`adv${next.round}`), kind: 'advance', title: next.round === 3 ? 'TO THE CHAMPIONSHIP!' : 'YOU ADVANCE', text: `You beat the ${oppOf(prev).name} ${scoreOf(prev)}. ${line}${next.round === 3 ? ` Best of ${seriesNeed(save, 3) * 2 - 1}: first to ${seriesNeed(save, 3)} wins.` : ''}` });
}
