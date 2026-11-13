// 3x5 bitmap font for crisp text on the low-resolution game canvas.
const G: Record<string, string> = {
  A: '.#.#.####.##.#', B: '##.#.###.#.###.', C: '.###..#..#...##', D: '##.#.##.##.###.',
  E: '####..##.#..###', F: '####..##.#..#..', G: '.###..#.##.#.##', H: '#.##.####.##.#',
  I: '###.#..#..#.###', J: '..#..#..##.#.#.', K: '#.##.###.#.##.#', L: '#..#..#..#..###',
  M: '#.########.##.#', N: '##.#.##.##.##.#', O: '.#.#.##.##.#.#.', P: '##.#.###.#..#..',
  Q: '.#.#.##.#.#...#', R: '##.#.###.#.##.#', S: '.###...#...###.', T: '###.#..#..#..#.',
  U: '#.##.##.##.####', V: '#.##.##.##.#.#.', W: '#.##.########.#', X: '#.##.#.#.#.##.#',
  Y: '#.##.#.#..#..#.', Z: '###..#.#.#..###',
  '0': '####.##.##.####', '1': '.#.##..#..#.###', '2': '##...#.#.#..###', '3': '##...#.#...###.',
  '4': '#.##.####..#..#', '5': '####..##...###.', '6': '.###..####.####', '7': '###..#.#..#..#.',
  '8': '####.#####.####', '9': '####.####..###.',
  '!': '.#..#..#.....#.', '?': '##...#.#.....#.', '.': '.............#.', ',': '..........#.#..',
  ':': '....#.....#....', '-': '......###......', '+': '....#.###.#....', "'": '.#..#..........',
  '/': '..#..#.#.#..#..', '%': '#.#..#.#.#..#.#', '(': '.#.#..#..#...#.', ')': '.#...#..#..#.#.',
  '#': '#.#####.#####.#', '*': '...#.#.#.#.#...', '>': '#...#...#.#.#..', '<': '..#.#.#...#...#',
  ' ': '...............',
};
// A and H were typed one cell short above; define them explicitly.
G.A = '.#.#.#####.##.#';
G.H = '#.##.#####.##.#';

export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * 4 - 1) * scale : 0;
}

export function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string,
  opts: { scale?: number; align?: 'left' | 'center' | 'right'; outline?: string } = {},
): void {
  const s = opts.scale ?? 1;
  const t = text.toUpperCase();
  let x0 = Math.round(x);
  const w = textWidth(t, s);
  if (opts.align === 'center') x0 = Math.round(x - w / 2);
  else if (opts.align === 'right') x0 = Math.round(x - w);
  const y0 = Math.round(y);
  const pass = (ox: number, oy: number, col: string) => {
    ctx.fillStyle = col;
    for (let i = 0; i < t.length; i++) {
      const g = G[t[i]] ?? G['?'];
      for (let k = 0; k < 15; k++) {
        if (g[k] === '#') ctx.fillRect(x0 + ox + (i * 4 + (k % 3)) * s, y0 + oy + Math.floor(k / 3) * s, s, s);
      }
    }
  };
  if (opts.outline && s === 1) {
    ctx.fillStyle = opts.outline;
    ctx.fillRect(x0 - 2, y0 - 2, w + 4, 9);
  } else if (opts.outline) {
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) pass(ox * s, oy * s, opts.outline);
  }
  pass(0, 0, color);
}
