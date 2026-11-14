import { useState } from 'preact/hooks';
import { COURTS, MAX_LEVEL, PERKS, TROPHIES, buyPerk, coachLevel, courtStyle, perk, perkPoints, prog, rankName, xpBar } from '../core/org/progress';
import { sfx } from '../audio/sfx';
import { touch, useSave } from '../state/store';
import { Btn, Meter, Panel, Screen, Tabs, toast } from './kit';

export function CoachScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const [tab, setTab] = useState<'Perks' | 'Trophies' | 'Courts'>('Perks');
  const p = prog(save);
  const bar = xpBar(save);
  const level = coachLevel(save);
  const points = perkPoints(save);
  const buy = (id: string) => { let err: string | null = null; touch(s => { err = buyPerk(s, id); }); if (err) toast(err); else sfx.coin(); };
  const current = courtStyle(save);
  return (
    <Screen title="Coach">
      <Panel team>
        <div class="row between"><div><div class="head gold">LEVEL {level}</div><div>{save.coach.name} · {rankName(level)}</div></div>
          <div class="right"><div class="head dim">PERK POINTS</div><div class={points > 0 ? 'gold head' : 'head'}>{points}</div></div></div>
        <div style={{ height: '8px' }} />
        <Meter label={level >= MAX_LEVEL ? 'MAX LEVEL' : `XP TO LEVEL ${level + 1}`} value={bar.pct} color="var(--gold)" text={level >= MAX_LEVEL ? '' : `${bar.into}/${bar.need}`} />
        <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>XP comes from games (more for wins), from plays you make yourself, from owner goals, playoff runs and trophies.</div>
      </Panel>
      <Tabs tabs={['Perks', 'Trophies', 'Courts'] as const} value={tab} onChange={setTab} labels={{ Trophies: `Trophies ${p.trophies.length}/${TROPHIES.length}` }} />
      {tab === 'Perks' && (['Court', 'Club'] as const).map(group => (
        <Panel title={group === 'Court' ? 'ON THE COURT' : 'RUNNING THE CLUB'}>
          <div class="list">
            {PERKS.filter(k => k.group === group).map(k => {
              const r = perk(save, k.id), locked = level < k.level, full = r >= k.max;
              return (
                <div class="item" style={{ opacity: locked ? 0.55 : 1 }}>
                  <div class="grow">
                    <div class="row"><span>{k.name}</span><span class="row" style={{ gap: '2px' }}>{Array.from({ length: k.max }, (_, i) => <span class="swatch" style={{ width: '10px', height: '10px', background: i < r ? 'var(--gold)' : 'var(--edge)' }} />)}</span></div>
                    <div class="dim" style={{ fontSize: '16px' }}>{k.desc}</div>
                  </div>
                  {locked ? <span class="tag">LV {k.level}</span> : full ? <span class="tag good">MAX</span> : <Btn kind={points > 0 ? 'small primary' : 'small'} disabled={points <= 0} onClick={() => buy(k.id)} silent>Learn</Btn>}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
      {tab === 'Trophies' && (
        <Panel>
          <div class="list">
            {TROPHIES.slice().sort((a, b) => Number(p.trophies.includes(b.id)) - Number(p.trophies.includes(a.id))).map(t => {
              const got = p.trophies.includes(t.id);
              return (
                <div class="item" style={{ opacity: got ? 1 : 0.6 }}>
                  <span style={{ fontSize: '24px', width: '24px', textAlign: 'center' }} class={got ? 'gold' : 'dim'}>{got ? '♛' : '·'}</span>
                  <div class="grow"><div class={got ? 'gold' : ''}>{t.name}</div><div class="dim" style={{ fontSize: '16px' }}>{t.desc}</div></div>
                  <span class={`tag ${got ? 'good' : ''}`}>{got ? 'EARNED' : `◉ ${t.credits}`}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      {tab === 'Courts' && (
        <Panel title="HOME COURT FLOOR">
          <div class="list">
            {COURTS.map(c => {
              const ok = c.ok(save), on = current.id === c.id;
              return (
                <div class={`item ${ok ? 'tap' : ''} ${on ? 'sel' : ''}`} style={{ opacity: ok ? 1 : 0.6 }} onClick={() => { if (!ok) return toast(c.how); touch(s => { prog(s).court = c.id; }); sfx.select(); }}>
                  <span style={{ width: '44px', height: '26px', border: '3px solid var(--edge)', background: `repeating-linear-gradient(90deg, ${c.wood} 0 8px, ${c.wood2} 8px 16px)`, flex: 'none' }} />
                  <div class="grow"><div>{c.name}</div><div class="dim" style={{ fontSize: '16px' }}>{c.how}</div></div>
                  {on ? <span class="tag good">IN USE</span> : ok ? <span class="tag">USE</span> : <span class="tag">LOCKED</span>}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </Screen>
  );
}
