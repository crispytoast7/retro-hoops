import { useEffect, useRef, useState } from 'preact/hooks';
import { FA_DAYS, HARD_LIMIT, MAX_CONTRACT_YEARS, MIN_SALARY, ROSTER_MAX, ROSTER_MIN, SALARY_CAP } from '../core/constants';
import { askingContract } from '../core/gm/value';
import { advanceOffseason, draftDone, expiringPlayers, faNextDay, faOver, resignPlayer } from '../core/offseason/offseason';
import { payroll, signingPath, statusOf } from '../core/org/finance';
import { takeJob } from '../core/org/people';
import { ovr } from '../core/ratings';
import type { OffseasonStep, Player, Save, SeasonHistory } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, touch, useSave } from '../state/store';
import { Btn, Meter, Panel, PlayerRow, Screen, Sprite, Stars, confirmDialog, fullName, money, moraleTag, toast } from './kit';
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
  contracts: 'Decide who stays. You may go over the cap to re-sign your own players, but never past the hard limit. Anyone you do not re-sign leaves when you continue.',
  draft: 'Two rounds. The eight teams that missed the playoffs draw for the top three picks; everyone else picks by record, worst first.',
  freeAgency: `${FA_DAYS} days to sign free agents. Another team's player needs room under the cap; over it you have minimum deals.`,
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
  const mine = a.teamId === save.userTeamId;
  return (
    <div class={`item ${mine ? 'ox-mine' : ''}`}>
      <div class="grow">
        <div class={big || mine ? 'head gold' : 'head dim'} style={{ fontSize: big ? '10px' : '7px' }}>{(AWARD_TITLE[a.award] ?? a.award).toUpperCase()}</div>
        <div class="nowrap"><NameLink id={a.playerId} name={a.name} /> <span class="dim">{save.teams[a.teamId]?.abbr ?? ''}</span></div>
        {a.line && <div class="dim ox-sub">{a.line}</div>}
      </div>
      {mine && <span class="tag gold">YOUR PLAYER</span>}
    </div>
  );
}

/** Handed out in this order: the big one comes last. */
const CEREMONY = ['Sixth Man', 'Most Improved', 'Rookie of the Year', 'Scoring Champ', 'Defensive Player', 'Finals MVP', 'MVP'];
const AWARD_TITLE: Record<string, string> = {
  'Sixth Man': 'Sixth Man of the Year', 'Most Improved': 'Most Improved Player', 'Scoring Champ': 'Scoring Champion',
  'Defensive Player': 'Defensive Player of the Year', 'Finals MVP': 'Finals MVP', MVP: 'Most Valuable Player',
};
type Award = SeasonHistory['awards'][number];

