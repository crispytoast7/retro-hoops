// Save storage: IndexedDB is the main store, localStorage is a fallback copy.
import { SAVE_VERSION } from '../core/constants';
import type { Save } from '../core/types';
import { FACILITY_KEYS } from '../core/types';
import { fileGet, fileSet } from './native';

const DB = 'retro-hoops', STORE = 'kv', KEY = 'save', LS_KEY = 'retro-hoops-save';

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(): Promise<string | null> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => res((r.result as string) ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(v: string | null): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (v === null) tx.objectStore(STORE).delete(KEY); else tx.objectStore(STORE).put(v, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Upgrade older saves step by step. Returns null if the data is not a usable save. */
export function migrate(raw: unknown): Save | null {
  const s = raw as Save;
  if (!s || typeof s !== 'object' || typeof s.version !== 'number' || !Array.isArray(s.teams) || !s.players) return null;
  if (s.version > SAVE_VERSION) return null;
  // v1 is the first version; future migrations go here: if (s.version === 1) { ...; s.version = 2; }
  // buildings added after launch start at level 1
  for (const t of s.teams) if (t?.facilities) for (const k of FACILITY_KEYS) if (!t.facilities[k]) t.facilities[k] = { level: 1, condition: 100 };
  s.draftClass ??= [];
  s.tradeOffer ??= null;
  return s;
}
function parse(text: string | null): Save | null {
  if (!text) return null;
  try { return migrate(JSON.parse(text)); } catch { return null; }
}

export async function loadStored(): Promise<Save | null> {
  let a: Save | null = null, b: Save | null = null;
  try { a = parse(await idbGet()); } catch { /* IndexedDB unavailable */ }
  try { b = parse(localStorage.getItem(LS_KEY)); } catch { /* storage blocked */ }
  // in the iPhone app, a third copy lives in the app's own files: the newest of the three wins
  const c = parse(await fileGet());
  return [a, b, c].filter((x): x is Save => !!x).sort((x, y) => y.savedAt - x.savedAt)[0] ?? null;
}
export async function store(save: Save | null): Promise<boolean> {
  const text = save ? JSON.stringify(save) : null;
  let ok = false;
  try { await idbSet(text); ok = true; } catch { /* fall through to localStorage */ }
  try { if (text === null) localStorage.removeItem(LS_KEY); else localStorage.setItem(LS_KEY, text); ok = true; } catch { /* quota or blocked */ }
  if (await fileSet(text)) ok = true;
  return ok;
}
export function askPersistent(): void {
  try { void navigator.storage?.persist?.(); } catch { /* optional */ }
}
