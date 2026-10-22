// Seeded level generator. Every level is built backwards from a known winning
// move list, which is replayed through the real engine before it is accepted.
import { makeRng, hashSeed } from './rng.js';
import { TYPES, DX, DY, footprint, pathCells, replay, createGame } from './engine.js';
import { botPlay } from './solver.js';
import { SHAPES, SHAPE_UNLOCK, makeShape } from './shapes.js';

export const TWISTS = [
  { id: 'nap', level: 13, name: 'Sleepy Drivers', icon: 'zzz',
    text: 'Some drivers are napping. Tap once to wake them up, then tap again to drive.' },
  { id: 'mystery', level: 25, name: 'Mystery Rides', icon: '?',
    text: 'Gray vehicles keep their color secret until nothing blocks their way.' },
  { id: 'gate', level: 37, name: 'Boom Gates', icon: 'gate',
    text: 'A barrier lifts once the number of vehicles on its sign have left the lot.' },
  { id: 'garage', level: 49, name: 'Garages', icon: 'garage',
    text: 'Garages roll out another vehicle whenever the space in front is empty. The badge shows how many are left inside.' },
  { id: 'key', level: 61, name: 'Valet Keys', icon: 'key',
    text: 'A padlocked vehicle waits until the vehicle carrying its matching key has left.' },
  { id: 'group', level: 73, name: 'Tour Groups', icon: 'group',
    text: 'Friends holding hands board together, so they need that many free seats in one vehicle.' },
  { id: 'rain', level: 86, name: 'Rainy Days', icon: 'rain',
    text: 'Umbrellas hide the colors of riders further back in line. Plan with what you can see!' },
];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const INTRO_LEVELS = new Set(TWISTS.map((t) => t.level));

export function difficulty(N) {
  const base = 1 - Math.exp(-N / 70);
  // A level that introduces a twist is never also a hard spike.
  const hard = N % 5 === 0 && !INTRO_LEVELS.has(N);
  const breather = N % 5 === 1 && N > 10;
  const d = clamp(base + (hard ? 0.15 : 0) - (breather ? 0.22 : 0), 0.04, 1);
  return { d, hard, breather };
}

export function paramsFor(N, rng, jitter = 0) {
  const dd = difficulty(N);
  const { hard, breather } = dd;
  const d = clamp(dd.d + jitter, 0.03, 1);
  // Lot size grows steadily with N; jitter only changes how tricky it is.
  const grow = 1 - Math.exp(-Math.max(0, N - 6) / 80);
  // Much-too-hard candidates also get a slightly smaller lot.
  const size = (breather ? 0.7 : hard ? 1.05 : 1) * clamp(1 + (jitter + 0.3) * 0.5, 0.72, 1);
  const minColors = 2 + Math.floor(grow * 3.5);
  return {
    d, hard, breather,
    colors: clamp(Math.round(2 + d * 5.4), minColors, 8),
    count: clamp(Math.round((12 + grow * 56 + rng.next() * 6) * size), 8, 72),
    cap: d < 0.22 ? 2 : d < 0.5 ? 3 : d < 0.8 ? 4 : 5,
    pPark: 0.05 + 0.3 * d,
    lifo: 0.05 + 0.4 * d,
    interleave: 0.1 + 0.4 * d,
    runMin: Math.max(2, Math.round(5 - d * 3)),
    runMax: Math.max(3, Math.round(10 - d * 6)),
    blockBias: 0.4 + 2.6 * d,
    depthBias: 0.15 + 0.08 * d,
    bus: N < 8 ? 0 : 0.06 + 0.16 * grow,
    van: 0.2 + 0.12 * grow,
  };
}

function chooseShape(N, rng) {
  const avail = SHAPE_UNLOCK.filter(([, lv]) => N >= lv).map(([n]) => n);
  // Newly unlocked shapes show up right away.
  const fresh = SHAPE_UNLOCK.find(([, lv]) => lv === N);
  if (fresh) return fresh[0];
  return rng.pick(avail);
}

function gridFor(count, mix, fill) {
  const avgLen = 1 * (1 - mix.van - mix.bus) + 2 * mix.van + 3 * mix.bus;
  const need = (count * avgLen) / 0.74 / fill;
  let W = clamp(Math.round(Math.sqrt(need / 1.28)), 4, 12);
  let H = clamp(Math.round(W * 1.28), 5, 15);
  while (W * H < need && (W < 12 || H < 15)) {
    if (H < 15 && H < W * 1.4) H++; else if (W < 12) W++; else H++;
  }
  return { W, H };
}

