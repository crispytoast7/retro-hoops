import { useState } from 'preact/hooks';
import { teamRatings } from '../core/sim/engine';
import type { Difficulty, Save } from '../core/types';
import { pickTeam, startLeague } from '../state/store';
import { Btn, Panel, Screen, Sprite, Stars, fullName, teamStarCount } from './kit';
import { reset } from './router';

const DIFFS: { k: Difficulty; label: string; desc: string }[] = [
  { k: 'easy', label: 'Rookie', desc: 'Bigger shot meter, slower defenders.' },
  { k: 'normal', label: 'Pro', desc: 'The intended balance.' },
  { k: 'hard', label: 'Legend', desc: 'Small meter, quick hands on defense.' },
];

export function NewGameScreen(_p: { params: Record<string, any> }) {
  const [name, setName] = useState('');
  const [look, setLook] = useState({ skin: 1, hair: 1, hairColor: 0 });
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [league, setLeague] = useState<Save | null>(null);
  const [seed, setSeed] = useState(() => (Date.now() ^ (Math.random() * 1e9)) >>> 0);

  const make = (s = seed) => setLeague(startLeague({ seed: s, coachName: name.trim() || 'Coach', coachLook: look, settings: { sound: true, difficulty: diff, haptics: true } }));

  if (!league) {
    const fake: any = { id: -1, look: { ...look, height: 1 } };
    return (
      <Screen title="New Coach">
        <Panel title="YOUR NAME">
          <input style={{ width: '100%' }} maxLength={18} placeholder="Coach name" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} />
        </Panel>
        <Panel title="LOOK">
          <div class="row">
            <Sprite player={fake} key={JSON.stringify(look)} scale={4} />
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
        <Btn kind="primary big" onClick={() => make()}>Generate League</Btn>
      </Screen>
    );
  }

  const rows = league.teams.map(t => ({ t, r: teamRatings(t.roster.map(id => league.players[id]), t.lineup) })).sort((a, b) => b.r.ovr - a.r.ovr);
  return (
    <Screen title="Choose a Franchise" onBack={() => setLeague(null)} right={<Btn kind="small" onClick={() => { const s = (seed * 1664525 + 1013904223) >>> 0; setSeed(s); make(s); }}>Reroll</Btn>}>
      <div class="dim">16 teams, 2 conferences. Weaker teams are a harder job, with a more patient owner.</div>
      <div class="panel list" style={{ padding: '2px 6px' }}>
        {rows.map(({ t, r }, i) => (
          <div class="item tap" onClick={() => { pickTeam(t.id); reset('hub'); }}>
            <span class="swatch" style={{ background: t.colors.primary, boxShadow: `4px 0 0 ${t.colors.secondary}`, marginRight: '4px' }} />
            <div class="grow">
              <div class="nowrap">{fullName(t)}</div>
              <div class="row dim" style={{ fontSize: '17px' }}><Stars n={teamStarCount(r.ovr)} /><span>{i < 4 ? 'Contender' : i < 10 ? 'Mid-table' : 'Rebuild'}</span><span>{t.conf ? 'West' : 'East'}</span></div>
            </div>
            <span class="tag">{t.abbr}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
