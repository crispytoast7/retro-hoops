import { useState } from 'preact/hooks';
import { ROSTER_MAX, ROSTER_MIN } from '../core/constants';
import { upgradeCost, upgradeRating } from '../core/org/economy';
import { capStatus, payroll } from '../core/org/finance';
import { ovr } from '../core/ratings';
import type { Player, RatingKey, Save } from '../core/types';
import { RATING_KEYS, RATING_NAMES } from '../core/types';
import { sfx } from '../audio/sfx';
import { act } from '../state/store';
import { Btn, Modal, Panel, Sprite, Stars, money, toast } from './kit';
import { NameLink, PlayerLine, STATUS_CLASS, contractText, releaseWithConfirm } from './OffseasonParts';
import { nav } from './router';

/** How far a rating is through its current half star (0-1), so an upgrade that does not yet add half a star still shows. */
const halfStarProgress = (v: number): number => {
  const s = ((v - 30) / 62) * 10 + 0.5; // half-star units, offset so rounding boundaries fall on integers
  if (s <= 1) return 0;
  if (s >= 10) return 1;
  return s - Math.floor(s);
};

export function CampStep({ save }: { save: Save }) {
  const me = save.teams[save.userTeamId];
  const off = save.offseason!;
  const [sel, setSel] = useState<number | null>(null);
  const roster = me.roster.map(id => save.players[id]).filter((p): p is Player => !!p).sort((a, b) => ovr(b) - ovr(a));
  const n = me.roster.length;
  const player = sel !== null && me.roster.includes(sel) ? save.players[sel] : null;

  return (
    <>
      <Panel team title="CAMP BUDGET">
        <div class="ox-stats">
          <div><h3>CREDITS</h3><div class="head gold">◉ {save.credits}</div></div>
          <div><h3>ROSTER</h3><div class={`head ${n > ROSTER_MAX || n < ROSTER_MIN ? 'bad' : ''}`}>{n}/{ROSTER_MAX}</div></div>
          <div><h3>PAYROLL</h3><div class={`head ${STATUS_CLASS[capStatus(save, me)]}`}>{money(payroll(save, me))}</div></div>
        </div>
        <div style={{ marginTop: '6px' }}>Rating upgrades cost <b class="good">25% less</b> during camp. Tap a player to train him.</div>
        {off.campSpent > 0 && <div class="dim" style={{ fontSize: '18px' }}>Spent at camp so far: ◉ {off.campSpent}</div>}
      </Panel>

      {n > ROSTER_MAX && (
        <div class="panel ox-warn"><div class="bad">Your roster has {n} players. The limit is {ROSTER_MAX}: release {n - ROSTER_MAX} before the season starts (tap a player, then Release).</div></div>
      )}
      {n < ROSTER_MIN && (
        <div class="panel ox-warn"><div class="gold">Only {n} players. If you start like this the league adds minimum-salary free agents to reach {ROSTER_MIN}.</div>
          <div style={{ height: '6px' }} />
          <Btn class="block" onClick={() => nav('trades', { tab: 'Free Agents' })}>Sign free agents</Btn>
        </div>
      )}

      <div class="panel list ox-list">
        {roster.map(p => <PlayerLine save={save} player={p} onClick={() => setSel(p.id)} sub={<span>{contractText(p)}</span>} right={<span class="tag">TRAIN</span>} />)}
      </div>

      <div class="row">
        <Btn class="grow" onClick={() => nav('lineup')}>Lineup</Btn>
        <Btn class="grow" onClick={() => nav('trades', { tab: 'Free Agents' })}>Free agents</Btn>
      </div>

      {player && <TrainModal save={save} player={player} onClose={() => setSel(null)} />}
    </>
  );
}

function TrainModal({ save, player: p, onClose }: { save: Save; player: Player; onClose: () => void }) {
  const me = save.teams[save.userTeamId];
  const up = (k: RatingKey) => {
    const err = act(s => upgradeRating(s, p.id, k));
    if (err) { toast(err); return; }
    sfx.coin();
    toast(`${RATING_NAMES[k]} trained!`, true);
  };
  const release = async () => { if (await releaseWithConfirm(save, p)) onClose(); };
  return (
    <Modal onClose={onClose}>
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <Sprite player={p} team={me} scale={3} />
        <div class="col grow" style={{ gap: '4px' }}>
          <div class="row"><span class="tag pos">{p.pos}</span><h2 class="grow nowrap"><NameLink id={p.id} name={p.name} /></h2></div>
          <div class="row dim ox-sub"><Stars v={ovr(p)} big /><span>Age {p.age}</span></div>
          <div class="dim ox-sub">{p.trait} · {contractText(p)}</div>
        </div>
      </div>
      <div class="row between"><span class="dim">Credits</span><span class="head gold">◉ {save.credits}</span></div>
      <div class="list">
        {RATING_KEYS.map(k => {
          const cost = upgradeCost(save, p, k);
          const maxed = p.ratings[k] >= 99;
          return (
            <div class="item">
              <div class="grow">
                <div>{RATING_NAMES[k]}</div>
                <div class="row" style={{ gap: '6px' }}><Stars v={p.ratings[k]} /><span class="ox-prog" title="Progress to the next half star"><span style={{ width: `${Math.round(halfStarProgress(p.ratings[k]) * 100)}%` }} /></span></div>
              </div>
              <Btn disabled={maxed || save.credits < cost} onClick={() => up(k)} silent>{maxed ? 'MAX' : `+ ◉${cost}`}</Btn>
            </div>
          );
        })}
      </div>
      <div class="dim" style={{ fontSize: '17px' }}>Each upgrade adds a little; the bar under the stars fills toward the next half star.</div>
      <div class="row">
        <Btn kind="danger" onClick={() => { void release(); }}>Release</Btn>
        <Btn class="grow" kind="primary" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}
