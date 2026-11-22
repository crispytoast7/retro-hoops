// All sound is synthesised with WebAudio: no audio files to load or cache.
let ctx: AudioContext | null = null;
/** Sound-effects bus. Music has its own bus (see music.ts) so the two can be switched separately. */
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let enabled = true;
const SFX_LEVEL = 0.42;
let crowdGain: GainNode | null = null;
let crowdSrc: AudioBufferSourceNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function setSound(on: boolean): void {
  enabled = on;
  if (master) master.gain.value = on ? SFX_LEVEL : 0;
  if (!on) stopCrowd();
}

/** Call from a user gesture so browsers allow audio. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // everything goes through a gentle low-pass and a limiter so nothing is harsh or clips
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 6; limiter.attack.value = 0.004; limiter.release.value = 0.18;
      limiter.connect(ctx.destination);
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass'; soften.frequency.value = 6500; soften.Q.value = 0.3;
      soften.connect(limiter);
      master = ctx.createGain();
      master.gain.value = enabled ? SFX_LEVEL : 0;
      master.connect(soften);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(limiter);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio is optional */ }
}

/** Shared audio context and the music bus, once audio has been unlocked. */
export const audioGraph = (): { ctx: AudioContext; musicBus: GainNode } | null => (ctx && musicBus ? { ctx, musicBus } : null);
export const noiseBuffer = (): AudioBuffer => noise();
if (import.meta.env.DEV && typeof window !== 'undefined') (window as any).__audio = audioGraph;

function noise(): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx!.createBuffer(1, ctx!.sampleRate * 2, ctx!.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
  if (!ctx || !master || !enabled) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(dur: number, vol: number, f0: number, f1: number, q = 1, delay = 0): void {
  if (!ctx || !master || !enabled) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random());
  s.stop(t + dur + 0.02);
}

import { buzz } from '../state/native';

export const sfx = {
  bounce: () => tone('sine', 140, 60, 0.08, 0.32),
  pass: () => hiss(0.12, 0.25, 900, 2400, 1.5),
  swish: () => { hiss(0.22, 0.38, 3600, 1100, 1.6); hiss(0.12, 0.18, 2200, 900, 2, 0.1); },
  rim: () => { tone('triangle', 620, 560, 0.1, 0.22); tone('sine', 930, 880, 0.2, 0.14); },
  board: () => tone('square', 190, 120, 0.08, 0.25),
  buzzer: () => { tone('triangle', 233, 230, 0.7, 0.3); tone('square', 116, 115, 0.7, 0.08); },
  whistle: () => { tone('sine', 2050, 2200, 0.16, 0.16); tone('sine', 2200, 2050, 0.18, 0.14, 0.19); },
  dunk: () => { tone('sine', 120, 42, 0.28, 0.85); hiss(0.18, 0.4, 320, 140, 0.8); tone('triangle', 500, 440, 0.2, 0.2, 0.03); tone('triangle', 760, 700, 0.3, 0.1, 0.05); },
  steal: () => { tone('square', 500, 250, 0.1, 0.2); tone('square', 250, 125, 0.12, 0.2, 0.08); },
  block: () => { tone('sine', 220, 60, 0.12, 0.7); hiss(0.08, 0.4, 800, 300, 1); },
  move: () => hiss(0.1, 0.2, 2500, 5000, 3),
  perfect: () => { tone('square', 880, 880, 0.06, 0.12); tone('square', 1320, 1320, 0.1, 0.12, 0.06); },
  good: () => { tone('square', 660, 660, 0.07, 0.14); tone('square', 880, 880, 0.07, 0.14, 0.07); tone('square', 1100, 1100, 0.12, 0.14, 0.14); },
  bad: () => { tone('square', 220, 180, 0.15, 0.16); tone('square', 165, 130, 0.22, 0.16, 0.14); },
  click: () => tone('square', 700, 700, 0.03, 0.1),
  /** One second gone on a shot clock that is running out. */
  tick: (urgent = false) => tone('square', urgent ? 1240 : 930, urgent ? 1240 : 930, 0.05, urgent ? 0.2 : 0.14),
  select: () => { tone('square', 520, 520, 0.04, 0.1); tone('square', 780, 780, 0.05, 0.1, 0.04); },
  coin: () => { tone('square', 988, 988, 0.06, 0.12); tone('square', 1319, 1319, 0.16, 0.12, 0.06); },
  cheer: (big = false) => { hiss(big ? 1.5 : 0.8, big ? 0.3 : 0.2, 700, 1300, 0.5); hiss(big ? 1.3 : 0.7, 0.1, 1700, 2300, 0.7, 0.06); },
  groan: () => hiss(0.7, 0.18, 420, 220, 0.7),
  /** The slam cam swinging in. */
  whoosh: () => { hiss(0.55, 0.16, 500, 2600, 0.6); tone('sine', 180, 720, 0.45, 0.07); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.16, 0.14, i * 0.13)); tone('square', 1047, 1047, 0.5, 0.14, 0.55); },
};

/** Looping crowd murmur whose loudness follows the crowd meter (0-100): a low rumble, not a hiss. */
export function setCrowd(level: number): void {
  if (!ctx || !master || !enabled) return;
  if (!crowdSrc) {
    crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = noise();
    crowdSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.2;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 140;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdSrc.connect(lp).connect(hp).connect(crowdGain).connect(master);
    crowdSrc.start();
  }
  crowdGain!.gain.setTargetAtTime(0.025 + (level / 100) * 0.07, ctx.currentTime, 0.5);
}
export function stopCrowd(): void {
  try { crowdSrc?.stop(); } catch { /* already stopped */ }
  crowdSrc = null; crowdGain = null;
}

// big plays are felt as well as heard (iPhone app only)
const FEEL: Partial<Record<keyof typeof sfx, Parameters<typeof buzz>[0]>> = { dunk: 'heavy', swish: 'light', perfect: 'success', steal: 'medium', block: 'medium' };
for (const k of Object.keys(FEEL) as (keyof typeof sfx)[]) {
  const play = sfx[k] as (...a: unknown[]) => void;
  (sfx as Record<string, unknown>)[k] = (...a: unknown[]) => { play(...a); buzz(FEEL[k]!); };
}
