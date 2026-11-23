// The phone apps' extras (iPhone and Android): a save file the operating system keeps, the share sheet,
// vibration, and Android's back button. On the website every function here quietly does nothing.
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

const FILE = 'retro-hoops-save.json';

/** The save as kept in the app's own files (survives the phone clearing web storage). */
export async function fileGet(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : null;
  } catch { return null; }
}
export async function fileSet(text: string | null): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    if (text === null) await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => undefined);
    else await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: text, encoding: Encoding.UTF8 });
    return true;
  } catch { return false; }
}

/** Hand a file to the phone's share sheet (Save to Files, Drive, Messages...). */
export async function shareFile(name: string, text: string): Promise<boolean> {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const w = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: text, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Retro Hoops save', files: [w.uri], dialogTitle: 'Save your franchise' });
    return true;
  } catch { return false; }
}

let buzzOn = true;
export const setHaptics = (on: boolean): void => { buzzOn = on; };
/** A short vibration for a big moment on the court. */
export function buzz(kind: 'light' | 'medium' | 'heavy' | 'success'): void {
  if (!buzzOn || !isNative()) return;
  void import('@capacitor/haptics').then(({ Haptics, ImpactStyle, NotificationType }) => {
    if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
    return Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  }).catch(() => undefined);
}

/**
 * Android's back button (or back swipe). `goBack` leaves the current screen and says whether there was
 * one to leave; from a screen with nowhere to go back to, the app steps aside to the home screen.
 */
export function onAndroidBack(goBack: () => boolean | 'stay'): void {
  let android = false;
  try { android = Capacitor.getPlatform() === 'android'; } catch { /* a browser */ }
  if (!android) return;
  void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
    if (goBack() === false) void App.minimizeApp();
  })).catch(() => undefined);
}
