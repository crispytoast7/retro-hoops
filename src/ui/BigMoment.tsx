// A big moment: the game stops and hands you a decision with real stakes.
import { useEffect, useState } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { MomentResult, pendingMoment, resolveMoment } from '../core/org/moments';
import { ovr } from '../core/ratings';
import type { Save } from '../core/types';
import { act, touch } from '../state/store';
import { Btn, Sprite, Stars } from './kit';
import { nav } from './router';
import { holdTips } from './Tips';

export function BigMomentHost({ save }: { save: Save }) {
  const m = pendingMoment(save);
  const [res, setRes] = useState<MomentResult | null>(null);
  useEffect(() => { if (m) { holdTips(true); sfx.whistle(); } }, [m?.title]);
  if (!m && !res) return null;
  const me = save.teams[save.userTeamId];
  const p = m?.playerId !== undefined ? save.players[m.playerId] : undefined;
  if (res) {
    return (
      <div class="moment-bg">
        <div class="moment" style={{ '--c1': me.colors.primary, '--c2': me.colors.secondary } as any}>
          <div class={`moment-result ${res.good ? 'good' : 'bad'}`}>{res.text}</div>
          <Btn kind="primary big" onClick={() => { holdTips(false); const go = res.goTo; setRes(null); touch(); if (go) nav(go.route, go.params); }}>{res.goTo ? 'Go there' : 'OK'}</Btn>
          {res.goTo && <Btn onClick={() => { holdTips(false); setRes(null); touch(); }}>Later</Btn>}
        </div>
      </div>
    );
  }
  return (
    <div class="moment-bg">
      <div class="moment" style={{ '--c1': me.colors.primary, '--c2': me.colors.secondary } as any}>
        <div class="moment-band"><span>★ BIG MOMENT ★</span><span>{m!.tag}</span></div>
        <h2 class="moment-title">{m!.title}</h2>
        {p && (
          <div class="row moment-who">
            <Sprite player={p} team={p.teamId !== null ? save.teams[p.teamId] : null} scale={3} />
            <div class="grow"><div>{p.name}</div><div class="row dim"><span class="tag pos">{p.pos}</span><Stars v={ovr(p)} /><span>Age {p.age}</span></div></div>
          </div>
        )}
        <div class="moment-text">{m!.text}</div>
        <div class="col" style={{ gap: '6px' }}>
          {m!.choices.map((c, i) => (
            <Btn class="opt" disabled={!!c.disabled} silent onClick={() => { const r = act(s => resolveMoment(s, i)); if (r) { if (r.good) sfx.fanfare(); else sfx.select(); setRes(r); } }}>
              <span>{c.label}</span><span class="fx">{c.disabled ?? c.effect}</span>
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}
