// A trade at a glance: who goes, who comes back, and what it does to your best five.
import { autoLineup } from '../core/lineup';
import { ovr, stars } from '../core/ratings';
import { ceilingView } from '../core/org/economy';
import { teamRatings } from '../core/sim/team';
import type { DraftPick, Player, Save } from '../core/types';
import { Stars, short, teamStarCount } from './kit';

export interface TradeSides { give: { players: number[]; picks: DraftPick[] }; get: { players: number[]; picks: DraftPick[] } }

const pickText = (save: Save, pk: DraftPick): string =>
  `${pk.round === 1 ? '1st' : '2nd'}-round pick, S${pk.year}${pk.origTeamId !== save.userTeamId ? ` (${save.teams[pk.origTeamId]?.abbr ?? '?'})` : ''}`;

function Side({ save, title, players, picks }: { save: Save; title: string; players: Player[]; picks: DraftPick[] }) {
  return (
    <div class="tc-side">
      <div class="head dim">{title}</div>
      {players.map(p => (
        <div class="tc-p">
          <div class="row" style={{ gap: '4px' }}><span class="tag pos">{p.pos}</span><span class="nowrap">{short(p.name)}</span></div>
          <div class="row" style={{ gap: '6px', fontSize: '16px' }}><Stars v={ovr(p)} /><span class="dim">{p.age}y · {p.contract.years}yr</span></div>
        </div>
      ))}
      {picks.map(pk => <div class="tc-p dim" style={{ fontSize: '17px' }}>{pickText(save, pk)}</div>)}
      {!players.length && !picks.length && <div class="dim">Nothing</div>}
    </div>
  );
}

/** A young player's ceiling, in a word: exact if known, a range if not. */
export function CeilTag({ save, p }: { save: Save; p: Player }) {
  const cv = ceilingView(save, p);
  const st = (v: number) => stars(v).toString().replace('.5', '½');
  return <span class={`tag ${cv.known ? 'good' : ''}`} title="How good he could become">CEIL {cv.known ? `${st(cv.hi)}★` : `${st(cv.lo)}-${st(cv.hi)}★?`}</span>;
}

/** Your best five before and after a deal: the one line that says whether it makes you better. */
export function BestFive({ save, sides }: { save: Save; sides: TradeSides }) {
  const me = save.teams[save.userTeamId];
  const now = me.roster.map(id => save.players[id]).filter(Boolean);
  const after = [...now.filter(p => !sides.give.players.includes(p.id)), ...sides.get.players.map(id => save.players[id]).filter(Boolean)];
  const five = (ps: Player[]) => teamRatings(ps, autoLineup(ps)).ovr;
  const a = five(now), b = five(after);
  return (
    <div class="row tc-verdict">
      <span class="dim">Your best five</span><Stars n={teamStarCount(a)} /><span class="dim">→</span><Stars n={teamStarCount(b)} />
      <span class={b > a ? 'good' : b < a ? 'bad' : 'dim'}>{b > a ? `better: +${b - a} overall` : b < a ? `weaker: ${b - a} overall` : 'no change'}</span>
    </div>
  );
}

/** The two sides of a deal, and your best five before and after it. */
export function TradeCard({ save, sides }: { save: Save; sides: TradeSides }) {
  return (
    <div class="tc">
      <div class="tc-cols">
        <Side save={save} title="YOU GIVE" players={sides.give.players.map(id => save.players[id]).filter(Boolean)} picks={sides.give.picks} />
        <div class="tc-arrow">⇄</div>
        <Side save={save} title="YOU GET" players={sides.get.players.map(id => save.players[id]).filter(Boolean)} picks={sides.get.picks} />
      </div>
      <BestFive save={save} sides={sides} />
    </div>
  );
}
