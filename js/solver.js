// Search solver (proves a state is winnable), a casual-player bot used for
// balancing, and the Shuffle booster, which re-colors only into winnable lots.
import { makeRng } from './rng.js';
import { cloneState, probe, tap, freeBay, DX, DY } from './engine.js';

// How many riders ahead the first unmet demand for each color is.
export function colorNeeds(s, look = Infinity) {
  const free = new Map();
  for (let b = 0; b < s.bayCount; b++) {
    const id = s.bays[b];
    if (id < 0) continue;
    const v = s.vehicles[id];
    free.set(v.color, (free.get(v.color) || 0) + v.cap - v.filled);
  }
  const need = new Map();
  let ahead = 0;
  for (let i = s.lp; i < s.line.length && ahead < look; i++) {
    const u = s.line[i];
    const f = free.get(u.c) || 0;
    if (f >= u.n) free.set(u.c, f - u.n);
    else if (!need.has(u.c)) need.set(u.c, ahead);
    ahead += u.n;
  }
  return need;
}

export function freeVehicles(s) {
  const out = [];
  for (const v of s.vehicles) if (v.state === 'lot' && probe(s, v).ok) out.push(v);
  return out;
}

function drive(s, id) {
  let ev = tap(s, id);
  if (ev.length && ev[0].t === 'wake') ev = tap(s, id);
  return ev;
}

function stateKey(s) {
  let k = s.lp + '|' + s.bayCount + '|';
  for (let b = 0; b < s.bayCount; b++) {
    const id = s.bays[b];
    k += id < 0 ? '-,' : id + '.' + s.vehicles[id].filled + ',';
  }
  for (const v of s.vehicles) k += v.state === 'lot' ? '1' : '0';
  return k;
}

// Everything that has to leave before v can drive out (blockers, their
// blockers, key holders). `wide` is set when a gate or garage is involved.
export function digSet(s, v) {
  const set = new Set();
  const stack = [v];
  let wide = false;
  while (stack.length) {
    const x = stack.pop();
    if (x.lock >= 0 && s.vehicles[x.lock].state === 'lot' && !set.has(x.lock)) {
      set.add(x.lock); stack.push(s.vehicles[x.lock]);
    }
    let cx = x.fx + DX[x.dir], cy = x.fy + DY[x.dir];
    while (cx >= 0 && cy >= 0 && cx < s.W && cy < s.H) {
      const i = cy * s.W + cx;
      const id = s.cells[i];
      if (id >= 0 && id !== v.id && !set.has(id)) { set.add(id); stack.push(s.vehicles[id]); }
      if (s.block[i]) wide = true;
      cx += DX[x.dir]; cy += DY[x.dir];
    }
  }
  return { set, wide };
}

// Moves worth trying: free vehicles that help bring the front color out,
// scored by how cheap and how well-timed that dig is (lower is better).
// Returns null when no vehicle of that color can be reached with the bays left.
function usefulMoves(s, free, need) {
  const u = s.line[s.lp];
  const bays = s.bayCount - s.bays.slice(0, s.bayCount).filter((x) => x >= 0).length;
  const useful = new Map();
  let wide = false;
  for (const g of s.garages) if (g.made < g.queue.length) wide = true;
  const late = (x) => (need.has(x.color) ? need.get(x.color) : 99);
  for (const v of s.vehicles) {
    if (v.state !== 'lot' || v.color !== u.c || v.cap < u.n) continue;
    const d = digSet(s, v);
    if (d.wide) wide = true;
    if (d.set.size + 1 > bays && !d.wide) continue;
    let score = d.set.size * 12;
    for (const id of d.set) score += Math.min(late(s.vehicles[id]), 60) * 0.4;
    // Big vehicles for a color that keeps coming, small ones otherwise.
    score += Math.abs(v.cap - 6) * 0.2;
    const put = (id) => { if (!useful.has(id) || useful.get(id) > score) useful.set(id, score); };
    put(v.id);
    for (const id of d.set) put(id);
  }
  if (!useful.size && !wide) return null;
  const out = free.filter((v) => useful.has(v.id)).map((v) => ({ v, score: useful.get(v.id) }));
  if (wide) {
    for (const v of free) if (!useful.has(v.id)) out.push({ v, score: 500 + late(v) });
  }
  return out;
}

function blockingSet(s) {
  const out = new Set();
  for (const w of s.vehicles) {
    if (w.state !== 'lot') continue;
    let x = w.fx + DX[w.dir], y = w.fy + DY[w.dir];
    while (x >= 0 && y >= 0 && x < s.W && y < s.H) {
      const id = s.cells[y * s.W + x];
      if (id >= 0) out.add(id);
      x += DX[w.dir]; y += DY[w.dir];
    }
  }
  return out;
}

// One randomized greedy playthrough. Returns the move list if it wins.
function dive(s0, rng, noise) {
  const s = cloneState(s0);
  const path = [];
  let guard = 0;
  while (s.status === 'playing' && guard++ < 1000) {
    const need = colorNeeds(s);
    const um = usefulMoves(s, freeVehicles(s), need);
    if (!um || !um.length) return null;
    let best = null, bs = Infinity;
    for (const m of um) {
      const sc = m.score + rng.next() * noise;
      if (sc < bs) { bs = sc; best = m.v; }
    }
    path.push(best.tag);
    drive(s, best.id);
  }
  return s.status === 'won' ? path : null;
}

