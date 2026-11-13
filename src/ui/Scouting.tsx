import { effLevel } from '../core/org/economy';
import type { Save } from '../core/types';
import { useSave } from '../state/store';
import { Btn, Panel, Screen } from './kit';
import { ProspectBoard, pickText } from './OffseasonParts';
import { nav } from './router';

/** True once this season's draft has been run (the class is gone until the new season). */
const draftPast = (save: Save): boolean =>
  save.phase === 'offseason' && (save.offseason?.step === 'freeAgency' || save.offseason?.step === 'camp' || save.offseason?.step === 'done');

/** The user's picks in the coming draft and the one after, as display lines. */
export function userPickLines(save: Save): { label: string; lines: string[] }[] {
  const me = save.teams[save.userTeamId];
  const off = save.offseason;
  const first = draftPast(save) ? save.year + 1 : save.year;
  const out: { label: string; lines: string[] }[] = [];
  for (const year of [first, first + 1]) {
    let lines: string[];
    if (year === save.year && off && off.draftOrder.length) {
      lines = off.draftOrder
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.teamId === me.id)
        .map(s => `Round ${s.round}, pick ${s.pick}${s.i < off.draftIdx ? ' (used)' : s.i === off.draftIdx ? ' (on the clock)' : ''}`);
    } else {
      lines = me.picks
        .filter(pk => pk.year === year)
        .sort((a, b) => a.round - b.round || a.origTeamId - b.origTeamId)
        .map(pk => pickText(save, pk) + (pk.origTeamId !== me.id ? ' via trade' : ''));
    }
    out.push({ label: `SEASON ${year} DRAFT`, lines });
  }
  return out;
}

export function ScoutingScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const off = save.offseason;
  const inDraft = save.phase === 'offseason' && off?.step === 'draft';
  const ids = inDraft && off ? off.prospects : save.draftClass;
  const level = effLevel(me.facilities.scouting);
  const known = ids.filter(id => save.players[id]?.scouted !== false).length;

  return (
    <Screen title="Scouting" right={<div class="head gold" title="Credits">◉ {save.credits}</div>}>
      <Panel team title="SCOUTING DEPARTMENT">
        <div class="row between"><span>Reports left this season</span><span class="head gold">{save.scoutPoints}</span></div>
        <div class="dim" style={{ fontSize: '18px', marginTop: '4px' }}>
          A report reveals a prospect's true ratings and his ceiling. {save.scoutPoints > 0 ? 'When your reports run out, ' : 'You are out of reports: '}each further report costs 1 credit.
          Unscouted ratings are shown as ranges; a level {level} scouting office keeps them {level >= 4 ? 'tight' : level >= 2 ? 'fairly close' : 'wide'}.
        </div>
        {ids.length > 0 && <div class="dim" style={{ fontSize: '18px', marginTop: '4px' }}>Scouted {known} of {ids.length} prospects.</div>}
      </Panel>

      <Panel title="YOUR PICKS">
        <div class="grid2">
          {userPickLines(save).map(g => (
            <div class="col" style={{ gap: '4px' }}>
              <h3>{g.label}</h3>
              {g.lines.length ? g.lines.map(l => <div>{l}</div>) : <div class="dim">No picks</div>}
            </div>
          ))}
        </div>
      </Panel>

      {inDraft && (
        <Btn kind="primary" class="block" onClick={() => nav('offseason')}>The draft is on: go to the board</Btn>
      )}

      {ids.length
        ? <ProspectBoard save={save} ids={ids} />
        : (
          <Panel title="DRAFT CLASS">
            <div class="dim">{draftPast(save) ? 'This year\'s draft is done. The next class is announced when the new season starts.' : 'No prospects to scout right now.'}</div>
          </Panel>
        )}
    </Screen>
  );
}
