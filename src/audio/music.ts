// Chiptune soundtrack, sequenced in code: a laid-back menu theme and a leaner in-game groove.
import { audioGraph, noiseBuffer } from './sfx';

type Track = 'menu' | 'game';
let wanted: Track | null = null;
let playing: Track | null = null;
let on = true;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;
const LEVEL: Record<Track, number> = { menu: 0.5, game: 0.3 };
const BPM: Record<Track, number> = { menu: 104, game: 118 };
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

// ---- voices --------------------------------------------------------------------------
function voice(type: OscillatorType, midi: number, t: number, dur: number, vol: number, cutoff = 0): void {
  const g = audioGraph();
  if (!g) return;
  const o = g.ctx.createOscillator();
  const a = g.ctx.createGain();
  o.type = type;
  o.frequency.value = hz(midi);
  a.gain.setValueAtTime(0.0001, t);
  a.gain.linearRampToValueAtTime(vol, t + 0.008);
  a.gain.setValueAtTime(vol, t + Math.max(0.01, dur * 0.6));
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (cutoff) {
    const f = g.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.7;
    o.connect(f).connect(a);
  } else o.connect(a);
  a.connect(g.musicBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function kick(t: number, vol = 0.5): void {
  const g = audioGraph();
  if (!g) return;
  const o = g.ctx.createOscillator(), a = g.ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  a.gain.setValueAtTime(vol, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(a).connect(g.musicBus);
  o.start(t); o.stop(t + 0.18);
}
function noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number): void {
  const g = audioGraph();
  if (!g) return;
  const s = g.ctx.createBufferSource();
  s.buffer = noiseBuffer();
  const f = g.ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
  const a = g.ctx.createGain();
  a.gain.setValueAtTime(vol, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(a).connect(g.musicBus);
  s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
const snare = (t: number, vol = 0.2) => { noiseHit(t, 0.13, vol, 'bandpass', 1900); voice('triangle', 55, t, 0.07, vol * 0.6); };
const hat = (t: number, open = false, vol = 0.05) => noiseHit(t, open ? 0.09 : 0.03, vol, 'highpass', 6500);

// ---- songs ---------------------------------------------------------------------------
const _ = -1;
// Menu theme, A minor, 8 bars. Chord tones for the arpeggio, root for the bass.
const MENU_CHORDS = [
  [57, 60, 64, 67], [57, 60, 64, 67], [62, 65, 69, 72], [62, 65, 69, 72],
  [53, 57, 60, 64], [55, 59, 62, 67], [57, 60, 64, 67], [52, 56, 59, 62],
];
const MENU_ROOT = [45, 45, 50, 50, 53, 55, 45, 52];
const MENU_BASS = [0, _, _, 0, _, _, 12, _, 0, _, _, 7, _, 12, _, _];
const MENU_ARP = [0, 1, 2, 3, 2, 1, 2, 3];
// lead: [bar, step, midi note, length in steps]
const MENU_LEAD: [number, number, number, number][] = [
  [0, 0, 76, 3], [0, 4, 79, 2], [0, 6, 81, 3], [0, 10, 79, 2], [0, 12, 76, 4],
  [1, 0, 74, 2], [1, 2, 76, 2], [1, 4, 72, 5], [1, 10, 69, 2], [1, 12, 72, 4],
  [2, 0, 74, 3], [2, 4, 77, 2], [2, 6, 81, 2], [2, 8, 79, 2], [2, 10, 77, 2], [2, 12, 74, 4],
  [3, 0, 77, 2], [3, 2, 76, 2], [3, 4, 74, 6], [3, 12, 69, 2], [3, 14, 72, 2],
  [4, 0, 81, 3], [4, 4, 84, 2], [4, 6, 81, 2], [4, 8, 79, 4], [4, 12, 77, 4],
  [5, 0, 79, 2], [5, 2, 83, 2], [5, 4, 86, 4], [5, 8, 83, 2], [5, 10, 79, 2], [5, 12, 74, 4],
  [6, 0, 76, 2], [6, 2, 81, 2], [6, 4, 84, 2], [6, 6, 81, 2], [6, 8, 76, 4], [6, 12, 72, 4],
  [7, 0, 76, 4], [7, 4, 80, 4], [7, 8, 83, 4], [7, 12, 76, 4],
];
// In-game groove, D minor, 4 bars: bass, drums and a few stabs so it sits under the action.
const GAME_CHORDS = [[62, 65, 69], [62, 65, 69], [58, 62, 65], [60, 64, 67]];
const GAME_ROOT = [50, 50, 46, 48];
const GAME_BASS = [0, _, 12, _, 0, _, 12, 0, _, 0, 12, _, 7, _, 12, _];
const GAME_RIFF: [number, number, number][] = [[3, 8, 74], [3, 10, 77], [3, 12, 79], [3, 14, 81]];

function scheduleStep(track: Track, n: number, t: number, s16: number): void {
  const pos = n % 16;
  if (track === 'menu') {
    const loop = Math.floor(n / 16) % 16; // 16 bars: groove alone, then with the tune
    const bar = loop % 8;
    const b = MENU_BASS[pos];
    if (b !== _) voice('triangle', MENU_ROOT[bar] + b, t, s16 * 1.7, 0.3);
    if (pos % 2 === 0) voice('square', MENU_CHORDS[bar][MENU_ARP[pos / 2]] + 12, t, s16 * 0.9, 0.028, 2600);
    if (pos === 0 || pos === 10) kick(t, 0.42);
    if (pos === 7) kick(t, 0.22);
    if (pos === 4 || pos === 12) snare(t, 0.16);
    if (pos % 2 === 0) hat(t, pos === 14, 0.04); else if (pos % 4 === 3) hat(t, false, 0.02);
    if (loop >= 8) for (const [lb, ls, note, len] of MENU_LEAD) if (lb === bar && ls === pos) voice('square', note, t, s16 * len * 0.92, 0.055, 2100);
  } else {
    const bar = Math.floor(n / 16) % 4;
    const cycle = Math.floor(n / 64) % 2;
    const b = GAME_BASS[pos];
    if (b !== _) voice('triangle', GAME_ROOT[bar] + b, t, s16 * 1.4, 0.3);
    if (pos === 0 || pos === 6 || pos === 10) kick(t, pos === 6 ? 0.25 : 0.45);
    if (pos === 4 || pos === 12) snare(t, 0.17);
    if (pos % 2 === 0) hat(t, false, 0.04);
    if (pos === 0 || pos === 11) for (const c of GAME_CHORDS[bar]) voice('square', c, t, s16 * 1.2, 0.02, 1800);
    if (cycle === 1) for (const [rb, rs, note] of GAME_RIFF) if (rb === bar && rs === pos) voice('square', note, t, s16 * 1.8, 0.04, 2200);
  }
}

function tick(): void {
  const g = audioGraph();
  if (!g || !playing) return;
  const s16 = 60 / BPM[playing] / 4;
  // if the tab was asleep, do not try to catch up on missed steps
  if (nextTime < g.ctx.currentTime - 0.2) nextTime = g.ctx.currentTime + 0.05;
  while (nextTime < g.ctx.currentTime + 0.14) {
    scheduleStep(playing, step, nextTime, s16);
    step++;
    nextTime += s16;
  }
}

function apply(): void {
  const g = audioGraph();
  if (!g) return;
  const target = on ? wanted : null;
  if (target === playing) return;
  const now = g.ctx.currentTime;
  g.musicBus.gain.cancelScheduledValues(now);
  g.musicBus.gain.setTargetAtTime(0, now, 0.08);
  playing = target;
  if (timer) { clearInterval(timer); timer = null; }
  if (!target) return;
  step = 0;
  nextTime = now + 0.35;
  g.musicBus.gain.setTargetAtTime(LEVEL[target], now + 0.3, 0.2);
  timer = setInterval(tick, 30);
}

/** Choose which tune should be playing (or none). Safe to call before audio is unlocked. */
export function setTrack(t: Track | null): void { wanted = t; apply(); }
export function setMusic(enabled: boolean): void { on = enabled; apply(); }
/** Call after a user gesture has unlocked audio, so a pending track can start. */
export function kickMusic(): void { apply(); }

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const g = audioGraph();
    if (!g) return;
    if (document.visibilityState === 'hidden') void g.ctx.suspend(); else void g.ctx.resume();
  });
}
