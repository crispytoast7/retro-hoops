import { TAP } from '../state/device';
import { useState } from 'preact/hooks';
import { autoLineup } from '../core/lineup';
import { ovr, overallOf } from '../core/ratings';
import { teamRatings } from '../core/sim/engine';
import { availablePlayers, resolveLineup, rotationPlan } from '../core/sim/team';
import type { Depth } from '../core/sim/team';
import { POSITIONS } from '../core/types';
import { sfx } from '../audio/sfx';
import { touch, useSave } from '../state/store';
import { Btn, Modal, Panel, PlayerRow, Screen, Stars, Tabs, short, teamStarCount, toast } from './kit';

const DEPTHS: Depth[] = ['tight', 'normal', 'deep'];
const DEPTH_TEXT: Record<Depth, string> = {
  tight: 'Your starters play nearly the whole game and only two reserves come in. Strongest five on the floor, more injuries, and the bench earns little XP.',
  normal: 'Every starter gets a rest. Better reserves play more.',
  deep: 'The bench plays long stretches. Starters stay fresh and healthy, and your reserves earn more XP.',
};

export function LineupScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const me = save.teams[save.userTeamId];
  const [sel, setSel] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const all = me.roster.map(id => save.players[id]);
  const bench = me.roster.filter(id => !me.lineup.includes(id)).map(id => save.players[id]).sort((a, b) => ovr(b) - ovr(a));
  const r = teamRatings(all, me.lineup);
  // the same plan the game itself will follow
  const pool = availablePlayers(all);
  const plan = rotationPlan(pool, resolveLineup(me.lineup, pool), { backups: me.backups, depth: me.depth });
  const depth: Depth = me.depth ?? 'normal';
  const minutesOf = (id: number): { min: number; slot: string } | null => { const s = plan.find(x => x.backupId === id); return s ? { min: s.backupMin, slot: s.slot } : null; };
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
  const nameBackup = (slot: number, id: number | null) => {
    touch(s => {
      const t = s.teams[s.userTeamId];
      const b = (t.backups ?? [null, null, null, null, null]).slice();
      while (b.length < 5) b.push(null);
      // one man, one slot: naming him here takes him off any other
      if (id !== null) b.forEach((x, i) => { if (x === id) b[i] = null; });
      b[slot] = id;
      t.backups = b;
    });
    sfx.select(); setPickFor(null);
  };
  return (
    <Screen title="Lineup" right={<Btn kind="small" onClick={() => { touch(s => { const t = s.teams[s.userTeamId]; t.lineup = autoLineup(t.roster.map(id => s.players[id])); t.backups = undefined; }); setSel(null); toast('Best healthy five set.', true); }}>Auto</Btn>}>
      <div class="panel row between">
        <div><div class="head dim">OFFENSE</div><Stars n={teamStarCount(r.off)} /></div>
        <div><div class="head dim">DEFENSE</div><Stars n={teamStarCount(r.def)} /></div>
        <div><div class="head dim">OVERALL</div><Stars n={teamStarCount(r.ovr)} /></div>
      </div>
      <div class="dim" style={{ fontSize: '17px' }}>{TAP} two players to swap them. Players out of position play a little worse.</div>
      <Panel title="STARTERS AND THEIR BACKUPS" team>
        <div class="list">
          {POSITIONS.map((slot, i) => {
            const p = save.players[me.lineup[i]];
            if (!p) return <div class="item"><span class="tag">{slot}</span><span class="bad grow">Empty: tap Auto</span></div>;
            const fit = p.pos === slot;
            const row = plan[i], sub = row?.backupId != null ? save.players[row.backupId] : null;
            return (
              <>
                <PlayerRow save={save} player={p} sel={sel === p.id} onClick={() => tap(p.id)}
                  note={<span>{row ? `${row.starterMin} min` : ''}{fit ? '' : <span class="gold"> · playing {slot}</span>}</span>}
                  right={<div class="col" style={{ alignItems: 'flex-end', gap: '2px' }}><span class="head dim">{slot}</span><Stars v={overallOf(p.ratings, slot) - (fit ? 0 : 4)} /></div>} />
                <div class="item tap lu-sub" onClick={() => setPickFor(i)}>
                  <span class="dim grow">↳ {sub ? <>{short(sub.name)} comes in for <b class={row.backupMin >= 14 ? 'good' : ''}>{row.backupMin} min</b></> : 'Nobody comes in for him'}</span>
                  <span class="tag">CHANGE</span>
                </div>
              </>
            );
          })}
        </div>
      </Panel>
      <Panel title="HOW MUCH THE BENCH PLAYS">
        <Tabs tabs={DEPTHS} labels={{ tight: 'Tight', normal: 'Normal', deep: 'Deep' }} value={depth} onChange={(v: Depth) => { touch(s => { s.teams[s.userTeamId].depth = v; }); sfx.select(); }} />
        <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>{DEPTH_TEXT[depth]}</div>
      </Panel>
      <Panel title="BENCH">
        <div class="list">
          {bench.map(p => {
            const m = minutesOf(p.id);
            return <PlayerRow save={save} player={p} sel={sel === p.id} onClick={() => tap(p.id)} note={p.injury ? undefined : m ? <span>{m.min} min behind your {m.slot}</span> : <span class="dim">Does not play</span>} />;
          })}
          {bench.length === 0 && <div class="dim">No one on the bench.</div>}
        </div>
      </Panel>
      {pickFor !== null && (
        <Modal onClose={() => setPickFor(null)}>
          <h3>WHO BACKS UP YOUR {POSITIONS[pickFor]}?</h3>
          <div class="dim" style={{ fontSize: '17px' }}>The closer he is to the starter, the more he plays.</div>
          <div class="list">
            {bench.filter(p => !p.injury).map(p => (
              <PlayerRow save={save} player={p} onClick={() => nameBackup(pickFor, p.id)}
                right={<Stars v={overallOf(p.ratings, POSITIONS[pickFor]) - (p.pos === POSITIONS[pickFor] ? 0 : 4)} />} />
            ))}
          </div>
          <div class="row">
            <Btn class="grow" onClick={() => nameBackup(pickFor, null)}>Let my staff pick</Btn>
            <Btn onClick={() => setPickFor(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </Screen>
  );
}
