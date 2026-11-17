import { useState } from 'preact/hooks';
import { HARD_LIMIT, MAX_CONTRACT_YEARS, MAX_SALARY, MIN_DEAL_YEARS, MIN_SALARY, SALARY_CAP } from '../core/constants';
import { capSpace, limitSpace, payroll, statusOf } from '../core/org/finance';
import { useSave } from '../state/store';
import { Btn, Panel, Screen, money } from './kit';
import { CapBar, CapTag } from './OffseasonParts';
import { nav } from './router';

/** The whole rulebook, in plain words. */
const RULES: string[] = [
  `The salary cap is ${money(SALARY_CAP)}. To sign a free agent from another team you need room under it.`,
  `You may go over the cap only to re-sign your own players (up to ${MAX_CONTRACT_YEARS} years), for minimum deals (${money(MIN_SALARY)}, 1 or ${MIN_DEAL_YEARS} years) and for draft picks.`,
  `The hard limit is ${money(HARD_LIMIT)}. No payroll may pass it, not even to re-sign your own players.`,
  'Trades: end at or under the cap and anything goes. End over the cap and you cannot take back more salary than you send out.',
];

export function FinancesScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const pay = payroll(save, me);
  const status = statusOf(pay);
  const space = capSpace(save, me), toLimit = limitSpace(save, me);
  const players = me.roster.map(id => save.players[id]).sort((a, b) => b.contract.salary - a.contract.salary);
  const nextYear = Math.round(players.filter(p => p.contract.years >= 2).reduce((s, p) => s + p.contract.salary, 0) * 10) / 10;
  const finalYear = players.filter(p => p.contract.years === 1);
  const finalTotal = Math.round(finalYear.reduce((s, p) => s + p.contract.salary, 0) * 10) / 10;

  const [rules, setRules] = useState(false);
  // the one thing that matters most, in plain words
  const headline = space >= MIN_SALARY
    ? { big: `You can offer a free agent up to ${money(Math.min(space, MAX_SALARY))}`, small: 'That is your room under the salary cap. You can also re-sign your own players.', cls: 'good' }
    : toLimit < 2
      ? { big: 'You are at the hard limit', small: 'Minimum deals and draft picks only, until some salary comes off.', cls: 'bad' }
      : { big: 'Over the cap: minimum deals only', small: `Other teams' free agents will only get a ${money(MIN_SALARY)} deal from you. You can still re-sign your own players, up to ${money(toLimit)} more.`, cls: 'gold' };

  return (
    <Screen title="Finances" right={<div class="head gold">◉ {save.credits}</div>}>
      <Panel title="YOUR MONEY AT A GLANCE" team>
        <div class={`fin-big ${headline.cls}`}>{headline.big}</div>
        <div class="dim" style={{ fontSize: '18px', margin: '2px 0 8px' }}>{headline.small}</div>
        <div class="row between"><span>Payroll <b>{money(pay)}</b> of a {money(SALARY_CAP)} cap</span><CapTag status={status} /></div>
        <CapBar pay={pay} />
        <div class="list" style={{ marginTop: '6px' }}>
          <div class="item" style={{ minHeight: '34px' }}>
            <span class="grow">Contracts ending this summer</span>
            <span class={finalYear.length ? 'gold right' : 'dim'}>{finalYear.length ? finalYear.map(p => p.name.split(' ').slice(-1)[0]).join(', ') : 'None'}</span>
          </div>
          {finalYear.length > 0 && <div class="dim" style={{ fontSize: '17px', padding: '0 6px 6px' }}>Re-sign them in the offseason, or they leave for nothing. That frees {money(finalTotal)} if they go.</div>}
          {me.deadCap > 0 && (
            <div class="item" style={{ minHeight: '34px' }}>
              <span class="grow">Dead money (released players)</span>
              <span class="bad">{money(me.deadCap)}</span>
            </div>
          )}
        </div>
        <Btn kind="small" class="block" onClick={() => setRules(!rules)}>{rules ? 'Hide the rules' : 'How the cap works ▾'}</Btn>
        {rules && (
          <div class="list cap-rules" style={{ marginTop: '6px' }}>
            {RULES.map((r, i) => <div class="item"><span class="n">{i + 1}</span><span class="grow">{r}</span></div>)}
          </div>
        )}
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
              {me.deadCap > 0 && <tr class="dim"><td>Dead money</td><td /><td /><td>{money(me.deadCap)}</td><td /></tr>}
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
