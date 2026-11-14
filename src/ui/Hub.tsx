import { useEffect, useState } from 'preact/hooks';
import { capStatus, payroll } from '../core/org/finance';
import { EventOutcome, currentEvent, eventText, resolveEvent, teamMorale } from '../core/org/people';
import { Feature, checklist, gamesToUnlock, isUnlocked, perkPoints, rankName, xpBar } from '../core/org/progress';
import { cal, ROUND_NAMES } from '../core/season/calendar';
import { advance } from '../core/season/flow';
import { gamesInWeek, userGame, userGamesInWeek } from '../core/season/schedule';
import { teamRatings } from '../core/sim/engine';
import type { Effect, Save } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, touch, useSave } from '../state/store';
import { Btn, Meter, Modal, Panel, Stars, fullName, money, recordStr, teamStarCount, toast } from './kit';
import { nav, replace, reset } from './router';
import { holdTips } from './Tips';

const TILES: [string, string, string][] = [
  ['roster', 'Roster', '☻'], ['lineup', 'Lineup', '≡'], ['staff', 'Staff', '♟'], ['facilities', 'Facilities', '⌂'],
  ['finances', 'Finances', '$'], ['trades', 'Trades', '⇄'], ['scouting', 'Scouting', '◎'], ['standings', 'Standings', '▤'],
  ['schedule', 'Schedule', '▦'], ['stats', 'Stats', '%'], ['history', 'History', '♛'], ['news', 'News', '✉'],
  ['coach', 'Coach', '★'], ['practice', 'Practice', '◉'],
];
const EFFECT_LABEL: Record<Effect['k'], string> = {
  morale: 'Player morale', teamMorale: 'Team morale', fans: 'Fans', owner: 'Owner', credits: 'Credits', rep: 'Reputation',
  injury: 'Out (weeks)', suspend: 'Suspended (weeks)', tradeDemand: 'Trade demand',
};

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
        <Btn kind="primary" onClick={() => { holdTips(false); setOut(null); touch(); }}>OK</Btn>
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
        {t!.choices.map((c, i) => <Btn class="block" onClick={() => { holdTips(true); const o = act(s => resolveEvent(s, i)); sfx.select(); if (o) setOut(o); else holdTips(false); }}>{eventText(save, c.label)}</Btn>)}
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
  const c = cal(save);
  const xp = xpBar(save);
  const steps = checklist(save);
  const todo = steps.filter(x => !x.done);
  const REG_WEEKS = c.regWeeks, TRADE_DEADLINE_WEEK = c.deadlineWeek;
  const sim = (mode: 'simGame' | 'simWeek') => {
    const before = save.credits;
    const posts = act((s, rng) => advance(s, rng, mode));
    if (posts.length === 1) nav('postgame', { post: posts[0], simmed: true });
    else if (posts.length > 1) { const w = posts.filter(p => p.won).length; toast(`Simulated ${posts.length} games: ${w}-${posts.length - w}. Credits +${save.credits - before}.`, true); }
  };
  const simWeek = () => sim('simWeek');
  const round = save.phase === 'playoffs' ? ROUND_NAMES[save.week - REG_WEEKS] : '';
  const weekGames = save.phase === 'regular' ? userGamesInWeek(save) : [];
  const gameNo = g ? weekGames.findIndex(x => x.id === g.id) + 1 : 0;
  const series = save.phase === 'playoffs' && g ? save.playoffs?.series.find(s => s.winnerId === undefined && (s.highId === me.id || s.lowId === me.id)) : undefined;
  const myW = series ? (series.highId === me.id ? series.highW : series.lowW) : 0, oppW = series ? (series.highId === me.id ? series.lowW : series.highW) : 0;
  const seriesText = !series || c.seriesWins === 1 ? '' : myW === oppW ? `Series tied ${myW}-${oppW}` : myW > oppW ? `You lead ${myW}-${oppW}` : `You trail ${myW}-${oppW}`;
  const openGames = save.phase !== 'offseason' && gamesInWeek(save, save.week).some(x => !x.played);

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
        <div class="panel row tap" style={{ gap: '10px', padding: '6px 10px' }} onClick={() => isUnlocked(save, 'coach') ? nav('coach') : toast('The coach profile unlocks after 2 games.')}>
          <span class="head gold" style={{ whiteSpace: 'nowrap' }}>LV {xp.level}</span>
          <Meter label={rankName(xp.level).toUpperCase()} value={xp.pct} color="var(--gold)" text={xp.need ? `${xp.into}/${xp.need} XP` : 'MAX'} />
        </div>

        {save.phase === 'offseason' ? (
          <Panel team title="OFFSEASON">
            <div>The season is over. Awards, contracts, the draft and free agency await.</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary big block" onClick={() => nav('offseason')}>Go to Offseason</Btn>
          </Panel>
        ) : g && opp ? (
          <Panel team title={save.phase === 'playoffs' ? `${round.toUpperCase()}${c.seriesWins > 1 ? ` · GAME ${myW + oppW + 1}` : ''}` : `WEEK ${save.week}${weekGames.length > 1 ? ` · GAME ${gameNo} OF ${weekGames.length}` : ''} · ${g.homeId === me.id ? 'HOME' : 'AWAY'}`}>
            <div class="row between">
              <div class="col" style={{ gap: '2px' }}><div class="head">{me.abbr}</div><Stars n={teamStarCount(rate(me.id))} /><div class="dim">{recordStr(me)}</div></div>
              <div class="head dim">{g.homeId === me.id ? 'VS' : 'AT'}</div>
              <div class="col right" style={{ gap: '2px', alignItems: 'flex-end' }}><div class="head">{opp.abbr}</div><Stars n={teamStarCount(rate(opp.id))} /><div class="dim">{opp.name} {recordStr(opp)}</div></div>
            </div>
            <div style={{ height: '10px' }} />
            <div class="row">
              <Btn kind="primary big" class="grow" disabled={me.lineup.length < 5} onClick={() => nav('game', { gameId: g.id })}>Play</Btn>
              <Btn onClick={() => sim('simGame')}>Sim</Btn>
            </div>
            {seriesText && <div class="gold center" style={{ marginTop: '8px' }}>{seriesText} · best of {c.seriesWins * 2 - 1}</div>}
            {(weekGames.length > 1 || c.seriesWins > 1) && <><div style={{ height: '8px' }} /><Btn kind="small block" onClick={simWeek}>{save.phase === 'playoffs' ? 'Sim the rest of the round' : 'Sim the rest of the week'}</Btn></>}
          </Panel>
        ) : (
          <Panel team title={save.phase === 'playoffs' ? 'PLAYOFFS' : 'BYE'}>
            <div>{save.phase === 'playoffs' ? (save.playoffs?.series.some(x => x.round === save.week - REG_WEEKS && (x.highId === me.id || x.lowId === me.id)) ? 'Your series is decided. The rest of the round plays out.' : 'Your season is over. The playoffs go on without you.') : openGames ? 'Your games this week are done.' : 'No game this week.'}</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary block" onClick={simWeek}>{save.phase === 'playoffs' ? `Sim ${round}` : 'Finish Week'}</Btn>
          </Panel>
        )}

        {todo.length > 0 && save.phase !== 'offseason' && (
          <Panel title={`GETTING STARTED · ${steps.filter(x => x.done).length}/${steps.length}`}>
            <div class="list">
              {todo.slice(0, 3).map((st, i) => (
                <div class={`item ${st.go ? 'tap' : ''}`} onClick={() => { if (st.go) nav(st.go); }}>
                  <span class="tag gold" style={{ minWidth: '22px', textAlign: 'center' }}>{i === 0 ? 'NEXT' : '·'}</span>
                  <div class="grow"><div>{st.text}</div>{i === 0 && <div class="dim" style={{ fontSize: '17px' }}>{st.why}</div>}</div>
                  {st.go && <span class="dim">&gt;</span>}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {(save.tradeOffer || injuredStarters > 0 || rundown > 0 || save.tradeDemands.length > 0 || me.roster.length < 8) && (
          <Panel title="NEEDS ATTENTION">
            <div class="list">
              {save.tradeOffer && isUnlocked(save, 'trades') && <div class="item tap" onClick={() => nav('trades')}><span class="grow">Trade offer from {save.teams[save.tradeOffer.aId].name}</span><span class="tag gold">VIEW</span></div>}
              {injuredStarters > 0 && <div class="item tap" onClick={() => nav('lineup')}><span class="grow">{injuredStarters} injured starter{injuredStarters > 1 ? 's' : ''}</span><span class="tag bad">LINEUP</span></div>}
              {save.tradeDemands.filter(id => me.roster.includes(id)).map(id => <div class="item tap" onClick={() => nav('player', { id })}><span class="grow">{save.players[id].name} wants a trade</span><span class="tag bad">UNHAPPY</span></div>)}
              {rundown > 0 && <div class="item tap" onClick={() => nav('facilities')}><span class="grow">{rundown} facilit{rundown > 1 ? 'ies need' : 'y needs'} maintenance</span><span class="tag gold">FIX</span></div>}
              {me.roster.length < 8 && <div class="item tap" onClick={() => nav('trades', { tab: 'Free Agents' })}><span class="grow">Roster is short: sign free agents</span><span class="tag bad">SIGN</span></div>}
            </div>
          </Panel>
        )}

        <div class="grid3">
          {TILES.map(([name, label, ico]) => {
            const open = name === 'practice' || isUnlocked(save, name as Feature);
            const left = open ? 0 : gamesToUnlock(save, name as Feature);
            if (!open) return (
              <Btn class="tile locked" onClick={() => toast(`${label} unlocks after ${left} more game${left === 1 ? '' : 's'}.`)} silent>
                <span class="ico">▣</span><span>{label}</span><span class="dim" style={{ fontSize: '7px' }}>{left} GAME{left === 1 ? '' : 'S'}</span>
              </Btn>
            );
            return (
              <Btn class="tile" onClick={() => nav(name)}>
                <span class="ico">{ico}</span><span>{label}{name === 'trades' && save.tradeOffer ? <span class="badge">1</span> : null}{name === 'coach' && perkPoints(save) > 0 ? <span class="badge">{perkPoints(save)}</span> : null}</span>
              </Btn>
            );
          })}
        </div>

        <Panel title="OWNER'S GOALS">
          <div class="list">
            {save.owner.goals.map(gl => <div class="item"><span class="grow">{gl.text}</span>{gl.done ? <span class="tag good">MET</span> : gl.failed ? <span class="tag bad">MISSED</span> : null}</div>)}
          </div>
          <div class="dim" style={{ fontSize: '17px', marginTop: '4px' }}>
            Payroll {money(payroll(save, me))} ({capStatus(save, me)}) · {expiring} contract{expiring === 1 ? '' : 's'} in final year
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
