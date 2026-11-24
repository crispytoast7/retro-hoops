// A ranking comes out: counted down from the bottom, one name at a time, the way it would be on television.
import { useEffect, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { markTip } from '../core/org/progress';
import type { NewsItem } from '../core/types';
import { DESKTOP, TAP } from '../state/device';
import { touch, useSave } from '../state/store';
import { Btn, Screen } from './kit';
import { back, nav } from './router';

type List = NonNullable<NewsItem['list']>;

export function RankingsScreen({ params }: { params: Record<string, any> }) {
  const save = useSave();
  const list = params.list as List | undefined;
  // seen it before (opened from the news page): no need to sit through the countdown again
  const [shown, setShown] = useState(params.reveal && list ? 0 : list?.rows.length ?? 0);
  useEffect(() => { if (params.seenKey) touch(s => markTip(s, params.seenKey)); }, []);
  const n = list?.rows.length ?? 0;
  const next = () => {
    if (shown >= n) return;
    const rank = n - shown; // the place about to be revealed
    if (rank === 1) sfx.fanfare(); else if (rank <= 3) sfx.good(); else sfx.select();
    setShown(shown + 1);
  };
  useEffect(() => {
    if (!DESKTOP) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!list) return <Screen title="Rankings"><div class="dim">Nothing to show.</div></Screen>;
  const done = shown >= n;
  const kind = list.kind ?? 'goat';
  const isMine = (r: List['rows'][number]) => r.mine ?? (r.playerId >= 0 && save.players[r.playerId]?.teamId === save.userTeamId);
  return (
    <Screen title={list.outlet} footer={done ? <Btn kind="primary" class="grow" onClick={back}>Done</Btn> : (
      <>
        <Btn onClick={() => { sfx.select(); setShown(n); }}>Show all</Btn>
        <Btn kind="primary" class="grow" onClick={next}>{shown === n - 1 ? 'And number one is...' : `${TAP}: number ${n - shown}`}</Btn>
      </>
    )}>
      <div class="panel rk-head">
        <div class="head gold">{list.title ?? `${list.by.toUpperCase()}'S ALL-TIME TOP 10`}</div>
        <div class="dim rk-motto">"{list.motto}" {list.title ? `· ${list.by}` : ''}</div>
      </div>
      <div class="list rk-list">
        {list.rows.map((r, i) => {
          const open = i >= n - shown, mine = isMine(r);
          const go = () => { if (r.playerId >= 0) nav('player', { id: r.playerId }); };
          return (
            <div class={`item rk-row ${open ? 'open' : ''} ${mine && open ? 'mine' : ''} ${i < 3 ? 'podium' : ''} ${open && r.playerId >= 0 ? 'tap' : ''}`} onClick={open ? go : undefined}>
              <span class="rk-rank">{i + 1}</span>
              {open ? (
                <div class="grow">
                  <div>{r.name} <span class="dim">{r.team}</span>{mine && <span class="tag gold" style={{ marginLeft: '4px' }}>{kind === 'power' ? 'YOU' : 'YOURS'}</span>}</div>
                  <div class="dim rk-note">{r.note}</div>
                </div>
              ) : <div class="grow rk-hidden">? ? ?</div>}
              {open && r.move !== undefined && r.move !== 0 && <span class={`rk-move ${r.move > 0 ? 'good' : 'bad'}`}>{r.move === 99 ? 'NEW' : r.move > 0 ? `▲${r.move}` : `▼${-r.move}`}</span>}
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
