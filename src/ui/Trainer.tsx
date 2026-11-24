// Making a player better, the same way everywhere: with level-up points from playing, or with credits at
// training camp. Every rating shows what a tap does to him, the one that helps most is marked, and his
// ceiling is always in view.
import { bestRatingFor } from '../core/org/chores';
import { CAMP_SESSIONS, campSessionsLeft, upgradeBlock, upgradeCost, upgradeRating, UPGRADE_POINTS } from '../core/org/economy';
import { POINT_GAIN, atCeiling, pointsOf, spendPoint } from '../core/org/xp';
import { POS_WEIGHTS, overallOf, ovr, raiseRating } from '../core/ratings';
import type { Player, RatingKey, Save } from '../core/types';
import { RATING_KEYS, RATING_NAMES } from '../core/types';
import { sfx } from '../audio/sfx';
import { TAP } from '../state/device';
import { act } from '../state/store';
import { Btn, Stars, toast } from './kit';

/** How far a rating is through its current half star (0-1). */
export const halfStarProgress = (v: number): number => {
  const s = ((v - 30) / 62) * 10 + 0.5;
  if (s <= 1) return 0;
  if (s >= 10) return 1;
  return s - Math.floor(s);
};
/** What raising this rating would do to his overall. */
function preview(p: Player, k: RatingKey, by: number): { gain: number; ovr: number } {
  const q = { ...p, ratings: { ...p.ratings } };
  const gain = raiseRating(q, k, by);
  return { gain, ovr: overallOf(q.ratings, q.pos) - ovr(p) };
}

export function Trainer({ save, player: p, mode, onDone }: { save: Save; player: Player; mode: 'points' | 'camp'; onDone?: () => void }) {
  const o = ovr(p), cap = Math.max(p.potential, o);
  const room = cap - o;
  const pts = pointsOf(p);
  const by = mode === 'points' ? POINT_GAIN : UPGRADE_POINTS;
  const block = mode === 'camp' ? upgradeBlock(save, p) : atCeiling(p) ? 'He has reached his ceiling.' : pts <= 0 ? null : null;
  // the best buy: what moves his overall most for what it costs, his position's needs breaking ties
  const fallback = bestRatingFor(p);
  const best = RATING_KEYS.map(k => {
    const pv = preview(p, k, by), cost = mode === 'camp' ? upgradeCost(save, p, k) : 1;
    return { k, v: pv.gain <= 0 ? -1 : (pv.ovr + POS_WEIGHTS[p.pos][k] * pv.gain * 0.6 + (k === fallback ? 0.05 : 0)) / cost };
  }).sort((a, b) => b.v - a.v)[0]?.k ?? fallback;
  const can = mode === 'points' ? pts > 0 && !atCeiling(p) : !block;
  const tapIt = (k: RatingKey) => {
    const err = act(s => (mode === 'points' ? spendPoint(s, p.id, k) : upgradeRating(s, p.id, k)));
    if (err) { toast(err); return; }
    sfx.coin();
    onDone?.();
  };
  return (
    <div class="col tr">
      <div class="tr-head">
        <div class="row between">
          <span class="dim">Overall</span><Stars v={o} big />
        </div>
        <div class="row between">
          <span class="dim">Ceiling</span><Stars v={cap} />
        </div>
        {/* how much he can still grow, as a bar from where he is to where he tops out */}
        <div class="tr-room"><span style={{ width: `${cap > 40 ? Math.round(((o - 40) / (cap - 40)) * 100) : 100}%` }} /></div>
        <div class={room > 0 ? 'dim' : 'gold'} style={{ fontSize: '17px' }}>{room > 0 ? `Room to grow: ${room} overall point${room === 1 ? '' : 's'}.` : 'He is at his ceiling: nothing more to train.'}</div>
      </div>
      <div class={`tr-say ${can ? 'gold' : 'dim'}`}>
        {mode === 'points'
          ? (atCeiling(p) ? 'At his ceiling, level-ups pay you a credit each instead.' : pts > 0 ? `${pts} point${pts === 1 ? '' : 's'} to spend. ${TAP} a rating: +${POINT_GAIN} each.` : 'No points yet: he earns them by playing.')
          : (block ?? `${campSessionsLeft(save, p)} of ${CAMP_SESSIONS} camp sessions left. ${TAP} a rating: +${UPGRADE_POINTS} each.`)}
      </div>
      <div class="list">
        {RATING_KEYS.map(k => {
          const v = p.ratings[k], pv = preview(p, k, by);
          const cost = mode === 'camp' ? upgradeCost(save, p, k) : 0;
          const off = !can || v >= 99 || pv.gain <= 0 || (mode === 'camp' && save.credits < cost);
          return (
            <div class={`item tr-row ${k === best && can ? 'best' : ''}`}>
              <div class="grow">
                <div class="row" style={{ gap: '6px' }}>{RATING_NAMES[k]}{k === best && can && <span class="tag gold">BEST</span>}</div>
                <div class="row" style={{ gap: '6px' }}><Stars v={v} /><span class="ox-prog" title="Progress to the next half star"><span style={{ width: `${Math.round(halfStarProgress(v) * 100)}%` }} /></span></div>
              </div>
              {can && <span class={`tr-fx ${pv.ovr > 0 ? 'good' : 'dim'}`}>{pv.gain <= 0 ? '' : pv.ovr > 0 ? `OVR +${pv.ovr}` : `+${pv.gain}`}</span>}
              {can && <Btn kind="small primary" disabled={off} silent onClick={() => tapIt(k)}>{mode === 'camp' ? `+ ◉${cost}` : `+${by}`}</Btn>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
