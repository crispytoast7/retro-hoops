import { useRef, useState } from 'preact/hooks';
import type { Difficulty } from '../core/types';
import { setMusic } from '../audio/music';
import { setSound, sfx } from '../audio/sfx';
import { PRIVACY, PRIVACY_UPDATED } from '../data/privacy';
import { exportSave, getSave, hasSave, importSave, resetSave, touch, useSave } from '../state/store';
import { DESKTOP } from '../state/device';
import { isNative, setHaptics, shareFile } from '../state/native';
import { Btn, Modal, Panel, Screen, Tabs, confirmDialog, toast } from './kit';
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
        <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>Sets how steady your aim is and how sharp defenders are. On top of this the game adapts: score in most of your key moments and it gets tougher; struggle and it eases off.</div>
      </Panel>
      {isNative() && (
        <Panel title="VIBRATION">
          <Tabs tabs={['On', 'Off'] as const} value={save.settings.haptics !== false ? 'On' : 'Off'} onChange={v => { touch(s => { s.settings.haptics = v === 'On'; }); setHaptics(v === 'On'); }} />
        </Panel>
      )}
      <Panel title="ASSISTANT GM">
        <Tabs tabs={['On', 'Off'] as const} value={save.settings.assistant ? 'On' : 'Off'} onChange={v => touch(s => { s.settings.assistant = v === 'On'; })} />
        <div class="dim" style={{ fontSize: '17px', marginTop: '6px' }}>Every week your assistant maintains run-down facilities, spends level-up points, replaces injured starters and uses scouting reports. Trades, signings, the draft and every big decision stay yours.</div>
      </Panel>
    </>
  );
}

const HOW_TOUCH: [string, string][] = [
  ['Move', 'drag on the court. Keep dragging at the rim to lay it in or dunk.'],
  ['Shoot', 'hold SHOOT. Let go when the crosshair is on the rim. Green is a swish.'],
  ['No shot', 'slide your finger off SHOOT, then let go.'],
  ['Pump fake', 'tap SHOOT. A defender who jumps leaves you open.'],
  ['Pass', 'tap a teammate. Tap one cutting to the rim and it is a lob.'],
  ['Crossover', 'a quick flick on the court. Flick away from the basket for a step-back.'],
  ['Putback', 'rebound near the rim and the button says PUT BACK. Press it.'],
  ['Free throws', 'hold SHOOT, let go on the rim. A tap does nothing.'],
];
const HOW_PC: [string, string][] = [
  ['Move', 'WASD or the arrow keys. Keep going at the rim to lay it in or dunk.'],
  ['Shoot', 'hold Space. Let go when the crosshair is on the rim. Green is a swish.'],
  ['No shot', 'press Escape while holding Space.'],
  ['Pump fake', 'tap Space. A defender who jumps leaves you open.'],
  ['Pass', 'press 1 to 4, or click a teammate. To one cutting to the rim, it is a lob.'],
  ['Crossover', 'Shift while moving. Away from the basket it is a step-back.'],
  ['Putback', 'rebound near the rim and the button says PUT BACK. Press Space.'],
  ['Free throws', 'hold Space, let go on the rim. A tap does nothing.'],
];

export function SettingsScreen(_p: { params: Record<string, any> }) {
  const file = useRef<HTMLInputElement>(null);
  const has = hasSave();
  const [policy, setPolicy] = useState(false);
  const doExport = async () => {
    const s = getSave();
    if (isNative()) {
      // the phone apps have no downloads folder: hand the file to the share sheet instead
      const ok = await shareFile(`retro-hoops-${s.coach.name.replace(/\W+/g, '-').toLowerCase()}-season-${s.year}.json`, exportSave());
      if (!ok) toast('Could not open the share sheet.');
      return;
    }
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
  const standalone = isNative() || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone;
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
      <Btn class="block" onClick={() => setPolicy(true)}>Privacy policy</Btn>
      {policy && (
        <Modal onClose={() => setPolicy(false)}>
          <h2>PRIVACY POLICY</h2>
          <div class="dim" style={{ fontSize: '17px' }}>Last updated {PRIVACY_UPDATED}</div>
          {PRIVACY.map(([h, t]) => <div><div class="head gold" style={{ margin: '6px 0 3px' }}>{h.toUpperCase()}</div><div>{t}</div></div>)}
          <Btn kind="primary" onClick={() => setPolicy(false)}>Close</Btn>
        </Modal>
      )}
      <Panel title="HOW TO PLAY">
        {has && getSave().schedule.length > 0 && <><Btn class="block" kind="primary" onClick={() => nav('practice')}>Practice the controls</Btn><div style={{ height: '8px' }} /></>}
        <div class="list" style={{ fontSize: '19px' }}>
          {(DESKTOP ? HOW_PC : HOW_TOUCH).map(([h, t]) => <div class="item"><span><b class="gold">{h}:</b> {t}</span></div>)}
          <div class="item dim">{DESKTOP ? 'Mouse: drag on the court to move, hold the SHOOT button, click a teammate. Menus: Enter and Escape.' : 'On a computer the game uses the keyboard and mouse instead.'}</div>
        </div>
      </Panel>
    </Screen>
  );
}
