import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { choresList, doChores } from '../core/org/chores';
import { FACILITY_COST, FACILITY_INFO, repairCost, repairFacility, upgradeFacility } from '../core/org/economy';
import type { FacilityKey } from '../core/types';
import { FACILITY_KEYS } from '../core/types';
import { touch, useSave } from '../state/store';
import { Btn, Screen, toast } from './kit';
import { ClubView } from './ClubView';

const SEEN_KEY = 'retro-hoops-facility-levels';

/** Levels last time this screen was open, per team, to celebrate upgrades that finished since. */
function freshUpgrades(teamId: number, levels: Record<FacilityKey, number>): FacilityKey[] {
  let up: FacilityKey[] = [];
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, Record<string, number>>;
    const before = all[teamId];
    if (before) up = FACILITY_KEYS.filter(k => levels[k] > (before[k] ?? levels[k]));
    all[teamId] = levels;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: no celebration, no harm */ }
  return up;
}

export function FacilitiesScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const panels = useRef<Partial<Record<FacilityKey, HTMLDivElement | null>>>({});
  const [lit, setLit] = useState<FacilityKey | null>(null);
  const [fresh] = useState<FacilityKey[]>(() => freshUpgrades(me.id, Object.fromEntries(FACILITY_KEYS.map(k => [k, me.facilities[k].level])) as Record<FacilityKey, number>));
  useEffect(() => { if (fresh.length) sfx.fanfare(); }, []);

  const run = (fn: () => string | null, ok: string, coin = false) => {
    let err: string | null = null;
    touch(() => { err = fn(); });
    if (err) toast(err); else { toast(ok, true); if (coin) sfx.coin(); }
  };
  const pick = (k: FacilityKey) => {
    panels.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setLit(k); sfx.click();
    setTimeout(() => setLit(cur => (cur === k ? null : cur)), 1600);
  };
  const repair = choresList(save).find(c => c.id === 'repair');
  const maintainAll = () => {
    let done: string[] = [];
    touch(s => { done = doChores(s, 'repair'); });
    if (done.length) { sfx.coin(); toast(done.length === 1 ? `${done[0]}.` : `${done.length} facilities maintained.`, true); }
    else toast(`Needs ${repair?.cost ?? 0} credits.`);
  };

  return (
    <Screen title="Facilities" right={<div class="head gold">◉ {save.credits}</div>}>
      <div class="clubview-wrap">
        <ClubView save={save} onPick={pick} />
        <div class="dim clubview-hint">Tap a building to see it. Every upgrade shows up here.</div>
      </div>
      {repair && (
        <div class="panel fac-maint">
          <div class="head gold">MAINTENANCE DUE</div>
          <div class="dim" style={{ fontSize: '17px' }}>{repair.text}. Run-down buildings work a level lower.</div>
          <Btn kind="primary" class="block" disabled={save.credits < 1} onClick={maintainAll}>Maintain all · ◉ {repair.cost}</Btn>
        </div>
      )}
      {FACILITY_KEYS.map(k => {
        const f = me.facilities[k];
        const info = FACILITY_INFO[k];
        const next = f.level + 1;
        const rc = repairCost(f);
        const cost = FACILITY_COST[next];
        return (
          <div ref={el => { panels.current[k] = el; }} class={`panel team fac ${lit === k ? 'lit' : ''}`}>
            <div class="row between">
              <h3 style={{ margin: 0 }}>{info.name.toUpperCase()}</h3>
              <div class="fac-pips">
                {[1, 2, 3, 4, 5].map(i => <span class={i <= f.level ? 'on' : f.pending === i ? 'soon' : ''} />)}
              </div>
            </div>
            {fresh.includes(k) && <div class="fac-fresh">UPGRADED! NOW LEVEL {f.level}</div>}
            <div class="fac-now"><span class="gold">Now:</span> {info.perks[f.level - 1]}</div>
            {f.level < 5 && !f.pending && <div class="dim fac-next">Level {next}: {info.perks[next - 1]}</div>}
            {f.pending && <div class="gold fac-next">Building level {f.pending}: ready next week</div>}
            {f.condition < 95 && (
              <div class={`fac-cond ${f.condition < 50 ? 'bad' : f.condition < 75 ? 'gold' : 'dim'}`}>
                Condition {Math.round(f.condition)}%{f.condition < 50 ? ': run down, working a level lower' : ''}
              </div>
            )}
            <div class="row" style={{ marginTop: '8px' }}>
              {!f.pending && f.level < 5 && (
                <Btn class="grow" kind="primary" disabled={save.credits < cost} onClick={() => run(() => upgradeFacility(save, k), `${info.name} upgrade under way.`, true)}>
                  Upgrade ◉ {cost}
                </Btn>
              )}
              {f.level >= 5 && !f.pending && <div class="grow dim">Top level.</div>}
              {rc > 0 && (
                <Btn class={f.pending || f.level >= 5 ? 'grow' : ''} disabled={save.credits < rc} onClick={() => run(() => repairFacility(save, k), `${info.name} maintained.`)}>
                  Maintain ◉ {rc}
                </Btn>
              )}
            </div>
          </div>
        );
      })}
    </Screen>
  );
}