// Depth-first search with a node budget. Returns list of tags, or null if no
// win exists ({budget: true} if it ran out of nodes first).
export function solve(s0, budget = 20000, dives = 40) {
  const rng = makeRng(12345);
  for (let i = 0; i < dives; i++) {
    const p = dive(s0, rng, i === 0 ? 0 : 2 + i * 1.5);
    if (p) return p;
  }
  const seen = new Set();
  const path = [];
  let nodes = 0, out = false;
  function dfs(s) {
    if (s.status === 'won') return true;
    if (s.status === 'lost') return false;
    if (++nodes > budget) { out = true; return false; }
    const k = stateKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    if (freeBay(s) < 0) return false;
    const um = usefulMoves(s, freeVehicles(s), colorNeeds(s));
    if (!um) return false;
    const moves = um.sort((a, b) => a.score - b.score || b.v.cap - a.v.cap);
    // Free vehicles that block nothing are interchangeable with their twins.
    const blockers = blockingSet(s);
    const tried = new Set();
    for (const { v } of moves) {
      if (!blockers.has(v.id) && !v.key) {
        const sig = v.color + ':' + v.type;
        if (tried.has(sig)) continue;
        tried.add(sig);
      }
      const t = cloneState(s);
      const ev = drive(t, v.id);
      if (!ev.length || ev[0].t !== 'exit') continue;
      path.push(v.tag);
      if (dfs(t)) return true;
      path.pop();
      if (out) return false;
    }
    return false;
  }
  const ok = dfs(cloneState(s0));
  if (ok) return path.slice();
  return out ? { budget: true } : null;
}

// A simple player. Sends a vehicle the front rider can board if one is free.
// Otherwise a thoughtful player (chance = skill) digs toward the nearest vehicle
// of the front color, and a hasty one sends whatever color looks needed soon.
export function botPlay(s, rng, skill = 0.5) {
  let guard = 0;
  while (s.status === 'playing' && guard++ < 2000) {
    const v = botMove(s, rng, skill);
    if (!v) break;
    drive(s, v.id);
  }
  return s.status === 'won';
}

// The bot's next choice (a free vehicle), or null if nothing can move.
export function botMove(s, rng, skill = 0.5) {
  const look = 6 + Math.round(skill * 24);
  {
    const visible = s.visible ? Math.min(look, s.visible) : look;
    const need = colorNeeds(s, visible);
    const free = freeVehicles(s);
    if (!free.length) return null;
    const u = s.line[s.lp];
    const bays = s.bayCount - s.bays.slice(0, s.bayCount).filter((x) => x >= 0).length;
    let choice = null;
    const direct = free.filter((v) => !v.hidden && v.color === u.c && v.cap >= u.n);
    if (direct.length && rng.chance(0.7 + 0.3 * skill)) choice = rng.pick(direct);
    else if (rng.chance(0.15 * (1 - skill))) choice = rng.pick(free);
    else if (rng.chance(skill)) {
      let best = null, bs = Infinity;
      for (const t of s.vehicles) {
        if (t.state !== 'lot' || t.hidden || t.color !== u.c || t.cap < u.n) continue;
        const d = digSet(s, t);
        if (d.set.size + 1 > bays) continue;
        let sc = d.set.size * 10 + rng.next() * 6;
        for (const id of d.set) { const w = s.vehicles[id]; sc += w.hidden ? 8 : Math.min(need.has(w.color) ? need.get(w.color) : 30, 30) * 0.3; }
        if (sc < bs) {
          const opts = free.filter((f) => f.id === t.id || d.set.has(f.id));
          if (opts.length) { bs = sc; best = opts.sort((a, b) => (need.get(a.color) ?? 99) - (need.get(b.color) ?? 99))[0]; }
        }
      }
      choice = best;
    }
    if (!choice) {
      const scored = free.map((v) => ({ v, sc: (v.hidden ? 25 : need.has(v.color) ? need.get(v.color) : 60) + rng.next() * (8 * (1 - skill) + 1) }));
      scored.sort((a, b) => a.sc - b.sc);
      choice = scored[0].v;
    }
    return choice;
  }
}

// Shuffle booster: swap colors among same-sized lot vehicles until a solver
// confirms the result can still be won. Returns true if colors changed.
export function shuffleLot(s, rng, tries = 30) {
  const lot = s.vehicles.filter((v) => v.state === 'lot');
  if (lot.length < 2) return false;
  const groups = {};
  for (const v of lot) (groups[v.type] = groups[v.type] || []).push(v);
  for (let t = 0; t < tries; t++) {
    const colors = new Map();
    let changed = false;
    for (const g of Object.values(groups)) {
      const cs = rng.shuffle(g.map((v) => v.color));
      g.forEach((v, i) => { colors.set(v.id, cs[i]); if (cs[i] !== v.color) changed = true; });
    }
    if (!changed) continue;
    const trial = cloneState(s);
    for (const [id, c] of colors) trial.vehicles[id].color = c;
    const sol = solve(trial, 4000);
    if (Array.isArray(sol)) {
      for (const [id, c] of colors) s.vehicles[id].color = c;
      return true;
    }
  }
  return false;
}