// Reverse placement: each new vehicle must have a clear road out given the
// vehicles already placed. Reversed, that order is a valid clearing order.
function placeVehicles(W, H, mask, walls, types, blockBias, depthBias, rng) {
  const N = W * H;
  const occ = new Int16Array(N).fill(-1);
  const wall = new Uint8Array(N);
  for (const c of walls) wall[c] = 1;
  const cover = new Float32Array(N);
  const placed = [];
  for (const want of types) {
    let best = null;
    const lens = want === 'bus' ? ['bus', 'van', 'car'] : want === 'van' ? ['van', 'car'] : ['car'];
    for (const type of lens) {
      const len = TYPES[type].len;
      let bestScore = -Infinity;
      for (let c = 0; c < N; c++) {
        if (!mask[c] || occ[c] >= 0) continue;
        const fx = c % W, fy = (c / W) | 0;
        for (let dir = 0; dir < 4; dir++) {
          const tx = fx - DX[dir] * (len - 1), ty = fy - DY[dir] * (len - 1);
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const cells = footprint(W, fx, fy, dir, len);
          let ok = true, score = 0;
          for (const k of cells) {
            if (!mask[k] || occ[k] >= 0 || wall[k]) { ok = false; break; }
            score += cover[k];
          }
          if (!ok) continue;
          const path = pathCells(W, H, fx, fy, dir);
          for (const k of path) if (occ[k] >= 0 || wall[k]) { ok = false; break; }
          if (!ok) continue;
          // Fill from the inside out (long roads first), block existing
          // roads, stay compact, plus some randomness.
          let nb = 0;
          for (const k of cells) {
            const x = k % W, y = (k / W) | 0;
            for (let d2 = 0; d2 < 4; d2++) {
              const nx = x + DX[d2], ny = y + DY[d2];
              if (nx >= 0 && ny >= 0 && nx < W && ny < H && occ[ny * W + nx] >= 0) nb++;
            }
          }
          score = (blockBias * score) / len + (nb * 0.3) / len + rng.next() * 1.6 + path.length * depthBias;
          if (score > bestScore) { bestScore = score; best = { type, fx, fy, dir, cells, path }; }
        }
      }
      if (best) break;
    }
    if (!best) break;
    for (const k of best.cells) occ[k] = placed.length;
    for (const k of best.path) cover[k] += 1;
    placed.push(best);
  }
  return { placed, occ, wall };
}

function pickTwists(N, rng, breather) {
  const intro = TWISTS.find((t) => t.level === N);
  if (intro) return { list: [intro.id], intro };
  const avail = TWISTS.filter((t) => N > t.level);
  const list = [];
  const max = breather ? 1 : 2;
  for (const t of rng.shuffle(avail.slice())) {
    if (list.length >= max) break;
    const recent = N - t.level <= 3;
    if (rng.chance(recent ? 0.75 : 0.24)) list.push(t.id);
  }
  return { list, intro: null };
}

// Plays the exit order with at most `cap` bays in use and writes down the
// line. Riders come in short runs of one color, so the line reads in chunks.
function buildLine(order, cap, P, rng, groupP) {
  const parked = [];
  const line = [];
  let i = 0, seq = 0, cur = null, runLeft = 0;
  while (i < order.length || parked.length) {
    const canPark = i < order.length && parked.length < cap;
    if (!parked.length || (canPark && rng.chance(P.pPark))) {
      const o = order[i++];
      parked.push({ c: o.color, rem: TYPES[o.type].cap, seq: ++seq });
      continue;
    }
    if (!cur || !parked.includes(cur) || runLeft <= 0) {
      if (rng.chance(P.lifo)) cur = parked[parked.length - 1];
      else if (rng.chance(P.interleave)) cur = rng.pick(parked);
      else cur = parked[0];
      runLeft = rng.range(P.runMin, P.runMax);
    }
    const c = cur.c;
    let n = groupP && rng.chance(groupP) ? rng.range(2, 3) : 1;
    let v = parked.find((p) => p.c === c && p.rem >= n);
    if (!v) { n = 1; v = parked.find((p) => p.c === c); }
    line.push({ c, n });
    runLeft -= n;
    v.rem -= n;
    if (v.rem === 0) parked.splice(parked.indexOf(v), 1);
  }
  return line;
}

function assignColors(order, K, rng) {
  // Spread colors evenly, but in a shuffled, slightly clumpy order.
  const bag = [];
  for (let i = 0; i < order.length; i++) bag.push(i % K);
  rng.shuffle(bag);
  for (let i = 1; i < bag.length; i++) {
    if (rng.chance(0.18)) { bag[i] = bag[i - 1]; }
  }
  // Make sure every color is still present.
  for (let c = 0; c < K; c++) if (!bag.includes(c)) bag[rng.int(bag.length)] = c;
  order.forEach((o, i) => { o.color = bag[i]; });
}

