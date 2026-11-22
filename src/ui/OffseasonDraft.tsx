import { TAP } from '../state/device';
import { useEffect, useRef, useState } from 'preact/hooks';
import { NUM_TEAMS, ROSTER_MAX } from '../core/constants';
import { rookieContract } from '../core/gm/draft';
import { draftDone, runDraftUntilUser, userDraftPick, userOnClock } from '../core/offseason/offseason';
import { capStatus, payroll } from '../core/org/finance';
import type { Player, Save } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, touch } from '../state/store';
import { Btn, Modal, Panel, confirmDialog, fullName, money, toast } from './kit';
import { CapTag, PlayerLine, ProspectBoard, ProspectRow, ReleaseModal, dealText } from './OffseasonParts';

const LOTTERY_TEAMS = 8;
/** The lottery, one ball at a time: the eight picks counted down from the last to the first. */
function LotteryReveal({ save }: { save: Save }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const slots = off.draftOrder.filter(s => s.round === 1 && s.pick <= LOTTERY_TEAMS).sort((a, b) => a.pick - b.pick);
  const [shown, setShown] = useState(0); // how many have been revealed, from the bottom up
  const [drum, setDrum] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const next = slots.length - shown; // the pick number about to be revealed
  const finish = () => touch(sv => { if (sv.offseason) sv.offseason.lotterySeen = true; });
  const mine = slots.filter(s => s.teamId === me.id).map(s => s.pick);
  const reveal = () => {
    if (drum || shown >= slots.length) return;
    const top = next <= 3;
    setDrum(true); sfx.select();
    setTimeout(() => {
      if (!alive.current) return;
      setDrum(false); setShown(shown + 1);
      const s = slots[next - 1];
      if (s.teamId === me.id) { if (top) sfx.fanfare(); else sfx.good(); } else if (top) sfx.click();
    }, top ? 1200 : 300);
  };
  const done = shown >= slots.length;
  const best = mine.length ? Math.min(...mine) : 0;
  return (
    <Panel team title="THE DRAFT LOTTERY">
      <div class="dim" style={{ fontSize: '18px', marginBottom: '6px' }}>The eight teams that missed the playoffs drew for the top three picks. The worse the record, the better the odds: 25% at #1 for the worst.</div>
      <div class="ox-lotto">
        {slots.map(s => {
          const open = s.pick > slots.length - shown;
          const t = save.teams[s.teamId];
          const you = open && s.teamId === me.id;
          const now = !open && s.pick === next;
          return (
            <div class={`ox-slot ${s.pick <= 3 ? 'top' : ''} ${open ? '' : 'hidden'} ${you ? 'you' : ''} ${now && drum ? 'drum' : ''}`}>
              <span class="n">#{s.pick}</span>
              {open ? <><span class="swatch" style={{ background: t.colors.primary, boxShadow: `4px 0 0 ${t.colors.secondary}`, marginRight: '4px' }} /><span class="grow nowrap">{fullName(t)}</span>{you && <span class="tag gold">YOU</span>}</>
                : <span class="grow dim">{now && drum ? '. . .' : '?'}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ height: '8px' }} />
      {done ? (
        <>
          <div class={best && best <= 3 ? 'gold' : ''} style={{ marginBottom: '6px' }}>{best ? (best <= 3 ? `You pick #${best}. The ball bounced your way.` : `You pick #${best}.`) : 'Your pick is in.'}</div>
          <Btn kind="primary big" class="block" onClick={finish}>To the draft board</Btn>
        </>
      ) : (
        <div class="row">
          <Btn kind="primary big" class="grow" disabled={drum} onClick={reveal}>{drum ? '. . .' : `Reveal pick #${next}`}</Btn>
          <Btn onClick={finish}>Skip</Btn>
        </div>
      )}
    </Panel>
  );
}

export function DraftStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const [sel, setSel] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const onClock = userOnClock(save);
  const done = draftDone(save);
  const slot = off.draftOrder[off.draftIdx];
  const full = me.roster.length >= ROSTER_MAX;

  const draft = (id: number) => {
    const p = save.players[id];
    const err = act((s, rng) => userDraftPick(s, id, rng));
    if (err) { toast(err); return; }
    setSel(null);
    toast(`You drafted ${p?.name ?? 'your man'}!`, true);
  };
  const pass = async () => {
    if (!(await confirmDialog('Pass on this pick? It is gone for good.', 'Pass'))) return;
    const err = act((s, rng) => userDraftPick(s, null, rng));
    if (err) toast(err);
  };

  const upcoming = off.draftOrder.slice(off.draftIdx, off.draftIdx + 8);
  const lottery = off.log.filter(l => l.startsWith('Lottery: ')).map(l => l.slice('Lottery: '.length));
  const log = off.log.filter(l => !l.startsWith('Lottery: ')).reverse();
  const topThree = off.draftOrder.filter(s => s.round === 1 && s.pick <= 3);
  const myClass = Object.values(save.players)
    .filter(p => p.draft && p.draft.year === save.year && p.draft.teamId === me.id && p.teamId === me.id)
    .sort((a, b) => (a.draft!.round - b.draft!.round) || (a.draft!.pick - b.draft!.pick));
  const pickPlayer: Player | null = sel !== null ? save.players[sel] ?? null : null;

  // a team in the lottery watches the balls drop before it sees the board
  const inLottery = off.draftOrder.some(s => s.round === 1 && s.pick <= LOTTERY_TEAMS && s.teamId === me.id);
  if (inLottery && !off.lotterySeen && lottery.length > 0) return <LotteryReveal save={save} />;

  return (
    <>
      {lottery.length > 0 && (
        <Panel team title="DRAFT LOTTERY">
          <div class="row" style={{ gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
            {topThree.map(s => {
              const t = save.teams[s.teamId];
              return <span class={`tag ${s.teamId === me.id ? 'gold' : ''}`}><span class="swatch" style={{ background: t.colors.primary, width: '8px', height: '8px', border: 0, marginRight: '4px' }} />#{s.pick} {t.abbr}</span>;
            })}
          </div>
          <div class="list ox-log">
            {lottery.map(l => <div class={`item ${l.startsWith(`${me.city} `) || l.includes(`belongs to ${me.city})`) ? 'gold' : ''}`}>{l}</div>)}
          </div>
          <div class="dim cap-note" style={{ marginTop: '4px' }}>The eight teams that missed the playoffs drew for the top three picks. The worst record had a 25% chance at #1.</div>
        </Panel>
      )}
      {onClock && slot && (
        <>
          <div class="ox-clock">YOU ARE ON THE CLOCK: ROUND {slot.round}, PICK {slot.pick}</div>
          <div class="row">
            <span class="grow dim" style={{ fontSize: '18px' }}>{TAP} a prospect to draft him. Rookie deal: {dealText(rookieContract(slot.round, slot.pick).salary, rookieContract(slot.round, slot.pick).years)}.</span>
            <Btn onClick={() => { void pass(); }}>Pass</Btn>
          </div>
          {full && (
            <div class="panel ox-warn">
              <div class="bad">Your roster is full ({ROSTER_MAX}). Release someone to make this pick, or pass.</div>
              <div style={{ height: '6px' }} />
              <Btn class="block" onClick={() => setReleasing(true)}>Release a player</Btn>
            </div>
          )}
        </>
      )}
      {!onClock && !done && (
        <Panel>
          <div class="dim">The other teams are picking.</div>
          <Btn class="block" onClick={() => act((s, rng) => runDraftUntilUser(s, rng))}>Run the next picks</Btn>
        </Panel>
      )}
      {done && (
        <Panel team title="THE DRAFT IS DONE">
          {myClass.length ? (
            <>
              <div class="dim" style={{ fontSize: '18px' }}>Your new rookies:</div>
              <div class="list">
                {myClass.map(p => <PlayerLine save={save} player={p} sub={<span>R{p.draft!.round} #{p.draft!.pick} · {money(p.contract.salary)}</span>} />)}
              </div>
            </>
          ) : <div class="dim">You did not draft anyone this year.</div>}
          <div class="dim" style={{ fontSize: '18px', marginTop: '6px' }}>Undrafted prospects join the free-agent pool. Continue to free agency.</div>
        </Panel>
      )}

      {!done && upcoming.length > 0 && (
        <Panel title="ON THE CLOCK NEXT">
          <div class="list">
            {upcoming.map((s, i) => {
              const t = save.teams[s.teamId];
              const mine = s.teamId === me.id;
              return (
                <div class={`item ${mine ? 'sel' : ''}`} style={{ minHeight: '34px' }}>
                  <span class="head dim" style={{ width: '62px' }}>R{s.round} #{s.pick}</span>
                  <span class="swatch" style={{ background: t.colors.primary }} />
                  <span class="grow nowrap">{t.city}</span>
                  {mine ? <span class="tag gold">YOU</span> : i === 0 ? <span class="tag">NOW</span> : null}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {log.length > 0 && (
        <Panel title="DRAFT LOG">
          <div class="list ox-log">
            {(showAll ? log : log.slice(0, 6)).map(l => <div class={`item ${l.includes(` ${me.abbr}:`) || l.startsWith(`${me.abbr} `) ? 'gold' : ''}`}>{l}</div>)}
          </div>
          {log.length > 6 && <Btn class="block" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${log.length}`}</Btn>}
        </Panel>
      )}

      {off.prospects.length > 0 && (
        <>
          <h3>THE BOARD ({off.prospects.length} LEFT)</h3>
          <ProspectBoard save={save} ids={off.prospects} onPick={onClock ? setSel : undefined} />
        </>
      )}

      {pickPlayer && slot && onClock && (
        <Modal onClose={() => setSel(null)}>
          <h3>ROUND {slot.round}, PICK {slot.pick} · #{(slot.round - 1) * NUM_TEAMS + slot.pick} OVERALL</h3>
          <div class="list"><ProspectRow save={save} player={pickPlayer} /></div>
          <div class="row between"><span class="dim">Rookie deal</span><span class="gold">{dealText(rookieContract(slot.round, slot.pick).salary, rookieContract(slot.round, slot.pick).years)}</span></div>
          <div class="row between"><span class="dim">Payroll · roster</span><span class="row" style={{ gap: '6px' }}>{money(payroll(save, me))} <CapTag status={capStatus(save, me)} /> {me.roster.length}/{ROSTER_MAX}</span></div>
          <div class="dim cap-note">A drafted player can always be signed to his rookie deal, whatever your payroll.</div>
          <div class="row">
            <Btn class="grow" onClick={() => setSel(null)}>Cancel</Btn>
            <Btn class="grow" kind="primary" onClick={() => draft(pickPlayer.id)}>Draft</Btn>
          </div>
        </Modal>
      )}
      {releasing && <ReleaseModal save={save} onClose={() => setReleasing(false)} text={`Roster ${me.roster.length}/${ROSTER_MAX}. Releasing in the offseason costs no dead money.`} />}
    </>
  );
}
