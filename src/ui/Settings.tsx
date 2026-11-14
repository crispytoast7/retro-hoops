import { useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../core/types';
import { setMusic } from '../audio/music';
import { setSound, sfx } from '../audio/sfx';
import { exportSave, getSave, hasSave, importSave, resetSave, touch, useSave } from '../state/store';
import { Btn, Panel, Screen, Tabs, confirmDialog, toast } from './kit';
import { nav, reset } from './router';

function SaveSettings() {
  const save = useSave();
  if (!save) return null;
  return (
    <>
      <Panel title="MUSIC">
        <Tabs tabs={['On', 'Off'] as const} value={save.settings.music !== false ? 'On' : 'Off'} onChange={v => { touch(s => { s.settings.music = v === 'On'; }); setMusic(v === 'On'); }} />
      </Panel>
      <Panel title="SOUND EFFECTS">
        <Tabs tabs={['On', 'Off'] as const} value={save.settings.sound ? 'On' : 'Off'} onChange={v => { touch(s => { s.settings.sound = v === 'On'; }); setSound(v === 'On'); if (v === 'On') sfx.select(); }} />
      </Panel>
      <Panel title="DIFFICULTY">
        <Tabs tabs={['easy', 'normal', 'hard'] as const} labels={{ easy: 'Rookie', normal: 'Pro', hard: 'Legend' }} value={save.settings.difficulty} onChange={(v: Difficulty) => touch(s => { s.settings.difficulty = v; })} />
        <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>Changes the shot meter size and how sharp defenders are when you play.</div>
      </Panel>
    </>
  );
}

export function SettingsScreen(_p: { params: Record<string, any> }) {
  const file = useRef<HTMLInputElement>(null);
  const has = hasSave();
  const doExport = () => {
    const s = getSave();
    const blob = new Blob([exportSave()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retro-hoops-${s.coach.name.replace(/\W+/g, '-').toLowerCase()}-season-${s.year}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Save exported.', true);
  };
  const doImport = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (has && !(await confirmDialog('Importing replaces your current franchise.', 'Import'))) return;
    const err = importSave(await f.text());
    if (err) toast(err); else { toast('Save imported.', true); reset('title'); }
  };
  const doReset = async () => {
    if (!(await confirmDialog('Delete your franchise for good? This cannot be undone.', 'Delete'))) return;
    await resetSave();
    reset('title');
  };
  const [big, setBig] = useState(document.documentElement.dataset.text === 'large');
  const setText = (v: 'Normal' | 'Large') => {
    const large = v === 'Large';
    if (large) document.documentElement.dataset.text = 'large'; else delete document.documentElement.dataset.text;
    try { localStorage.setItem('retro-hoops-text', large ? 'large' : 'normal'); } catch { /* not saved */ }
    setBig(large);
  };
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone;
  return (
    <Screen title="Settings">
      <Panel title="TEXT SIZE">
        <Tabs tabs={['Normal', 'Large'] as const} value={big ? 'Large' : 'Normal'} onChange={setText} />
      </Panel>
      {has && <SaveSettings />}
      <Panel title="YOUR SAVE">
        <div class="dim" style={{ fontSize: '17px', marginBottom: '8px' }}>The game saves automatically on this device. Export a copy now and then: it is the only backup, and the way to move to another device.</div>
        <div class="col">
          {has && <Btn class="block" onClick={doExport}>Export save</Btn>}
          <Btn class="block" onClick={() => file.current?.click()}>Import save</Btn>
          <input ref={file} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={doImport} />
          {has && <Btn class="block" kind="danger" onClick={doReset}>Reset save</Btn>}
        </div>
      </Panel>
      {!standalone && (
        <Panel title="INSTALL">
          <div class="dim" style={{ fontSize: '17px' }}>
            {ios ? 'On iPhone: tap Share, then "Add to Home Screen". Installed, the game works offline and Safari will not clear your save after a week away.'
              : 'Use your browser menu: "Install app" or "Add to Home screen". Installed, the game works offline.'}
          </div>
        </Panel>
      )}
      <Panel title="HOW TO PLAY">
        {has && getSave().schedule.length > 0 && <><Btn class="block" kind="primary" onClick={() => nav('practice')}>Practice the controls</Btn><div style={{ height: '8px' }} /></>}
        <div class="list" style={{ fontSize: '19px' }}>
          <div class="item">Drag on the court: dribble and drive</div>
          <div class="item">Touch your player, pull back, let go: shoot at the rim, or throw a pass where you aim</div>
          <div class="item">Let go when the crosshair is over the rim. Green is a swish.</div>
          <div class="item">Tap a teammate: quick pass</div>
          <div class="item">Quick flick: crossover, or a step-back away from the basket</div>
          <div class="item">Drive at the rim with a lane: layup or dunk</div>
          <div class="item dim">Keyboard: arrows/WASD move, hold Space to aim a shot and release, Shift for a move, 1-4 pass</div>
        </div>
      </Panel>
    </Screen>
  );
}