function tryGenerate(N, salt, jitter = 0) {
  // Twists and shape depend only on N; the salt varies layout and line.
  const lr = makeRng(hashSeed('color-commute-level', N));
  const rng = makeRng(hashSeed('color-commute', N, salt));
  const P = paramsFor(N, rng, jitter);
  const tw = pickTwists(N, lr, P.breather);
  const has = (id) => tw.list.includes(id);
  const shapeName = chooseShape(N, lr);
  const shape0 = SHAPES[shapeName];
  const mix = { van: P.van, bus: P.bus };
  const { W, H } = gridFor(P.count, mix, shape0.fill);
  const shape = makeShape(shapeName, W, H, rng);

  const types = [];
  for (let i = 0; i < P.count; i++) {
    const r = rng.next();
    types.push(r < mix.bus ? 'bus' : r < mix.bus + mix.van ? 'van' : 'car');
  }
  // Long vehicles first so they find room.
  types.sort((a, b) => TYPES[b].len - TYPES[a].len + (rng.next() - 0.5) * 1.2);

  const { placed, occ, wall } = placeVehicles(W, H, shape.mask, shape.walls, types, P.blockBias, P.depthBias, rng);
  if (placed.length < Math.min(P.count * 0.75, 8)) return null;

  // Exit order is the reverse of placement.
  const order = placed.slice().reverse().map((p, i) => ({ ...p, tag: 'v' + i, init: i }));
  const block = new Uint8Array(W * H);
  for (const c of shape.walls) block[c] = 1;

  // --- Garages: a vehicle's own footprint becomes the garage's driveway.
  const garages = [];
  if (has('garage')) {
    const want = rng.range(1, 2);
    const cands = rng.shuffle(order.filter((o) => o.init != null));
    for (const V of cands) {
      if (garages.length >= want) break;
      const tail = V.cells[V.cells.length - 1];
      const bx = (tail % W) - DX[V.dir], by = ((tail / W) | 0) - DY[V.dir];
      if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
      const g = by * W + bx;
      if (occ[g] >= 0 || block[g]) continue;
      if (order.some((o) => o.path.includes(g))) continue;
      const vi = order.indexOf(V);
      let limit = order.length;
      for (let j = vi + 1; j < order.length; j++) {
        if (order[j].path.some((k) => V.cells.includes(k))) { limit = j; break; }
      }
      const q = rng.range(1, 3);
      const gi = garages.length;
      const queue = [];
      let at = vi + 1;
      for (let k = 0; k < q; k++) {
        const opts = ['car', 'van', 'bus'].filter((t) => TYPES[t].len <= V.cells.length);
        const type = rng.pick(opts);
        queue.push({ type });
        const pos = rng.range(at, Math.max(at, Math.min(limit, at + 3)));
        order.splice(pos, 0, { type, tag: 'g' + gi + '.' + k, path: V.path, cells: [], spawn: { gi, k } });
        limit++;
        at = pos + 1;
      }
      garages.push({ cell: g, dir: V.dir, span: V.cells.length, queue });
      block[g] = 2;
    }
  }

  // --- Boom gates on empty cells crossed by roads.
  const gates = [];
  if (has('gate')) {
    const want = rng.range(1, 2);
    const cands = [];
    for (let c = 0; c < W * H; c++) {
      if (occ[c] >= 0 || block[c]) continue;
      let need = Infinity, cross = 0;
      order.forEach((o, i) => { if (o.path.includes(c)) { cross++; need = Math.min(need, i); } });
      if (cross && need >= 3) cands.push({ c, need, score: cross + need * 0.3 + rng.next() * 3 });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const g of cands) {
      if (gates.length >= want) break;
      if (gates.some((x) => Math.abs((x.cells[0] % W) - (g.c % W)) + Math.abs(((x.cells[0] / W) | 0) - ((g.c / W) | 0)) < 3)) continue;
      gates.push({ cells: [g.c], need: Math.min(g.need, P.count) });
      block[g.c] = 3;
    }
  }

  // Spec vehicles (initial ones), indexed by their tag number.
  const inits = order.filter((o) => o.init != null).sort((a, b) => a.init - b.init);
  const specV = inits.map((o) => ({ type: o.type, fx: o.fx, fy: o.fy, dir: o.dir }));
  const initIdx = (o) => o.init;

  // Which vehicles can move at the very start?
  const freeAtStart = (o) => o.path.every((k) => occ[k] < 0 && !block[k]);

  // --- Valet keys.
  if (has('key')) {
    const want = rng.range(1, 3);
    let made = 0;
    const used = new Set();
    for (let ai = order.length - 1; ai >= 2 && made < want; ai--) {
      const A = order[ai];
      if (A.init == null || used.has(A.init) || !freeAtStart(A)) continue;
      if (!rng.chance(0.5)) continue;
      const keys = order.slice(0, ai).filter((o) => o.init != null && !used.has(o.init) && specV[o.init].lock == null);
      if (!keys.length) continue;
      const K = keys[rng.int(Math.min(keys.length, 6))];
      specV[A.init].lock = initIdx(K);
      used.add(A.init); used.add(K.init);
      made++;
    }
  }
  if (has('nap')) {
    for (const v of specV) if (rng.chance(0.28)) v.napping = true;
  }
  if (has('mystery')) {
    for (const o of inits) if (!freeAtStart(o) && rng.chance(0.55)) specV[o.init].hidden = true;
    for (const g of garages) for (const q of g.queue) if (rng.chance(0.5)) q.hidden = true;
  }

  assignColors(order, P.colors, rng);
  for (const o of order) {
    if (o.init != null) specV[o.init].color = o.color;
    else garages[o.spawn.gi].queue[o.spawn.k].color = o.color;
  }

  const line = buildLine(order, P.cap, P, rng, has('group') ? 0.3 : 0);
  const spec = {
    n: N, W, H, mask: Array.from(shape.mask), walls: shape.walls.slice(),
    vehicles: specV, gates, garages, line, bays: 5,
    visible: has('rain') ? rng.range(5, 8) : 0,
    solution: order.map((o) => o.tag),
    twists: tw.list, intro: tw.intro ? tw.intro.id : null,
    shape: shapeName + (shape.label ? ':' + shape.label : ''),
    d: P.d, count: P.count, hard: P.hard, breather: P.breather, colors: P.colors,
  };
  // Twist must really be present on its intro level.
  if (tw.intro) {
    const id = tw.intro.id;
    if (id === 'gate' && !gates.length) return null;
    if (id === 'garage' && !garages.length) return null;
    if (id === 'key' && !specV.some((v) => v.lock != null)) return null;
    if (id === 'mystery' && !specV.some((v) => v.hidden)) return null;
    if (id === 'nap' && !specV.some((v) => v.napping)) return null;
    if (id === 'group' && !line.some((u) => u.n > 1)) return null;
  }
  const r = replay(spec, spec.solution);
  if (!r.ok) return null;
  return spec;
}

