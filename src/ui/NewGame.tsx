import { useState } from 'preact/hooks';
import { worstTeam } from '../core/offseason/offseason';
import { ovr } from '../core/ratings';
import { teamRatings } from '../core/sim/engine';
import { CALENDARS } from '../core/season/calendar';
import type { Difficulty, Save } from '../core/types';
import { markTip } from '../core/org/progress';
import { tutorialDone } from '../state/device';
import { pickTeam, startLeague, touch } from '../state/store';
import { Btn, Panel, Screen, Sprite, Stars, fullName, teamStarCount } from './kit';
import { reset } from './router';

const DIFFS: { k: Difficulty; label: string; desc: string }[] = [
  { k: 'easy', label: 'Rookie', desc: 'Steadier crosshair, slower defenders.' },
  { k: 'normal', label: 'Pro', desc: 'The intended balance.' },
  { k: 'hard', label: 'Legend', desc: 'Wild crosshair, quick hands on defense.' },
];

export function NewGameScreen(_p: { params: Record<string, any> }) {
  const [name, setName] = useState('');
  const [look, setLook] = useState({ skin: 1, hair: 1, hairColor: 0 });
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [league, setLeague] = useState<Save | null>(null);
  const [seed, setSeed] = useState(() => (Date.now() ^ (Math.random() * 1e9)) >>> 0);

  const make = (s = seed) => setLeague(startLeague({ seed: s, coachName: name.trim() || 'Coach', coachLook: look, settings: { sound: true, difficulty: diff, haptics: true }, calendar: CALENDARS.classic }));

  if (!league) {
    const fake: any = { id: -1, look: { ...look, height: 1 } };
    return (
      <Screen title="New Coach">
        <Panel title="YOUR NAME">
          <input style={{ width: '100%' }} maxLength={18} placeholder="Coach name" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} />
        </Panel>
        <Panel title="LOOK">
          <div class="row">
            <Sprite player={fake} key={JSON.stringify(look)} scale={3} />
            <div class="col grow">
              <Btn kind="small" onClick={() => setLook({ ...look, skin: (look.skin + 1) % 5 })}>Skin</Btn>
              <Btn kind="small" onClick={() => setLook({ ...look, hair: (look.hair + 1) % 6 })}>Hair</Btn>
              <Btn kind="small" onClick={() => setLook({ ...look, hairColor: (look.hairColor + 1) % 5 })}>Hair colour</Btn>
            </div>
          </div>
        </Panel>
        <Panel title="DIFFICULTY">
          <div class="col">
            {DIFFS.map(d => (
              <div class={`item tap ${diff === d.k ? 'sel' : ''}`} onClick={() => setDiff(d.k)}>
                <div class="grow"><div class="head">{d.label}</div><div class="dim">{d.desc}</div></div>
              </div>
            ))}
          </div>
        </Panel>
        <Btn kind="primary big" onClick={() => make()}>Start my career</Btn>
      </Screen>
    );
  }

  // every new coach is handed the weakest roster in the league
  const t = worstTeam(league);
  const r = teamRatings(t.roster.map(id => league.players[id]), t.lineup);
  const best = t.roster.map(id => league.players[id]).sort((a, b) => ovr(b) - ovr(a)).slice(0, 3);
  return (
    <Screen title="Your First Job" onBack={() => setLeague(null)} team={t}>
      <Panel team>
        <div class="head dim">THE ONLY CLUB THAT CALLED</div>
        <div class="row" style={{ marginTop: '6px' }}>
          <span class="swatch" style={{ background: t.colors.primary, boxShadow: `4px 0 0 ${t.colors.secondary}`, marginRight: '6px' }} />
          <div class="grow"><h2>{fullName(t).toUpperCase()}</h2><div class="row dim"><Stars n={teamStarCount(r.ovr)} /><span>{t.conf ? 'West' : 'East'}</span><span>Weakest of 16</span></div></div>
        </div>
      </Panel>
      <Panel title="WHAT YOU ARE WALKING INTO">
        <div class="list">
          <div class="item"><span class="grow">The worst roster in the league. Nobody expects anything this year.</span></div>
          <div class="item"><span class="grow">The owner is patient: you cannot be fired in your first season.</span></div>
          <div class="item"><span class="grow">Bad teams get the best odds at the first pick in the draft.</span></div>
          <div class="item"><span class="grow">Win here and bigger clubs will come calling.</span></div>
        </div>
      </Panel>
      <Panel title="YOUR BEST PLAYERS">
        <div class="list">
          {best.map(p => (
            <div class="item"><span class="tag pos">{p.pos}</span><Sprite player={p} team={t} /><div class="grow"><div class="nowrap">{p.name}</div><div class="row dim" style={{ fontSize: '17px' }}><Stars v={ovr(p)} /><span>Age {p.age}</span></div></div></div>
          ))}
        </div>
      </Panel>
      <Btn kind="primary big" onClick={() => { pickTeam(t.id); if (tutorialDone()) touch(sv => markTip(sv, 'practice_done')); reset(tutorialDone() ? 'hub' : 'practice'); }}>Take the job</Btn>
    </Screen>
  );
}
