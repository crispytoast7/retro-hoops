// The greatest of all time, according to whoever has a microphone. A couple of times a season a
// reporter publishes an all-time top ten, and each one has an angle.
import { careerStats, clamp, gameScore, ovr } from '../ratings';
import { Rng } from '../rng';
import type { Player, Save } from '../types';
import { pushNews } from './economy';

export interface GoatRow { playerId: number; name: string; team: string; note: string }
export interface GoatList { by: string; outlet: string; motto: string; rows: GoatRow[] }

interface Reporter { name: string; outlet: string; motto: string; top: string; quips: string[]; score: (f: Facts) => number; wild?: boolean }
interface Facts { p: Player; gp: number; pts: number; reb: number; ast: number; stocks: number; mvp: number; fmvp: number; allL: number; other: number; rings: number; peak: number; seasons: number; season: number; age: number; hof: boolean; ts: number; impact: number }

const count = (p: Player, prefix: string) => p.awards.filter(a => a.startsWith(prefix)).length;
function facts(save: Save, p: Player): Facts {
  const c = careerStats(p);
  const rings = p.seasons.filter(s => save.teams[s.teamId]?.titles.includes(s.year)).length;
  const mvp = count(p, 'MVP ('), fmvp = count(p, 'Finals MVP'), allL = count(p, 'All-League');
  const tsa = c.fga + 0.44 * c.fta;
  return {
    p, gp: c.gp, pts: c.pts, reb: c.orb + c.drb, ast: c.ast, stocks: c.stl + c.blk,
    mvp, fmvp, allL, other: p.awards.length - mvp - fmvp - allL, rings,
    peak: Math.max(ovr(p), ...p.seasons.map(s => s.ovr)), seasons: p.seasons.length + (p.season.gp ? 1 : 0),
    season: gameScore(p.season), age: p.age, hof: save.hallOfFame.some(h => h.playerId === p.id),
    ts: tsa > 0 ? c.pts / (2 * tsa) : 0, impact: c.gp ? gameScore(c) / c.gp : 0,
  };
}
/** What most people would call a career. */
const classic = (f: Facts) => f.pts + 0.9 * f.reb + 1.2 * f.ast + 1.5 * f.stocks + 450 * f.mvp + 300 * f.fmvp + 120 * f.allL + 80 * f.other + 250 * f.rings + Math.max(0, f.peak - 60) * 12;

const REPORTERS: Reporter[] = [
  { name: 'Dale Brickley', outlet: 'The Courier', motto: 'Rings first. Everything else is a footnote.', top: 'Not close.', quips: ['Plays the right way.', 'Old school. I love it.', 'Winner. Ask anyone.', 'Tough as nails.', 'Shows up in big games.'],
    score: f => (classic(f) + 600 * f.rings + 400 * f.fmvp) * (f.age <= 24 ? 0.85 : 1) },
  { name: 'Kiki Novak', outlet: 'Box Score Weekly', motto: 'I trust the numbers, not the narrative.', top: 'The numbers do not lie.', quips: ['Elite efficiency.', 'Underrated by the eye test.', 'The on-off splits are absurd.', 'Quietly historic.', 'Look it up.'],
    score: f => f.impact * 40 * clamp(f.gp / 28, 0, 1) + (f.ts - 0.52) * 2500 + 0.35 * classic(f) },
  { name: 'Marcus Ferris', outlet: 'Hot Take Radio', motto: 'Recency bias? Never heard of her.', top: 'Fight me.', quips: ['He is HIM.', 'Different breed.', 'Nobody wants to guard him.', 'Top 3 by next year. Book it.', 'I said what I said.'], wild: true,
    score: f => classic(f) + 30 * f.season + (f.p.retired ? -400 : 0) },
];

function note(save: Save, f: Facts, r: Reporter, rank: number): string {
  const bits: string[] = [];
  if (f.rings) bits.push(`${f.rings} ring${f.rings === 1 ? '' : 's'}`);
  if (f.mvp) bits.push(`MVP x${f.mvp}`);
  if (f.fmvp) bits.push(`Finals MVP x${f.fmvp}`);
  if (f.gp) bits.push(`${(f.pts / f.gp).toFixed(1)} ppg`);
  if (r.name === 'Kiki Novak' && f.ts) bits.push(`${Math.round(f.ts * 1000) / 10}% true shooting`);
  if (f.hof) bits.push('Hall of Famer');
  let s = bits.slice(0, 3).join(', ');
  if (rank === 0) s += `. ${r.top}`;
  // thin résumé: the reporter fills the gap with an opinion
  else if (bits.length < 3) s += `. ${r.quips[(f.p.id + rank) % r.quips.length]}`;
  return s;
}

/** Publish a reporter's all-time top ten. Picks the reporter by rotation. */
export function publishGoatList(save: Save, when: 'midseason' | 'summer'): GoatList | null {
  const pool = Object.values(save.players).map(p => facts(save, p)).filter(f => f.gp >= 10);
  if (pool.length < 12) return null;
  const n = (save.year * 2 + (when === 'summer' ? 1 : 0)) % REPORTERS.length;
  const r = REPORTERS[n];
  const ranked = pool.map(f => ({ f, s: r.score(f) })).sort((a, b) => b.s - a.s).map(x => x.f);
  const top = ranked.slice(0, 10);
  if (r.wild && ranked.length > 30) {
    // the hot take: someone nobody else would put anywhere near this list
    const rng = new Rng((save.year * 7919 + (when === 'summer' ? 13 : 0)) >>> 0);
    top.splice(rng.int(5, 8), 0, ranked[rng.int(25, Math.min(60, ranked.length - 1))]);
    top.length = 10;
  }
  const rows: GoatRow[] = top.map((f, i) => {
    const t = f.p.teamId !== null ? save.teams[f.p.teamId] : null;
    const wild = r.wild && !ranked.slice(0, 12).includes(f);
    return { playerId: f.p.id, name: f.p.name, team: t ? t.abbr : f.p.retired ? 'Retired' : 'Free agent', note: wild ? 'Trust me on this one.' : note(save, f, r, i) };
  });
  const list: GoatList = { by: r.name, outlet: r.outlet, motto: r.motto, rows };
  const mineAt = rows.findIndex(x => save.players[x.playerId].teamId === save.userTeamId);
  const lead = rows.slice(0, 3).map((x, i) => `${i + 1}. ${x.name}`).join(', ');
  const text = `${r.name} (${r.outlet}) ranks the all-time top 10: ${lead}...${mineAt >= 0 ? ` Your ${rows[mineAt].name} is #${mineAt + 1}.` : ''}`;
  pushNews(save, 'league', text, mineAt >= 0);
  (save.news[0] as typeof save.news[0] & { list?: GoatList }).list = list;
  return list;
}