// Target chance that a fair, attentive bot wins. Gentle start, a slow climb,
// spikes on every 5th level and a breather right after.
export function targetWinRate(N) {
  const { hard, breather } = difficulty(N);
  let t = 0.95 - 0.4 * (1 - Math.exp(-Math.max(0, N - 6) / 70));
  if (hard) t -= 0.2;
  if (breather) t += 0.12;
  if (TWISTS.some((x) => x.level === N)) t += 0.08;
  if (N < 22) t += 0.06 * (1 - (N - 7) / 15);
  return clamp(t, 0.25, 0.97);
}

export function rateLevel(spec, runs = 12) {
  let w = 0, smart = 0;
  for (const skill of [0.5, 0.9]) {
    for (let r = 0; r < runs; r++) {
      const won = botPlay(createGame(spec), makeRng(hashSeed('bot', spec.n, skill, r)), skill);
      if (won) { w++; if (skill > 0.8) smart++; }
    }
  }
  return { rate: w / (runs * 2), smart: smart / runs };
}

// Build candidates for level N and keep the one whose bot win rate is closest
// to the target, easing or tightening difficulty between tries.
// Deterministic: same N, same level.
export function generateLevel(N, candidates = 14) {
  const target = targetWinRate(N);
  let best = null, bestErr = Infinity;
  let found = 0, jitter = 0;
  for (let salt = 0; salt < 100 && found < candidates; salt++) {
    const spec = tryGenerate(N, salt, jitter);
    if (!spec) continue;
    found++;
    const r = rateLevel(spec);
    const err = Math.abs(r.rate - target);
    // Fairness: a thoughtful player must be able to win it sometimes.
    if (r.smart > 0 && err < bestErr) { bestErr = err; best = spec; spec.rate = r.rate; spec.target = target; }
    if (best && err < 0.05) break;
    jitter += clamp((r.rate - target) * 0.45, -0.12, 0.08);
    jitter = clamp(jitter, -0.85, 0.3);
  }
  if (best) return best;
  for (let salt = 0; salt < 200; salt++) {
    const spec = tryGenerate(N, salt, -0.5);
    if (spec) return spec;
  }
  throw new Error('could not generate level ' + N);
}
