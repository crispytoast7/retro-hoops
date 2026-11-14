// Pieces shared by the Trades, Scouting and Offseason screens.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { DEAD_CAP_RATE, FIRST_APRON, LUXURY_TAX, ROSTER_MIN, SALARY_CAP, SECOND_APRON } from '../core/constants';
import { scoutProspect, scoutedRating } from '../core/org/economy';
import { statusOf } from '../core/org/finance';
import type { CapStatus, SigningVia } from '../core/org/finance';
import { releaseDeadCap, releasePlayer } from '../core/org/roster';
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
        {pl.origin && <div class="dim" style={{ fontSize: '16px' }}>{pl.origin}</div>}
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
/** Same rule as the player screen: half a season's salary while the deal is live. */
export function deadCapFor(_save: Save, p: Player): number {
  return releaseDeadCap(p);
}
export async function releaseWithConfirm(save: Save, p: Player): Promise<boolean> {
  const me = save.teams[save.userTeamId];
  if (me.roster.length <= ROSTER_MIN) { toast(`You need at least ${ROSTER_MIN} players.`); return false; }
  const dead = deadCapFor(save, p);
  const ok = await confirmDialog(`Release ${p.name}? ${dead > 0 ? `${money(dead)} stays on your cap as dead money until next offseason.` : ''}`, 'Release');
  if (!ok) return false;
  act(s => { releasePlayer(s, p.id, { deadCap: true }); });
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

// ---- cap status ----------------------------------------------------------------------
export const STATUS_LABEL: Record<CapStatus, string> = {
  'under cap': 'UNDER THE CAP', 'over cap': 'OVER THE CAP', taxpayer: 'TAXPAYER', 'first apron': 'OVER APRON 1', 'second apron': 'OVER APRON 2',
};
export const STATUS_CLASS: Record<CapStatus, string> = {
  'under cap': 'good', 'over cap': '', taxpayer: 'gold', 'first apron': 'bad', 'second apron': 'bad',
};
/** "This signing ..." for a move that changes the status. */
export const STATUS_PUSH: Record<CapStatus, string> = {
  'under cap': 'keeps you under the cap', 'over cap': 'puts you over the cap', taxpayer: 'puts you in the luxury tax',
  'first apron': 'puts you over the first apron', 'second apron': 'puts you over the second apron',
};
/** A team's cap status as a tag. */
export function CapTag(p: { status: CapStatus }) {
  return <span class={`tag ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>;
}
/** How a signing gets done, in the words the screens use. */
export const VIA_TEXT: Record<SigningVia, string> = {
  space: 'Cap space', bird: 'Own free agent', mle: 'Mid-level exception', taxMle: 'Taxpayer mid-level', min: 'Minimum deal',
};

const CAP_LINES: { key: string; name: string; at: number }[] = [
  { key: 'cap', name: 'CAP', at: SALARY_CAP }, { key: 'tax', name: 'TAX', at: LUXURY_TAX },
  { key: 'a1', name: 'APRON 1', at: FIRST_APRON }, { key: 'a2', name: 'APRON 2', at: SECOND_APRON },
];
const BAR_LO = 100, BAR_HI = 215;
const barPct = (v: number): number => Math.max(0, Math.min(100, ((v - BAR_LO) / (BAR_HI - BAR_LO)) * 100));
/** One payroll bar with the four lines marked on it, and a legend that shows which have been crossed. */
export function CapBar(p: { pay: number }) {
  const status = statusOf(p.pay);
  return (
    <div class="cap-bar-wrap">
      <div class="cap-bar" role="img" aria-label={`Payroll ${money(p.pay)}: ${status}`}>
        <div class={`cap-fill ${STATUS_CLASS[status] || 'plain'}`} style={{ width: `${Math.max(2, barPct(p.pay))}%` }} />
        {CAP_LINES.map(l => <i class={`cap-mark ${l.key}`} style={{ left: `${barPct(l.at)}%` }} />)}
      </div>
      <div class="cap-legend">
        {CAP_LINES.map(l => (
          <div class={p.pay > l.at ? 'over' : ''}>
            <span class="k"><i class={`cap-chip ${l.key}`} />{l.name}</span>
            <span>${l.at}M</span>
          </div>
        ))}
      </div>
    </div>
  );
}
