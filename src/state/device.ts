// Things remembered on this device, outside any one save.
const KEY = 'retro-hoops-tutorial';

/** Someone has already finished the tutorial here, so a second career does not have to sit through it again. */
export function tutorialDone(): boolean { try { return localStorage.getItem(KEY) === 'done'; } catch { return false; } }
export function setTutorialDone(): void { try { localStorage.setItem(KEY, 'done'); } catch { /* not remembered */ } }

/** A computer with a mouse (and so, almost always, a keyboard). Touch-first devices are false. */
export const DESKTOP = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;
/** "Tap" on a phone, "Click" on a computer. */
export const TAP = DESKTOP ? 'Click' : 'Tap';
export const tap = DESKTOP ? 'click' : 'tap';
/** Reword a sentence written for touch so it reads right on a computer. */
export const pcText = (s: string): string => (DESKTOP ? s.replace(/\bone-tap\b/g, 'one-click').replace(/\bOne tap\b/g, 'One click').replace(/\bTap\b/g, 'Click').replace(/\btap\b/g, 'click') : s);
