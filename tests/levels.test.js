import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLevel, TUT_COUNT } from '../js/levels.js';
import { createGame, replay, TYPES, footprint, tap, cloneState } from '../js/engine.js';
import { solve, shuffleLot, freeVehicles } from '../js/solver.js';
import { makeRng } from '../js/rng.js';

const LAST = +(process.env.LEVELS || 300);

function checkStructure(spec) {
  const N = spec.W * spec.H;
  const used = new Set(spec.walls);
  for (const v of spec.vehicles) {
    assert.ok(TYPES[v.type], 'type');
    assert.ok(v.color >= 0 && v.color < 8, 'color');
    const cells = footprint(spec.W, v.fx, v.fy, v.dir, TYPES[v.type].len);
    for (const c of cells) {
      assert.ok(c >= 0 && c < N, 'in grid');
      assert.equal(spec.mask[c], 1, 'on painted lot');
      assert.ok(!used.has(c), 'no overlap');
      used.add(c);
    }
    const tx = v.fx - [0, 1, 0, -1][v.dir] * (TYPES[v.type].len - 1);
    assert.ok(tx >= 0 && tx < spec.W, 'tail inside');
  }
  // Exactly enough seats of every color.
  const seats = new Map(), riders = new Map();
  const add = (m, c, n) => m.set(c, (m.get(c) || 0) + n);
  for (const v of spec.vehicles) add(seats, v.color, TYPES[v.type].cap);
  for (const g of spec.garages || []) for (const q of g.queue) add(seats, q.color, TYPES[q.type].cap);
  for (const u of spec.line) add(riders, u.c, u.n);
  assert.deepEqual([...seats.entries()].sort(), [...riders.entries()].sort(), 'seats == riders per color');
}

test('tutorials are well formed and solvable', () => {
  for (let n = 1; n <= TUT_COUNT; n++) {
    const spec = getLevel(n);
    checkStructure(spec);
    const sol = solve(createGame(spec));
    assert.ok(Array.isArray(sol), 'tutorial ' + n + ' solvable');
    assert.equal(replay(spec, sol).ok, true);
  }
});

test(`levels ${TUT_COUNT + 1}-${LAST}: deterministic, well formed, and won by their built-in solution`, () => {
  let solverOk = 0, total = 0;
  for (let n = TUT_COUNT + 1; n <= LAST; n++) {
    const spec = getLevel(n);
    checkStructure(spec);
    const r = replay(spec, spec.solution);
    assert.equal(r.ok, true, `level ${n} replay: ${r.why}`);
    const s = createGame(spec);
    assert.ok(freeVehicles(s).length > 0, `level ${n} has a first move`);
    if (n % 10 === 0) {
      total++;
      const sol = solve(createGame(spec), 6000, 20);
      if (Array.isArray(sol)) { solverOk++; assert.equal(replay(spec, sol).ok, true); }
    }
  }
  // The independent search solver also finds wins on most sampled levels.
  assert.ok(solverOk >= total * 0.6, `solver confirmed ${solverOk}/${total}`);
});

test('same level number always builds the same lot', async () => {
  const { generateLevel } = await import('../js/generator.js');
  for (const n of [7, 42, 137]) {
    assert.deepEqual(JSON.stringify(generateLevel(n)), JSON.stringify(generateLevel(n)));
  }
});

test('shuffle keeps the lot winnable and seat counts exact', () => {
  for (const n of [9, 14, 23, 31]) {
    const spec = getLevel(n);
    const s = createGame(spec);
    // Play the first few moves of the known solution.
    for (const tag of spec.solution.slice(0, 3)) {
      const v = s.vehicles.find((x) => x.tag === tag);
      let ev = tap(s, v.id); if (ev[0].t === 'wake') tap(s, v.id);
    }
    const before = s.vehicles.filter((v) => v.state === 'lot').map((v) => v.type + v.color).sort();
    const t = cloneState(s);
    if (shuffleLot(t, makeRng(n))) {
      const after = t.vehicles.filter((v) => v.state === 'lot').map((v) => v.type + v.color).sort();
      assert.deepEqual(after, before, 'same multiset of (size,color)');
      assert.ok(Array.isArray(solve(t, 20000)), 'still winnable');
    }
  }
});
