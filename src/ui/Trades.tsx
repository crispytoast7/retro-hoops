import { useRef, useState } from 'preact/hooks';
import { ROSTER_MAX, TRADE_DEADLINE_WEEK } from '../core/constants';
import { evaluateTrade, executeTrade, suggestSweetener, validateTrade } from '../core/gm/trade';
import type { TradeOffer, TradeSide } from '../core/gm/trade';
import { askingContract, teamNeeds } from '../core/gm/value';
import { pushNews, teamName } from '../core/org/economy';
import { capSpace } from '../core/org/finance';
import { signPlayer } from '../core/org/roster';
import { ovr, round1 } from '../core/ratings';
import type { DraftPick, Player, Save, Team } from '../core/types';
import { POSITIONS } from '../core/types';
import { act, useSave } from '../state/store';
import { Btn, Modal, Panel, Screen, Stars, Tabs, confirmDialog, fullName, money, recordStr, toast } from './kit';
import { FreeAgentList, PlayerLine, STRATEGY_HINT, contractText, dealText, pickText } from './OffseasonParts';
import { nav } from './router';

type Tab = 'Propose' | 'Offers' | 'Free Agents';
const TABS: readonly Tab[] = ['Propose', 'Offers', 'Free Agents'];

const samePick = (a: DraftPick, b: DraftPick): boolean => a.year === b.year && a.round === b.round && a.origTeamId === b.origTeamId;
const sortPicks = (ps: DraftPick[]): DraftPick[] => ps.slice().sort((a, b) => a.year - b.year || a.round - b.round || a.origTeamId - b.origTeamId);
const salaryOf = (save: Save, ids: readonly number[]): number => round1(ids.reduce((s, id) => s + (save.players[id]?.contract.salary ?? 0), 0));

/** Whether trades are open, and a line explaining the deadline. */
function tradeWindow(save: Save): { open: boolean; text: string } {
  if (save.phase === 'playoffs') return { open: false, text: 'No trades during the playoffs. The market reopens in the offseason.' };
  if (save.phase === 'offseason') return { open: true, text: 'Offseason: trades are open.' };
  if (save.week > TRADE_DEADLINE_WEEK) return { open: false, text: `The trade deadline (after week ${TRADE_DEADLINE_WEEK}) has passed. Trades reopen in the offseason.` };
  const left = TRADE_DEADLINE_WEEK - save.week + 1;
  return { open: true, text: `Trade deadline: after week ${TRADE_DEADLINE_WEEK}. ${left} week${left === 1 ? '' : 's'} left to deal.` };
}

/** Survives a trip to a player page and back (screens remount on navigation). */
const memo: { tab: Tab; partnerId: number | null; give: TradeSide; get: TradeSide } = {
  tab: 'Propose', partnerId: null, give: { players: [], picks: [] }, get: { players: [], picks: [] },
};

export function TradesScreen(p: { params: Record<string, any> }) {
  const save = useSave();
  const [tab, setTabState] = useState<Tab>(TABS.includes(p.params.tab) ? p.params.tab : memo.tab);
  const setTab = (t: Tab) => { memo.tab = t; setTabState(t); };
  return (
    <Screen title="Trades" right={save.tradeOffer ? <span class="tag gold">OFFER IN</span> : undefined}>
      <div class="ox-chips"><Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ Offers: save.tradeOffer ? 'Offers (1)' : 'Offers' }} /></div>
      {tab === 'Propose' && <ProposeTab save={save} />}
      {tab === 'Offers' && <OffersTab save={save} />}
      {tab === 'Free Agents' && <FreeAgentsTab save={save} />}
    </Screen>
  );
}

// ---- propose -------------------------------------------------------------------------
const emptySide = (): TradeSide => ({ players: [], picks: [] });

