// The current save in memory, with change notification and auto-save.
import { useEffect, useState } from 'preact/hooks';
import { newLeague, NewGameOpts } from '../core/gen/league';
import { chooseTeam } from '../core/offseason/offseason';
import { Rng } from '../core/rng';
import type { Save } from '../core/types';
import { setMusic } from '../audio/music';
import { setSound } from '../audio/sfx';
import { askPersistent, loadStored, migrate, store } from './persist';

let save: Save | null = null;
let version = 0;
const subs = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export let lastSaveOk = true;

function notify(): void { version++; subs.forEach(f => f()); }
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flush(); }, 250);
}
export async function flush(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (save) { save.savedAt = Date.now(); lastSaveOk = await store(save); }
}

export const getSave = (): Save => save!;
export const hasSave = (): boolean => save !== null;

/** Re-render the calling component whenever the save changes. */
export function useSave(): Save {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return save!;
}

/** Run a change against the save with the seeded RNG, then notify and auto-save. */
export function act<T>(fn: (save: Save, rng: Rng) => T): T {
  const rng = new Rng(save!.rng);
  try {
    return fn(save!, rng);
  } finally {
    save!.rng = rng.state;
    notify();
    scheduleSave();
  }
}
/** A change that needs no randomness. */
export function touch(fn?: (save: Save) => void): void {
  fn?.(save!);
  notify();
  scheduleSave();
}

export async function boot(): Promise<boolean> {
  save = await loadStored();
  if (save) { setSound(save.settings.sound); setMusic(save.settings.music !== false); }
  return save !== null;
}
export function startLeague(opts: NewGameOpts): Save {
  save = newLeague(opts);
  notify();
  return save;
}
export function pickTeam(teamId: number): void {
  act((s, rng) => chooseTeam(s, teamId, rng));
  askPersistent();
  void flush();
}
export async function resetSave(): Promise<void> {
  save = null;
  await store(null);
  notify();
}
export const exportSave = (): string => JSON.stringify(save);
export function importSave(text: string): string | null {
  let parsed: Save | null = null;
  try { parsed = migrate(JSON.parse(text)); } catch { /* not JSON */ }
  if (!parsed) return 'That file is not a Retro Hoops save.';
  save = parsed;
  setSound(save.settings.sound); setMusic(save.settings.music !== false);
  notify();
  void flush();
  return null;
}

// Save before the tab goes away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
  window.addEventListener('pagehide', () => { void flush(); });
}
