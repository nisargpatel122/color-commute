// Color Commute rules engine. Pure logic, no DOM: the view replays its events.
// Directions: 0 up, 1 right, 2 down, 3 left.
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const TYPES = {
  car: { len: 1, cap: 4 },
  van: { len: 2, cap: 6 },
  bus: { len: 3, cap: 10 },
};
export const BASE_BAYS = 5;
export const MAX_BAYS = 6;

// Block codes for non-vehicle cells.
export const B_NONE = 0, B_WALL = 1, B_GARAGE = 2, B_GATE = 3;

export function footprint(W, fx, fy, dir, len) {
  const out = [];
  for (let i = 0; i < len; i++) out.push((fy - DY[dir] * i) * W + (fx - DX[dir] * i));
  return out;
}

export function pathCells(W, H, fx, fy, dir) {
  const out = [];
  let x = fx + DX[dir], y = fy + DY[dir];
  while (x >= 0 && y >= 0 && x < W && y < H) {
    out.push(y * W + x);
    x += DX[dir]; y += DY[dir];
  }
  return out;
}

export function createGame(spec) {
  const W = spec.W, H = spec.H, N = W * H;
  const s = {
    W, H,
    cells: new Int16Array(N).fill(-1),
    block: new Uint8Array(N),
    gateAt: new Int16Array(N).fill(-1),
    mask: spec.mask ? Uint8Array.from(spec.mask) : new Uint8Array(N).fill(1),
    vehicles: [],
    gates: [],
    garages: [],
    line: spec.line.map((u) => ({ c: u.c, n: u.n || 1 })),
    lp: 0,
    bays: new Int16Array(MAX_BAYS).fill(-1),
    bayCount: spec.bays || BASE_BAYS,
    exited: 0,
    seq: 0,
    status: 'playing',
    visible: spec.visible || 0,
  };
  for (const c of spec.walls || []) s.block[c] = B_WALL;
  spec.vehicles.forEach((vs, i) => addVehicle(s, vs, 'v' + i));
  spec.vehicles.forEach((vs, i) => {
    if (vs.lock != null && vs.lock >= 0) {
      s.vehicles[i].lock = vs.lock;
      s.vehicles[vs.lock].key = true;
    }
  });
  (spec.gates || []).forEach((g, gi) => {
    s.gates.push({ cells: g.cells.slice(), need: g.need, open: false });
    for (const c of g.cells) { s.block[c] = B_GATE; s.gateAt[c] = gi; }
  });
  (spec.garages || []).forEach((g, gi) => {
    const out = [];
    const gx = g.cell % W, gy = (g.cell / W) | 0;
    for (let i = 1; i <= g.span; i++) out.push((gy + DY[g.dir] * i) * W + gx + DX[g.dir] * i);
    s.garages.push({ cell: g.cell, dir: g.dir, span: g.span, out, queue: g.queue.map((q) => ({ ...q })), made: 0 });
    s.block[g.cell] = B_GARAGE;
  });
  const ev = [];
  settle(s, ev);
  return s;
}

function addVehicle(s, vs, tag) {
  const t = TYPES[vs.type];
  const v = {
    id: s.vehicles.length, tag, type: vs.type, len: t.len, cap: t.cap, color: vs.color,
    fx: vs.fx, fy: vs.fy, dir: vs.dir, state: 'lot', bay: -1, filled: 0,
    hidden: !!vs.hidden, napping: !!vs.napping, lock: -1, key: false, parkSeq: 0,
  };
  v.cells = footprint(s.W, v.fx, v.fy, v.dir, v.len);
  for (const c of v.cells) s.cells[c] = v.id;
  s.vehicles.push(v);
  return v;
}

// Can v drive out? Returns {ok, kind, dist, hit, cell}.
export function probe(s, v) {
  if (v.lock >= 0 && s.vehicles[v.lock].state === 'lot') return { ok: false, kind: 'lock', dist: 0, hit: v.lock };
  let x = v.fx + DX[v.dir], y = v.fy + DY[v.dir], dist = 0;
  while (x >= 0 && y >= 0 && x < s.W && y < s.H) {
    const i = y * s.W + x;
    if (s.cells[i] >= 0) return { ok: false, kind: 'vehicle', dist, hit: s.cells[i], cell: i };
    const b = s.block[i];
    if (b) return { ok: false, kind: b === B_WALL ? 'wall' : b === B_GARAGE ? 'garage' : 'gate', dist, cell: i, hit: b === B_GATE ? s.gateAt[i] : -1 };
    x += DX[v.dir]; y += DY[v.dir]; dist++;
  }
  return { ok: true, dist };
}

