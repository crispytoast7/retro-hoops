import { useEffect, useState } from 'preact/hooks';
import { FA_DAYS, LUXURY_TAX, MAX_CONTRACT_YEARS, ROSTER_MAX, ROSTER_MIN } from '../core/constants';
import { askingContract, supermaxEligible } from '../core/gm/value';
import { advanceOffseason, draftDone, expiringPlayers, faNextDay, faOver, resignPlayer } from '../core/offseason/offseason';
import { payroll, statusOf, taxBill } from '../core/org/finance';
import { takeJob } from '../core/org/people';
import { ovr } from '../core/ratings';
import type { OffseasonStep, Player, Save, SeasonHistory } from '../core/types';
import { act, useSave } from '../state/store';
import { Btn, Meter, Panel, PlayerRow, Screen, Stars, confirmDialog, fullName, money, moraleTag, toast } from './kit';
import { CampStep } from './OffseasonCamp';
import { DraftStep } from './OffseasonDraft';
import { FreeAgencyStep } from './OffseasonFA';
import { CapBar, CapTag, NameLink, STATUS_CLASS, STATUS_PUSH, contractText, dealText } from './OffseasonParts';
import { nav, replace, reset } from './router';

type Step = Exclude<OffseasonStep, 'done'>;
const STEPS: Step[] = ['awards', 'retirements', 'contracts', 'draft', 'freeAgency', 'camp'];
const PIP: Record<Step, string> = { awards: 'Awards', retirements: 'Retire', contracts: 'Re-sign', draft: 'Draft', freeAgency: 'FA', camp: 'Camp' };
const TITLE: Record<Step, string> = {
  awards: 'Season in Review', retirements: 'Retirements', contracts: 'Contracts',
  draft: 'The Draft', freeAgency: 'Free Agency', camp: 'Training Camp',
};
const BLURB: Record<Step, string> = {
  awards: 'The champions are crowned and the awards handed out. Here is how your season went.',
  retirements: 'Veterans hang up their sneakers. Everyone else is a year older, and the summer changed their game.',
  contracts: 'Decide who stays. You may re-sign your own players even when you are over the cap. Anyone you do not re-sign leaves when you continue.',
  draft: 'Two rounds. The eight teams that missed the playoffs draw for the top three picks; everyone else picks by record, worst first.',
  freeAgency: `${FA_DAYS} days to sign free agents. Under the cap you can offer anything that fits; over it you have one mid-level exception and minimum deals.`,
  camp: 'Last chance to train your players before the season tips off.',
};
export const FINISH: Record<SeasonHistory['userPlayoff'], string> = {
  champ: 'Champions!', F: 'Lost in the Championship', SF: 'Lost in the Conference Final',
  R1: 'Lost in the Conference Semifinal', none: 'Missed the playoffs',
};

const scrollTop = () => document.querySelector('.screen > .body')?.scrollTo(0, 0);

