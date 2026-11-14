import { useState } from 'preact/hooks';
import { FA_DAYS, MAX_FA_YEARS, MIN_DEAL_YEARS, MIN_SALARY, MLE, ROSTER_MAX } from '../core/constants';
import { interestLevel } from '../core/gm/freeAgency';
import { askingContract } from '../core/gm/value';
import { faOver } from '../core/offseason/offseason';
import { capSpace, capStatus, maxOffer, mleStatus, payroll, signingPath } from '../core/org/finance';
import type { SigningResult } from '../core/org/finance';
import { clamp, ovr, round1 } from '../core/ratings';
import type { FreeAgentOffer, Player, Save } from '../core/types';
import { touch } from '../state/store';
import { Btn, Modal, Panel, Stars, money, toast } from './kit';
import { CapTag, FreeAgentList, PlayerLine, STATUS_CLASS, VIA_TEXT, dealText } from './OffseasonParts';

const INTEREST_CLASS = { none: 'bad', low: 'gold', medium: 'ox-accent', high: 'good' } as const;
const INTEREST_TEXT = { none: 'NO INTEREST', low: 'LOW INTEREST', medium: 'MEDIUM INTEREST', high: 'HIGH INTEREST' } as const;

/** The user's live offers (dropping any for players who have since signed elsewhere). */
function pendingOffers(save: Save): { p: Player; o: FreeAgentOffer }[] {
  const off = save.offseason!;
  return Object.entries(off.userOffers)
    .map(([k, o]) => ({ p: save.players[Number(k)], o }))
    .filter(x => !!x.p && save.freeAgents.includes(x.p.id));
}

/** How each pending offer would be signed if they all came good, best player first (the order they are decided in): each one counts against the room of the next, and only one can use the mid-level. */
function offerPaths(save: Save): Map<number, SigningResult> {
  const me = save.teams[save.userTeamId];
  const out = new Map<number, SigningResult>();
  let pending = 0, mleTaken = false, spots = ROSTER_MAX - me.roster.length;
  for (const { p, o } of pendingOffers(save).sort((a, b) => ovr(b.p) - ovr(a.p) || a.p.id - b.p.id)) {
    const path: SigningResult = spots <= 0
      ? { ok: false, reason: `No roster room: your roster and your other offers would pass ${ROSTER_MAX}.` }
      : signingPath(save, me, o.salary, { years: o.years, pending, mleTaken });
    out.set(p.id, path);
    if (!path.ok) continue;
    pending = round1(pending + o.salary);
    spots--;
    if (path.via === 'mle' || path.via === 'taxMle') mleTaken = true;
  }
  return out;
}

/** What the user's other pending offers already commit: salary, roster spots, and the mid-level if one of them would use it. */
function room(save: Save, exceptId: number | null): { pending: number; spots: number; mleTaken: boolean } {
  const me = save.teams[save.userTeamId];
  const paths = offerPaths(save);
  const others = pendingOffers(save).filter(x => x.p.id !== exceptId && paths.get(x.p.id)?.ok);
  return {
    pending: round1(others.reduce((s, x) => s + x.o.salary, 0)),
    spots: ROSTER_MAX - me.roster.length - others.length,
    mleTaken: others.some(x => { const r = paths.get(x.p.id); return !!r && r.ok && (r.via === 'mle' || r.via === 'taxMle'); }),
  };
}

