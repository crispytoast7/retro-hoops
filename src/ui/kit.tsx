// Shared UI pieces for every screen.
import { BADGES, badgeOf } from '../core/badges';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { isStar, pointsOf, atCeiling } from '../core/org/xp';
import { heightOf } from '../core/body';
import { FORM_NAME, formOf } from '../core/org/week';
import { ovr, stars } from '../core/ratings';
import type { Player, Save, Team } from '../core/types';
import { drawPlayer } from '../game/render';
import { back } from './router';

export const money = (v: number): string => `$${v.toFixed(1)}M`;
export const pct = (m: number, a: number): string => (a ? `${Math.round((m / a) * 100)}%` : '-');
export const avg = (total: number, gp: number): string => (gp ? (total / gp).toFixed(1) : '0.0');
export const short = (name: string): string => { const i = name.indexOf(' '); return i < 0 ? name : `${name[0]}. ${name.slice(i + 1)}`; };
export const recordStr = (t: Team): string => `${t.record.w}-${t.record.l}`;
export const fullName = (t: Team): string => `${t.city} ${t.name}`;

export function Btn(p: { onClick?: () => void; kind?: string; disabled?: boolean; children: ComponentChildren; class?: string; silent?: boolean }) {
  return (
    <button class={`btn ${p.kind ?? ''} ${p.class ?? ''}`} disabled={p.disabled}
      onClick={() => { if (!p.silent) sfx.click(); p.onClick?.(); }}>{p.children}</button>
  );
}

export function Screen(p: { title: string; children: ComponentChildren; onBack?: (() => void) | null; right?: ComponentChildren; footer?: ComponentChildren; team?: Team }) {
  const style = p.team ? { '--team': p.team.colors.primary, '--team2': p.team.colors.secondary } as any : undefined;
  return (
    <div class="screen" style={style}>
      <div class="topbar">
        {p.onBack !== null && <Btn kind="small" onClick={p.onBack ?? back}>&lt;</Btn>}
        <h1>{p.title}</h1>
        {p.right}
      </div>
      <div class="body">{p.children}</div>
      {p.footer && <div class="footer">{p.footer}</div>}
    </div>
  );
}

export function Panel(p: { title?: string; children: ComponentChildren; team?: boolean; class?: string }) {
  return <div class={`panel ${p.team ? 'team' : ''} ${p.class ?? ''}`}>{p.title && <h3>{p.title}</h3>}{p.children}</div>;
}

const STAR = 'M4 0h1v2h3v1H7v1H6v2h1v2H6V7H5V6H4v1H3v1H2V6h1V4H2V3H1V2h3z';
/** Star rating from a hidden 1-100 value (or pass `n` for a direct 0-5 count). */
export function Stars(p: { v?: number; n?: number; big?: boolean }) {
  const s = p.n ?? stars(p.v ?? 0);
  return (
    <span class={`stars ${p.big ? 'big' : ''}`} title={`${s} stars`}>
      {[0, 1, 2, 3, 4].map(i => {
        const fill = s >= i + 1 ? 1 : s >= i + 0.5 ? 0.5 : 0;
        return (
          <svg viewBox="0 0 9 8" shape-rendering="crispEdges">
            <path d={STAR} fill="#0b0a14" />
            {fill > 0 && <path d={STAR} fill="#ffd23c" clip-path={fill < 1 ? 'inset(0 50% 0 0)' : undefined} />}
          </svg>
        );
      })}
    </span>
  );
}

export function Meter(p: { label: string; value: number; color?: string; text?: string; onClick?: () => void }) {
  const v = Math.max(0, Math.min(100, p.value));
  const color = p.color ?? (v >= 60 ? 'var(--good)' : v >= 35 ? 'var(--gold)' : 'var(--bad)');
  return (
    <div class={`meter ${p.onClick ? 'tap' : ''}`} onClick={p.onClick}>
      <div class="lbl"><span>{p.label}{p.onClick && <span class="dim"> ⓘ</span>}</span><span>{p.text ?? Math.round(v)}</span></div>
      <div class="bar"><div class="fill" style={{ width: `${v}%`, background: color }} /></div>
    </div>
  );
}

export function Modal(p: { children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class="modal-bg" onClick={e => { if (e.target === e.currentTarget) p.onClose?.(); }}>
      <div class="modal">{p.children}</div>
    </div>
  );
}

let toastSet: ((t: string | null) => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Brief message at the bottom of the screen. Pass an error string straight from core functions. */
export function toast(text: string | null | undefined, good = false): void {
  if (!text) return;
  if (good) sfx.select(); else sfx.bad();
  toastSet?.(text);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastSet?.(null), 2400);
}
export function ToastHost() {
  const [t, set] = useState<string | null>(null);
  useEffect(() => { toastSet = set; return () => { toastSet = null; }; }, []);
  return t ? <div class="toast" onClick={() => set(null)}>{t}</div> : null;
}

