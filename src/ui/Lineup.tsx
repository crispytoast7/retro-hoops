import { useState } from 'preact/hooks';
import { autoLineup } from '../core/lineup';
import { ovr, overallOf } from '../core/ratings';
import { teamRatings } from '../core/sim/engine';
import { POSITIONS } from '../core/types';
import { sfx } from '../audio/sfx';
import { touch, useSave } from '../state/store';
import { Btn, Panel, PlayerRow, Screen, Stars, teamStarCount, toast } from './kit';

export function LineupScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const [sel, setSel] = useState<number | null>(null);
  const bench = me.roster.filter(id => !me.lineup.includes(id)).map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a));
  const r = teamRatings(me.roster.map(id => save.players[id]), me.lineup);
  const tap = (id: number) => {
    if (sel === null) { setSel(id); sfx.click(); return; }
    if (sel === id) { setSel(null); return; }
    const a = me.lineup.indexOf(sel), b = me.lineup.indexOf(id);
    if (a < 0 && b < 0) { setSel(id); return; } // two bench players: just move the selection
    const incoming = a < 0 ? sel : b < 0 ? id : null;
    if (incoming !== null && save.players[incoming].injury) { toast('He is not available to play.'); setSel(null); return; }
    touch(s => {
      const L = s.teams[s.userTeamId].lineup;
      if (a >= 0 && b >= 0) [L[a], L[b]] = [L[b], L[a]];
      else if (a >= 0) L[a] = id;
      else L[b] = sel;
    });
    sfx.select();
    setSel(null);
  };
  return (
    <Screen title="Lineup" right={<Btn kind="small" onClick={() => { touch(s => { const t = s.teams[s.userTeamId]; t.lineup = autoLineup(t.roster.map(id => s.players[id])); }); setSel(null); toast('Best healthy five set.', true); }}>Auto</Btn>}>
      <div class="panel row between">
        <div><div class="head dim">OFFENSE</div><Stars n={teamStarCount(r.off)} /></div>
        <div><div class="head dim">DEFENSE</div><Stars n={teamStarCount(r.def)} /></div>
        <div><div class="head dim">OVERALL</div><Stars n={teamStarCount(r.ovr)} /></div>
      </div>
      <div class="dim" style={{ fontSize: '17px' }}>Tap two players to swap them. Players out of position play a little worse.</div>
      <Panel title="STARTERS" team>
        <div class="list">
          {POSITIONS.map((slot, i) => {
            const p = save.players[me.lineup[i]];
            if (!p) return <div class="item"><span class="tag">{slot}</span><span class="bad grow">Empty: tap Auto</span></div>;
            const fit = p.pos === slot;
            return (
              <PlayerRow save={save} player={p} sel={sel === p.id} onClick={() => tap(p.id)}
                note={fit ? undefined : <span class="gold">playing {slot}</span>}
                right={<div class="col" style={{ alignItems: 'flex-end', gap: '2px' }}><span class="head dim">{slot}</span><Stars v={overallOf(p.ratings, slot) - (fit ? 0 : 4)} /></div>} />
            );
          })}
        </div>
      </Panel>
      <Panel title="BENCH">
        <div class="list">
          {bench.map(p => <PlayerRow save={save} player={p} sel={sel === p.id} onClick={() => tap(p.id)} />)}
          {bench.length === 0 && <div class="dim">No one on the bench.</div>}
        </div>
      </Panel>
    </Screen>
  );
}
