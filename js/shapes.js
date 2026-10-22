// Lot shapes. Each returns { mask, walls } for a W x H grid.
// mask = painted parking cells (where vehicles start). walls = hedge cells.

const LETTERS = {
  C: ['.###', '#...', '#...', '#...', '.###'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  L: ['#...', '#...', '#...', '#...', '####'],
  T: ['####', '.##.', '.##.', '.##.', '.##.'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  Z: ['####', '..#.', '.#..', '#...', '####'],
  E: ['####', '#...', '###.', '#...', '####'],
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  X: ['#..#', '.##.', '.##.', '.##.', '#..#'],
  Y: ['#..#', '#..#', '.##.', '.##.', '.##.'],
};

function fromFn(W, H, fn) {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / W) * 2 - 1;
      const v = ((y + 0.5) / H) * 2 - 1;
      mask[y * W + x] = fn(u, v, x, y) ? 1 : 0;
    }
  }
  return mask;
}

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const starPts = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.5 : 1.05;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + 0.1]);
  }
  return pts;
})();

export const SHAPES = {
  rect: { fill: 1, fn: () => true },
  rounded: { fill: 0.92, fn: (u, v) => Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4) < 1.05 },
  circle: { fill: 0.8, fn: (u, v) => u * u + v * v < 1.08 },
  diamond: { fill: 0.6, fn: (u, v) => Math.abs(u) + Math.abs(v) < 1.12 },
  heart: {
    fill: 0.66,
    fn: (u, v) => {
      const x = u * 1.22, y = -v * 1.22 + 0.22;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y < 0;
    },
  },
  star: { fill: 0.5, fn: (u, v) => inPoly(u, v, starPts) },
  cross: { fill: 0.62, fn: (u, v) => Math.abs(u) < 0.42 || Math.abs(v) < 0.36 },
  ring: { fill: 0.6, fn: (u, v) => { const r = u * u + v * v; return r < 1.08 && r > 0.2; } },
  hourglass: { fill: 0.68, fn: (u, v) => Math.abs(u) < 0.3 + Math.abs(v) * 0.75 },
  arrow: { fill: 0.62, fn: (u, v) => (v < -0.05 ? Math.abs(u) < 1.05 + v : Math.abs(u) < 0.42) },
  house: { fill: 0.78, fn: (u, v) => (v < -0.25 ? Math.abs(u) < (v + 1.05) * 1.3 : Math.abs(u) < 0.92) },
  spiral: { fill: 0.72, walls: spiralWalls },
  maze: { fill: 0.86, walls: mazeWalls },
  letter: { fill: 0.55, letter: true },
};

// Shapes unlock gradually so early lots stay simple.
export const SHAPE_UNLOCK = [
  ['rect', 1], ['rounded', 1], ['circle', 7], ['heart', 9], ['diamond', 12], ['cross', 15],
  ['star', 18], ['letter', 21], ['house', 24], ['spiral', 28], ['hourglass', 31], ['ring', 34],
  ['arrow', 40], ['maze', 44],
];

function spiralWalls(W, H) {
  const walls = new Set();
  let x0 = 2, y0 = 2, x1 = W - 3, y1 = H - 3;
  let side = 0;
  // Hedge line that winds inward, leaving 2-wide lanes.
  while (x1 - x0 >= 1 && y1 - y0 >= 1) {
    if (side === 0) { for (let x = x0; x <= x1; x++) walls.add(y0 * W + x); y0 += 3; }
    else if (side === 1) { for (let y = y0 - 3; y <= y1; y++) walls.add(y * W + x1); x1 -= 3; }
    else if (side === 2) { for (let x = x1 + 3; x >= x0; x--) walls.add(y1 * W + x); y1 -= 3; }
    else { for (let y = y1 + 3; y >= y0; y--) walls.add(y * W + x0); x0 += 3; }
    side = (side + 1) % 4;
  }
  return [...walls].filter((c) => c >= 0 && c < W * H);
}

function mazeWalls(W, H, rng) {
  const walls = [];
  for (let y = 2; y < H - 1; y += 3) {
    let x = rng.int(2);
    while (x < W) {
      const len = rng.range(2, 3);
      for (let i = 0; i < len && x + i < W; i++) walls.push(y * W + x + i);
      x += len + rng.range(2, 3);
    }
  }
  for (let x = 2; x < W - 1; x += 4) {
    const y = rng.range(0, H - 3);
    if (rng.chance(0.6)) for (let i = 0; i < 2; i++) walls.push((y + i) * W + x);
  }
  return [...new Set(walls)];
}

export function makeShape(name, W, H, rng) {
  const sh = SHAPES[name];
  if (sh.letter) {
    const keys = Object.keys(LETTERS);
    const ch = keys[rng.int(keys.length)];
    const bm = LETTERS[ch];
    const mask = fromFn(W, H, (u, v, x, y) => {
      const bx = Math.min(3, Math.floor((x / W) * 4));
      const by = Math.min(4, Math.floor((y / H) * 5));
      return bm[by][bx] === '#';
    });
    return { mask, walls: [], label: ch };
  }
  if (sh.walls) {
    const walls = sh.walls(W, H, rng);
    const mask = new Uint8Array(W * H).fill(1);
    for (const c of walls) mask[c] = 0;
    return { mask, walls };
  }
  return { mask: fromFn(W, H, sh.fn), walls: [] };
}
