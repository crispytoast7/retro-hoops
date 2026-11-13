import { useEffect, useState } from 'preact/hooks';
import { REG_WEEKS, TRADE_DEADLINE_WEEK } from '../core/constants';
import { capSpace } from '../core/org/finance';
import { EventOutcome, currentEvent, eventText, resolveEvent, teamMorale } from '../core/org/people';
import { endWeek } from '../core/season/flow';
import { userGame } from '../core/season/schedule';
import { teamRatings } from '../core/sim/engine';
import type { Effect, Save } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, useSave } from '../state/store';
import { Btn, Meter, Modal, Panel, Stars, fullName, money, recordStr, teamStarCount } from './kit';
import { nav, replace, reset } from './router';

const TILES: [string, string, string][] = [
  ['roster', 'Roster', '☻'], ['lineup', 'Lineup', '≡'], ['staff', 'Staff', '♟'], ['facilities', 'Facilities', '⌂'],
  ['finances', 'Finances', '$'], ['trades', 'Trades', '⇄'], ['scouting', 'Scouting', '◎'], ['standings', 'Standings', '▤'],
  ['schedule', 'Schedule', '▦'], ['stats', 'Stats', '%'], ['history', 'History', '♛'], ['news', 'News', '✉'],
];
const EFFECT_LABEL: Record<Effect['k'], string> = {
  morale: 'Player morale', teamMorale: 'Team morale', fans: 'Fans', owner: 'Owner', credits: 'Credits', rep: 'Reputation',
  injury: 'Out (weeks)', suspend: 'Suspended (weeks)', tradeDemand: 'Trade demand',
};
export const ROUND_NAME = ['', 'Conference Semifinal', 'Conference Final', 'Championship'];

function EventModal({ save }: { save: Save }) {
  const [out, setOut] = useState<EventOutcome | null>(null);
  const t = currentEvent(save);
  if (!t && !out) return null;
  if (out) {
    return (
      <Modal>
        <h2>RESULT</h2>
        <div>{out.result}</div>
        <div class="row wrap">
          {out.effects.map(e => <span class={`tag ${e.k === 'tradeDemand' || e.k === 'injury' || e.k === 'suspend' || e.v < 0 ? 'bad' : 'good'}`}>{EFFECT_LABEL[e.k]}{e.k === 'tradeDemand' ? '' : ` ${e.v > 0 && e.k !== 'injury' && e.k !== 'suspend' ? '+' : ''}${e.v}`}</span>)}
        </div>
        <Btn kind="primary" onClick={() => setOut(null)}>OK</Btn>
      </Modal>
    );
  }
  const subject = save.pendingEvent?.playerId != null ? save.players[save.pendingEvent.playerId] : null;
  return (
    <Modal>
      <h3>THIS WEEK</h3>
      <h2>{t!.title}</h2>
      <div>{eventText(save, t!.text)}</div>
      {subject && <div class="dim">{subject.name} · {subject.pos} · {subject.trait}</div>}
      <div class="col">
        {t!.choices.map((c, i) => <Btn class="block" onClick={() => { const o = act(s => resolveEvent(s, i)); sfx.select(); setOut(o); }}>{eventText(save, c.label)}</Btn>)}
      </div>
    </Modal>
  );
}

