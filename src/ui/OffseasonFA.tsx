import { useState } from 'preact/hooks';
import { FA_DAYS, MAX_CONTRACT_YEARS, MAX_SALARY, MIN_SALARY, ROSTER_MAX } from '../core/constants';
import { interestLevel } from '../core/gm/freeAgency';
import { askingContract } from '../core/gm/value';
import { faOver } from '../core/offseason/offseason';
import { capSpace } from '../core/org/finance';
import { clamp, ovr, round1 } from '../core/ratings';
import type { FreeAgentOffer, Player, Save } from '../core/types';
import { touch } from '../state/store';
import { Btn, Modal, Panel, Stars, money, toast } from './kit';
import { FreeAgentList, PlayerLine, dealText } from './OffseasonParts';

const INTEREST_CLASS = { none: 'bad', low: 'gold', medium: 'ox-accent', high: 'good' } as const;
const INTEREST_TEXT = { none: 'NO INTEREST', low: 'LOW INTEREST', medium: 'MEDIUM INTEREST', high: 'HIGH INTEREST' } as const;

/** The user's live offers (dropping any for players who have since signed elsewhere). */
function pendingOffers(save: Save): { p: Player; o: FreeAgentOffer }[] {
  const off = save.offseason!;
  return Object.entries(off.userOffers)
    .map(([k, o]) => ({ p: save.players[Number(k)], o }))
    .filter(x => !!x.p && save.freeAgents.includes(x.p.id));
}

/** Cap and roster room left once every other pending offer is counted. */
function room(save: Save, exceptId: number | null): { cap: number; spots: number } {
  const me = save.teams[save.userTeamId];
  const others = pendingOffers(save).filter(x => x.p.id !== exceptId);
  return {
    cap: round1(capSpace(save, me) - others.reduce((s, x) => s + x.o.salary, 0)),
    spots: ROSTER_MAX - me.roster.length - others.length,
  };
}

