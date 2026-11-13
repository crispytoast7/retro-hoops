// Pieces shared by the Trades, Scouting and Offseason screens.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { DEAD_CAP_RATE, ROSTER_MIN } from '../core/constants';
import { scoutProspect, scoutedRating } from '../core/org/economy';
import { releasePlayer } from '../core/org/roster';
import { overallOf, ovr, round1, stars } from '../core/ratings';
import type { DraftPick, Player, Pos, RatingKey, Ratings, Save } from '../core/types';
import { POSITIONS, RATING_KEYS } from '../core/types';
import { act } from '../state/store';
import { Btn, Modal, Stars, Tabs, confirmDialog, money, toast } from './kit';
import { nav } from './router';

export const RATING_ABBR: Record<RatingKey, string> = {
  sht: 'SHT', hnd: 'HND', pas: 'PAS', spd: 'SPD', fin: 'FIN', def: 'DEF', reb: 'REB',
};

/** A player's name that opens his player page, without triggering the row it sits in. */
export function NameLink(p: { id: number; name: string }) {
  return <span class="ox-link" onClick={e => { e.stopPropagation(); nav('player', { id: p.id }); }}>{p.name}</span>;
}

/** Stops a tap on a button from also hitting the row around it. */
export function Stop(p: { children: ComponentChildren }) {
  return <span class="row" style={{ gap: '6px', flex: 'none' }} onClick={e => e.stopPropagation()}>{p.children}</span>;
}

/** "Y3 R1 (HCG)": year, round and the original team's abbreviation. */
export const pickText = (save: Save, pk: DraftPick): string =>
  `Y${pk.year} R${pk.round} (${save.teams[pk.origTeamId]?.abbr ?? '?'})`;

export const yrs = (n: number): string => `${n} yr${n === 1 ? '' : 's'}`;
export const dealText = (salary: number, years: number): string => `${money(salary)} x ${yrs(years)}`;
export const contractText = (p: Player): string =>
  p.contract.years > 0 ? dealText(p.contract.salary, p.contract.years) : `${money(p.contract.salary)} · expiring`;

export const STRATEGY_HINT: Record<'contend' | 'middle' | 'rebuild', string> = {
  contend: 'WIN NOW', middle: 'MIDDLE', rebuild: 'REBUILD',
};

// ---- position filter -----------------------------------------------------------------
export type PosF = 'ALL' | Pos;
const POS_TABS: PosF[] = ['ALL', ...POSITIONS];
export function PosFilter(p: { value: PosF; onChange: (v: PosF) => void }) {
  return <div class="ox-chips"><Tabs tabs={POS_TABS} value={p.value} onChange={p.onChange} /></div>;
}

// ---- player rows ---------------------------------------------------------------------
/** Like the kit's PlayerRow, but the name always opens the player page and the row can do something else. */
export function PlayerLine(p: { save: Save; player: Player; onClick?: () => void; right?: ComponentChildren; sel?: boolean; note?: ComponentChildren; sub?: ComponentChildren; dim?: boolean }) {
  const pl = p.player;
  return (
    <div class={`item ${p.onClick ? 'tap' : ''} ${p.sel ? 'sel' : ''} ${p.dim ? 'ox-faded' : ''}`} onClick={p.onClick}>
      <span class="tag pos">{pl.pos}</span>
      <div class="grow">
        <div class="nowrap">
          <NameLink id={pl.id} name={pl.name} />
          {pl.injury && <span class="badge">{pl.injury.desc === 'suspended' ? 'SUS' : 'INJ'} {pl.injury.weeks}W</span>}
          {p.note}
        </div>
        <div class="row dim ox-sub"><Stars v={ovr(pl)} /><span>Age {pl.age}</span>{p.sub}</div>
      </div>
      {p.right}
    </div>
  );
}

// ---- prospects -----------------------------------------------------------------------
export interface ProspectView { ranges: Record<RatingKey, { lo: number; hi: number }>; est: number; known: boolean }
/** What the user's scouts can see of a prospect, plus an overall estimate from the midpoints. */
export function prospectView(save: Save, p: Player): ProspectView {
  const mid = {} as Ratings;
  const ranges = {} as Record<RatingKey, { lo: number; hi: number }>;
  for (const k of RATING_KEYS) {
    const r = scoutedRating(save, p, k);
    ranges[k] = r;
    mid[k] = (r.lo + r.hi) / 2;
  }
  return { ranges, est: overallOf(mid, p.pos), known: p.scouted !== false };
}

/** One Stars if the read is certain to the half star, else "2-3.5" text. */
export function StarRange(p: { lo: number; hi: number }) {
  const a = stars(p.lo), b = stars(p.hi);
  if (a === b) return <Stars n={a} />;
  return <span class="ox-range" title={`${a} to ${b} stars`}>{a}-{b}<b> ★</b></span>;
}

export function scout(id: number): void {
  const err = act(s => scoutProspect(s, id));
  if (err) toast(err); else toast('Scouting report is in.', true);
}

