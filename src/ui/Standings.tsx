import { TAP } from '../state/device';
import { useState } from 'preact/hooks';
import { standings } from '../core/season/schedule';
import type { Team } from '../core/types';
import { useSave } from '../state/store';
import { Modal, Panel, PlayerRow, Screen, confName, fullName } from './kit';
import { nav } from './router';
import { Btn } from './kit';
import { Bracket } from './Bracket';

const streakStr = (n: number) => (n === 0 ? '-' : n > 0 ? `W${n}` : `L${-n}`);

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
      <Panel title={po ? 'PLAYOFF BRACKET' : 'PLAYOFF PICTURE · IF THE SEASON ENDED TODAY'}>
        <Bracket save={save} />
      </Panel>
      {table(0)}
      {table(1)}
      <div class="dim">Top 4 in each conference make the playoffs. {TAP} a team to see its roster.</div>
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