/** The awards night: one envelope at a time, your own winners in gold. */
function Ceremony({ save, h }: { save: Save; h: SeasonHistory }) {
  const off = save.offseason!;
  const singles = CEREMONY.map(n => h.awards.find(a => a.award === n)).filter((a): a is Award => !!a);
  const allLeague = h.awards.filter(a => a.award.startsWith('All-League'));
  const total = singles.length + (allLeague.length ? 1 : 0);
  const [n, setN] = useState(off.awardsSeen ? total : 0);
  const [drum, setDrum] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const rewards = off.awardRewards ?? [];
  const rewardOf = (a: Award) => rewards.find(r => r.award === a.award && r.playerId === a.playerId);
  const isMine = (a: Award) => a.teamId === save.userTeamId;
  const finish = () => touch(sv => { if (sv.offseason) sv.offseason.awardsSeen = true; });
  const titleOf = (i: number) => (i < singles.length ? AWARD_TITLE[singles[i].award] ?? singles[i].award : 'All-League Team');

  const reveal = () => {
    if (drum || n >= total) return;
    const next = singles[n];
    const big = !!next && (next.award === 'MVP' || next.award === 'Finals MVP');
    const mine = next ? isMine(next) : allLeague.some(isMine);
    setDrum(true); sfx.select();
    setTimeout(() => {
      if (!alive.current) return;
      setDrum(false); setN(n + 1);
      if (mine) { sfx.fanfare(); setTimeout(() => sfx.coin(), 500); } else if (big) sfx.cheer(true); else sfx.good();
      if (n + 1 >= total) finish();
    }, big ? 1100 : 450);
  };
  const showAll = () => { setN(total); finish(); };

  const done = n >= total;
  const staged = n > 0 && !done ? n - 1 : -1; // the envelope just opened
  const stage = (i: number) => {
    if (i >= singles.length) {
      return (
        <div class={`ox-stage ${allLeague.some(isMine) ? 'mine' : ''}`}>
          <div class="head gold">ALL-LEAGUE TEAM</div>
          <div class="list" style={{ width: '100%' }}>
            {allLeague.map(a => (
              <div class={`item ${isMine(a) ? 'ox-mine' : ''}`} style={{ minHeight: '34px' }}>
                <span class="tag pos">{a.award.replace('All-League ', '')}</span>
                <div class="grow nowrap"><NameLink id={a.playerId} name={a.name} /> <span class="dim">{save.teams[a.teamId]?.abbr ?? ''}</span></div>
                {isMine(a) && <span class="tag gold">YOUR PLAYER</span>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    const a = singles[i], p = save.players[a.playerId], t = save.teams[a.teamId], r = rewardOf(a);
    return (
      <div class={`ox-stage ${isMine(a) ? 'mine' : ''}`}>
        <div class="head gold">{(AWARD_TITLE[a.award] ?? a.award).toUpperCase()}</div>
        <div class="row" style={{ gap: '12px', alignItems: 'center' }}>
          {p && <Sprite player={p} team={t} scale={3} />}
          <div class="col" style={{ gap: '3px', alignItems: 'flex-start', textAlign: 'left' }}>
            <div class="ox-winner"><NameLink id={a.playerId} name={a.name} /></div>
            <div class="dim">{p ? `${p.pos} · ` : ''}{t ? fullName(t) : ''}</div>
            {a.line && <div>{a.line}</div>}
          </div>
        </div>
        {isMine(a) && <div class="row" style={{ gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}><span class="tag gold">YOUR PLAYER</span>{r && <span class="gold">◉ +{r.credits} credits · fans +{r.fans}</span>}</div>}
      </div>
    );
  };

  if (done) {
    const order = [...singles].reverse();
    const credits = rewards.reduce((x, r) => x + r.credits, 0), fans = rewards.reduce((x, r) => x + r.fans, 0);
    return (
      <>
        {rewards.length > 0 && (
          <div class="panel ox-haul">
            <div class="head gold">YOUR PLAYERS TOOK HOME {rewards.length} AWARD{rewards.length === 1 ? '' : 'S'}</div>
            <div>The club earns <span class="gold">◉ +{credits} credits</span>, fan support +{fans}, and {rewards.length === 1 ? 'a very happy player' : 'some very happy players'}.</div>
          </div>
        )}
        <Panel title="AWARDS">
          <div class="list">{order.map(a => <AwardRow save={save} a={a} big={a.award === 'MVP'} />)}</div>
        </Panel>
        {allLeague.length > 0 && (
          <Panel title="ALL-LEAGUE TEAM">
            <div class="list">
              {allLeague.map(a => (
                <div class={`item ${isMine(a) ? 'ox-mine' : ''}`}>
                  <span class="tag pos">{a.award.replace('All-League ', '')}</span>
                  <div class="grow nowrap"><NameLink id={a.playerId} name={a.name} /> <span class="dim">{save.teams[a.teamId]?.abbr ?? ''}</span></div>
                  {isMine(a) && <span class="tag gold">YOUR PLAYER</span>}
                </div>
              ))}
            </div>
          </Panel>
        )}
      </>
    );
  }
  return (
    <Panel team title={`AWARDS NIGHT · ${n}/${total}`}>
      {staged >= 0 && !drum && stage(staged)}
      {drum && <div class="ox-stage drum"><div class="head dim">AND THE</div><div class="head gold">{titleOf(n).toUpperCase()}</div><div class="head dim">{n < singles.length ? 'GOES TO' : 'IS'} . . .</div></div>}
      {staged < 0 && !drum && <div class="ox-stage"><div class="ox-cup">♛</div><div>{total} envelopes. The big one comes last.</div></div>}
      <div style={{ height: '8px' }} />
      <div class="row">
        <Btn kind="primary big" class="grow" disabled={drum} onClick={reveal}>{drum ? '. . .' : `Open: ${titleOf(n)}`}</Btn>
        <Btn onClick={showAll}>Show all</Btn>
      </div>
      {n > 1 && (
        <div class="list" style={{ marginTop: '8px' }}>
          {singles.slice(0, staged >= 0 ? staged : n).reverse().map(a => <AwardRow save={save} a={a} />)}
        </div>
      )}
    </Panel>
  );
}

function AwardsStep({ save }: { save: Save }) {
  const off = save.offseason!;
  const h = save.history[save.history.length - 1];
  if (!h) return <Panel><div class="dim">No season to review.</div></Panel>;
  const mine = save.teams[h.userTeamId];
  const goals = off.log.filter(l => l.startsWith('MET:') || l.startsWith('MISSED:'));
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

      <Ceremony save={save} h={h} />

      <Panel title="THE OWNER'S VERDICT">
        <div class="list">
          {goals.length
            ? goals.map(l => {
              const met = l.startsWith('MET:');
              return <div class="item"><span class={`tag ${met ? 'good' : 'bad'}`}>{met ? 'MET' : 'MISSED'}</span><span class="grow">{l.replace(/^(MET|MISSED):\s*/, '')}</span></div>;
            })
            : <div class="item dim">No goals were set.</div>}
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
            <div class="dim" style={{ fontSize: '18px', margin: '6px 0' }}>{t.prestige > save.teams[save.userTeamId].prestige + 8
              ? 'A bigger club wants you as head coach. You do not have to answer: the offer lapses when you continue.'
              : 'A NEW CHALLENGE: you have won it all here. This club, one of the weakest in the league, asks whether you could do it again. Your coach level, perks and credits come with you. You do not have to answer.'}</div>
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
  // how the summer changed each of your players (older saves fall back to last season's overall)
  const changes = roster.map(p => {
    const rec = off.progress?.find(x => x.playerId === p.id);
    const last = p.seasons[p.seasons.length - 1];
    const d = rec ? rec.after - rec.before : last && last.year === save.year ? ovr(p) - last.ovr : null;
    return { p, d };
  }).sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
  const top = changes[0], bottom = changes[changes.length - 1];
  const riser = top && (top.d ?? 0) >= 2 ? { p: top.p, d: top.d! } : null;
  const faller = bottom && (bottom.d ?? 0) <= -2 ? { p: bottom.p, d: bottom.d! } : null;

  return (
    <>
      <Panel team title="SUMMER PROGRESS">
        <div class="dim" style={{ fontSize: '18px', marginBottom: '6px' }}>Everyone is a year older. Young players with room to grow got better; veterans past 30 start to slip.</div>
        {(riser || faller) && (
          <div class="ox-callouts">
            {riser && (
              <div class="ox-callout up tap" onClick={() => nav('player', { id: riser.p.id })}>
                <div class="head good">BIGGEST LEAP</div>
                <div class="row" style={{ gap: '8px' }}><Sprite player={riser.p} team={me} scale={2} /><div><div>{riser.p.name}</div><div class="good">▲ +{riser.d} overall</div></div></div>
              </div>
            )}
            {faller && (
              <div class="ox-callout down tap" onClick={() => nav('player', { id: faller.p.id })}>
                <div class="head bad">BIGGEST DROP</div>
                <div class="row" style={{ gap: '8px' }}><Sprite player={faller.p} team={me} scale={2} /><div><div>{faller.p.name}</div><div class="bad">▼ {faller.d} overall</div></div></div>
              </div>
            )}
          </div>
        )}
        <div class="list">
          {changes.map(({ p, d }) => {
            const tag = d === null ? null : d > 0 ? <span class="tag good">▲ +{d}</span> : d < 0 ? <span class="tag bad">▼ {d}</span> : <span class="tag">=</span>;
            return <PlayerRow save={save} player={p} onClick={() => nav('player', { id: p.id })} right={tag} />;
          })}
        </div>
      </Panel>
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
  const toLimit = Math.round((HARD_LIMIT - pay) * 10) / 10, space = Math.round((SALARY_CAP - pay) * 10) / 10;

  return (
    <>
      <Panel team title="EXPIRING CONTRACTS">
        <div class="dim" style={{ fontSize: '18px' }}>
          Re-sign the players you want to keep at their asking price, for up to {MAX_CONTRACT_YEARS} years. <b class="gold">You may go over the {money(SALARY_CAP)} cap to keep your own players, but never past the {money(HARD_LIMIT)} hard limit.</b> Anyone you do not re-sign leaves for free agency when you continue: letting a player go needs no action.
        </div>
        <div class="row between" style={{ marginTop: '8px' }}>
          <span>Payroll next season <b>{money(pay)}</b></span><CapTag status={status} />
        </div>
        <CapBar pay={pay} />
        <div class="ox-stats" style={{ marginTop: '6px' }}>
          <div><h3>ROOM TO RE-SIGN</h3><div class={`head ${toLimit < MIN_SALARY ? 'bad' : 'good'}`}>{money(Math.max(0, toLimit))}</div></div>
          <div><h3>CAP SPACE</h3><div class={`head ${space >= MIN_SALARY ? 'good' : 'dim'}`}>{money(Math.max(0, space))}</div></div>
          <div><h3>UNDER CONTRACT</h3><div class="head">{signed.length}/{ROSTER_MAX}</div></div>
        </div>
        <div class="dim cap-note" style={{ marginTop: '6px' }}>Room to re-sign is what is left under the hard limit. Cap space is what you could offer another team's free agent later: every player you re-sign uses it up.</div>
      </Panel>

      <div class="panel list ox-list">
        {exp.length === 0 && <div class="item dim">No expiring contracts left to decide.</div>}
        {exp.map(p => {
          const ask = askingContract(save, p, me.id);
          const gone = letGo.includes(p.id);
          const after = statusOf(pay + ask.salary);
          const path = signingPath(save, me, ask.salary, { ownPlayer: true, years: ask.years });
          return (
            <div class={`item ${gone ? 'ox-faded' : ''}`}>
              <span class="tag pos">{p.pos}</span>
              <div class="grow">
                <div class="nowrap"><NameLink id={p.id} name={p.name} /> {moraleTag(p.morale)}</div>
                <div class="row dim ox-sub"><Stars v={ovr(p)} /><span>Age {p.age}</span><span>{p.trait}</span></div>
                <div class="ox-sub">
                  {gone ? <span class="dim">Leaving in free agency</span>
                    : ask.refuses ? <span class="bad">Will not re-sign</span>
                    : (
                      <span>
                        Asks <b class="gold">{dealText(ask.salary, ask.years)}</b>
                        {!path.ok ? <span class="bad"> · does not fit under the hard limit</span>
                          : after !== status ? <span class={STATUS_CLASS[after] || 'dim'}> · {STATUS_PUSH[after]}</span> : null}
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
