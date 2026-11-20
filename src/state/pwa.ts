// Service worker registration. Updates are offered on the title screen, never forced mid-game.
import { registerSW } from 'virtual:pwa-register';
import { isNative } from './native';

let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const subs = new Set<() => void>();

export function initPwa(): void {
  if (import.meta.env.DEV) return;
  // inside the native iPhone shell the files are already on the device: no service worker needed.
  // (Not `window.Capacitor`: the Capacitor library defines that in a plain browser too.)
  if (isNative()) return;
  try {
    apply = registerSW({
      onNeedRefresh() { waiting = true; subs.forEach(f => f()); },
      // the browser only looks for a new version on a fresh load; a home-screen app that is resumed never does.
      // Look again whenever the game comes back to the front, and every half hour while it stays open.
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => { if (!waiting && navigator.onLine !== false) void reg.update().catch(() => { /* offline */ }); };
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 30 * 60 * 1000);
      },
    });
  } catch { /* offline support is optional */ }
}
export const updateWaiting = (): boolean => waiting;
export const onUpdate = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function applyUpdate(): void { void apply?.(true); }
