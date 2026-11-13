import { FACILITY_COST, FACILITY_INFO, repairCost, repairFacility, upgradeFacility } from '../core/org/economy';
import { FACILITY_KEYS } from '../core/types';
import { touch, useSave } from '../state/store';
import { Btn, Meter, Panel, Screen, toast } from './kit';

export function FacilitiesScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];

  const run = (fn: () => string | null, ok: string) => {
    let err: string | null = null;
    touch(() => { err = fn(); });
    if (err) toast(err); else toast(ok, true);
  };

  return (
    <Screen title="Facilities" right={<div class="head gold">◉ {save.credits}</div>}>
      {FACILITY_KEYS.map(k => {
        const f = me.facilities[k];
        const info = FACILITY_INFO[k];
        const next = f.level + 1;
        const rc = repairCost(f);
        return (
          <Panel title={info.name.toUpperCase()} team>
            <div class="dim">{info.desc}</div>
            <div class="row" style={{ margin: '8px 0' }}>
              <span class="head">LVL {f.level}</span>
              <div class="row" style={{ gap: '4px' }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <span style={{ width: '18px', height: '18px', border: '2px solid var(--edge)', background: i <= f.level ? 'var(--gold)' : 'var(--panel2)', display: 'inline-block' }} />
                ))}
              </div>
            </div>
            <div><span class="gold">Now:</span> {info.perks[f.level - 1]}</div>
            {f.level < 5 && <div class="dim"><span>Next:</span> {info.perks[next - 1]}</div>}
            <div style={{ margin: '8px 0' }}><Meter label="CONDITION" value={f.condition} text={`${Math.round(f.condition)}%`} /></div>
            {f.condition < 50 && <div class="bad" style={{ marginBottom: '6px' }}>Run down: works one level lower until maintained.</div>}
            <div class="row wrap">
              {f.pending ? (
                <div class="grow gold">Upgrade to level {f.pending} ready next week</div>
              ) : f.level >= 5 ? (
                <div class="grow dim">Max level.</div>
              ) : (
                <Btn class="grow" kind="primary" disabled={save.credits < FACILITY_COST[next]} onClick={() => run(() => upgradeFacility(save, k), `${info.name} upgrade started.`)}>
                  Upgrade to {next} (◉ {FACILITY_COST[next]})
                </Btn>
              )}
              {rc > 0 && (
                <Btn class="grow" disabled={save.credits < rc} onClick={() => run(() => repairFacility(save, k), `${info.name} repaired.`)}>
                  Maintain (◉ {rc})
                </Btn>
              )}
            </div>
          </Panel>
        );
      })}
    </Screen>
  );
}
