import { useEffect, useState } from 'preact/hooks';
import { TROPHIES, coachLevel, rankName } from '../core/org/progress';
import { AFTER_GAME, AfterGame, afterGameChoice } from '../core/org/xp';
import { advance, PostGame } from '../core/season/flow';
import type { BoxLine } from '../core/types';
import { sfx } from '../audio/sfx';
import { act, useSave } from '../state/store';
import { Btn, Panel, Sprite, Tabs, short } from './kit';
import { nav, reset } from './router';

function Box({ lines, names }: { lines: BoxLine[]; names: (id: number) => string }) {
  const played = lines.filter(l => l.min > 0).sort((a, b) => Number(b.starter) - Number(a.starter) || b.min - a.min);
  return (
    <div class="scrollx">
      <table class="tbl">
        <thead><tr><th>PLAYER</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3P</th><th>FT</th></tr></thead>
        <tbody>
          {played.map(l => (
            <tr><td>{names(l.playerId)}</td><td>{l.min}</td><td>{l.pts}</td><td>{l.orb + l.drb}</td><td>{l.ast}</td><td>{l.stl}</td><td>{l.blk}</td><td>{l.tov}</td>
              <td>{l.fgm}-{l.fga}</td><td>{l.tpm}-{l.tpa}</td><td>{l.ftm}-{l.fta}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PostGameScreen({ params }: { params: Record<string, any> }) {
  const save = useSave();
  const post = params.post as PostGame;
  const g = save.schedule.find(x => x.id === post.gameId);
  const [tab, setTab] = useState<'Mine' | 'Theirs'>('Mine');
  useEffect(() => { if (post.total > 0) setTimeout(() => sfx.coin(), 400); if (post.levelUp) setTimeout(() => sfx.fanfare(), 800); }, []);
  if (!g || !g.result) return <div class="screen"><div class="title"><Btn kind="primary" onClick={() => reset('hub')}>Back to the hub</Btn></div></div>;
  const r = g.result;
  const home = save.teams[r.homeId], away = save.teams[r.awayId];
  const iAmHome = r.homeId === save.userTeamId;
  const top = save.players[post.topPerformer];
  const topLine = [...r.box.home, ...r.box.away].find(l => l.playerId === post.topPerformer);
  const topTeam = r.box.home.some(l => l.playerId === post.topPerformer) ? home : away;
  const names = (id: number) => (save.players[id] ? short(save.players[id].name) : '—');
  const go = (choice: AfterGame) => {
    act((s, rng) => { afterGameChoice(s, choice, post.won); if (!params.simmed) advance(s, rng, 'afterUser'); });
    sfx.select();
    reset('hub');
  };
  const opts = AFTER_GAME[post.won ? 'won' : 'lost'];
  const periods = r.homeQ.map((_, i) => (i < 4 ? `Q${i + 1}` : `OT${i - 3}`));
  return (
    <div class="screen">
      <div class="topbar"><h1 class={post.won ? 'good' : 'bad'}>{post.won ? 'WIN' : 'LOSS'} · FINAL{r.ot ? ' (OT)' : ''}</h1></div>
      <div class="body">
        <Panel team>
          <table class="tbl">
            <thead><tr><th>TEAM</th>{periods.map(p => <th>{p}</th>)}<th>T</th></tr></thead>
            <tbody>
              <tr class={!iAmHome ? 'me' : ''}><td>{away.abbr}</td>{r.awayQ.map(v => <td>{v}</td>)}<td><b>{r.awayScore}</b></td></tr>
              <tr class={iAmHome ? 'me' : ''}><td>{home.abbr}</td>{r.homeQ.map(v => <td>{v}</td>)}<td><b>{r.homeScore}</b></td></tr>
            </tbody>
          </table>
        </Panel>
        {top && topLine && (
          <Panel title="TOP PERFORMER">
            <div class="row tap" onClick={() => nav('player', { id: top.id })}>
              <Sprite player={top} team={topTeam} />
              <div class="grow"><div>{top.name} <span class="dim">{topTeam.abbr}</span></div>
                <div class="gold">{topLine.pts} PTS · {topLine.orb + topLine.drb} REB · {topLine.ast} AST{topLine.stl + topLine.blk > 2 ? ` · ${topLine.stl + topLine.blk} STOCKS` : ''}</div></div>
            </div>
          </Panel>
        )}
        <Panel title="CREDITS EARNED">
          <div class="list">
            {post.credits.map(c => <div class="item" style={{ minHeight: 0 }}><span class="grow">{c.label}</span><span class="gold">+{Math.round(c.amount * 10) / 10}</span></div>)}
            <div class="item" style={{ minHeight: 0 }}><span class="grow head">PAID OUT</span><span class="head gold">◉ +{post.total}</span></div>
          </div>
        </Panel>
        <Panel title="COACH XP">
          <div class="list">
            <div class="item" style={{ minHeight: 0 }}><span class="grow">{post.levelUp ? <span class="gold head">LEVEL UP! NOW LEVEL {post.levelUp}</span> : `Level ${coachLevel(save)} · ${rankName(coachLevel(save))}`}</span><span class="gold">+{Math.round(post.xp)} XP</span></div>
            {post.levelUp && <div class="item" style={{ minHeight: 0 }}><span class="grow">A new perk point is waiting on the Coach screen.</span></div>}
            {(post.playerLevelUps ?? []).map(id => save.players[id] && <div class="item tap" style={{ minHeight: 0 }} onClick={() => nav('player', { id })}><span class="grow gold">Level up: {save.players[id].name}</span><span class="tag gold">SPEND</span></div>)}
            {post.trophies.map(id => { const t = TROPHIES.find(x => x.id === id)!; return <div class="item" style={{ minHeight: 0 }}><span class="grow gold">♛ Trophy: {t.name}</span><span class="gold">◉ +{t.credits}</span></div>; })}
          </div>
        </Panel>
        <Panel title="BOX SCORE">
          <Tabs tabs={['Mine', 'Theirs'] as const} labels={{ Mine: (iAmHome ? home : away).abbr, Theirs: (iAmHome ? away : home).abbr }} value={tab} onChange={setTab} />
          <div style={{ height: '6px' }} />
          <Box lines={(tab === 'Mine') === iAmHome ? r.box.home : r.box.away} names={names} />
        </Panel>
      </div>
      <div class="footer" style={{ flexDirection: 'column', gap: '6px' }}>
        <div class="head dim">AFTER THE GAME, YOU...</div>
        {(Object.keys(opts) as AfterGame[]).map(k => (
          <Btn class="block" kind={k === 'team' ? 'primary' : ''} onClick={() => go(k)} silent>
            <span class="grow" style={{ textAlign: 'left' }}>{opts[k].label}</span><span style={{ fontSize: '8px', opacity: 0.85 }}>{opts[k].effect}</span>
          </Btn>
        ))}
      </div>
    </div>
  );
}
