import type { Save, StaffMember } from '../core/types';
import { REP_FOR_STARS, canHire, fireStaff, hireStaff } from '../core/org/economy';
import { touch, useSave } from '../state/store';
import { Btn, Meter, Panel, Screen, Stars, confirmDialog, toast } from './kit';

const ROLES: { role: 'OC' | 'DC'; slot: 'oc' | 'dc'; title: string; what: string }[] = [
  { role: 'OC', slot: 'oc', title: 'OFFENSIVE COORDINATOR', what: 'Boosts shooting and passing on possessions you play.' },
  { role: 'DC', slot: 'dc', title: 'DEFENSIVE COORDINATOR', what: 'Improves your simulated defense.' },
];

export function StaffScreen(_p: { params: Record<string, any> }) {
  const save: Save = useSave();
  const me = save.teams[save.userTeamId];

  const fire = async (role: 'OC' | 'DC', name: string) => {
    if (!(await confirmDialog(`Fire ${name}? He returns to the hiring pool.`, 'Fire'))) return;
    touch(s => fireStaff(s, role));
    toast(`${name} fired.`, true);
  };
  const hire = async (s: StaffMember, slot: 'oc' | 'dc') => {
    const cur = me.staff[slot];
    if (cur && !(await confirmDialog(`Hire ${s.name} for ${s.cost} credits? ${cur.name} will be let go.`, 'Hire'))) return;
    let err: string | null = null;
    touch(sv => { err = hireStaff(sv, s.id); });
    if (err) toast(err); else toast(`${s.name} hired.`, true);
  };

  return (
    <Screen title="Staff" right={<div class="head gold">◉ {save.credits}</div>}>
      <Panel title="COACH REPUTATION">
        <Meter label="REPUTATION" value={save.coach.rep} text={`${Math.round(save.coach.rep)}/100`} />
        <div class="dim" style={{ marginTop: '6px' }}>
          Reputation unlocks better staff: 3 stars at {REP_FOR_STARS[3]}, 4 stars at {REP_FOR_STARS[4]}, 5 stars at {REP_FOR_STARS[5]}.
        </div>
      </Panel>

      {ROLES.map(r => {
        const cur = me.staff[r.slot];
        const pool = save.staffPool.filter(s => s.role === r.role).sort((a, b) => b.stars - a.stars || a.cost - b.cost);
        return (
          <Panel title={r.title} team>
            <div class="dim" style={{ marginBottom: '6px' }}>{r.what}</div>
            {cur ? (
              <div class="item">
                <div class="grow">
                  <div class="nowrap">{cur.name}</div>
                  <div class="row dim"><Stars n={cur.stars} /><span>Age {cur.age}</span></div>
                </div>
                <Btn kind="small danger" onClick={() => fire(r.role, cur.name)}>Fire</Btn>
              </div>
            ) : (
              <div class="item"><span class="tag bad">VACANT</span><span class="dim grow">No coordinator. Hire one below.</span></div>
            )}
            <h3 style={{ margin: '10px 0 4px' }}>AVAILABLE</h3>
            <div class="list">
              {pool.length === 0 && <div class="dim item">Nobody available right now.</div>}
              {pool.map(s => {
                const why = canHire(save, s);
                return (
                  <div class="item">
                    <div class="grow">
                      <div class="nowrap">{s.name}</div>
                      <div class="row dim"><Stars n={s.stars} /><span>Age {s.age}</span></div>
                      {why && <div class="bad" style={{ fontSize: '17px' }}>{why}</div>}
                    </div>
                    <div class="gold">◉ {s.cost}</div>
                    <Btn kind="small primary" disabled={!!why} onClick={() => hire(s, r.slot)}>Hire</Btn>
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}
    </Screen>
  );
}
