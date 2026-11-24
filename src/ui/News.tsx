import { useState } from 'preact/hooks';
import { useSave } from '../state/store';
import { Btn, Panel, Screen } from './kit';
import { nav } from './router';

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
                <div class="grow">
                  <div class={n.mine || n.list ? '' : 'dim'}>{n.text}</div>
                  {n.list && <Btn kind="small" class="goat-open" onClick={() => nav('rankings', { list: n.list })}>See the list</Btn>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </Screen>
  );
}
