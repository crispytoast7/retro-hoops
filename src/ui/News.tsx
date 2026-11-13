import { useState } from 'preact/hooks';
import { useSave } from '../state/store';
import { Btn, Panel, Screen } from './kit';

export function NewsScreen(_p: { params: Record<string, any> }) {
  const save = useSave();
  const [mine, setMine] = useState(false);
  const items = save.news.filter(n => !mine || n.mine).slice(0, 80);
  const groups: { key: string; head: string; items: typeof items }[] = [];
  for (const n of items) {
    const key = `${n.year}:${n.week}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, head: `Season ${n.year}, Week ${n.week}`, items: [] }; groups.push(g); }
    g.items.push(n);
  }
  return (
    <Screen title="News">
      <div class="row">
        <Btn class={`grow ${!mine ? 'primary' : ''}`} onClick={() => setMine(false)}>All</Btn>
        <Btn class={`grow ${mine ? 'primary' : ''}`} onClick={() => setMine(true)}>My team</Btn>
      </div>
      {groups.length === 0 && <Panel><div class="dim">Nothing to report yet.</div></Panel>}
      {groups.map(g => (
        <Panel title={g.head.toUpperCase()}>
          <div class="list">
            {g.items.map(n => (
              <div class="item" style={{ alignItems: 'flex-start' }}>
                <span class={`tag ${n.mine ? 'gold' : ''}`}>{n.kind.toUpperCase()}</span>
                <span class={`grow ${n.mine ? '' : 'dim'}`}>{n.text}</span>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </Screen>
  );
}
