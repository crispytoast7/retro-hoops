import { FIRST_APRON, LUXURY_TAX, MAX_CONTRACT_YEARS, MIN_DEAL_YEARS, MIN_SALARY, SALARY_CAP, SECOND_APRON } from '../core/constants';
import { capSpace, luxuryTax, mleStatus, payroll, statusOf } from '../core/org/finance';
import type { Save, Team } from '../core/types';
import { useSave } from '../state/store';
import { Panel, Screen, money } from './kit';
import { CapBar, CapTag } from './OffseasonParts';
import { nav } from './router';

/** What the league rules let this team do, and stop it doing, at its current payroll. One line each. */
function capRules(save: Save, team: Team): { ok: boolean; text: string }[] {
  const pay = payroll(save, team), status = statusOf(pay);
  const space = capSpace(save, team), mle = mleStatus(save, team);
  const out: { ok: boolean; text: string }[] = [];
  out.push(space >= MIN_SALARY
    ? { ok: true, text: `Sign free agents into your ${money(space)} of cap space.` }
    : { ok: false, text: 'Sign free agents with cap space: your payroll is over the cap.' });
  out.push(mle.available
    ? { ok: true, text: `Sign one free agent for up to ${money(mle.amount)} with the ${mle.kind === 'mle' ? 'mid-level exception' : 'taxpayer mid-level exception'}. Once a season.` }
    : { ok: false, text: team.mleUsed ? 'Use the mid-level exception: you already used it this season.'
      : status === 'second apron' ? 'Use a mid-level exception: there is none above the second apron.'
      : 'Use a mid-level exception: it would push you past the second apron.' });
  out.push({ ok: true, text: `Sign anyone to a minimum deal: ${money(MIN_SALARY)} for 1 or ${MIN_DEAL_YEARS} years.` });
  out.push({ ok: true, text: `Re-sign your own players when their deals end, for up to ${MAX_CONTRACT_YEARS} years, however high your payroll.` });
  if (status === 'under cap') out.push({ ok: true, text: `Take back any salary in a trade that fits under the cap. Past it: up to 125% of what you send, plus $0.25M.` });
  else if (status === 'over cap' || status === 'taxpayer') out.push({ ok: true, text: `Take back up to 125% of the salary you send in a trade, plus $0.25M, while you stay at or under the first apron (${money(FIRST_APRON)}).` });
  else out.push({ ok: false, text: 'Take back more salary in a trade than you send out.' });
  if (status === 'second apron') {
    out.push({ ok: false, text: 'Send out more than one player in the same trade.' });
    out.push({ ok: false, text: 'Trade away a first-round pick.' });
  } else {
    out.push({ ok: true, text: `Combine players in a trade and trade first-round picks. Both stop above the second apron (${money(SECOND_APRON)}).` });
  }
  return out;
}

export function FinancesScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const pay = payroll(save, me);
  const status = statusOf(pay);
  const space = capSpace(save, me);
  const tax = luxuryTax(save, me);
  const mle = mleStatus(save, me);
  const players = me.roster.map(id => save.players[id]).sort((a, b) => b.contract.salary - a.contract.salary);
  const nextYear = Math.round(players.filter(p => p.contract.years >= 2).reduce((s, p) => s + p.contract.salary, 0) * 10) / 10;

  return (
    <Screen title="Finances" right={<div class="head gold">◉ {save.credits}</div>}>
      <Panel title="PAYROLL AND THE CAP" team>
        <div class="row between"><span>Payroll <b>{money(pay)}</b></span><CapTag status={status} /></div>
        <CapBar pay={pay} />
        <div class="row between wrap cap-note">
          {space >= 0
            ? <span>Cap space <b class="good">{money(space)}</b></span>
            : <span>Over the cap by <b>{money(-space)}</b></span>}
          <span>Dead cap <b class={me.deadCap > 0 ? 'bad' : 'dim'}>{money(me.deadCap)}</b></span>
        </div>
        <div class="list" style={{ marginTop: '6px' }}>
          <div class="item" style={{ minHeight: '34px' }}>
            <span class="grow">Tax bill today</span>
            {tax.over > 0
              ? <span class="bad right">◉ {tax.credits} and −{tax.ownerHit} owner approval</span>
              : <span class="good right">None: {money(Math.round((LUXURY_TAX - pay) * 10) / 10)} under the line</span>}
          </div>
          <div class="item" style={{ minHeight: '34px' }}>
            <span class="grow">Mid-level exception</span>
            {mle.available
              ? <span class="good right">{mle.kind === 'taxMle' ? 'Taxpayer size: ' : 'Available: '}up to {money(mle.amount)}</span>
              : <span class="dim right">{me.mleUsed ? 'Used this season' : 'Not available'}</span>}
          </div>
        </div>
        <div class="dim cap-note" style={{ marginTop: '6px' }}>
          {tax.over > 0
            ? `You are ${money(tax.over)} over the tax line. If the season ended today it would cost that bill: 1 credit per $3M over and 1 owner approval per $4M over (at least 2).`
            : `The cap (${money(SALARY_CAP)}) is soft: you may pass it by re-signing your own players, with minimum deals and with the mid-level exception. Finish a season above ${money(LUXURY_TAX)} and you pay luxury tax.`}
        </div>
      </Panel>

      <Panel title="LEAGUE RULES FOR YOU RIGHT NOW">
        <div class="list cap-rules">
          {capRules(save, me).map(r => (
            <div class="item"><span class={`tag ${r.ok ? 'good' : 'bad'}`}>{r.ok ? 'CAN' : "CAN'T"}</span><span class="grow">{r.text}</span></div>
          ))}
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