export function FreeAgencyStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const [sel, setSel] = useState<Player | null>(null);
  const over = faOver(save);
  const pending = pendingOffers(save);
  const left = room(save, null);
  const space = capSpace(save, me);
  const lastDay = off.faDay - 1;

  const withdraw = (id: number) => { touch(s => { delete s.offseason!.userOffers[id]; }); toast('Offer withdrawn.', true); };

  return (
    <>
      <Panel team title={over ? 'FREE AGENCY IS OVER' : `DAY ${Math.min(off.faDay, FA_DAYS)} OF ${FA_DAYS}`}>
        <div class="ox-stats">
          <div><h3>CAP SPACE</h3><div class={`head ${space < 0 ? 'bad' : 'good'}`}>{money(space)}</div></div>
          <div><h3>ROSTER</h3><div class="head">{me.roster.length}/{ROSTER_MAX}</div></div>
          <div><h3>FREE AFTER OFFERS</h3><div class="head">{money(left.cap)}</div></div>
        </div>
        <div class="dim" style={{ fontSize: '18px', marginTop: '6px' }}>
          {over
            ? 'The market has closed for the summer. Continue to training camp. Anyone still unsigned can be signed during the season.'
            : 'Tap a player to make an offer. Each day, every free agent takes the best offer he likes enough. They are picky early and take the best real offer on the last day.'}
        </div>
      </Panel>

      {off.log.length > 0 && (
        <Panel title={`DAY ${lastDay} RESULTS`}>
          <div class="list ox-log">
            {off.log.map(l => {
              const good = l.includes(`signs with ${me.city} `);
              const bad = l.includes('your offer') && !l.includes('still') || l.startsWith('You could not');
              return <div class={`item ${good ? 'good' : bad ? 'bad' : l.includes('your offer') ? 'gold' : ''}`}>{l}</div>;
            })}
          </div>
        </Panel>
      )}

      <Panel title={`YOUR OFFERS (${pending.length})`}>
        {pending.length === 0 ? <div class="dim">No offers out. {over ? '' : 'Tap a free agent below to make one.'}</div> : (
          <div class="list">
            {pending.map(({ p, o }) => {
              const lvl = interestLevel(save, p, { ...o, teamId: me.id });
              return (
                <PlayerLine save={save} player={p} onClick={() => setSel(p)}
                  sub={<><span>{dealText(o.salary, o.years)}</span><span class={`tag ${INTEREST_CLASS[lvl]}`}>{lvl.toUpperCase()}</span></>}
                  right={<span onClick={e => e.stopPropagation()}><Btn onClick={() => withdraw(p.id)}>Withdraw</Btn></span>} />
              );
            })}
          </div>
        )}
      </Panel>

      <h3>FREE AGENTS</h3>
      <FreeAgentList save={save}
        onPick={p => { if (over) toast('Free agency is over. Unsigned players can be signed during the season.'); else setSel(p); }}
        sub={p => off.userOffers[p.id] ? <span class="tag gold">OFFER OUT</span> : null}
        right={p => <span class="head">{money(askingContract(save, p, me.id).salary)}</span>} />

      {sel && !over && <OfferModal save={save} player={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function OfferModal({ save, player: p, onClose }: { save: Save; player: Player; onClose: () => void }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const ask = askingContract(save, p, me.id);
  const existing = off.userOffers[p.id];
  const r = room(save, p.id);
  const max = round1(Math.min(MAX_SALARY, r.cap));
  const canOffer = r.spots > 0 && max >= MIN_SALARY && save.freeAgents.includes(p.id);
  const start = existing?.salary ?? clamp(Math.ceil(ask.salary * 2) / 2, MIN_SALARY, Math.max(MIN_SALARY, max));
  const [salary, setSalary] = useState(round1(start));
  const [years, setYears] = useState(existing?.years ?? ask.years);
  const set = (v: number) => setSalary(round1(clamp(v, MIN_SALARY, Math.max(MIN_SALARY, max))));
  const lvl = interestLevel(save, p, { teamId: me.id, salary, years });
  const why = !save.freeAgents.includes(p.id) ? `${p.name} has already signed.`
    : r.spots <= 0 ? `No roster room: your roster plus pending offers would pass ${ROSTER_MAX}. Withdraw an offer or release someone.`
    : max < MIN_SALARY ? 'No cap space left once your other offers are counted.'
    : salary > max ? `Your cap room for this offer is ${money(max)}.`
    : null;

  const submit = () => {
    if (why) { toast(why); return; }
    touch(s => { s.offseason!.userOffers[p.id] = { teamId: s.userTeamId, salary, years }; });
    toast(existing ? 'Offer updated.' : 'Offer submitted. He will decide when the day ends.', true);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h3>MAKE AN OFFER</h3>
      <div class="row"><span class="tag pos">{p.pos}</span><h2 class="grow">{p.name}</h2></div>
      <div class="row dim ox-sub"><Stars v={ovr(p)} big /><span>Age {p.age}</span><span>{p.trait}</span></div>
      <div class="row between"><span class="dim">He asks</span><span class="gold">{dealText(ask.salary, ask.years)}</span></div>
      <div class="row between"><span class="dim">Room for this offer</span><span>{money(Math.max(0, r.cap))} · {Math.max(0, r.spots)} spot{r.spots === 1 ? '' : 's'}</span></div>

      {canOffer && (
        <>
          <h3>SALARY PER SEASON</h3>
          <div class="ox-stepper">
            <Btn onClick={() => set(salary - 0.5)} disabled={salary <= MIN_SALARY}>−</Btn>
            <span class="v">{money(salary)}</span>
            <Btn onClick={() => set(salary + 0.5)} disabled={salary >= max}>+</Btn>
          </div>
          <div class="row ox-quick">
            <Btn kind="small" class="grow" onClick={() => set(MIN_SALARY)}>Min</Btn>
            <Btn kind="small" class="grow" onClick={() => set(ask.salary)}>His ask</Btn>
            <Btn kind="small" class="grow" onClick={() => set(max)}>Max</Btn>
          </div>
          <h3>YEARS</h3>
          <div class="ox-chips">
            <div class="tabs">
              {Array.from({ length: MAX_CONTRACT_YEARS }, (_, i) => i + 1).map(y => (
                <Btn kind="small" class={y === years ? 'on' : ''} onClick={() => setYears(y)}>{y}</Btn>
              ))}
            </div>
          </div>
          <div class="row between">
            <span class="dim">His interest</span>
            <span class={`tag ${INTEREST_CLASS[lvl]}`} style={{ fontSize: '10px', padding: '6px 8px' }}>{INTEREST_TEXT[lvl]}</span>
          </div>
        </>
      )}
      {why && <div class="bad">{why}</div>}
      <div class="row">
        <Btn class="grow" onClick={onClose}>Cancel</Btn>
        {existing && <Btn class="grow" kind="danger" onClick={() => { touch(s => { delete s.offseason!.userOffers[p.id]; }); toast('Offer withdrawn.', true); onClose(); }}>Withdraw</Btn>}
        <Btn class="grow" kind="primary" disabled={!!why} onClick={submit}>{existing ? 'Update' : 'Submit offer'}</Btn>
      </div>
    </Modal>
  );
}
