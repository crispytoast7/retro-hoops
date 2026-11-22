// Explainers and trophy pop-ups, shown over the hub and the offseason screens.
import { pcText } from '../state/device';
import { TROPHIES, markTip, nextTip, prog } from '../core/org/progress';
import type { Tip } from '../core/org/progress';
import { useEffect, useState } from 'preact/hooks';
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
  return <TipCard key={tip.id} tip={tip} />;
}

/** One explainer. A paged tip shows a single short line at a time. */
function TipCard({ tip }: { tip: Tip }) {
  const [page, setPage] = useState(0);
  const paged = !!tip.pages && tip.text.length > 1;
  const last = !paged || page >= tip.text.length - 1;
  const done = () => touch(s => markTip(s, tip.id));
  return (
    <Modal>
      <h2 class="gold">{tip.title}</h2>
      {paged ? <div class="tippage" key={page}>{pcText(tip.text[page])}</div> : tip.text.map(t => <div>{pcText(t)}</div>)}
      {paged && <div class="tipdots">{tip.text.map((_t, i) => <span class={i === page ? 'on' : ''} />)}</div>}
      <div class="row">
        {!last && <Btn class="grow" kind="primary" onClick={() => setPage(page + 1)}>Next</Btn>}
        {last && <Btn class="grow" kind={tip.go ? '' : 'primary'} onClick={done}>Got it</Btn>}
        {last && tip.go && <Btn class="grow" kind="primary" onClick={() => { done(); nav(tip.go!); }}>{tip.goLabel}</Btn>}
      </div>
    </Modal>
  );
}