export function freeBay(s) {
  for (let b = 0; b < s.bayCount; b++) if (s.bays[b] < 0) return b;
  return -1;
}

export function lotCount(s) {
  let n = 0;
  for (const v of s.vehicles) if (v.state === 'lot') n++;
  for (const g of s.garages) n += g.queue.length - g.made;
  return n;
}

export function tap(s, id) {
  const ev = [];
  if (s.status !== 'playing') return ev;
  const v = s.vehicles[id];
  if (!v || v.state !== 'lot') return ev;
  if (v.napping) { v.napping = false; ev.push({ t: 'wake', id }); return ev; }
  const p = probe(s, v);
  if (!p.ok) { ev.push({ t: 'blocked', id, kind: p.kind, dist: p.dist, hit: p.hit, cell: p.cell }); return ev; }
  const b = freeBay(s);
  if (b < 0) { ev.push({ t: 'nobay', id }); return ev; }
  leaveLot(s, v, b, ev, 'exit');
  settle(s, ev);
  return ev;
}

// Booster: pull any lot vehicle straight to a bay, ignoring what's in the way.
export function lift(s, id) {
  const ev = [];
  if (s.status !== 'playing') return ev;
  const v = s.vehicles[id];
  if (!v || v.state !== 'lot') return ev;
  const b = freeBay(s);
  if (b < 0) { ev.push({ t: 'nobay', id }); return ev; }
  v.napping = false;
  leaveLot(s, v, b, ev, 'lift');
  settle(s, ev);
  return ev;
}

// Booster: open the 6th bay. Can rescue a lost board.
export function addBay(s) {
  const ev = [];
  if (s.bayCount >= MAX_BAYS || s.status === 'won') return ev;
  s.bayCount = MAX_BAYS;
  if (s.status === 'lost') s.status = 'playing';
  ev.push({ t: 'bay', bay: MAX_BAYS - 1 });
  resolve(s, ev);
  return ev;
}

function leaveLot(s, v, b, ev, kind) {
  for (const c of v.cells) s.cells[c] = -1;
  v.state = 'bay'; v.bay = b; v.parkSeq = ++s.seq;
  s.bays[b] = v.id;
  s.exited++;
  const wasHidden = v.hidden;
  v.hidden = false;
  ev.push({ t: kind, id: v.id, bay: b, reveal: wasHidden });
}

// Open gates, run garages, reveal mystery vehicles, then board riders.
function settle(s, ev) {
  let changed = true;
  while (changed) {
    changed = false;
    s.gates.forEach((g, gi) => {
      if (!g.open && s.exited >= g.need) {
        g.open = true;
        for (const c of g.cells) { s.block[c] = B_NONE; s.gateAt[c] = -1; }
        ev.push({ t: 'gate', gate: gi });
        changed = true;
      }
    });
    s.garages.forEach((g, gi) => {
      if (g.made >= g.queue.length) return;
      for (const c of g.out) if (s.cells[c] >= 0 || s.block[c]) return;
      const q = g.queue[g.made];
      const len = TYPES[q.type].len;
      const front = g.out[g.span - 1];
      const v = addVehicle(s, { type: q.type, color: q.color, fx: front % s.W, fy: (front / s.W) | 0, dir: g.dir, hidden: q.hidden }, 'g' + gi + '.' + g.made);
      g.made++;
      ev.push({ t: 'spawn', id: v.id, garage: gi, len });
      changed = true;
    });
  }
  for (const v of s.vehicles) {
    if (v.state === 'lot' && v.hidden && probe(s, v).ok) { v.hidden = false; ev.push({ t: 'reveal', id: v.id }); }
  }
  resolve(s, ev);
}