function ProposeTab({ save }: { save: Save }) {
  const me = save.teams[save.userTeamId];
  const [partnerId, setPartnerState] = useState<number | null>(memo.partnerId !== me.id ? memo.partnerId : null);
  const [give, setGiveState] = useState<TradeSide>(memo.give);
  const [get, setGetState] = useState<TradeSide>(memo.get);
  const setPartnerId = (v: number | null) => { memo.partnerId = v; setPartnerState(v); };
  const setGive = (v: TradeSide) => { memo.give = v; setGiveState(v); };
  const setGet = (v: TradeSide) => { memo.get = v; setGetState(v); };
  const [reply, setReply] = useState<{ message: string; note?: string } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const win = tradeWindow(save);
  const them = partnerId !== null ? save.teams[partnerId] : null;

  // Drop anything that has moved since it was picked (a trade went through, a player retired).
  const clean = (team: Team | null, side: TradeSide): TradeSide => team
    ? { players: side.players.filter(id => team.roster.includes(id)), picks: side.picks.filter(pk => team.picks.some(x => samePick(x, pk))) }
    : emptySide();
  const g = clean(me, give), r = clean(them, get);
  const offer: TradeOffer | null = them ? { aId: me.id, bId: them.id, aGives: g, bGives: r } : null;

  const choose = (id: number | null) => { setPartnerId(id); setGive(emptySide()); setGet(emptySide()); setReply(null); };
  const togglePlayer = (side: 'give' | 'get', id: number) => {
    const set = side === 'give' ? setGive : setGet;
    const cur = side === 'give' ? g : r;
    set({ ...cur, players: cur.players.includes(id) ? cur.players.filter(x => x !== id) : [...cur.players, id] });
    setReply(null);
  };
  const togglePick = (side: 'give' | 'get', pk: DraftPick) => {
    const set = side === 'give' ? setGive : setGet;
    const cur = side === 'give' ? g : r;
    set({ ...cur, picks: cur.picks.some(x => samePick(x, pk)) ? cur.picks.filter(x => !samePick(x, pk)) : [...cur.picks, pk] });
    setReply(null);
  };

  const showReply = (rep: { message: string; note?: string }) => {
    setReply(rep);
    setTimeout(() => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  };

  const propose = async () => {
    if (!offer || !them) return;
    const ev = evaluateTrade(save, offer, them.id);
    if (!ev.accept) { showReply({ message: ev.message }); return; }
    const ok = await confirmDialog(`${them.city}: "${ev.message}" Make the trade?`, 'Trade');
    if (!ok) return;
    const err = validateTrade(save, offer);
    if (err) { toast(err); return; }
    act(s => executeTrade(s, offer));
    toast(`Trade done with ${them.city}!`, true);
    setGive(emptySide()); setGet(emptySide()); setReply(null);
  };

  const sweeten = () => {
    if (!offer || !them || !reply) return;
    const s = suggestSweetener(save, offer, them.id);
    if (!s) { showReply({ message: reply.message, note: `No single extra piece gets this done. Try a different package.` }); return; }
    let label = '';
    if (s.playerId !== undefined) {
      const id = s.playerId;
      setGive({ ...g, players: [...g.players, id] });
      label = save.players[id]?.name ?? 'a player';
    } else if (s.pick) {
      const pk = s.pick;
      setGive({ ...g, picks: [...g.picks, pk] });
      label = pickText(save, pk);
    }
    showReply({ message: reply.message, note: `Add ${label} and they should say yes. It is on your side of the deal now: propose again.` });
  };

  const footer = them && offer ? (() => {
    const reason = validateTrade(save, offer);
    const myOut = salaryOf(save, g.players), myIn = salaryOf(save, r.players);
    const myAfter = round1(capSpace(save, me) + myOut - myIn);
    const theirAfter = round1(capSpace(save, them) + myIn - myOut);
    const empty = !g.players.length && !g.picks.length && !r.players.length && !r.picks.length;
    return (
      <div class="col grow" style={{ gap: '6px' }}>
        <div class="ox-sum">
          <span class="h" /><span class="h">OUT</span><span class="h">IN</span><span class="h">CAP AFTER</span>
          <span class="head">{me.abbr}</span><span>{money(myOut)}</span><span>{money(myIn)}</span><span class={myAfter < 0 ? 'bad' : 'good'}>{money(myAfter)}</span>
          <span class="head">{them.abbr}</span><span>{money(myIn)}</span><span>{money(myOut)}</span><span class={theirAfter < 0 ? 'bad' : ''}>{money(theirAfter)}</span>
        </div>
        {!empty && reason && <div class="bad" style={{ fontSize: '18px' }}>{reason}</div>}
        <Btn kind="primary" class="block" disabled={empty || !!reason} onClick={() => { void propose(); }}>Propose Trade</Btn>
      </div>
    );
  })() : null;

  return (
    <>
      <div ref={topRef} />
      <div class={`panel ${win.open ? '' : 'ox-warn'}`}><span class={win.open ? '' : 'bad'}>{win.text}</span></div>
      {!them ? (
        <Panel title="PICK A TRADE PARTNER">
          <div class="ox-teams">
            {save.teams.filter(t => t.id !== me.id).map(t => (
              <Btn class="ox-team" onClick={() => choose(t.id)}>
                <span class="row" style={{ gap: '4px' }}><span class="swatch" style={{ background: t.colors.primary, width: '10px', height: '10px' }} />{t.abbr}</span>
                <span class="ox-rec">{recordStr(t)}</span>
                <span class="ox-hint">{STRATEGY_HINT[t.strategy]}</span>
              </Btn>
            ))}
          </div>
        </Panel>
      ) : (
        <PartnerBar save={save} team={them} onChange={() => choose(null)} />
      )}

      {them && reply && (
        <Panel title={`${them.abbr} GM SAYS`} class="ox-reply">
          <div class="ox-quote">"{reply.message}"</div>
          {reply.note && <div class="gold" style={{ marginTop: '6px' }}>{reply.note}</div>}
          {!reply.note && <Btn class="block" onClick={sweeten}>What would it take?</Btn>}
        </Panel>
      )}

      {them && (
        <div class="ox-cols">
          <Panel title="YOU GIVE" class="ox-list">
            <AssetList save={save} team={me} side={g} onPlayer={id => togglePlayer('give', id)} onPick={pk => togglePick('give', pk)} />
          </Panel>
          <Panel title={`YOU GET (${them.abbr})`} class="ox-list">
            <AssetList save={save} team={them} side={r} onPlayer={id => togglePlayer('get', id)} onPick={pk => togglePick('get', pk)} />
          </Panel>
        </div>
      )}
      {them && <div class="dim" style={{ fontSize: '17px' }}>Tap players and picks to add them to the deal. Tap a name to see the player.</div>}
      {footer && <div class="ox-sticky">{footer}</div>}
    </>
  );
}

function PartnerBar({ save, team, onChange }: { save: Save; team: Team; onChange: () => void }) {
  const needs = teamNeeds(save, team);
  const big = POSITIONS.filter(p => needs[p] >= 0.6).sort((a, b) => needs[b] - needs[a]).slice(0, 2);
  return (
    <div class="panel row">
      <span class="swatch" style={{ background: team.colors.primary, boxShadow: `4px 0 0 ${team.colors.secondary}`, marginRight: '4px' }} />
      <div class="grow">
        <div class="nowrap">{fullName(team)}</div>
        <div class="row dim ox-sub"><span>{recordStr(team)}</span><span class="tag">{STRATEGY_HINT[team.strategy]}</span><span>{big.length ? `Needs ${big.join(', ')}` : 'No big needs'}</span></div>
      </div>
      <Btn onClick={onChange}>Change</Btn>
    </div>
  );
}

function AssetList({ save, team, side, onPlayer, onPick }: { save: Save; team: Team; side: TradeSide; onPlayer: (id: number) => void; onPick: (pk: DraftPick) => void }) {
  const players = team.roster.map(id => save.players[id]).filter(Boolean).sort((a, b) => ovr(b) - ovr(a));
  const picks = sortPicks(team.picks);
  return (
    <div class="list">
      {players.map(pl => {
        const on = side.players.includes(pl.id);
        return (
          <PlayerLine save={save} player={pl} sel={on} onClick={() => onPlayer(pl.id)}
            note={save.tradeDemands.includes(pl.id) ? <span class="tag bad" style={{ marginLeft: '4px' }}>WANTS OUT</span> : null}
            sub={<span>{contractText(pl)}</span>}
            right={<span class={`tag ${on ? 'good' : ''}`}>{on ? 'IN ✓' : 'ADD'}</span>} />
        );
      })}
      {picks.map(pk => {
        const on = side.picks.some(x => samePick(x, pk));
        return (
          <div class={`item tap ${on ? 'sel' : ''}`} onClick={() => onPick(pk)}>
            <span class="tag">PICK</span>
            <span class="grow">{pickText(save, pk)}</span>
            <span class={`tag ${on ? 'good' : ''}`}>{on ? 'IN ✓' : 'ADD'}</span>
          </div>
        );
      })}
      {!picks.length && <div class="item dim">No draft picks.</div>}
    </div>
  );
}

// ---- offers --------------------------------------------------------------------------
function SideList({ save, side, empty }: { save: Save; side: TradeSide; empty: string }) {
  if (!side.players.length && !side.picks.length) return <div class="item dim">{empty}</div>;
  return (
    <div class="list">
      {side.players.map(id => save.players[id]).filter(Boolean).map(pl => <PlayerLine save={save} player={pl} sub={<span>{contractText(pl)}</span>} />)}
      {side.picks.map(pk => <div class="item"><span class="tag">PICK</span><span class="grow">{pickText(save, pk)}</span></div>)}
    </div>
  );
}

function OffersTab({ save }: { save: Save }) {
  const me = save.teams[save.userTeamId];
  const o = save.tradeOffer;
  const demands = save.tradeDemands.filter(id => me.roster.includes(id)).map(id => save.players[id]).filter(Boolean);

  const accept = async () => {
    if (!o) return;
    const err = validateTrade(save, o);
    if (err) { toast(err); return; }
    if (!(await confirmDialog(`Accept the trade with ${save.teams[o.aId].city}?`, 'Accept'))) return;
    act(s => { executeTrade(s, o); s.tradeOffer = null; });
    toast('Trade done!', true);
  };
  const decline = () => { act(s => { s.tradeOffer = null; }); toast('Offer declined.', true); };

  return (
    <>
      {o ? (() => {
        const from = save.teams[o.aId];
        const reason = validateTrade(save, o);
        const out = salaryOf(save, o.bGives.players), inn = salaryOf(save, o.aGives.players);
        const after = round1(capSpace(save, me) + out - inn);
        return (
          <Panel team title={`OFFER FROM ${from.city.toUpperCase()}`}>
            <div class="row dim ox-sub"><span class="swatch" style={{ background: from.colors.primary }} /><span>{fullName(from)}</span><span>{recordStr(from)}</span><span class="tag">{STRATEGY_HINT[from.strategy]}</span></div>
            <h3 style={{ marginTop: '10px' }}>YOU GIVE</h3>
            <SideList save={save} side={o.bGives} empty="Nothing." />
            <h3 style={{ marginTop: '10px' }}>YOU GET</h3>
            <SideList save={save} side={o.aGives} empty="Nothing." />
            <div class="row between" style={{ marginTop: '8px' }}><span class="dim">Your cap space after</span><span class={after < 0 ? 'bad' : 'good'}>{money(after)}</span></div>
            {reason && <div class="bad">{reason}</div>}
            <div class="row" style={{ marginTop: '8px' }}>
              <Btn class="grow" kind="danger" onClick={decline}>Decline</Btn>
              <Btn class="grow" kind="primary" disabled={!!reason} onClick={() => { void accept(); }}>Accept</Btn>
            </div>
          </Panel>
        );
      })() : (
        <Panel title="NO OFFERS">
          <div class="dim">No team has made you an offer. AI teams call now and then before the deadline. You can always make your own on the Propose tab.</div>
        </Panel>
      )}
      <Panel title="TRADE REQUESTS">
        {demands.length ? (
          <>
            <div class="dim" style={{ fontSize: '18px' }}>These players have asked out. AI teams are more likely to make offers for them, and they will not re-sign with you.</div>
            <div class="list">{demands.map(pl => <PlayerLine save={save} player={pl} sub={<span>{contractText(pl)}</span>} right={<span class="tag bad">WANTS OUT</span>} />)}</div>
          </>
        ) : <div class="dim">Nobody on your roster has asked for a trade.</div>}
      </Panel>
    </>
  );
}

// ---- free agents ---------------------------------------------------------------------
function FreeAgentsTab({ save }: { save: Save }) {
  const [sel, setSel] = useState<Player | null>(null);
  const me = save.teams[save.userTeamId];
  const step = save.phase === 'offseason' ? save.offseason?.step : null;
  return (
    <>
      {step === 'freeAgency' ? (
        <Panel team title="FREE AGENCY IS ON">
          <div>Free agents are taking offers from every team. Make yours on the Offseason screen: each day players pick the offer they like best.</div>
          <div style={{ height: '8px' }} />
          <Btn kind="primary" class="block" onClick={() => nav('offseason')}>Go to Free Agency</Btn>
        </Panel>
      ) : (
        <div class="panel row between">
          <span>Cap space <b class="good">{money(capSpace(save, me))}</b></span>
          <span>Roster <b class={me.roster.length >= ROSTER_MAX ? 'bad' : ''}>{me.roster.length}/{ROSTER_MAX}</b></span>
        </div>
      )}
      <FreeAgentList save={save} onPick={setSel}
        right={pl => <span class="head">{money(askingContract(save, pl, me.id).salary)}</span>} />
      {sel && <SignModal save={save} player={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function SignModal({ save, player: p, onClose }: { save: Save; player: Player; onClose: () => void }) {
  const me = save.teams[save.userTeamId];
  const ask = askingContract(save, p, me.id);
  const space = capSpace(save, me);
  const step = save.phase === 'offseason' ? save.offseason?.step : null;
  const preFa = step === 'awards' || step === 'retirements' || step === 'contracts' || step === 'draft';
  const reason = !save.freeAgents.includes(p.id) ? `${p.name} is no longer a free agent.`
    : step === 'freeAgency' ? 'Free agency is running: make offers on the Offseason screen.'
    : preFa ? 'Free agency opens after the draft. Make offers then on the Offseason screen.'
    : ask.refuses ? `${p.name} will not sign with you.`
    : me.roster.length >= ROSTER_MAX ? `Your roster is full (${ROSTER_MAX}). Release someone first.`
    : ask.salary > space ? `Not enough cap space: he wants ${money(ask.salary)}, you have ${money(space)}.`
    : null;
  const sign = () => {
    act(s => {
      signPlayer(s, p.id, me.id, { salary: ask.salary, years: ask.years });
      pushNews(s, 'signing', `${p.name} signs with the ${teamName(me)} (${ask.years} yr${ask.years === 1 ? '' : 's'}, $${ask.salary}M).`, true);
    });
    toast(`${p.name} signed!`, true);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <h3>FREE AGENT</h3>
      <div class="row"><span class="tag pos">{p.pos}</span><h2 class="grow">{p.name}</h2></div>
      <div class="row dim ox-sub"><Stars v={ovr(p)} big /><span>Age {p.age}</span><span>{p.trait}</span></div>
      <div class="list">
        <div class="item"><span class="grow">He asks</span><span class="head gold">{dealText(ask.salary, ask.years)}</span></div>
        <div class="item"><span class="grow">Your cap space</span><span class={space >= ask.salary ? 'good' : 'bad'}>{money(space)}</span></div>
        <div class="item"><span class="grow">Your roster</span><span class={me.roster.length >= ROSTER_MAX ? 'bad' : ''}>{me.roster.length}/{ROSTER_MAX}</span></div>
      </div>
      {reason && <div class="bad">{reason}</div>}
      <div class="row">
        <Btn class="grow" onClick={() => nav('player', { id: p.id })}>Profile</Btn>
        {step === 'freeAgency'
          ? <Btn class="grow" kind="primary" onClick={() => { onClose(); nav('offseason'); }}>Offseason</Btn>
          : <Btn class="grow" kind="primary" disabled={!!reason} onClick={sign}>Sign</Btn>}
      </div>
      <Btn kind="small" onClick={onClose}>Close</Btn>
    </Modal>
  );
}
