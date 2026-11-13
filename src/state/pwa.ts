// Service worker registration. Updates are offered on the title screen, never forced mid-game.
import { registerSW } from 'virtual:pwa-register';

let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const subs = new Set<() => void>();

export function initPwa(): void {
  if (import.meta.env.DEV) return;
  try {
    apply = registerSW({
      onNeedRefresh() { waiting = true; subs.forEach(f => f()); },
    });
  } catch { /* offline support is optional */ }
}
export const updateWaiting = (): boolean => waiting;
export const onUpdate = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function applyUpdate(): void { void apply?.(true); }