export function ProspectRow(p: { save: Save; player: Player; onClick?: () => void; sel?: boolean; right?: ComponentChildren; noScout?: boolean }) {
  const pl = p.player;
  const v = prospectView(p.save, pl);
  return (
    <div class={`item ox-prospect ${p.onClick ? 'tap' : ''} ${p.sel ? 'sel' : ''}`} onClick={p.onClick}>
      <div class="col grow" style={{ gap: '4px' }}>
        <div class="row">
          <span class="tag pos">{pl.pos}</span>
          <div class="grow nowrap"><NameLink id={pl.id} name={pl.name} /></div>
          {p.right}
          {v.known
            ? <span class="tag good">SCOUTED</span>
            : !p.noScout && <Stop><Btn onClick={() => scout(pl.id)}>{p.save.scoutPoints > 0 ? 'Scout' : 'Scout ◉1'}</Btn></Stop>}
        </div>
        <div class="row dim ox-sub">
          <span>Age {pl.age}</span>
          <span class="row" style={{ gap: '4px' }}>{v.known ? 'Now' : 'Est.'} <Stars v={v.est} /></span>
          {v.known && <span class="row" style={{ gap: '4px' }}>Ceiling <Stars v={pl.potential} /></span>}
        </div>
        <div class="ox-rgrid">
          {RATING_KEYS.map(k => (
            <div><span class="k">{RATING_ABBR[k]}</span><StarRange lo={v.ranges[k].lo} hi={v.ranges[k].hi} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Filterable, sortable prospect list. `onPick` makes rows tappable. */
export function ProspectBoard(p: { save: Save; ids: readonly number[]; onPick?: (id: number) => void; noScout?: boolean }) {
  const [pos, setPos] = useState<PosF>('ALL');
  const [sort, setSort] = useState<'Overall' | 'Age'>('Overall');
  const rows = p.ids
    .map(id => p.save.players[id])
    .filter((pl): pl is Player => !!pl && (pos === 'ALL' || pl.pos === pos))
    .map(pl => ({ pl, est: prospectView(p.save, pl).est }));
  rows.sort((a, b) => (sort === 'Overall' ? b.est - a.est || a.pl.age - b.pl.age : a.pl.age - b.pl.age || b.est - a.est));
  return (
    <>
      <PosFilter value={pos} onChange={setPos} />
      <div class="row ox-chips">
        <span class="head dim">SORT</span>
        <div class="grow"><Tabs tabs={['Overall', 'Age'] as const} value={sort} onChange={setSort} labels={{ Overall: 'Est. overall', Age: 'Youngest' }} /></div>
      </div>
      <div class="panel list ox-list">
        {rows.length
          ? rows.map(r => <ProspectRow key={r.pl.id} save={p.save} player={r.pl} noScout={p.noScout} onClick={p.onPick ? () => p.onPick!(r.pl.id) : undefined} />)
          : <div class="item dim">No prospects{pos !== 'ALL' ? ` at ${pos}` : ''}.</div>}
      </div>
    </>
  );
}

// ---- free agents ---------------------------------------------------------------------
export function FreeAgentList(p: { save: Save; onPick: (pl: Player) => void; right?: (pl: Player) => ComponentChildren; sub?: (pl: Player) => ComponentChildren }) {
  const [pos, setPos] = useState<PosF>('ALL');
  const list = p.save.freeAgents
    .map(id => p.save.players[id])
    .filter((pl): pl is Player => !!pl && !pl.retired && (pos === 'ALL' || pl.pos === pos))
    .sort((a, b) => ovr(b) - ovr(a) || a.age - b.age);
  return (
    <>
      <PosFilter value={pos} onChange={setPos} />
      <div class="panel list ox-list">
        {list.length
          ? list.map(pl => <PlayerLine key={pl.id} save={p.save} player={pl} onClick={() => p.onPick(pl)} right={p.right?.(pl)} sub={p.sub?.(pl)} />)
          : <div class="item dim">No free agents{pos !== 'ALL' ? ` at ${pos}` : ''}.</div>}
      </div>
    </>
  );
}

// ---- releasing -----------------------------------------------------------------------
/** Same rule as the player screen: dead money in season, none in the offseason. */
export function deadCapFor(save: Save, p: Player): number {
  if (save.phase === 'offseason') return 0;
  return Math.min(p.contract.salary, round1(p.contract.salary * Math.max(1, p.contract.years) * DEAD_CAP_RATE * 0.5));
}
export async function releaseWithConfirm(save: Save, p: Player): Promise<boolean> {
  const me = save.teams[save.userTeamId];
  if (me.roster.length <= ROSTER_MIN) { toast(`You need at least ${ROSTER_MIN} players.`); return false; }
  const dead = deadCapFor(save, p);
  const ok = await confirmDialog(`Release ${p.name}? ${dead > 0 ? `${money(dead)} stays on your cap this season as dead money.` : 'No dead money in the offseason.'}`, 'Release');
  if (!ok) return false;
  act(s => { releasePlayer(s, p.id, { deadCap: s.phase !== 'offseason' }); });
  toast(`${p.name} released.`, true);
  return true;
}

/** Pick someone on the user's roster to let go. */
export function ReleaseModal(p: { save: Save; onClose: () => void; text?: string }) {
  const me = p.save.teams[p.save.userTeamId];
  const roster = me.roster.map(id => p.save.players[id]).filter(Boolean).sort((a, b) => ovr(a) - ovr(b));
  return (
    <Modal onClose={p.onClose}>
      <h2>RELEASE A PLAYER</h2>
      <div class="dim">{p.text ?? `Roster: ${me.roster.length} players.`}</div>
      <div class="list">
        {roster.map(pl => (
          <PlayerLine save={p.save} player={pl} sub={<span>{contractText(pl)}</span>}
            right={<Btn kind="danger" onClick={() => { void releaseWithConfirm(p.save, pl); }}>Cut</Btn>} />
        ))}
      </div>
      <Btn kind="primary" onClick={p.onClose}>Done</Btn>
    </Modal>
  );
}

/** Cap space a team will have next season: contracts with years left, plus dead money. */
export function committedSpace(save: Save, teamId: number, cap: number): number {
  const t = save.teams[teamId];
  let pay = t.deadCap;
  for (const id of t.roster) { const pl = save.players[id]; if (pl && pl.contract.years > 0) pay += pl.contract.salary; }
  return round1(cap - pay);
}
