// A challenge you pick before each game: a goal of your own, with a reward.
import { clamp, ovr } from '../ratings';
import { Rng } from '../rng';
import type { GameResult, Save } from '../types';
import { grantXp } from './xp';

export interface Objective {
  kind: 'win10' | 'threes' | 'dunks' | 'perfect' | 'feed' | 'star' | 'hold' | 'clean' | 'oop';
  text: string;
  reward: string;
  n: number;
  playerId?: number;
}
export interface ObjectiveResult { text: string; reward: string; done: boolean }

const short = (name: string): string => { const i = name.indexOf(' '); return i < 0 ? name : `${name[0]}. ${name.slice(i + 1)}`; };

/** Three challenges for a game. The same game always offers the same three. */
export function offerObjectives(save: Save, gameId: number): Objective[] {
  const rng = new Rng((gameId * 7919 + save.year * 104729) >>> 0);
  const me = save.teams[save.userTeamId];
  const ps = me.lineup.map(id => save.players[id]).filter(Boolean);
  const star = ps.slice().sort((a, b) => ovr(b) - ovr(a))[0];
  const young = me.roster.map(id => save.players[id]).filter(p => p.age <= 23 && !p.injury).sort((a, b) => b.potential - a.potential)[0];
  const full = (save.calendar?.games ?? 14) > 0; // scores are NBA-sized
  const pool: Objective[] = [
    { kind: 'win10', text: 'Win by 10 or more', reward: '+4 credits', n: 10 },
    { kind: 'threes', text: 'Make 3 threes yourself', reward: '+3 credits', n: 3 },
    { kind: 'dunks', text: 'Throw down 2 dunks yourself', reward: 'Fans +5', n: 2 },
    { kind: 'perfect', text: 'Hit 4 dead-centre shots', reward: '+3 credits', n: 4 },
    { kind: 'hold', text: `Hold them under ${full ? 105 : 50} points`, reward: 'Owner +4', n: full ? 105 : 50 },
    { kind: 'clean', text: 'No turnovers in your key moments', reward: '+3 credits', n: 0 },
    { kind: 'oop', text: 'Finish an alley-oop', reward: 'Fans +4, +1 credit', n: 1 },
  ];
  if (star) pool.push({ kind: 'star', text: `${short(star.name)} scores 28 or more`, reward: 'His morale +8, +2 credits', n: 28, playerId: star.id });
  if (young && young.id !== star?.id) pool.push({ kind: 'feed', text: `Get ${short(young.name)} 14 points or more`, reward: 'He gains 60 XP', n: 14, playerId: young.id });
  return rng.shuffle(pool).slice(0, 3);
}

/** Check the chosen challenge against the finished game and pay out. */
export function settleObjective(save: Save, o: Objective, result: GameResult, highlights: string[]): ObjectiveResult {
  const home = result.homeId === save.userTeamId;
  const mine = home ? result.homeScore : result.awayScore, theirs = home ? result.awayScore : result.homeScore;
  const lines = home ? result.box.home : result.box.away;
  const count = (h: string) => highlights.filter(x => x === h).length;
  const ptsOf = (id?: number) => lines.find(l => l.playerId === id)?.pts ?? 0;
  let done = false;
  switch (o.kind) {
    case 'win10': done = mine - theirs >= o.n; break;
    case 'threes': done = count('three') >= o.n; break;
    case 'dunks': done = count('dunk') >= o.n; break;
    case 'perfect': done = count('perfect') >= o.n; break;
    case 'hold': done = theirs < o.n; break;
    case 'clean': done = highlights.includes('played') && count('tov') === 0; break;
    case 'oop': done = count('oop') >= 1; break;
    case 'star': case 'feed': done = ptsOf(o.playerId) >= o.n; break;
  }
  if (done) {
    const p = o.playerId != null ? save.players[o.playerId] : undefined;
    switch (o.kind) {
      case 'win10': save.credits += 4; break;
      case 'threes': case 'perfect': case 'clean': save.credits += 3; break;
      case 'dunks': save.fans = clamp(save.fans + 5, 0, 100); break;
      case 'hold': save.owner.approval = clamp(save.owner.approval + 4, 0, 100); break;
      case 'oop': save.fans = clamp(save.fans + 4, 0, 100); save.credits += 1; break;
      case 'star': if (p) p.morale = clamp(p.morale + 8, 0, 100); save.credits += 2; break;
      case 'feed': if (p) grantXp(save, p, 60); break;
    }
  }
  return { text: o.text, reward: o.reward, done };
}
