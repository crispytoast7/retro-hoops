// All sound is synthesised with WebAudio: no audio files to load or cache.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let crowdGain: GainNode | null = null;
let crowdSrc: AudioBufferSourceNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function setSound(on: boolean): void {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
  if (!on) stopCrowd();
}

/** Call from a user gesture so browsers allow audio. */
export function unlockAudio(): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio is optional */ }
}

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

export const sfx = {
  bounce: () => tone('sine', 150, 55, 0.09, 0.5),
  pass: () => hiss(0.12, 0.25, 900, 2400, 1.5),
  swish: () => { hiss(0.28, 0.5, 5200, 1400, 2); },
  rim: () => { tone('square', 620, 560, 0.12, 0.16); tone('triangle', 930, 880, 0.18, 0.18); },
  board: () => tone('square', 190, 120, 0.08, 0.25),
  buzzer: () => { tone('sawtooth', 196, 190, 0.9, 0.3); tone('square', 98, 96, 0.9, 0.2); },
  whistle: () => { tone('square', 2100, 2300, 0.18, 0.12); tone('square', 2300, 2100, 0.2, 0.12, 0.2); },
  dunk: () => { tone('sine', 110, 40, 0.25, 0.8); hiss(0.2, 0.5, 300, 120, 0.8); tone('square', 520, 480, 0.15, 0.12, 0.03); },
  steal: () => { tone('square', 500, 250, 0.1, 0.2); tone('square', 250, 125, 0.12, 0.2, 0.08); },
  block: () => { tone('sine', 220, 60, 0.12, 0.7); hiss(0.08, 0.4, 800, 300, 1); },
  move: () => hiss(0.1, 0.2, 2500, 5000, 3),
  perfect: () => { tone('square', 880, 880, 0.06, 0.12); tone('square', 1320, 1320, 0.1, 0.12, 0.06); },
  good: () => { tone('square', 660, 660, 0.07, 0.14); tone('square', 880, 880, 0.07, 0.14, 0.07); tone('square', 1100, 1100, 0.12, 0.14, 0.14); },
  bad: () => { tone('square', 220, 180, 0.15, 0.16); tone('square', 165, 130, 0.22, 0.16, 0.14); },
  click: () => tone('square', 700, 700, 0.03, 0.1),
  select: () => { tone('square', 520, 520, 0.04, 0.1); tone('square', 780, 780, 0.05, 0.1, 0.04); },
  coin: () => { tone('square', 988, 988, 0.06, 0.12); tone('square', 1319, 1319, 0.16, 0.12, 0.06); },
  cheer: (big = false) => { hiss(big ? 1.6 : 0.8, big ? 0.5 : 0.3, 900, 1800, 0.4); hiss(big ? 1.4 : 0.7, 0.2, 2500, 3200, 0.6, 0.05); },
  groan: () => hiss(0.7, 0.25, 500, 250, 0.6),
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.16, 0.14, i * 0.13)); tone('square', 1047, 1047, 0.5, 0.14, 0.55); },
};

/** Looping crowd murmur whose loudness follows the crowd meter (0-100). */
export function setCrowd(level: number): void {
  if (!ctx || !master || !enabled) return;
  if (!crowdSrc) {
    crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = noise();
    crowdSrc.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.3;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdSrc.connect(f).connect(crowdGain).connect(master);
    crowdSrc.start();
  }
  crowdGain!.gain.setTargetAtTime(0.02 + (level / 100) * 0.1, ctx.currentTime, 0.4);
}
export function stopCrowd(): void {
  try { crowdSrc?.stop(); } catch { /* already stopped */ }
  crowdSrc = null; crowdGain = null;
}