export function OffseasonScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const [letGo, setLetGo] = useState<number[]>([]);
  useEffect(() => { if (save.fired) replace('fired'); }, [save.fired]);

  const off = save.offseason;
  if (save.phase !== 'offseason' || !off || off.step === 'done') {
    return (
      <Screen title="Offseason">
        <Panel team title={`SEASON ${save.year}`}>
          <div>The season is under way. The offseason starts once a champion is crowned.</div>
          <div style={{ height: '8px' }} />
          <Btn kind="primary" class="block" onClick={() => reset('hub')}>Back to the hub</Btn>
        </Panel>
      </Screen>
    );
  }
  const step = off.step as Step;
  const me = save.teams[save.userTeamId];

  const advance = async () => {
    if (step === 'contracts') {
      const left = expiringPlayers(save).filter(p => !letGo.includes(p.id));
      if (left.length && !(await confirmDialog(`${left.map(p => p.name).join(', ')} ${left.length === 1 ? 'has' : 'have'} not been re-signed and will leave as free agents. Continue?`, 'Let them go'))) return;
    }
    if (step === 'draft' && !draftDone(save)) { toast('The draft is still going.'); return; }
    if (step === 'freeAgency' && !faOver(save)) {
      const n = Object.keys(off.userOffers).length;
      if (!(await confirmDialog(`Skip the rest of free agency?${n ? ` Your ${n} pending offer${n === 1 ? '' : 's'} will be withdrawn.` : ''} Unsigned players can still be signed during the season.`, 'Skip'))) return;
    }
    if (step === 'camp') {
      const n = me.roster.length;
      if (n > ROSTER_MAX) { toast(`Too many players: ${n} of ${ROSTER_MAX}. Release ${n - ROSTER_MAX} first.`); return; }
      if (n < ROSTER_MIN && !(await confirmDialog(`You only have ${n} players. The league will add minimum-salary free agents to reach ${ROSTER_MIN}. Start the season?`, 'Start'))) return;
    }
    act((s, rng) => advanceOffseason(s, rng));
    if (save.phase !== 'offseason') { toast(`Season ${save.year} tips off!`, true); reset('hub'); return; }
    setLetGo([]);
    scrollTop();
  };

  const nextDay = () => {
    act((s, rng) => faNextDay(s, rng));
    scrollTop();
  };

  const over = step === 'freeAgency' && faOver(save);
  const footer = (
    <>
      {step === 'freeAgency' && <Btn kind={over ? '' : 'primary big'} class="grow" disabled={over} onClick={nextDay}>{over ? 'FA over' : `Next day (${Math.min(off.faDay, FA_DAYS)}/${FA_DAYS})`}</Btn>}
      <Btn kind={step === 'freeAgency' && !over ? '' : 'primary big'} class="grow" disabled={step === 'draft' && !draftDone(save)} onClick={() => { void advance(); }}>
        {step === 'camp' ? `Start Season ${save.year + 1}` : step === 'freeAgency' && !over ? 'Skip the rest' : 'Continue'}
      </Btn>
    </>
  );

  return (
    <Screen title="Offseason" footer={footer} right={<div class="head gold" title="Credits">◉ {save.credits}</div>}>
      <div class="panel team">
        <div class="ox-pips">
          {STEPS.map((s, j) => {
            const i = STEPS.indexOf(step);
            return <div class={`ox-pip ${j < i ? 'done' : j === i ? 'on' : ''}`}><i />{PIP[s]}</div>;
          })}
        </div>
        <div class="row between" style={{ marginTop: '10px' }}>
          <h2>{TITLE[step].toUpperCase()}</h2>
          <span class="tag">SEASON {save.year}</span>
        </div>
        <div class="dim" style={{ fontSize: '18px' }}>{BLURB[step]}</div>
      </div>
      {step === 'awards' && <AwardsStep save={save} />}
      {step === 'retirements' && <RetirementsStep save={save} />}
      {step === 'contracts' && <ContractsStep save={save} letGo={letGo} setLetGo={setLetGo} />}
      {step === 'draft' && <DraftStep save={save} />}
      {step === 'freeAgency' && <FreeAgencyStep save={save} />}
      {step === 'camp' && <CampStep save={save} />}
    </Screen>
  );
}

// ---- awards --------------------------------------------------------------------------
function TeamBanner({ save, teamId, label, big }: { save: Save; teamId: number; label: string; big?: boolean }) {
  const t = save.teams[teamId];
  if (!t) return null;
  return (
    <div class={`ox-trophy ${big ? '' : 'sm'}`} style={{ '--c1': t.colors.primary, '--c2': t.colors.secondary } as any}>
      {big && <span class="ox-cup">♛</span>}
      <div class="grow">
        <h3>{label}</h3>
        <div class="ox-tname">{fullName(t)}</div>
      </div>
      <span class="ox-abbr">{t.abbr}</span>
    </div>
  );
}

function AwardRow({ save, a, big }: { save: Save; a: SeasonHistory['awards'][number]; big?: boolean }) {
  return (
    <div class="item">
      <div class="grow">
        <div class={big ? 'head gold' : 'head dim'} style={{ fontSize: big ? '10px' : '7px' }}>{a.award.toUpperCase()}</div>
        <div class="nowrap"><NameLink id={a.playerId} name={a.name} /> <span class="dim">{save.teams[a.teamId]?.abbr ?? ''}</span></div>
        {a.line && <div class="dim ox-sub">{a.line}</div>}
      </div>
      {a.teamId === save.userTeamId && <span class="tag gold">YOURS</span>}
    </div>
  );
}

function AwardsStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const h = save.history[save.history.length - 1];
  if (!h) return <Panel><div class="dim">No season to review.</div></Panel>;
  const mine = save.teams[h.userTeamId];
  const goals = off.log.filter(l => l.startsWith('MET:') || l.startsWith('MISSED:'));
  const taxLine = off.log.find(l => l.startsWith('Luxury tax:'));
  const mvp = h.awards.find(a => a.award === 'MVP');
  const others = h.awards.filter(a => a.award !== 'MVP' && !a.award.startsWith('All-League'));
  const allLeague = h.awards.filter(a => a.award.startsWith('All-League'));
  const offers = (off.jobOffers ?? []).filter(id => id !== save.userTeamId && save.teams[id]);

  const take = async (teamId: number) => {
    const t = save.teams[teamId];
    if (!(await confirmDialog(`Leave the ${fullName(save.teams[save.userTeamId])} for the ${fullName(t)}? You take over their offseason from here: contracts, the draft and free agency.`, 'Take the job'))) return;
    act(s => { takeJob(s, teamId, false); if (s.offseason) s.offseason.jobOffers = []; });
    toast(`Welcome to ${t.city}, coach!`, true);
  };

  return (
    <>
      <TeamBanner save={save} teamId={h.championId} label={`SEASON ${h.year} CHAMPIONS`} big />
      <TeamBanner save={save} teamId={h.runnerUpId} label="RUNNER-UP" />

      <Panel team title="YOUR SEASON">
        <div class="row between">
          <span class="head">{mine?.abbr}</span>
          <span class="head">{h.userW}-{h.userL}</span>
          <span class={`tag ${h.userPlayoff === 'champ' ? 'gold' : h.userPlayoff === 'none' ? 'bad' : 'good'}`}>{FINISH[h.userPlayoff].toUpperCase()}</span>
        </div>
      </Panel>

      <Panel title="AWARDS">
        <div class="list">
          {mvp && <AwardRow save={save} a={mvp} big />}
          {others.map(a => <AwardRow save={save} a={a} />)}
        </div>
      </Panel>
      {allLeague.length > 0 && (
        <Panel title="ALL-LEAGUE TEAM">
          <div class="list">
            {allLeague.map(a => (
              <div class="item">
                <span class="tag pos">{a.award.replace('All-League ', '')}</span>
                <div class="grow nowrap"><NameLink id={a.playerId} name={a.name} /> <span class="dim">{save.teams[a.teamId]?.abbr ?? ''}</span></div>
                {a.teamId === save.userTeamId && <span class="tag gold">YOURS</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="THE OWNER'S VERDICT">
        <div class="list">
          {goals.length
            ? goals.map(l => {
              const met = l.startsWith('MET:');
              return <div class="item"><span class={`tag ${met ? 'good' : 'bad'}`}>{met ? 'MET' : 'MISSED'}</span><span class="grow">{l.replace(/^(MET|MISSED):\s*/, '')}</span></div>;
            })
            : <div class="item dim">No goals were set.</div>}
          {taxLine && <div class="item"><span class="tag bad">TAX</span><span class="grow">{taxLine.replace(/^Luxury tax:\s*/, '')}</span></div>}
        </div>
        <div style={{ height: '8px' }} />
        <Meter label="OWNER APPROVAL" value={save.owner.approval} />
      </Panel>

      {offers.map(id => {
        const t = save.teams[id];
        const last = t.history[t.history.length - 1];
        return (
          <Panel team title="JOB OFFER (OPTIONAL)">
            <div class="row">
              <span class="swatch" style={{ background: t.colors.primary, boxShadow: `4px 0 0 ${t.colors.secondary}`, marginRight: '4px' }} />
              <div class="grow">
                <div class="nowrap">{fullName(t)}</div>
                <div class="row dim ox-sub">{last && <span>{last.w}-{last.l} last season</span>}<span class="row" style={{ gap: '4px' }}>Prestige <Stars n={Math.max(0.5, Math.round(t.prestige / 10) / 2)} /></span></div>
              </div>
            </div>
            <div class="dim" style={{ fontSize: '18px', margin: '6px 0' }}>A bigger club wants you as head coach. You do not have to answer: the offer lapses when you continue.</div>
            <Btn kind="primary" class="block" onClick={() => { void take(id); }}>Take the job</Btn>
          </Panel>
        );
      })}
    </>
  );
}

// ---- retirements ---------------------------------------------------------------------
function RetirementsStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const me = save.teams[save.userTeamId];
  const lastTeam = (p: Player): number | null => (p.seasons.length ? p.seasons[p.seasons.length - 1].teamId : null);
  const retired = off.retired.map(id => save.players[id]).filter((p): p is Player => !!p).sort((a, b) => ovr(b) - ovr(a));
  const unknown = off.retired.length - retired.length;
  const hof = save.hallOfFame.filter(h => h.yearRetired === save.year);
  const roster = me.roster.map(id => save.players[id]).filter((p): p is Player => !!p).sort((a, b) => ovr(b) - ovr(a));

  return (
    <>
      {off.log.length > 0 && (
        <Panel title="HEADLINES">
          <div class="list ox-log">{off.log.map(l => <div class="item">{l}</div>)}</div>
        </Panel>
      )}
      {hof.length > 0 && (
        <Panel team title="HALL OF FAME CLASS">
          <div class="list">
            {hof.map(h => (
              <div class="item">
                <span class="ox-cup sm">♛</span>
                <div class="grow">
                  <div class="nowrap"><NameLink id={h.playerId} name={h.name} /></div>
                  <div class="row dim ox-sub"><span>{h.pos}</span><span>{h.seasons} season{h.seasons === 1 ? "" : "s"}</span><span>{h.career.pts} pts</span>{h.awards.length > 0 && <span>{h.awards.length} award{h.awards.length === 1 ? "" : "s"}</span>}</div>
                </div>
                <Stars v={h.peakOvr} />
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel title={`RETIRED (${off.retired.length})`}>
        {off.retired.length === 0 ? <div class="dim">Nobody retired this year.</div> : (
          <div class="list">
            {retired.map(p => {
              const tid = lastTeam(p);
              const wasMine = tid === me.id;
              return (
                <div class="item">
                  <span class="tag pos">{p.pos}</span>
                  <div class="grow">
                    <div class="nowrap"><NameLink id={p.id} name={p.name} /></div>
                    <div class="row dim ox-sub"><span>Age {p.age}</span><span>{p.seasons.length} season{p.seasons.length === 1 ? "" : "s"}</span>{tid !== null && save.teams[tid] && <span>{save.teams[tid].abbr}</span>}</div>
                  </div>
                  {wasMine && <span class="tag gold">YOURS</span>}
                </div>
              );
            })}
            {unknown > 0 && <div class="item dim">and {unknown} more</div>}
          </div>
        )}
      </Panel>
      <Panel title="YOUR ROSTER, ONE YEAR ON">
        <div class="dim" style={{ fontSize: '18px', marginBottom: '4px' }}>Everyone has aged a year. Young players grew over the summer; veterans may have slipped.</div>
        <div class="list">
          {roster.map(p => {
            const last = p.seasons[p.seasons.length - 1];
            const d = last && last.year === save.year ? ovr(p) - last.ovr : null;
            const tag = d === null ? null : d >= 2 ? <span class="tag good">▲ BETTER</span> : d <= -2 ? <span class="tag bad">▼ SLIPPED</span> : <span class="tag">STEADY</span>;
            return <PlayerRow save={save} player={p} onClick={() => nav('player', { id: p.id })} right={tag} />;
          })}
        </div>
      </Panel>
    </>
  );
}

// ---- contracts -----------------------------------------------------------------------
function ContractsStep({ save, letGo, setLetGo }: { save: Save; letGo: number[]; setLetGo: (v: number[]) => void }) {
  const me = save.teams[save.userTeamId];
  const exp = expiringPlayers(save).sort((a, b) => ovr(b) - ovr(a));
  // expired deals are already off the books: this is what next season is committed to
  const pay = payroll(save, me);
  const status = statusOf(pay);
  const signed = me.roster.map(id => save.players[id]).filter(p => p && p.contract.years > 0).sort((a, b) => ovr(b) - ovr(a));
  const resign = (p: Player) => {
    const err = act(s => resignPlayer(s, p.id));
    if (err) toast(err); else toast(`${p.name} re-signed!`, true);
  };
  const bill = taxBill(pay);

  return (
    <>
      <Panel team title="EXPIRING CONTRACTS">
        <div class="dim" style={{ fontSize: '18px' }}>
          Re-sign the players you want to keep at their asking price. <b class="gold">You can always re-sign your own players, even over the cap and the aprons</b>, for up to {MAX_CONTRACT_YEARS} years. Anyone you do not re-sign leaves for free agency when you continue: letting a player go needs no action.
        </div>
        <div class="row between" style={{ marginTop: '8px' }}>
          <span>Payroll next season <b>{money(pay)}</b></span><CapTag status={status} />
        </div>
        <CapBar pay={pay} />
        <div class="row between wrap cap-note">
          <span>Under contract <b>{signed.length} / {ROSTER_MAX}</b></span>
          {bill.over > 0
            ? <span class="bad">Stay above {money(LUXURY_TAX)} all season and the tax is ◉ {bill.credits} and −{bill.ownerHit} owner approval</span>
            : <span class="dim">{money(Math.round((LUXURY_TAX - pay) * 10) / 10)} under the tax line</span>}
        </div>
      </Panel>

      <div class="panel list ox-list">
        {exp.length === 0 && <div class="item dim">No expiring contracts left to decide.</div>}
        {exp.map(p => {
          const ask = askingContract(save, p, me.id);
          const gone = letGo.includes(p.id);
          const after = statusOf(pay + ask.salary);
          return (
            <div class={`item ${gone ? 'ox-faded' : ''}`}>
              <span class="tag pos">{p.pos}</span>
              <div class="grow">
                <div class="nowrap"><NameLink id={p.id} name={p.name} /> {moraleTag(p.morale)}</div>
                <div class="row dim ox-sub"><Stars v={ovr(p)} /><span>Age {p.age}</span><span>{p.trait}</span>{supermaxEligible(p) && <span class="tag gold">SUPERMAX ELIGIBLE</span>}</div>
                <div class="ox-sub">
                  {gone ? <span class="dim">Leaving in free agency</span>
                    : ask.refuses ? <span class="bad">Will not re-sign</span>
                    : (
                      <span>
                        Asks <b class="gold">{dealText(ask.salary, ask.years)}</b>
                        {ask.supermax && <span class="tag gold" style={{ marginLeft: '6px' }}>SUPERMAX</span>}
                        {after !== status && <span class={STATUS_CLASS[after] || 'dim'}> · {STATUS_PUSH[after]}</span>}
                      </span>
                    )}
                </div>
              </div>
              <div class="col" style={{ gap: '6px', flex: 'none' }}>
                {gone
                  ? <Btn onClick={() => setLetGo(letGo.filter(x => x !== p.id))}>Undo</Btn>
                  : (
                    <>
                      {!ask.refuses && <Btn kind="good" onClick={() => resign(p)}>Re-sign</Btn>}
                      <Btn onClick={() => setLetGo([...letGo, p.id])}>Let go</Btn>
                    </>
                  )}
              </div>
            </div>
          );
        })}
      </div>
      {exp.some(p => supermaxEligible(p)) && (
        <div class="dim cap-note">Supermax: a player with an MVP or All-League award can be paid up to $52.5M by his own team, above the $45M maximum anyone else can offer. Only the very best ask for it.</div>
      )}

      <Panel title="TRADES ARE OPEN">
        <div class="dim" style={{ fontSize: '18px', marginBottom: '6px' }}>You can trade players and picks all offseason.</div>
        <Btn class="block" onClick={() => nav('trades', { tab: 'Propose' })}>Open Trades</Btn>
      </Panel>

      <Panel title={`UNDER CONTRACT NEXT SEASON (${signed.length})`}>
        <div class="list">
          {signed.map(p => <PlayerRow save={save} player={p} onClick={() => nav('player', { id: p.id })} right={<span class="dim ox-sub">{contractText(p)}</span>} />)}
        </div>
      </Panel>
    </>
  );
}
