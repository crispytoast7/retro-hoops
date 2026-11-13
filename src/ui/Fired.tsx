import { takeJob } from '../core/org/people';
import { act, useSave } from '../state/store';
import { teamRatings } from '../core/sim/engine';
import { Btn, Panel, Stars, fullName, teamStarCount } from './kit';
import { reset } from './router';

export function FiredScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const old = save.teams[save.userTeamId];
  const offers = save.fired?.offers ?? [];
  if (!save.fired) return <div class="screen"><div class="title"><Btn kind="primary" onClick={() => reset('hub')}>Back to the hub</Btn></div></div>;
  return (
    <div class="screen">
      <div class="body">
        <div class="center" style={{ padding: '16px 0' }}>
          <div class="logo" style={{ fontSize: '28px', color: 'var(--bad)' }}>FIRED</div>
        </div>
        <Panel>
          <div>{save.owner.name} has run out of patience. Your time with the {fullName(old)} is over.</div>
          <div class="dim" style={{ marginTop: '6px' }}>Your career record ({save.coach.w}-{save.coach.l}, {save.coach.titles} title{save.coach.titles === 1 ? '' : 's'}) comes with you. These clubs will give you a chance to rebuild it.</div>
        </Panel>
        {offers.map(id => {
          const t = save.teams[id];
          const r = teamRatings(t.roster.map(p => save.players[p]), t.lineup);
          return (
            <Panel>
              <div class="row">
                <span class="swatch" style={{ background: t.colors.primary, boxShadow: `4px 0 0 ${t.colors.secondary}`, marginRight: '4px' }} />
                <div class="grow"><div>{fullName(t)}</div><div class="row dim"><Stars n={teamStarCount(r.ovr)} /><span>{t.record.w}-{t.record.l}</span></div></div>
                <Btn kind="primary" onClick={() => { act(s => takeJob(s, id, true)); reset('hub'); }}>Take job</Btn>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
