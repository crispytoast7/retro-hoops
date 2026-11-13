import { useState } from 'preact/hooks';
import type { Player, Save, StatLine } from '../core/types';
import { useSave } from '../state/store';
import { Panel, Screen, Tabs, avg, pct, short } from './kit';
import { nav } from './router';

const TABS = ['Team', 'Leaders', 'Teams'] as const;
type Tab = typeof TABS[number];

type Col = { key: string; label: string; get: (s: StatLine) => number; fmt: (s: StatLine) => string };
const per = (f: (s: StatLine) => number) => (s: StatLine) => (s.gp ? f(s) / s.gp : 0);
const perCol = (key: string, label: string, f: (s: StatLine) => number): Col => ({ key, label, get: per(f), fmt: s => avg(f(s), s.gp) });
const ratio = (m: (s: StatLine) => number, a: (s: StatLine) => number) => (s: StatLine) => (a(s) ? m(s) / a(s) : 0);
const COLS: Col[] = [
  { key: 'gp', label: 'GP', get: s => s.gp, fmt: s => String(s.gp) },
  perCol('min', 'MIN', s => s.min), perCol('pts', 'PTS', s => s.pts),
  perCol('reb', 'REB', s => s.orb + s.drb), perCol('ast', 'AST', s => s.ast),
  perCol('stl', 'STL', s => s.stl), perCol('blk', 'BLK', s => s.blk), perCol('tov', 'TOV', s => s.tov),
  { key: 'fg', label: 'FG%', get: ratio(s => s.fgm, s => s.fga), fmt: s => pct(s.fgm, s.fga) },
  { key: 'tp', label: '3P%', get: ratio(s => s.tpm, s => s.tpa), fmt: s => pct(s.tpm, s.tpa) },
  { key: 'ft', label: 'FT%', get: ratio(s => s.ftm, s => s.fta), fmt: s => pct(s.ftm, s.fta) },
];

const LEADERS: { label: string; f: (s: StatLine) => number; total?: boolean }[] = [
  { label: 'POINTS', f: s => s.pts }, { label: 'REBOUNDS', f: s => s.orb + s.drb }, { label: 'ASSISTS', f: s => s.ast },
  { label: 'STEALS', f: s => s.stl }, { label: 'BLOCKS', f: s => s.blk }, { label: '3-POINTERS MADE', f: s => s.tpm },
];

function allPlayers(save: Save): { p: Player; abbr: string }[] {
  return save.teams.flatMap(t => t.roster.map(id => ({ p: save.players[id], abbr: t.abbr })));
}

export function StatsScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const [tab, setTab] = useState<Tab>('Team');
  const [sort, setSort] = useState('pts');
  const col = COLS.find(c => c.key === sort) ?? COLS[2];

  return (
    <Screen title="Stats" team={me}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'Team' && (
        <Panel>
          <div class="scrollx">
            <table class="tbl">
              <thead><tr><th>Player</th>{COLS.map(c => (
                <th style={{ cursor: 'pointer', padding: '10px 4px', color: c.key === sort ? 'var(--gold)' : undefined }} onClick={() => setSort(c.key)}>{c.label}</th>
              ))}</tr></thead>
              <tbody>
                {me.roster.map(id => save.players[id]).sort((a, b) => col.get(b.season) - col.get(a.season)).map(p => (
                  <tr style={{ cursor: 'pointer', height: '40px' }} onClick={() => nav('player', { id: p.id })}>
                    <td>{short(p.name)}</td>
                    {COLS.map(c => <td>{c.fmt(p.season)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="dim">Tap a column to sort. Per-game averages.</div>
        </Panel>
      )}
      {tab === 'Leaders' && (() => {
        const all = allPlayers(save).filter(x => x.p.season.gp >= 3);
        return (
          <>
            {all.length === 0 && <div class="dim">Leaders appear after a few games.</div>}
            {all.length > 0 && LEADERS.map(L => {
              const top = [...all].sort((a, b) => L.f(b.p.season) / b.p.season.gp - L.f(a.p.season) / a.p.season.gp).slice(0, 5);
              return (
                <Panel title={L.label}>
                  <div class="list">
                    {top.map((x, i) => (
                      <div class={`item tap ${x.abbr === me.abbr ? 'sel' : ''}`} onClick={() => nav('player', { id: x.p.id })}>
                        <span class="dim" style={{ width: '20px' }}>{i + 1}</span>
                        <span class="grow nowrap">{x.p.name} <span class="dim">{x.abbr}</span></span>
                        <b class="gold">{avg(L.f(x.p.season), x.p.season.gp)}</b>
                      </div>
                    ))}
                  </div>
                </Panel>
              );
            })}
            <div class="dim">Minimum 3 games played.</div>
          </>
        );
      })()}
      {tab === 'Teams' && (
        <Panel>
          <div class="scrollx">
            <table class="tbl">
              <thead><tr><th>Team</th><th>GP</th><th>PF</th><th>PA</th><th>Diff</th></tr></thead>
              <tbody>
                {[...save.teams].map(t => {
                  const gp = t.record.w + t.record.l;
                  return { t, gp, pf: gp ? t.record.pf / gp : 0, pa: gp ? t.record.pa / gp : 0 };
                }).sort((a, b) => b.pf - b.pa - (a.pf - a.pa)).map(r => (
                  <tr class={r.t.id === save.userTeamId ? 'me' : ''} style={{ height: '40px' }}>
                    <td>{r.t.abbr} <span class="dim">{r.t.name}</span></td>
                    <td>{r.gp}</td><td>{r.pf.toFixed(1)}</td><td>{r.pa.toFixed(1)}</td>
                    <td class={r.pf - r.pa > 0 ? 'good' : r.pf - r.pa < 0 ? 'bad' : ''}>{r.pf - r.pa > 0 ? '+' : ''}{(r.pf - r.pa).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Screen>
  );
}
