// Dev-only harness: open /?arcade to loop hand-played possessions with generated teams.
import { newLeague } from '../core/gen/league';
import { Arcade } from '../game/arcade';
import { unlockAudio } from '../audio/sfx';
import type { Difficulty } from '../core/types';

export function runArcadeTest(root: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  const save = newLeague({ seed: Number(q.get('seed') ?? 7), coachName: 'Test', coachLook: { skin: 1, hair: 1, hairColor: 0 }, settings: { sound: true, difficulty: 'normal', haptics: true } });
  const a = save.teams[0], b = save.teams[1];
  root.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;height:100dvh"><div id="hud" style="font:14px monospace;padding:6px">tap to start</div><canvas id="c" style="width:min(100vw,calc((100dvh - 40px)*8/9));aspect-ratio:8/9;image-rendering:pixelated"></canvas></div>`;
  const canvas = root.querySelector('#c') as HTMLCanvasElement;
  const hud = root.querySelector('#hud') as HTMLElement;
  const arcade = new Arcade(canvas, { paint: a.colors.primary, accent: a.colors.secondary, banners: 3, crowdA: a.colors.primary, crowdB: a.colors.secondary });
  (window as any).arcade = arcade;
  let us = 0, n = 0;
  const loop = async () => {
    for (;;) {
      const r = await arcade.play({
        poss: { quarter: 4, clock: n % 3 === 2 ? 9 : 200, userScore: us, oppScore: 0, offense: a.lineup, defense: b.lineup, clutch: false, lastShot: n % 3 === 2, crowd: 50 },
        offense: a.lineup.map(id => save.players[id]), defense: b.lineup.map(id => save.players[id]),
        offColors: a.colors, defColors: b.colors, ocStars: 2, difficulty: (q.get('d') as Difficulty) ?? 'normal',
      });
      us += r.points; n++;
      hud.textContent = `pts ${us} in ${n} | ${JSON.stringify(r.outcome.events)} ${r.highlights.join(',')}`;
      (window as any).lastResult = r;
    }
  };
  arcade.onClock = (c, s) => { if (Math.random() < 0.1) hud.title = `${c.toFixed(0)} ${s.toFixed(0)}`; };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  void loop();
}
