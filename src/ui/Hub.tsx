import { allStarPending, allStarState, finishAllStar } from '../core/org/allstar';
import { badgeOf } from '../core/badges';
import { pcText } from '../state/device';
import { useEffect, useState } from 'preact/hooks';
import { SALARY_CAP } from '../core/constants';
import { capStatus, payroll } from '../core/org/finance';
import { EventOutcome, currentEvent, eventText, resolveEvent, teamMorale } from '../core/org/people';
import { Feature, checklist, gamesToUnlock, isUnlocked, perkPoints, rankName, tutorialNeeded, xpBar } from '../core/org/progress';
import { cal, ROUND_NAMES, seriesNeed } from '../core/season/calendar';
import { advance, playoffsUnsettled, settlePlayoffs } from '../core/season/flow';
import { gamesInWeek, userGame, userGamesInWeek } from '../core/season/schedule';
import { playoffMoment } from '../core/season/bracket';
import { readyToLevel } from '../core/org/xp';
import { choresList, doChores } from '../core/org/chores';
import { pendingMoment, stakesFor } from '../core/org/moments';
import { BigMomentHost } from './BigMoment';
import { ClubView } from './ClubView';
import { doPlan, skipPlan, edgeFor, ensureWeek, honorNow, intel, pressure, needsWeek, plansOpen, signSponsor, sponsorOf, sponsorOffers, sponsorOpen, sponsorProgress, weekState } from '../core/org/week';
import { ovr } from '../core/ratings';
import { teamRatings } from '../core/sim/engine';
import type { Effect, Save } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, touch, useSave } from '../state/store';
import { BadgeTag, Btn, Meter, Modal, Panel, Stars, fullName, money, recordStr, short, teamStarCount, toast } from './kit';
import { nav, replace, reset } from './router';
import { holdTips } from './Tips';

