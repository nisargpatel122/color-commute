import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tap, lift, addBay, sortLine, probe, replay } from '../js/engine.js';

const R = 0, B = 1, G = 2;
const line = (str) => [...str].map((ch) => ({ c: { R, B, G }[ch], n: 1 }));
const car = (color, fx, fy, dir, extra = {}) => ({ type: 'car', color, fx, fy, dir, ...extra });

test('free car exits, parks and boards riders one by one', () => {
  const s = createGame({ W: 3, H: 3, vehicles: [car(R, 1, 1, 0)], line: line('RRRR') });
  const ev = tap(s, 0);
  assert.equal(ev[0].t, 'exit');
  assert.equal(ev[0].bay, 0);
  const boards = ev.filter((e) => e.t === 'board');
  assert.deepEqual(boards.map((e) => e.seat), [0, 1, 2, 3]);
  assert.ok(ev.some((e) => e.t === 'depart'));
  assert.equal(s.status, 'won');
});

test('blocked vehicle bumps and stays; reports blocker and distance', () => {
  // red at (1,2) facing up; blue at (1,0) blocks with 1 empty cell between.
  const s = createGame({ W: 3, H: 3, vehicles: [car(R, 1, 2, 0), car(B, 1, 0, 1)], line: line('BBBBRRRR') });
  const ev = tap(s, 0);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].t, 'blocked');
  assert.equal(ev[0].hit, 1);
  assert.equal(ev[0].dist, 1);
  assert.equal(s.vehicles[0].state, 'lot');
  tap(s, 1);
  assert.equal(probe(s, s.vehicles[0]).ok, true);
  tap(s, 0);
  assert.equal(s.status, 'won');
});

test('vans and buses are long and seat 6 and 10', () => {
  const s = createGame({
    W: 4, H: 4,
    vehicles: [{ type: 'bus', color: R, fx: 3, fy: 0, dir: 1 }, { type: 'van', color: B, fx: 0, fy: 2, dir: 3 }],
    line: line('R'.repeat(10) + 'B'.repeat(6)),
  });
  assert.deepEqual([...s.cells.slice(0, 4)], [-1, 0, 0, 0]);
  assert.deepEqual([...s.cells.slice(8, 12)], [1, 1, -1, -1]);
  assert.equal(s.vehicles[0].cap, 10);
  assert.equal(s.vehicles[1].cap, 6);
  tap(s, 0); tap(s, 1);
  assert.equal(s.status, 'won');
});

test('front of line boards only its color, in order', () => {
  const s = createGame({ W: 4, H: 2, vehicles: [car(R, 0, 0, 0), car(B, 1, 0, 0)], line: line('BRRRRBBB') });
  let ev = tap(s, 0); // red parks, but front is blue: nobody boards
  assert.equal(ev.filter((e) => e.t === 'board').length, 0);
  ev = tap(s, 1); // blue parks: B boards, then RRRR into red, then BBB
  const seq = ev.filter((e) => e.t === 'board').map((e) => e.c);
  assert.deepEqual(seq, [B, R, R, R, R, B, B, B]);
  assert.equal(s.status, 'won');
});

test('earliest parked vehicle of a color fills first', () => {
  const s = createGame({ W: 4, H: 2, vehicles: [car(G, 0, 0, 0), car(R, 1, 0, 0), car(R, 2, 0, 0)], line: line('GRRRRRRRRGGG') });
  tap(s, 1); tap(s, 2); // both red park before any rider can board
  const ev = tap(s, 0);
  const reds = ev.filter((e) => e.t === 'board' && e.c === R).map((e) => e.id);
  assert.deepEqual(reds, [1, 1, 1, 1, 2, 2, 2, 2]);
});

test('full bays with no match loses; no bay means vehicle refuses', () => {
  const vehicles = [0, 1, 2, 3, 4, 5].map((x) => car(R, x, 0, 0));
  vehicles.push(car(B, 6, 0, 0));
  const s = createGame({ W: 7, H: 1, vehicles, line: line('BBBB' + 'R'.repeat(24)) });
  for (let i = 0; i < 4; i++) tap(s, i);
  assert.equal(s.status, 'playing');
  const ev = tap(s, 4);
  assert.equal(ev.at(-1).t, 'lose');
  assert.equal(s.status, 'lost');
  assert.equal(tap(s, 6).length, 0);
});

test('a sixth bay gives room to park one more', () => {
  const vehicles = [0, 1, 2, 3, 4].map((x) => car(R, x, 0, 0));
  vehicles.push(car(B, 5, 0, 0));
  const s = createGame({ W: 6, H: 1, vehicles, line: line('BBBB' + 'R'.repeat(20)), bays: 6 });
  for (let i = 0; i < 5; i++) tap(s, i);
  assert.equal(s.status, 'playing');
  tap(s, 5);
  assert.equal(s.status, 'won');
});