export function HubScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  useEffect(() => {
    if (save.fired) replace('fired');
  }, [save.fired]);
  const g = save.phase !== 'offseason' ? userGame(save) : undefined;
  const opp = g ? save.teams[g.homeId === me.id ? g.awayId : g.homeId] : null;
  const rate = (id: number) => { const t = save.teams[id]; return teamRatings(t.roster.map(p => save.players[p]), t.lineup).ovr; };
  const injuredStarters = me.lineup.filter(id => save.players[id]?.injury).length;
  const expiring = me.roster.filter(id => save.players[id].contract.years <= 1).length;
  const rundown = Object.values(me.facilities).filter(f => f.condition < 50).length;
  const simWeek = () => { const post = act((s, rng) => endWeek(s, rng)); if (post) nav('postgame', { post, simmed: true }); };
  const round = save.phase === 'playoffs' ? ROUND_NAME[save.week - REG_WEEKS] : '';

  return (
    <div class="screen">
      <div class="topbar">
        <span class="swatch" style={{ background: me.colors.primary, boxShadow: `4px 0 0 ${me.colors.secondary}`, marginRight: '4px' }} />
        <div class="grow">
          <h1 class="nowrap">{fullName(me)}</h1>
          <div class="dim" style={{ fontSize: '17px' }}>{recordStr(me)} · Season {save.year}{save.phase === 'regular' ? ` · Week ${save.week}/${REG_WEEKS}` : save.phase === 'playoffs' ? ' · Playoffs' : ' · Offseason'}</div>
        </div>
        <div class="head gold" title="Credits">◉ {save.credits}</div>
        <Btn kind="small" onClick={() => nav('settings')}>⚙</Btn>
      </div>
      <div class="body">
        <div class="panel row" style={{ gap: '10px' }}>
          <Meter label="OWNER" value={save.owner.approval} />
          <Meter label="FANS" value={save.fans} />
          <Meter label="MORALE" value={teamMorale(save, me)} />
        </div>

        {save.phase === 'offseason' ? (
          <Panel team title="OFFSEASON">
            <div>The season is over. Awards, contracts, the draft and free agency await.</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary big block" onClick={() => nav('offseason')}>Go to Offseason</Btn>
          </Panel>
        ) : g && opp && g.played ? (
          <Panel team title={`WEEK ${save.week}`}>
            <div>Your game is in the books. Wrap up the rest of the week.</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary block" onClick={() => { act((s, rng) => { endWeek(s, rng); }); }}>Finish Week</Btn>
          </Panel>
        ) : g && opp ? (
          <Panel team title={save.phase === 'playoffs' ? round.toUpperCase() : `WEEK ${save.week} · ${g.homeId === me.id ? 'HOME' : 'AWAY'}`}>
            <div class="row between">
              <div class="col" style={{ gap: '2px' }}><div class="head">{me.abbr}</div><Stars n={teamStarCount(rate(me.id))} /><div class="dim">{recordStr(me)}</div></div>
              <div class="head dim">{g.homeId === me.id ? 'VS' : 'AT'}</div>
              <div class="col right" style={{ gap: '2px', alignItems: 'flex-end' }}><div class="head">{opp.abbr}</div><Stars n={teamStarCount(rate(opp.id))} /><div class="dim">{opp.name} {recordStr(opp)}</div></div>
            </div>
            <div style={{ height: '10px' }} />
            <div class="row">
              <Btn kind="primary big" class="grow" disabled={me.lineup.length < 5} onClick={() => nav('game', { gameId: g.id })}>Play</Btn>
              <Btn onClick={simWeek}>Sim</Btn>
            </div>
          </Panel>
        ) : (
          <Panel team title={save.phase === 'playoffs' ? 'PLAYOFFS' : 'BYE'}>
            <div>{save.phase === 'playoffs' ? 'Your season is over. The playoffs go on without you.' : 'No game this week.'}</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary block" onClick={simWeek}>{save.phase === 'playoffs' ? `Sim ${round}` : 'Sim Week'}</Btn>
          </Panel>
        )}

        {(save.tradeOffer || injuredStarters > 0 || rundown > 0 || save.tradeDemands.length > 0 || me.roster.length < 8) && (
          <Panel title="NEEDS ATTENTION">
            <div class="list">
              {save.tradeOffer && <div class="item tap" onClick={() => nav('trades')}><span class="grow">Trade offer from {save.teams[save.tradeOffer.aId].name}</span><span class="tag gold">VIEW</span></div>}
              {injuredStarters > 0 && <div class="item tap" onClick={() => nav('lineup')}><span class="grow">{injuredStarters} injured starter{injuredStarters > 1 ? 's' : ''}</span><span class="tag bad">LINEUP</span></div>}
              {save.tradeDemands.filter(id => me.roster.includes(id)).map(id => <div class="item tap" onClick={() => nav('player', { id })}><span class="grow">{save.players[id].name} wants a trade</span><span class="tag bad">UNHAPPY</span></div>)}
              {rundown > 0 && <div class="item tap" onClick={() => nav('facilities')}><span class="grow">{rundown} facilit{rundown > 1 ? 'ies need' : 'y needs'} maintenance</span><span class="tag gold">FIX</span></div>}
              {me.roster.length < 8 && <div class="item tap" onClick={() => nav('trades', { tab: 'Free Agents' })}><span class="grow">Roster is short: sign free agents</span><span class="tag bad">SIGN</span></div>}
            </div>
          </Panel>
        )}

        <div class="grid3">
          {TILES.map(([name, label, ico]) => (
            <Btn class="tile" onClick={() => nav(name)}>
              <span class="ico">{ico}</span><span>{label}{name === 'trades' && save.tradeOffer ? <span class="badge">1</span> : null}</span>
            </Btn>
          ))}
        </div>

        <Panel title="OWNER'S GOALS">
          <div class="list">
            {save.owner.goals.map(gl => <div class="item"><span class="grow">{gl.text}</span>{gl.done ? <span class="tag good">MET</span> : gl.failed ? <span class="tag bad">MISSED</span> : null}</div>)}
          </div>
          <div class="dim" style={{ fontSize: '17px', marginTop: '4px' }}>
            Cap space {money(capSpace(save, me))} · {expiring} contract{expiring === 1 ? '' : 's'} in final year
            {save.phase === 'regular' && save.week <= TRADE_DEADLINE_WEEK ? ` · Trade deadline after week ${TRADE_DEADLINE_WEEK}` : ''}
          </div>
        </Panel>

        <Panel title="LATEST">
          <div class="list">
            {save.news.slice(0, 4).map(n => <div class="item" style={{ minHeight: 0 }}><span class={n.mine ? '' : 'dim'}>{n.text}</span></div>)}
          </div>
          <Btn kind="small" onClick={() => nav('news')}>All news</Btn>
        </Panel>
        <Btn kind="small" onClick={() => reset('title')}>Title screen</Btn>
      </div>
      <EventModal save={save} />
    </div>
  );
}
