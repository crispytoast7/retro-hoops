// Explainers and trophy pop-ups, shown over the hub and the offseason screens.
import { TROPHIES, markTip, nextTip, prog } from '../core/org/progress';
import { useEffect } from 'preact/hooks';
import { sfx } from '../audio/sfx';
import { touch, useSave } from '../state/store';
import { Btn, Modal } from './kit';
import { nav } from './router';

/** Set while another pop-up (an event result) is on screen, so explainers wait their turn. */
let held = false;
export const holdTips = (v: boolean): void => { held = v; };

export function ProgressHost({ route }: { route: string }) {
  const save = useSave();
  const show = !held && ((route === 'hub' && !save.pendingEvent && !save.fired && !(save as { moments?: { pending: unknown } }).moments?.pending) || route === 'offseason');
  const fresh = show ? prog(save).fresh : [];
  const tip = show && !fresh.length ? nextTip(save) : null;
  useEffect(() => { if (fresh.length) sfx.fanfare(); else if (tip) sfx.select(); }, [fresh.length, tip?.id]);
  if (fresh.length) {
    return (
      <Modal>
        <h3>TROPHY{fresh.length > 1 ? 'S' : ''} UNLOCKED</h3>
        <div class="list">
          {fresh.map(id => { const t = TROPHIES.find(x => x.id === id)!; return (
            <div class="item"><span class="gold" style={{ fontSize: '26px' }}>♛</span><div class="grow"><div class="gold">{t.name}</div><div class="dim" style={{ fontSize: '17px' }}>{t.desc}</div></div><span class="tag gold">◉ +{t.credits}</span></div>
          ); })}
        </div>
        <Btn kind="primary" onClick={() => touch(s => { prog(s).fresh = []; })}>Nice</Btn>
      </Modal>
    );
  }
  if (!tip) return null;
  return (
    <Modal>
      <h2 class="gold">{tip.title}</h2>
      {tip.text.map(t => <div>{t}</div>)}
      <div class="row">
        <Btn class="grow" kind={tip.go ? '' : 'primary'} onClick={() => touch(s => markTip(s, tip.id))}>Got it</Btn>
        {tip.go && <Btn class="grow" kind="primary" onClick={() => { touch(s => markTip(s, tip.id)); nav(tip.go!); }}>{tip.goLabel}</Btn>}
      </div>
    </Modal>
  );
}