// The vehicle the front unit would board: earliest parked of its color with room.
export function boardTarget(s, u) {
  let best = null;
  for (let b = 0; b < s.bayCount; b++) {
    const id = s.bays[b];
    if (id < 0) continue;
    const v = s.vehicles[id];
    if (v.color === u.c && v.cap - v.filled >= u.n && (!best || v.parkSeq < best.parkSeq)) best = v;
  }
  return best;
}

function resolve(s, ev) {
  if (s.status !== 'playing') return;
  for (;;) {
    if (s.lp >= s.line.length) { s.status = 'won'; ev.push({ t: 'win' }); return; }
    const u = s.line[s.lp];
    const v = boardTarget(s, u);
    if (v) {
      for (let k = 0; k < u.n; k++) {
        ev.push({ t: 'board', id: v.id, bay: v.bay, c: u.c, unit: s.lp, k, seat: v.filled });
        v.filled++;
      }
      s.lp++;
      if (v.filled >= v.cap) {
        s.bays[v.bay] = -1;
        v.state = 'gone';
        ev.push({ t: 'depart', id: v.id, bay: v.bay });
      }
      continue;
    }
    if (freeBay(s) < 0 || lotCount(s) === 0) { s.status = 'lost'; ev.push({ t: 'lose' }); }
    return;
  }
}

// Booster: reorder the next `m` units so riders who can board right now go
// first, finishing the fullest vehicles first. Seat totals never change.
export function sortLine(s, m = 16) {
  const ev = [];
  if (s.status === 'won') return ev;
  const end = Math.min(s.line.length, s.lp + m);
  const rem = s.line.slice(s.lp, end);
  const sim = [];
  for (let b = 0; b < s.bayCount; b++) {
    const id = s.bays[b];
    if (id >= 0) { const v = s.vehicles[id]; sim.push({ c: v.color, free: v.cap - v.filled, seq: v.parkSeq }); }
  }
  sim.sort((a, b) => a.seq - b.seq);
  const out = [];
  for (;;) {
    let bj = -1, bt = null, bScore = Infinity;
    rem.forEach((u, j) => {
      const t = sim.find((p) => p.c === u.c && p.free >= u.n);
      if (!t) return;
      const score = (t.free - u.n) * 100 + t.seq;
      if (score < bScore) { bScore = score; bj = j; bt = t; }
    });
    if (bj < 0) break;
    const u = rem.splice(bj, 1)[0];
    bt.free -= u.n;
    if (bt.free === 0) sim.splice(sim.indexOf(bt), 1);
    out.push(u);
  }
  out.push(...rem);
  s.line.splice(s.lp, end - s.lp, ...out);
  if (s.status === 'lost') s.status = 'playing';
  ev.push({ t: 'sort' });
  resolve(s, ev);
  return ev;
}

export function cloneState(s) {
  return {
    ...s,
    cells: s.cells.slice(),
    block: s.block.slice(),
    gateAt: s.gateAt.slice(),
    vehicles: s.vehicles.map((v) => ({ ...v })),
    gates: s.gates.map((g) => ({ ...g })),
    garages: s.garages.map((g) => ({ ...g })),
    line: s.line.slice(),
    bays: s.bays.slice(),
  };
}

// Index of the first rider of each unit, for drawing the line.
export function unitStarts(line) {
  const st = new Array(line.length + 1);
  let a = 0;
  for (let i = 0; i < line.length; i++) { st[i] = a; a += line[i].n; }
  st[line.length] = a;
  return st;
}

// Replay a solution (list of vehicle tags) through the engine.
export function replay(spec, solution) {
  const s = createGame(spec);
  for (const tag of solution) {
    const v = s.vehicles.find((x) => x.tag === tag);
    if (!v || v.state !== 'lot') return { ok: false, s, why: 'missing ' + tag };
    let ev = tap(s, v.id);
    if (ev.length && ev[0].t === 'wake') ev = tap(s, v.id);
    if (!ev.length || (ev[0].t !== 'exit')) return { ok: false, s, why: 'tap ' + tag + ' -> ' + (ev[0] && ev[0].t) };
    if (s.status === 'lost') return { ok: false, s, why: 'lost after ' + tag };
  }
  return { ok: s.status === 'won', s, why: s.status };
}