test('extra bay rescues a lost game', () => {
  const vehicles = [0, 1, 2, 3, 4].map((x) => car(R, x, 0, 0));
  vehicles.push(car(B, 5, 0, 0));
  const s = createGame({ W: 6, H: 1, vehicles, line: line('BBBB' + 'R'.repeat(20)) });
  for (let i = 0; i < 5; i++) tap(s, i);
  assert.equal(s.status, 'lost');
  addBay(s);
  assert.equal(s.status, 'playing');
  tap(s, 5);
  assert.equal(s.status, 'won');
});

test('sort booster rescues by bringing boardable riders forward', () => {
  const s = createGame({ W: 3, H: 2, vehicles: [car(R, 0, 0, 0), car(B, 1, 0, 0)], line: line('BBBBRRRR'), bays: 1 });
  tap(s, 0);
  assert.equal(s.status, 'lost');
  sortLine(s);
  assert.equal(s.status, 'playing');
  tap(s, 1);
  assert.equal(s.status, 'won');
});

test('lift pulls a blocked vehicle out', () => {
  const s = createGame({ W: 3, H: 3, vehicles: [car(R, 1, 2, 0), car(B, 1, 0, 1)], line: line('RRRRBBBB') });
  const ev = lift(s, 0);
  assert.equal(ev[0].t, 'lift');
  tap(s, 1);
  assert.equal(s.status, 'won');
});

test('walls block; napping needs two taps; mystery reveals when free', () => {
  const s = createGame({
    W: 3, H: 3, walls: [1],
    vehicles: [car(R, 1, 1, 0), car(B, 0, 2, 0, { napping: true }), car(G, 2, 1, 2, { hidden: true }), car(R, 2, 2, 1)],
    line: line('BBBBRRRRGGGGRRRR'),
  });
  assert.equal(tap(s, 0)[0].kind, 'wall');
  assert.equal(s.vehicles[2].hidden, true); // blocked by red at (2,2)
  assert.equal(tap(s, 1)[0].t, 'wake');
  assert.equal(tap(s, 1)[0].t, 'exit');
  const ev = tap(s, 3);
  assert.ok(ev.some((e) => e.t === 'reveal' && e.id === 2));
});

test('gate opens after enough exits; garage spawns when space clears; keys unlock', () => {
  const s = createGame({
    W: 4, H: 4,
    vehicles: [car(R, 0, 1, 0), car(B, 3, 3, 0, { lock: 0 }), car(G, 1, 1, 0)],
    gates: [{ cells: [2], need: 1 }],
    garages: [{ cell: 10, dir: 0, span: 1, queue: [{ type: 'car', color: R }] }],
    line: line('RRRRGGGGRRRRBBBB'),
  });
  // car at (2,1)? garage at cell 10 = (2,2) facing up, out cell = (2,1): empty -> spawns immediately.
  assert.equal(s.vehicles.length, 4);
  assert.equal(s.vehicles[3].tag, 'g0.0');
  assert.equal(tap(s, 3)[0].kind, 'gate');
  assert.equal(tap(s, 1)[0].kind, 'lock');
  tap(s, 0); // gate opens (1 exit), key gone
  assert.equal(s.gates[0].open, true);
  assert.equal(probe(s, s.vehicles[1]).ok, true);
  tap(s, 2); tap(s, 3); tap(s, 1);
  assert.equal(s.status, 'won');
});

test('tour groups need room for the whole group', () => {
  const s = createGame({
    W: 3, H: 1,
    vehicles: [car(R, 0, 0, 0), car(R, 1, 0, 0)],
    line: [{ c: R, n: 1 }, { c: R, n: 1 }, { c: R, n: 3 }, { c: R, n: 2 }, { c: R, n: 1 }],
  });
  const ev = tap(s, 0);
  assert.equal(ev.filter((e) => e.t === 'board').length, 2); // group of 3 can't fit into 2 free seats
  const ev2 = tap(s, 1);
  const ids = ev2.filter((e) => e.t === 'board').map((e) => e.id);
  assert.deepEqual(ids, [1, 1, 1, 0, 0, 1]);
  assert.equal(s.status, 'won');
});

test('replay helper', () => {
  const spec = { W: 3, H: 3, vehicles: [car(R, 1, 2, 0), car(B, 1, 0, 1)], line: line('BBBBRRRR') };
  assert.equal(replay(spec, ['v1', 'v0']).ok, true);
  assert.equal(replay(spec, ['v0', 'v1']).ok, false);
});
