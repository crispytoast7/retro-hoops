import { TAP } from '../state/device';
import { useState } from 'preact/hooks';
import { ROSTER_MAX, SALARY_CAP } from '../core/constants';
import { capStatus, payroll } from '../core/org/finance';
import { ovr } from '../core/ratings';
import { POSITIONS } from '../core/types';
import { useSave } from '../state/store';
import { Btn, Panel, PlayerRow, Screen, Tabs, money, moraleTag } from './kit';
import { CapTag } from './OffseasonParts';
import { nav } from './router';

export function RosterScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const [sort, setSort] = useState<'Position' | 'Overall' | 'Salary' | 'Age'>('Position');
  const starters = new Set(me.lineup);
  const players = me.roster.map(id => save.players[id]).sort((a, b) =>
    sort === 'Overall' ? ovr(b) - ovr(a)
      : sort === 'Salary' ? b.contract.salary - a.contract.salary
        : sort === 'Age' ? a.age - b.age
          : POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || ovr(b) - ovr(a));
  return (
    <Screen title="Roster" right={<Btn kind="small" onClick={() => nav('lineup')}>Lineup</Btn>}>
      <div class="row between dim" style={{ fontSize: '18px' }}>
        <span>{me.roster.length}/{ROSTER_MAX} players</span>
        <span class="row" style={{ gap: '6px' }}>Payroll {money(payroll(save, me))} / cap {money(SALARY_CAP)} <CapTag status={capStatus(save, me)} /></span>
      </div>
      <Tabs tabs={['Position', 'Overall', 'Salary', 'Age'] as const} value={sort} onChange={setSort} />
      <Panel>
        <div class="list">
          {players.map(p => (
            <PlayerRow save={save} player={p} onClick={() => nav('player', { id: p.id })}
              note={<span>{starters.has(p.id) ? 'Starter' : 'Bench'}</span>}
              right={<div class="col right" style={{ gap: '3px', alignItems: 'flex-end' }}><span>{money(p.contract.salary)} · {p.contract.years}y</span>{moraleTag(p.morale)}</div>} />
          ))}
        </div>
      </Panel>
      <div class="dim" style={{ fontSize: '17px' }}>{TAP} a player for ratings, stats, upgrades and contract options.</div>
    </Screen>
  );
}
