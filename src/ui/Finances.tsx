import { SALARY_CAP } from '../core/constants';
import { capSpace, payroll } from '../core/org/finance';
import { useSave } from '../state/store';
import { Panel, Screen, money } from './kit';
import { nav } from './router';

export function FinancesScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const pay = payroll(save, me);
  const players = me.roster.map(id => save.players[id]).sort((a, b) => b.contract.salary - a.contract.salary);
  const nextYear = Math.round(players.filter(p => p.contract.years >= 2).reduce((s, p) => s + p.contract.salary, 0) * 10) / 10;
  const pctUsed = Math.min(100, (pay / SALARY_CAP) * 100);

  return (
    <Screen title="Finances" right={<div class="head gold">◉ {save.credits}</div>}>
      <Panel title="SALARY CAP" team>
        <div class="row between"><span>Payroll {money(pay)}</span><span class="dim">Cap {money(SALARY_CAP)}</span></div>
        <div style={{ height: '16px', background: 'var(--edge)', border: '2px solid var(--edge)', margin: '6px 0' }}>
          <div style={{ width: `${pctUsed}%`, height: '100%', background: pctUsed > 95 ? 'var(--bad)' : pctUsed > 80 ? 'var(--gold)' : 'var(--good)' }} />
        </div>
        <div class="row between wrap">
          <span>Cap space <b class={capSpace(save, me) > 0 ? 'good' : 'bad'}>{money(capSpace(save, me))}</b></span>
          <span>Dead cap <b class={me.deadCap > 0 ? 'bad' : 'dim'}>{money(me.deadCap)}</b></span>
        </div>
      </Panel>

      <Panel title="PAYROLL">
        <div class="scrollx">
          <table class="tbl">
            <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Salary</th><th>Yrs</th></tr></thead>
            <tbody>
              {players.map(p => (
                <tr style={{ cursor: 'pointer', height: '40px' }} onClick={() => nav('player', { id: p.id })}>
                  <td>{p.name}</td>
                  <td>{p.pos}</td>
                  <td>{p.age}</td>
                  <td>{money(p.contract.salary)}</td>
                  <td class={p.contract.years <= 1 ? 'gold' : ''}>{p.contract.years}{p.contract.years <= 1 ? '!' : ''}</td>
                </tr>
              ))}
              {me.deadCap > 0 && <tr class="dim"><td>Dead cap</td><td /><td /><td>{money(me.deadCap)}</td><td /></tr>}
            </tbody>
          </table>
        </div>
        <div class="dim" style={{ marginTop: '4px' }}>Next season committed: {money(nextYear)} ({players.filter(p => p.contract.years >= 2).length} players). Gold = final year.</div>
      </Panel>

      <Panel title="CREDITS">
        <div class="head gold" style={{ marginBottom: '8px' }}>◉ {save.credits}</div>
        <div class="list">
          {[
            ['Win', '3'], ['Loss', '1'], ['Home gate', 'fans x arena level'], ['Highlight plays', 'up to 3'],
            ['Milestones', 'streaks, win totals'], ['Playoff win', '5'], ['Championship', '15'],
          ].map(([a, b]) => <div class="item row between" style={{ minHeight: '32px' }}><span>{a}</span><span class="gold">{b}</span></div>)}
        </div>
        <div class="dim" style={{ marginTop: '4px' }}>Spend credits on staff, facilities and player upgrades.</div>
      </Panel>
    </Screen>
  );
}