export function FreeAgencyStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const [sel, setSel] = useState<Player | null>(null);
  const over = faOver(save);
  const pending = pendingOffers(save);
  const paths = offerPaths(save);
  const left = room(save, null);
  const space = capSpace(save, me);
  const best = maxOffer(save, me, { pending: left.pending, mleTaken: left.mleTaken });
  const mle = mleStatus(save, me);
  const lastDay = off.faDay - 1;

  const withdraw = (id: number) => { touch(s => { delete s.offseason!.userOffers[id]; }); toast('Offer withdrawn.', true); };

  return (
    <>
      <Panel team title={over ? 'FREE AGENCY IS OVER' : `DAY ${Math.min(off.faDay, FA_DAYS)} OF ${FA_DAYS}`}>
        <div class="ox-stats">
          <div><h3>PAYROLL</h3><div class={`head ${STATUS_CLASS[capStatus(save, me)]}`}>{money(payroll(save, me))}</div></div>
          <div><h3>ROSTER</h3><div class="head">{me.roster.length}/{ROSTER_MAX}</div></div>
          <div><h3>BIGGEST OFFER LEFT</h3><div class="head">{left.spots > 0 ? money(best.salary) : '-'}</div></div>
        </div>
        <div class="row cap-note" style={{ marginTop: '6px', flexWrap: 'wrap' }}>
          <CapTag status={capStatus(save, me)} />
          <span>
            {space >= MIN_SALARY ? `Cap space ${money(space)}. ` : 'No cap space. '}
            {mle.available ? `${mle.kind === 'taxMle' ? 'Taxpayer mid-level' : 'Mid-level exception'}: one signing up to ${money(mle.amount)}. ` : me.mleUsed ? 'Mid-level exception used. ' : 'No mid-level exception at this payroll. '}
            Minimum deals ({money(MIN_SALARY)}) are always allowed.
          </span>
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
              const bad = l.includes('your offer') && !l.includes('still') || l.startsWith('Your offer to');
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
              const path = paths.get(p.id);
              return (
                <PlayerLine save={save} player={p} onClick={() => setSel(p)}
                  sub={<>
                    <span>{dealText(o.salary, o.years)}</span>
                    <span class={`tag ${INTEREST_CLASS[lvl]}`}>{lvl.toUpperCase()}</span>
                    {path && (path.ok ? <span class="tag">{VIA_TEXT[path.via].toUpperCase()}</span> : <span class="tag bad">NOT ALLOWED</span>)}
                    {path && !path.ok && <span class="bad">{path.reason}</span>}
                  </>}
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
  // the most the rules allow for this offer once the other offers are counted
  const best = maxOffer(save, me, { pending: r.pending, mleTaken: r.mleTaken });
  const max = best.salary;
  const canOffer = r.spots > 0 && save.freeAgents.includes(p.id);
  const start = existing?.salary ?? clamp(Math.ceil(ask.salary * 2) / 2, MIN_SALARY, max);
  const [salary, setSalary] = useState(round1(start));
  // with only a minimum deal to offer, two years is the limit
  const yearCap = best.via === 'min' ? MIN_DEAL_YEARS : MAX_FA_YEARS;
  const [years, setYears] = useState(Math.min(existing?.years ?? ask.years, yearCap));
  const set = (v: number) => setSalary(round1(clamp(v, MIN_SALARY, max)));
  const lvl = interestLevel(save, p, { teamId: me.id, salary, years });
  const path = signingPath(save, me, salary, { years, pending: r.pending, mleTaken: r.mleTaken });
  const why = !save.freeAgents.includes(p.id) ? `${p.name} has already signed.`
    : r.spots <= 0 ? `No roster room: your roster plus pending offers would pass ${ROSTER_MAX}. Withdraw an offer or release someone.`
    : !path.ok ? path.reason
    : null;
  const short = max < ask.salary;

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
      <div class="row between"><span class="dim">Most you can offer</span><span>{money(max)} · {VIA_TEXT[best.via].toLowerCase()}</span></div>
      {canOffer && short && (
        <div class="gold cap-note">
          {best.via === 'min' ? 'You are over the cap with no exception to use: a minimum deal is all the rules allow.'
            : best.via === 'space' ? 'That is all the cap space you have left.'
            : `You are over the cap: the ${VIA_TEXT[best.via].toLowerCase()} is the most you can pay${best.salary < MLE && best.via === 'mle' ? ' without crossing the first apron' : ''}.`}
        </div>
      )}

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
              {Array.from({ length: yearCap }, (_, i) => i + 1).map(y => (
                <Btn kind="small" class={y === years ? 'on' : ''} onClick={() => setYears(y)}>{y}</Btn>
              ))}
            </div>
          </div>
          <div class="row between">
            <span class="dim">Signed with</span>
            {path.ok
              ? <span class={path.via === 'mle' || path.via === 'taxMle' ? 'gold' : 'good'}>{VIA_TEXT[path.via]}{path.via === 'mle' || path.via === 'taxMle' ? ' (once a season)' : ''}</span>
              : <span class="bad">Not allowed</span>}
          </div>
          <div class="row between">
            <span class="dim">His interest</span>
            <span class={`tag ${INTEREST_CLASS[lvl]}`} style={{ fontSize: '10px', padding: '6px 8px' }}>{INTEREST_TEXT[lvl]}</span>
          </div>
          {path.ok && path.via === 'min' && <div class="dim cap-note">A minimum deal can run {MIN_DEAL_YEARS} years at most.</div>}
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
