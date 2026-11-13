import { useState } from 'preact/hooks';
import type { Save, StatLine } from '../core/types';
import { useSave } from '../state/store';
import { Meter, Panel, Screen, Tabs, avg, fullName } from './kit';

const TABS = ['Seasons', 'Banners', 'Records', 'Hall of Fame', 'Coach'] as const;
type Tab = typeof TABS[number];
const FINISH: Record<string, string> = { none: 'Missed playoffs', R1: 'Lost in first round', SF: 'Lost in conference final', F: 'Lost in the final', champ: 'Champions' };

const REC_GROUPS: { title: string; prefix: string }[] = [
  { title: 'SINGLE GAME', prefix: 'game' }, { title: 'SEASON', prefix: 'season' }, { title: 'CAREER', prefix: 'career' },
];
const REC_LABEL: Record<string, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: '3-Pointers', stl: 'Steals', blk: 'Blocks', gp: 'Games played' };
const REC_STATS = ['pts', 'reb', 'ast', 'tpm', 'stl', 'blk', 'gp'];

function SeasonRow({ save, h }: { save: Save; h: Save['history'][number] }) {
  const [open, setOpen] = useState(false);
  const mine = h.userTeamId;
  return (
    <Panel title={`SEASON ${h.year}`}>
      <div class="list">
        <div class="item"><span class="dim">Champion</span><span class="grow right gold">{fullName(save.teams[h.championId])}</span></div>
        <div class="item"><span class="dim">Runner-up</span><span class="grow right">{fullName(save.teams[h.runnerUpId])}</span></div>
        {h.mvp && <div class="item" style={{ flexWrap: 'wrap' }}><span class="dim">MVP</span><span class="grow right">{h.mvp.name} ({save.teams[h.mvp.teamId]?.abbr})<div class="dim">{h.mvp.line}</div></span></div>}
        <div class="item"><span class="dim">{save.teams[mine]?.abbr ?? 'You'}</span><span class="grow right">{h.userW}-{h.userL} · <span class={h.userPlayoff === 'champ' ? 'gold' : ''}>{FINISH[h.userPlayoff]}</span></span></div>
      </div>
      {h.awards.length > 0 && (
        <>
          <div class="item tap" onClick={() => setOpen(!open)}><span class="grow">{open ? 'Hide' : 'Show'} awards ({h.awards.length})</span><span>{open ? '-' : '+'}</span></div>
          {open && h.awards.map(a => (
            <div class="item" style={{ flexWrap: 'wrap' }}>
              <span class="tag gold">{a.award}</span>
              <span class="grow">{a.name} <span class="dim">{save.teams[a.teamId]?.abbr}{a.line ? ` · ${a.line}` : ''}</span></span>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

const tot = (s: StatLine, k: 'pts' | 'ast') => s[k];

export function HistoryScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const [tab, setTab] = useState<Tab>('Seasons');
  const c = save.coach;

  return (
    <Screen title="History" team={me}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ 'Hall of Fame': 'HoF' }} />

      {tab === 'Seasons' && (save.history.length === 0
        ? <Panel><div class="dim">No seasons completed yet.</div></Panel>
        : [...save.history].reverse().map(h => <SeasonRow save={save} h={h} />))}

      {tab === 'Banners' && (
        <>
          <Panel title={`${fullName(me).toUpperCase()} TITLES`}>
            {me.titles.length === 0 ? <div class="dim">No banners yet. Win a championship to hang the first one.</div> : (
              <div class="row wrap" style={{ gap: '12px', alignItems: 'flex-start' }}>
                {me.titles.map(y => (
                  <div class="center" style={{ width: '64px' }}>
                    <div style={{ background: me.colors.primary, color: me.colors.secondary, border: '3px solid var(--edge)', borderBottom: 0, padding: '10px 4px 18px', clipPath: 'polygon(0 0,100% 0,100% 100%,50% 85%,0 100%)' }}>
                      <div class="head" style={{ fontSize: '8px' }}>CHAMPS</div>
                      <div class="head" style={{ fontSize: '12px', marginTop: '6px' }}>{y}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="LEAGUE TITLES">
            <div class="list">
              {[...save.teams].sort((a, b) => b.titles.length - a.titles.length || a.id - b.id).map(t => (
                <div class="item" style={{ minHeight: '36px' }}>
                  <span class="swatch" style={{ background: t.colors.primary }} />
                  <span class={`grow nowrap ${t.id === me.id ? 'gold' : ''}`}>{fullName(t)}</span>
                  <b class={t.titles.length ? 'gold' : 'dim'}>{t.titles.length}</b>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {tab === 'Records' && REC_GROUPS.map(g => {
        const rows = REC_STATS.map(k => [k, save.records[`${g.prefix}.${k}`]] as const).filter(([, r]) => r);
        return (
          <Panel title={g.title}>
            {rows.length === 0 ? <div class="dim">No records set yet.</div> : (
              <div class="list">
                {rows.map(([k, r]) => (
                  <div class="item">
                    <span class="grow">{REC_LABEL[k]}<div class="dim" style={{ fontSize: '17px' }}>{r!.name} · Season {r!.year}</div></span>
                    <b class="gold">{r!.value}</b>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}

      {tab === 'Hall of Fame' && (save.hallOfFame.length === 0
        ? <Panel><div class="dim">No Hall of Famers yet. Great careers end up here.</div></Panel>
        : save.hallOfFame.map(h => (
          <Panel>
            <div class="row"><span class="tag pos">{h.pos}</span><b class="grow nowrap">{h.name}</b><span class="dim">Retired S{h.yearRetired}</span></div>
            <div class="dim">{save.teams[h.teamId]?.abbr} · {h.seasons} seasons</div>
            <div>{h.career.pts} PTS · {h.career.orb + h.career.drb} REB · {tot(h.career, 'ast')} AST</div>
            {h.awards.length > 0 && <div class="gold" style={{ fontSize: '18px' }}>{h.awards.join(', ')}</div>}
          </Panel>
        )))}

      {tab === 'Coach' && (
        <>
          <Panel title={c.name.toUpperCase()}>
            <Meter label="REPUTATION" value={c.rep} text={`${Math.round(c.rep)}/100`} />
            <div class="list" style={{ marginTop: '8px' }}>
              {[
                ['Career record', `${c.w}-${c.l}`], ['Win %', c.w + c.l ? `${Math.round((c.w / (c.w + c.l)) * 100)}%` : '-'],
                ['Playoff record', `${c.playoffW}-${c.playoffL}`], ['Titles', String(c.titles)],
                ['Seasons', String(c.seasons)], ['Times fired', String(c.fired)],
              ].map(([a, b]) => <div class="item between" style={{ minHeight: '34px' }}><span class="dim">{a}</span><b>{b}</b></div>)}
            </div>
          </Panel>
          <Panel title="CAREER STOPS">
            <div class="list">
              {c.stops.length === 0 && <div class="dim">No stops yet.</div>}
              {[...c.stops].reverse().map(s => (
                <div class="item">
                  <span class="swatch" style={{ background: save.teams[s.teamId]?.colors.primary }} />
                  <div class="grow">
                    <div class="nowrap">{save.teams[s.teamId] ? fullName(save.teams[s.teamId]) : 'Team'}</div>
                    <div class="dim">Season {s.from} to {s.to ?? 'now'}{s.titles ? ` · ${s.titles} title${s.titles > 1 ? 's' : ''}` : ''}</div>
                  </div>
                  <b>{s.w}-{s.l}</b>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </Screen>
  );
}