const TILES: [string, string, string][] = [
  ['roster', 'Roster', '☻'], ['lineup', 'Lineup', '≡'], ['staff', 'Staff', '♟'], ['facilities', 'Facilities', '⌂'],
  ['finances', 'Finances', '$'], ['trades', 'Trades', '⇄'], ['scouting', 'Scouting', '◎'], ['standings', 'Standings', '▤'],
  ['schedule', 'Schedule', '▦'], ['stats', 'Stats', '%'], ['history', 'History', '♛'], ['news', 'News', '✉'],
  ['coach', 'Coach', '★'], ['practice', 'Practice', '◉'],
];
/** The hub's four areas. */
const GROUPS: [string, string[]][] = [
  ['TEAM', ['roster', 'lineup', 'coach']],
  ['FRONT OFFICE', ['staff', 'facilities', 'finances']],
  ['PLAYER MARKET', ['trades', 'scouting', 'practice']],
  ['LEAGUE', ['standings', 'schedule', 'stats', 'news', 'history']],
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

/** The playoff moment already on its way to the screen, so a re-render does not open it twice. */
let shownMoment = '';
const CHORE_SCREEN = { repair: 'facilities', level: 'roster', lineup: 'lineup', scout: 'scouting' } as const;
const PLAN_GROUP = { train: 'TRAIN', prep: 'PREPARE', club: 'CLUB' } as const;
/** One move a week: three to choose from, and what you pass on is gone. */
function WeekPlan({ save }: { save: Save }) {
  const w = weekState(save);
  if (!plansOpen(save) || needsWeek(save) || !w.hand.length) return null;
  if (w.picked === 'skip') return null;
  if (w.picked) {
    const plan = w.hand.find(p => p.id === w.picked);
    return (
      <Panel title="YOUR MOVE THIS WEEK">
        <div class="gold">{plan?.title}</div>
        <div>{w.result}</div>
        <div class="dim" style={{ fontSize: '17px' }}>{plan?.effect}</div>
      </Panel>
    );
  }
  return (
    <Panel title="YOUR MOVE THIS WEEK · PICK ONE">
      <div class="col" style={{ gap: '6px' }}>
        {w.hand.map(p => (
          <Btn class="opt plan" silent onClick={() => { const r = act((s, rng) => doPlan(s, p.id, rng)); if (r) { if (p.id === 'sponsorday') sfx.coin(); else sfx.select(); } else toast('That is not possible right now.'); }}>
            <span class={`tag ${p.group === 'train' ? 'good' : p.group === 'prep' ? 'gold' : ''}`}>{PLAN_GROUP[p.group]}</span>
            <span>{p.title}</span>
            <span class="fx">{p.effect}</span>
          </Btn>
        ))}
      </div>
      <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>The other two are gone once you choose. New options next week.</div>
    </Panel>
  );
}
function SponsorOffer({ save }: { save: Save }) {
  if (!sponsorOpen(save)) return null;
  return (
    <Panel title="SPONSOR DEAL · PICK ONE FOR THE SEASON">
      <div class="col" style={{ gap: '6px' }}>
        {sponsorOffers(save).map((o, i) => (
          <Btn class="opt plan" silent onClick={() => { touch(s => signSponsor(s, i)); sfx.coin(); toast(`Signed with ${o.name}.`, true); }}>
            <span class={`tag ${o.tier === 'Bold' ? 'bad' : o.tier === 'Solid' ? 'gold' : 'good'}`}>{o.tier.toUpperCase()}</span>
            <span>{o.name}</span>
            <span class="fx">{o.text}: <span class="gold">+{o.credits} credits</span></span>
          </Btn>
        ))}
      </div>
      <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>Hit the target before the season ends and they pay. Miss it and you get nothing.</div>
    </Panel>
  );
}

export function HubScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  useEffect(() => {
    if (save.fired) replace('fired');
  }, [save.fired]);
  // stop for playoff news: it begins, you advance, you are out, you are champions
  useEffect(() => {
    const m = playoffMoment(save);
    if (!m || save.fired || m.id === shownMoment) return;
    shownMoment = m.id;
    nav(m.kind === 'champion' ? 'champion' : 'bracket', { moment: m });
  });
  // a new coach who has not finished the controls tutorial goes back to it (he may have closed the game half way)
  useEffect(() => { if (tutorialNeeded(save)) replace('practice'); }, []);
  // a playoff game that was played but never counted toward its series (a bug in older versions left the
  // Championship stuck this way) is counted now, which brings up the next game of the series
  useEffect(() => { if (playoffsUnsettled(save)) act((st, rng) => settlePlayoffs(st, rng)); });
  // deal this week's plans the first time the hub shows a new week
  useEffect(() => { if (needsWeek(save)) touch(s => { ensureWeek(s); }); });
  const g = save.phase !== 'offseason' ? userGame(save) : undefined;
  const opp = g ? save.teams[g.homeId === me.id ? g.awayId : g.homeId] : null;
  const rate = (id: number) => { const t = save.teams[id]; return teamRatings(t.roster.map(p => save.players[p]), t.lineup).ovr; };
  const injuredStarters = me.lineup.filter(id => save.players[id]?.injury).length;
  const expiring = me.roster.filter(id => save.players[id].contract.years <= 1).length;
  const rundown = Object.values(me.facilities).filter(f => f.condition < 50).length;
  const c = cal(save);
  const xp = xpBar(save);
  const levelers = readyToLevel(save);
  const steps = checklist(save);
  const chores = choresList(save);
  const choreCost = chores.reduce((s, c) => s + c.cost, 0);
  // the things only you can decide
  const people = [
    save.tradeOffer && isUnlocked(save, 'trades') ? <div class="item tap" onClick={() => nav('trades', { tab: 'Offers' })}><span class="grow">Trade offer from the {save.teams[save.tradeOffer.aId].name}</span><span class="tag gold">VIEW</span></div> : null,
    ...save.tradeDemands.filter(id => me.roster.includes(id)).map(id => <div class="item tap" onClick={() => nav('player', { id })}><span class="grow">{save.players[id].name} wants a trade</span><span class="tag bad">UNHAPPY</span></div>),
    me.roster.length < 8 ? <div class="item tap" onClick={() => nav('trades', { tab: 'Free Agents' })}><span class="grow">Roster is short: sign free agents</span><span class="tag bad">SIGN</span></div> : null,
  ].filter(Boolean);
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
  const need = series ? seriesNeed(save, series.round) : c.seriesWins;
  const seriesText = !series || need === 1 ? '' : myW === oppW ? `Series tied ${myW}-${oppW}` : myW > oppW ? `You lead ${myW}-${oppW}` : `You trail ${myW}-${oppW}`;
  const info = g ? intel(save, g) : null;
  const edge = edgeFor(save);
  const lean = g ? pressure(save) : 0;
  const planWaiting = plansOpen(save) && !needsWeek(save) && weekState(save).hand.length > 0 && !weekState(save).picked;
  // the weekly move is asked for on the way to the game, so nobody forgets it
  const [ask, setAsk] = useState<null | 'play' | 'sim' | 'week'>(null);
  const run = (what: 'play' | 'sim' | 'week') => { if (what === 'play' && g) nav('game', { gameId: g.id }); else if (what === 'sim') sim('simGame'); else simWeek(); };
  const go = (what: 'play' | 'sim' | 'week') => { if (planWaiting) setAsk(what); else run(what); };
  const sponsor = sponsorOf(save);
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
        <ClubView save={save} compact onPick={() => isUnlocked(save, 'facilities') ? nav('facilities') : toast(`Facilities unlock after ${gamesToUnlock(save, 'facilities')} more game${gamesToUnlock(save, 'facilities') === 1 ? '' : 's'}.`)} />
        <div class="panel row" style={{ gap: '10px' }}>
          <Meter label="OWNER" value={save.owner.approval} />
          <Meter label="FANS" value={save.fans} />
          <Meter label="MORALE" value={teamMorale(save, me)} />
        </div>
        <div class="panel row tap" style={{ gap: '10px', padding: '6px 10px' }} onClick={() => isUnlocked(save, 'coach') ? nav('coach') : toast('The coach profile unlocks after 2 games.')}>
          <span class="head gold" style={{ whiteSpace: 'nowrap' }}>LV {xp.level}</span>
          <Meter label={rankName(xp.level).toUpperCase()} value={xp.pct} color="var(--gold)" text={xp.need ? `${xp.into}/${xp.need} XP` : 'MAX'} />
        </div>

        {allStarPending(save) && (() => {
          const as = allStarState(save)!;
          const sh = save.players[as.shooterId], dk = save.players[as.dunkerId];
          const mine = as.stars.map(id => save.players[id]).filter(pl => pl && pl.teamId === me.id);
          return (
            <div class="panel as-panel">
              <div class="head gold">★ ALL-STAR WEEKEND</div>
              {mine.length > 0 && <div class="gold">{mine.map(pl => short(pl.name)).join(', ')}: All-Star{mine.length === 1 ? '' : 's'}!</div>}
              <div>{short(sh.name)} is in the three-point contest. {short(dk.name)} is in the dunk contest.</div>
              <div style={{ height: '8px' }} />
              <div class="row">
                <Btn kind="primary" class="grow" onClick={() => nav('allstar')}>Play the contests</Btn>
                <Btn onClick={() => { act(st => finishAllStar(st)); toast('The contests went on without you. Results are in the news.', true); }}>Skip</Btn>
              </div>
            </div>
          );
        })()}

        {save.phase === 'offseason' ? (
          <Panel team title="OFFSEASON">
            <div>The season is over. Awards, contracts, the draft and free agency await.</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary big block" onClick={() => nav('offseason')}>Go to Offseason</Btn>
          </Panel>
        ) : g && opp ? (
          <Panel team title={save.phase === 'playoffs' ? `${round.toUpperCase()}${need > 1 ? ` · GAME ${myW + oppW + 1}` : ''}` : `WEEK ${save.week}${weekGames.length > 1 ? ` · GAME ${gameNo} OF ${weekGames.length}` : ''} · ${g.homeId === me.id ? 'HOME' : 'AWAY'}`}>
            <div class="row between">
              <div class="col" style={{ gap: '2px' }}><div class="head">{me.abbr}</div><Stars n={teamStarCount(rate(me.id))} /><div class="dim">{recordStr(me)}</div></div>
              <div class="head dim">{g.homeId === me.id ? 'VS' : 'AT'}</div>
              <div class="col right" style={{ gap: '2px', alignItems: 'flex-end' }}><div class="head">{opp.abbr}</div><Stars n={teamStarCount(rate(opp.id))} /><div class="dim">{opp.name} {recordStr(opp)}</div></div>
            </div>
            {info && (
              <div class="intel">
                {info.rival && <div><span class="tag gold">RIVALRY GAME</span> <span class="gold">Win: +2 credits, fans +3</span></div>}
                {info.star && <div class="tap" onClick={() => nav('player', { id: info.star!.id })}><span class="dim">Their star:</span> {info.star.pos} {short(info.star.name)} <Stars v={ovr(info.star)} />{info.starPpg > 0 ? <span class="dim"> {info.starPpg.toFixed(1)} ppg</span> : null}</div>}
                {opp.lineup.map(id => save.players[id]).filter(pl => pl && !pl.injury && badgeOf(pl)).slice(0, 3).map(pl => (
                  <div class="tap" onClick={() => nav('player', { id: pl.id })}><BadgeTag player={pl} /> <span class="dim">{pl.pos}</span> {short(pl.name)}</div>
                ))}
                {info.run && <div class={info.run.startsWith('Won') ? 'bad' : 'good'}>{opp.name}: {info.run.toLowerCase()}</div>}
                {info.race && <div class="dim">{info.race}</div>}
                {lean >= 1.5 && <div class="bad">TARGET ON YOUR BACK · everyone brings their best against you (opponents +{lean})</div>}
                {lean <= -1 && <div class="good">TAKEN LIGHTLY · they are not up for this one (opponents {lean})</div>}
                {edge && <div class="good">EDGE · {edge.label}</div>}
                {stakesFor(save, g.id) && <div class="gold">ON THE LINE · {stakesFor(save, g.id)!.label}</div>}
              </div>
            )}
            <div style={{ height: '10px' }} />
            <div class="row">
              <Btn kind="primary big" class="grow" disabled={me.lineup.length < 5} onClick={() => go('play')}>Play</Btn>
              <Btn onClick={() => go('sim')}>Sim</Btn>
            </div>
            <div class="dim center" style={{ marginTop: '6px', fontSize: '17px' }}>A simmed game pays half.</div>
            {planWaiting && <div class="gold center" style={{ marginTop: '6px', fontSize: '18px' }}>Make your move for the week first ▼</div>}
            {seriesText && <div class="gold center" style={{ marginTop: '8px' }}>{seriesText} · best of {need * 2 - 1}</div>}
            {save.phase === 'playoffs' && <><div style={{ height: '8px' }} /><Btn kind="small block" onClick={() => nav('bracket')}>View the bracket</Btn></>}
            {(weekGames.length > 1 || need > 1) && <><div style={{ height: '8px' }} /><Btn kind="small block" onClick={() => go('week')}>{save.phase === 'playoffs' ? (need > 1 ? 'Sim the rest of the series' : 'Sim the rest of the round') : 'Sim the rest of the week'}</Btn></>}
          </Panel>
        ) : (
          <Panel team title={save.phase === 'playoffs' ? 'PLAYOFFS' : 'BYE'}>
            <div>{save.phase === 'playoffs' ? (save.playoffs?.series.some(x => x.round === save.week - REG_WEEKS && (x.highId === me.id || x.lowId === me.id)) ? 'Your series is decided. The rest of the round plays out.' : 'Your season is over. The playoffs go on without you.') : openGames ? 'Your games this week are done.' : 'No game this week.'}</div>
            <div style={{ height: '8px' }} />
            <Btn kind="primary block" onClick={simWeek}>{save.phase === 'playoffs' ? `Sim ${round}` : 'Finish Week'}</Btn>
            {save.phase === 'playoffs' && <><div style={{ height: '8px' }} /><Btn kind="small block" onClick={() => nav('bracket')}>View the bracket</Btn></>}
          </Panel>
        )}

        {honorNow(save) && (
          <div class="panel honor">
            <div class="head gold">★ PLAYER OF THE WEEK</div>
            <div>{honorNow(save)}</div>
            <div class="dim" style={{ fontSize: '17px' }}>+1 credit, fans +1, and he is delighted.</div>
          </div>
        )}
        <WeekPlan save={save} />
        <SponsorOffer save={save} />

        {todo.length > 0 && save.phase !== 'offseason' && (
          <Panel title={`GETTING STARTED · ${steps.filter(x => x.done).length}/${steps.length}`}>
            <div class="list">
              {todo.slice(0, 3).map((st, i) => (
                <div class={`item ${st.go ? 'tap' : ''}`} onClick={() => { if (st.go) nav(st.go); }}>
                  <span class="tag gold" style={{ minWidth: '22px', textAlign: 'center' }}>{i === 0 ? 'NEXT' : '·'}</span>
                  <div class="grow"><div>{st.text}</div>{i === 0 && <div class="dim" style={{ fontSize: '17px' }}>{pcText(st.why)}</div>}</div>
                  {st.go && <span class="dim">&gt;</span>}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {(chores.length > 0 || people.length > 0) && (
          <Panel title="TO DO">
            <div class="list">
              {people}
              {chores.map(c => (
                <div class="item todo-row">
                  <span class="grow tap" onClick={() => nav(CHORE_SCREEN[c.id])}>{c.text}</span>
                  <Btn kind="small" disabled={c.cost > save.credits} onClick={() => { const done = act(s => doChores(s, c.id)); sfx.coin(); toast(done.join('. ') || 'Done.', true); }}>{c.cost ? `Do it ◉${c.cost}` : 'Do it'}</Btn>
                </div>
              ))}
            </div>
            {chores.length > 1 && <><div style={{ height: '6px' }} /><Btn kind="primary block" onClick={() => { const done = act(s => doChores(s)); sfx.coin(); toast(done.length ? `${done.length} jobs done` : 'Done.', true); }}>Do all {choreCost ? `(◉ up to ${choreCost})` : ''}</Btn></>}
            <div class="row tap" style={{ marginTop: '8px', gap: '8px' }} onClick={() => touch(s => { s.settings.assistant = !s.settings.assistant; })}>
              <span class={`tag ${save.settings.assistant ? 'good' : ''}`}>{save.settings.assistant ? 'ON' : 'OFF'}</span>
              <span class="dim grow" style={{ fontSize: '17px' }}>Assistant GM: do these for me every week</span>
            </div>
          </Panel>
        )}
        {chores.length === 0 && people.length === 0 && save.settings.assistant && save.phase !== 'offseason' && <div class="dim center" style={{ fontSize: '17px' }}>Your assistant is handling the chores. <span class="tap gold" onClick={() => touch(s => { s.settings.assistant = false; })}>Turn off</span></div>}

        {GROUPS.map(([title, names]) => (
          <div class="col" style={{ gap: '5px' }}>
            <h3>{title}</h3>
            <div class="grid3">
          {TILES.filter(t => names.includes(t[0])).map(([name, label, ico]) => {
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
          </div>
        ))}

        <Panel title={sponsor ? 'SEASON GOALS' : "OWNER'S GOALS"}>
          <div class="list">
            {save.owner.goals.map(gl => <div class="item"><span class="grow">{gl.text}</span>{gl.done ? <span class="tag good">MET</span> : gl.failed ? <span class="tag bad">MISSED</span> : null}</div>)}
            {sponsor && (() => { const [v, t] = sponsorProgress(save, sponsor); return (
              <div class="item"><div class="grow"><div>{sponsor.name}: {sponsor.text.toLowerCase()}</div><div class="dim" style={{ fontSize: '17px' }}>Sponsor deal · {sponsor.paid ? 'paid' : `${v}/${t}`}</div></div><span class={`tag ${sponsor.paid ? 'good' : 'gold'}`}>{sponsor.paid ? 'PAID' : `◉ +${sponsor.credits}`}</span></div>
            ); })()}
          </div>
          <div class="dim" style={{ fontSize: '17px', marginTop: '4px' }}>
            Payroll {money(payroll(save, me))} vs {money(SALARY_CAP)} cap ({capStatus(save, me)}) · {expiring} contract{expiring === 1 ? '' : 's'} in final year
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
      {pendingMoment(save) ? null : <EventModal save={save} />}
      <BigMomentHost save={save} />
      {ask && planWaiting && (
        <Modal onClose={() => setAsk(null)}>
          <h3>BEFORE THE GAME</h3>
          <h2>YOUR MOVE THIS WEEK</h2>
          <div class="dim" style={{ fontSize: '17px' }}>Pick one. The other two are gone after this week.</div>
          <div class="col" style={{ gap: '6px' }}>
            {weekState(save).hand.map(p => (
              <Btn class="opt plan" silent onClick={() => { const r = act((s, rng) => doPlan(s, p.id, rng)); if (r) { sfx.select(); toast(r, true); } const what = ask; setAsk(null); run(what); }}>
                <span class={`tag ${p.group === 'train' ? 'good' : p.group === 'prep' ? 'gold' : ''}`}>{PLAN_GROUP[p.group]}</span>
                <span>{p.title}</span>
                <span class="fx">{p.effect}</span>
              </Btn>
            ))}
          </div>
          <Btn onClick={() => { touch(s => skipPlan(s)); const what = ask; setAsk(null); run(what); }}>Skip this week</Btn>
        </Modal>
      )}
    </div>
  );
}
