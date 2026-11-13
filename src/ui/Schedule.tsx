import { useState } from 'preact/hooks';
import { REG_WEEKS } from '../core/constants';
import type { BoxLine, GameResult, ScheduledGame } from '../core/types';
import { useSave } from '../state/store';
import { Btn, Modal, Panel, Screen, fullName, recordStr, short } from './kit';

const ROUND = ['', 'Semifinal', 'Conf Final', 'Championship'];

export function ScheduleScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.userTeamId;
  const [open, setOpen] = useState<ScheduledGame | null>(null);
  const games = save.schedule.filter(g => g.homeId === me || g.awayId === me).sort((a, b) => a.week - b.week);

  const box = (r: GameResult, lines: BoxLine[], teamId: number, q: number[]) => (
    <div>
      <h3 style={{ margin: '6px 0 4px' }}>{fullName(save.teams[teamId]).toUpperCase()} <span class="gold">{q.reduce((a, b) => a + b, 0)}</span></h3>
      <div class="scrollx">
        <table class="tbl">
          <thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3P</th></tr></thead>
          <tbody>
            {lines.filter(l => l.min > 0).map(l => (
              <tr>
                <td>{short(save.players[l.playerId]?.name ?? '?')}</td>
                <td>{Math.round(l.min)}</td><td>{l.pts}</td><td>{l.orb + l.drb}</td><td>{l.ast}</td><td>{l.stl}</td><td>{l.blk}</td>
                <td>{l.fgm}-{l.fga}</td><td>{l.tpm}-{l.tpa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <Screen title="Schedule">
      <Panel title={`SEASON ${save.year}`} team>
        <div class="list">
          {games.length === 0 && <div class="dim">No games scheduled.</div>}
          {games.map(g => {
            const home = g.homeId === me;
            const opp = save.teams[home ? g.awayId : g.homeId];
            const done = g.played && g.homeScore != null && g.awayScore != null;
            const mine = home ? g.homeScore! : g.awayScore!;
            const theirs = home ? g.awayScore! : g.homeScore!;
            const isNext = !g.played && g.week === save.week;
            const label = g.playoff || g.week > REG_WEEKS ? ROUND[g.week - REG_WEEKS] ?? 'Playoffs' : `Wk ${g.week}`;
            const tappable = !!g.result;
            return (
              <div class={`item ${tappable ? 'tap' : ''} ${isNext ? 'sel' : ''}`} onClick={tappable ? () => setOpen(g) : undefined}>
                <span class="tag" style={{ minWidth: '52px', textAlign: 'center' }}>{label}</span>
                <span class="tag">{home ? 'HOME' : 'AWAY'}</span>
                <div class="grow nowrap">{opp.abbr} <span class="dim">{recordStr(opp)}</span></div>
                {done ? <b class={mine > theirs ? 'good' : 'bad'}>{mine > theirs ? 'W' : 'L'} {mine}-{theirs}</b>
                  : isNext ? <span class="tag gold">NEXT</span> : <span class="dim">-</span>}
              </div>
            );
          })}
        </div>
      </Panel>
      {open && open.result && (
        <Modal onClose={() => setOpen(null)}>
          <h2>{save.teams[open.result.awayId].abbr} {open.result.awayScore} @ {save.teams[open.result.homeId].abbr} {open.result.homeScore}{open.result.ot ? ` (${open.result.ot > 1 ? open.result.ot : ''}OT)` : ''}</h2>
          <div class="scrollx">
            <table class="tbl">
              <thead><tr><th>Team</th>{open.result.homeQ.map((_, i) => <th>{i < 4 ? `Q${i + 1}` : 'OT'}</th>)}<th>T</th></tr></thead>
              <tbody>
                <tr><td>{save.teams[open.result.awayId].abbr}</td>{open.result.awayQ.map(v => <td>{v}</td>)}<td>{open.result.awayScore}</td></tr>
                <tr><td>{save.teams[open.result.homeId].abbr}</td>{open.result.homeQ.map(v => <td>{v}</td>)}<td>{open.result.homeScore}</td></tr>
              </tbody>
            </table>
          </div>
          {box(open.result, open.result.box.away, open.result.awayId, open.result.awayQ)}
          {box(open.result, open.result.box.home, open.result.homeId, open.result.homeQ)}
          <Btn onClick={() => setOpen(null)}>Close</Btn>
        </Modal>
      )}
    </Screen>
  );
}