/** Yes/no confirmation as a promise. */
let confirmSet: ((c: { text: string; yes: string; res: (v: boolean) => void } | null) => void) | null = null;
export function confirmDialog(text: string, yes = 'Yes'): Promise<boolean> {
  return new Promise(res => { if (confirmSet) confirmSet({ text, yes, res }); else res(window.confirm(text)); });
}
export function ConfirmHost() {
  const [c, set] = useState<{ text: string; yes: string; res: (v: boolean) => void } | null>(null);
  useEffect(() => { confirmSet = set; return () => { confirmSet = null; }; }, []);
  if (!c) return null;
  const done = (v: boolean) => { c.res(v); set(null); };
  return (
    <Modal onClose={() => done(false)}>
      <div>{c.text}</div>
      <div class="row"><Btn class="grow" onClick={() => done(false)}>Cancel</Btn><Btn class="grow" kind="primary" onClick={() => done(true)}>{c.yes}</Btn></div>
    </Modal>
  );
}

/** Pixel portrait of a player in his team's colours. */
export function Sprite(p: { player: Player; team?: Team | null; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = p.scale ?? 2;
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 20, 34);
    drawPlayer(g, { x: 10, y: 32, player: p.player, jersey: p.team?.colors.primary ?? '#77738f', trim: p.team?.colors.secondary ?? '#d8d4ea', run: -1, face: 0, lift: 0 });
  }, [p.player.id, p.team?.id]);
  return <canvas ref={ref} width={20} height={34} style={{ width: `${20 * scale}px`, height: `${34 * scale}px`, flex: 'none' }} />;
}

export function moraleTag(m: number) {
  return m >= 70 ? <span class="tag good">HAPPY</span> : m >= 45 ? <span class="tag">OK</span> : m >= 25 ? <span class="tag gold">UNHAPPY</span> : <span class="tag bad">ANGRY</span>;
}

/** Hot or cold marker for one of the user's players. */
export function FormTag({ player }: { player: Player }) {
  const f = formOf(player);
  if (!f) return null;
  return <span class={`tag form ${f > 0 ? 'hot' : 'cold'}`}>{f > 0 ? '▲'.repeat(f) : '▼'.repeat(-f)} {FORM_NAME[f]}</span>;
}

/** A player's badge, as a small gold tag. Nothing for a player without one (or an unscouted prospect). */
export function BadgeTag({ player }: { player: Player }) {
  const b = player.scouted === false ? null : badgeOf(player);
  return b ? <span class="tag bdg" title={BADGES[b].desc}>◆ {BADGES[b].name}</span> : null;
}

/** Standard one-line player row used in lists. */
export function PlayerRow(p: { save: Save; player: Player; onClick?: () => void; right?: ComponentChildren; sel?: boolean; note?: ComponentChildren }) {
  const pl = p.player;
  return (
    <div class={`item ${p.onClick ? 'tap' : ''} ${p.sel ? 'sel' : ''}`} onClick={p.onClick}>
      <span class="tag pos">{pl.pos}</span>
      <div class="grow">
        <div class="nowrap">{pl.scouted !== false && isStar(pl) && <span class="gold" title="Star player">★ </span>}{pl.name}{pl.teamId === p.save.userTeamId && pointsOf(pl) > 0 && !atCeiling(pl) && <span class="badge" style={{ background: 'var(--gold)', color: '#1a0d04' }}>LEVEL UP</span>}{pl.injury && <span class="badge">{pl.injury.desc === 'suspended' ? 'SUS' : 'INJ'} {pl.injury.weeks}W</span>}{p.save.captainId === pl.id && <span class="tag gold" style={{ marginLeft: '4px' }}>C</span>}</div>
        <div class="row dim" style={{ gap: '2px 6px', fontSize: '17px', flexWrap: 'wrap' }}><Stars v={ovr(pl)} /><span class="nowrap">{heightOf(pl)}</span><span class="nowrap">Age {pl.age}</span><BadgeTag player={pl} />{pl.teamId === p.save.userTeamId && <FormTag player={pl} />}{p.note}</div>
      </div>
      {p.right}
    </div>
  );
}

export function Tabs<T extends string>(p: { tabs: readonly T[]; value: T; onChange: (t: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div class="tabs">
      {p.tabs.map(t => <Btn kind="small" class={t === p.value ? 'on' : ''} onClick={() => p.onChange(t)}>{p.labels?.[t] ?? t}</Btn>)}
    </div>
  );
}

/** Team strength as stars: 64 overall = 1 star, 72 = 3, 80 = 5. */
export const teamStarCount = (teamOvr: number): number => Math.max(0.5, Math.min(5, Math.round(((teamOvr - 60) / 4) * 2) / 2));
export const confName = (c: number): string => (c === 0 ? 'East' : 'West');
