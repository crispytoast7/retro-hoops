import { useState } from 'preact/hooks';
import { standings } from '../core/season/schedule';
import type { PlayoffSeries, Save, Team } from '../core/types';
import { useSave } from '../state/store';
import { Modal, Panel, PlayerRow, Screen, confName, fullName } from './kit';
import { nav } from './router';
import { Btn } from './kit';

const ROUNDS = ['', 'CONFERENCE SEMIFINALS', 'CONFERENCE FINALS', 'CHAMPIONSHIP'];
const streakStr = (n: number) => (n === 0 ? '-' : n > 0 ? `W${n}` : `L${-n}`);

function Series({ save, s }: { save: Save; s: PlayoffSeries }) {
  const g = s.gameId != null ? save.schedule.find(x => x.id === s.gameId) : undefined;
  const single = (save.calendar?.seriesWins ?? 1) === 1;
  // one-off games show the score; series show games won
  const score = (id: number) => (single ? (g?.played ? (g.homeId === id ? g.homeScore : g.awayScore) : undefined) : id === s.highId ? s.highW : s.lowW);
  const row = (id: number) => {
    const t = save.teams[id];
    const win = s.winnerId === id;
    return (
      <div class="row" style={{ minHeight: '30px', color: win ? 'var(--gold)' : id === save.userTeamId ? 'var(--accent)' : undefined }}>
        <span class="swatch" style={{ background: t.colors.primary }} />
        <span class="grow nowrap">{win ? '> ' : ''}{t.abbr} {t.name}</span>
        <span class="head">{score(id) ?? ''}</span>
      </div>
    );
  };
  return <div class="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>{row(s.highId)}{row(s.lowId)}</div>;
}

export function StandingsScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const [open, setOpen] = useState<Team | null>(null);
  const po = save.playoffs;

  const table = (conf: number) => (
    <Panel title={`${confName(conf).toUpperCase()} CONFERENCE`} team={conf === save.teams[save.userTeamId].conf}>
      <div class="scrollx">
        <table class="tbl">
          <thead><tr><th>#  Team</th><th>W</th><th>L</th><th>Conf</th><th>Diff</th><th>Strk</th></tr></thead>
          <tbody>
            {standings(save, conf).map((t, i) => {
              const d = t.record.pf - t.record.pa;
              return (
                <tr class={`${t.id === save.userTeamId ? 'me' : ''} ${i === 4 ? 'cut' : ''}`} style={{ cursor: 'pointer', height: '40px' }} onClick={() => setOpen(t)}>
                  <td>{i + 1}. {t.abbr} <span class="dim">{t.name}</span></td>
                  <td>{t.record.w}</td><td>{t.record.l}</td>
                  <td>{t.record.confW}-{t.record.confL}</td>
                  <td class={d > 0 ? 'good' : d < 0 ? 'bad' : ''}>{d > 0 ? '+' : ''}{d}</td>
                  <td class={t.record.streak > 0 ? 'good' : t.record.streak < 0 ? 'bad' : ''}>{streakStr(t.record.streak)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  return (
    <Screen title="Standings">
      {po && (
        <Panel title="PLAYOFF BRACKET">
          {po.championId != null && (
            <div class="item" style={{ justifyContent: 'center', background: 'var(--panel2)' }}>
              <span class="head gold">CHAMPIONS: {fullName(save.teams[po.championId])}</span>
            </div>
          )}
          {[1, 2, 3].map(r => {
            const ss = po.series.filter(s => s.round === r);
            if (!ss.length) return null;
            return (
              <div>
                <h3 style={{ margin: '8px 0 4px' }}>{ROUNDS[r]}</h3>
                <div class="list">
                  {ss.map(s => (
                    <div>
                      {r < 3 && <div class="dim" style={{ fontSize: '16px' }}>{confName(s.conf)}</div>}
                      <Series save={save} s={s} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Panel>
      )}
      {table(0)}
      {table(1)}
      <div class="dim">Top 4 in each conference make the playoffs. Tap a team to see its roster.</div>
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <h2>{fullName(open)}</h2>
          <div class="dim">{open.record.w}-{open.record.l}</div>
          <div class="list">
            {open.roster.map(id => save.players[id]).map(p => (
              <PlayerRow save={save} player={p} onClick={() => { setOpen(null); nav('player', { id: p.id }); }} />
            ))}
          </div>
          <Btn onClick={() => setOpen(null)}>Close</Btn>
        </Modal>
      )}
    </Screen>
  );
}
