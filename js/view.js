// The playfield: lays out the street, stop and lot, turns engine events into
// animation, and handles taps. The engine stays the source of truth.
import { TILT, ZK, ANGLES, vehicleSprite, commuterSprite, drawBadge, drawTree, drawBush, drawFlower, drawHedge, roundRectPath as rr, shade, clearSprites, symbolPath } from './render.js';
import { createGame, tap as engineTap, lift as engineLift, addBay, sortLine, unitStarts, DX, DY, TYPES, MAX_BAYS, BASE_BAYS } from './engine.js';
import { shuffleLot } from './solver.js';
import { makeRng, hashSeed } from './rng.js';
import { COLORS } from './config.js';

const DIR_ANG = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const STREAK_WINDOW = 2.2;

function buildPath(points, radius) {
  const P = [];
  for (const p of points) {
    const q = P[P.length - 1];
    if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 0.5) P.push({ x: p.x, y: p.y });
  }
  const pts = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], p = P[i], b = P[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, la / 2, lb / 2);
    const p1 = { x: p.x - ((p.x - a.x) / la) * r, y: p.y - ((p.y - a.y) / la) * r };
    const p2 = { x: p.x + ((b.x - p.x) / lb) * r, y: p.y + ((b.y - p.y) / lb) * r };
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push({
        x: (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * p.x + t * t * p2.x,
        y: (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * p.y + t * t * p2.y,
      });
    }
  }
  if (P.length > 1) pts.push(P[P.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, len: cum[cum.length - 1] };
}

function pathAt(path, d) {
  const { pts, cum } = path;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, ang: null };
  d = clamp(d, 0, path.len);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / seg;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), ang: Math.atan2((b.y - a.y) / TILT, b.x - a.x) };
}

function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class GameView {
  constructor(canvas, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.s = null;
    this.time = 0;
    this.paused = false;
    this.pick = null; // 'lift' while choosing a vehicle to lift
    this.parts = [];
    this.texts = [];
    this.ripples = [];
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
  }

  // ---------------------------------------------------------------- level --
  load(spec) {
    this.spec = spec;
    this.s = createGame(spec);
    this.ended = false;
    this.endTimer = 0;
    this.pick = null;
    this.parts.length = 0;
    this.texts.length = 0;
    this.hops = [];
    this.boardQ = [];
    this.hopClock = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.lastExit = -99;
    this.streakCoins = 0;
    this.moves = 0;
    this.startTime = this.time;
    this.shakeT = 0;
    this.bayRes = new Array(MAX_BAYS).fill(-1); // visual slot -> vehicle using it
    this.bayOpen = this.s.bayCount > BASE_BAYS ? 1 : 0;
    this.vis = new Map();
    for (const v of this.s.vehicles) this.vis.set(v.id, this.mkVis(v));
    this.rebuildRiders(true);
    this.layout();
  }

  rebuildRiders(all) {
    const s = this.s;
    this.starts = unitStarts(s.line);
    if (all) { this.riders = []; this.vf = 0; this.vfShow = 0; }
    const from = this.starts[s.lp];
    s.line.forEach((u, ui) => {
      if (ui < s.lp) return;
      for (let k = 0; k < u.n; k++) {
        const ci = this.starts[ui] + k;
        const old = this.riders[ci];
        this.riders[ci] = { c: u.c, look: hashSeed('r', ci, this.spec.n) % 997, group: u.n > 1 ? u.n : 0, gk: k, hop: old && ci >= from ? (old.c !== u.c ? 1 : 0) : 0 };
      }
    });
  }

  mkVis(v) {
    return {
      id: v.id, type: v.type, len: v.len, cap: v.cap, color: v.color, hidden: v.hidden, nap: v.napping,
      mode: 'lot', x: 0, y: 0, ang: DIR_ANG[v.dir], k: 1, bz: 0, bv: 0, shake: 0, landed: 0,
      bay: -1, hasSlot: false, path: null, pd: 0, speed: 0, depart: false, departT: 0, reveal: 0, zzz: Math.random() * 3,
    };
  }

  // ---------------------------------------------------------------- layout --
  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W; this.H = H; this.dpr = dpr;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(H * dpr);
    this.cv.style.width = W + 'px';
    this.cv.style.height = H + 'px';
    if (!this.s) return;
    const ins = this.hooks.insets();
    const colW = Math.min(W - ins.l - ins.r - 8, 560);
    const colX = (W - colW) / 2;
    const top = ins.t + ins.hud;
    const bottom = H - ins.b - ins.bar;
    const { W: gw, H: gh } = this.s;
    const cm = clamp(colW / 18, 15, 26);
    const rows = 3;
    const rowH = cm * 0.98;
    const lineH = rows * rowH + cm * 0.55;
    const slotW = colW / 6.3;
    const csW = colW / (gw + 1.9);
    // Parked vehicles are as big as the bay width allows, unless the lot
    // needs the height more.
    let bcs = clamp(slotW / 1.35, 22, 46), bayH = 0, cs = 0;
    for (let pass = 0; pass < 2; pass++) {
      bayH = 3 * bcs * TILT * 0.9 + bcs * 0.62;
      const avail = bottom - top - lineH - bayH - 6;
      const csH = avail / ((gh + 1.9) * TILT + 0.3);
      cs = clamp(Math.min(csW, csH), 12, 52);
      if (csH < csW && bcs > cs) bcs = Math.max(22, cs);
      else break;
    }
    const lane = cs * 0.95;
    const lotW = gw * cs, lotH = gh * cs * TILT;
    const stackH = lineH + bayH + lane * TILT * 2 + lotH;
    const y0 = top + Math.max(0, (bottom - top - stackH) * 0.45);
    const L = {
      W, H, colW, colX, cm, rows, rowH, bcs, slotW, bayH, cs, lane,
      lineTop: y0, lineBottom: y0 + lineH,
    };
    L.bayTop = L.lineBottom;
    L.streetTop = L.bayTop + bayH;
    L.streetY = L.streetTop + (lane * TILT) / 2;
    L.lotTop = L.streetTop + lane * TILT;
    L.lotLeft = colX + (colW - lotW) / 2;
    L.lotW = lotW; L.lotH = lotH;
    L.lotBottom = L.lotTop + lotH;
    L.bottomLaneY = L.lotBottom + (lane * TILT) / 2;
    L.leftLaneX = L.lotLeft - lane / 2;
    L.rightLaneX = L.lotLeft + lotW + lane / 2;
    L.bayCY = L.bayTop + bayH * 0.5;
    L.spriteS = Math.round(Math.max(cs, bcs) * dpr);
    // the line snakes along the sidewalk; front is at the bottom-left near the bays
    L.lineLeft = colX + cm * 1.25;
    L.lineRight = colX + colW - cm * 0.6;
    L.perRow = Math.max(6, Math.floor((L.lineRight - L.lineLeft) / (cm * 0.6)) + 1);
    L.rStep = (L.lineRight - L.lineLeft) / (L.perRow - 1);
    this.L = L;
    if (this.lastS !== L.spriteS || this.lastCm !== cm) { clearSprites(); this.lastS = L.spriteS; this.lastCm = cm; }
    for (const vv of this.vis.values()) this.placeVis(vv);
    this.buildBg();
  }

  bayX(b) { const L = this.L; return L.colX + L.colW / 2 + (b - (MAX_BAYS - 1) / 2) * L.slotW; }
  bayPos(b, len) {
    const L = this.L;
    // parked nose-up, front near the top of the bay
    const vlen = len * L.bcs * TILT;
    return { x: this.bayX(b), y: L.bayTop + L.bcs * 0.42 + vlen / 2 };
  }

  lotCenter(v) {
    const L = this.L;
    let sx = 0, sy = 0;
    for (const c of v.cells) { sx += c % this.s.W; sy += (c / this.s.W) | 0; }
    sx = sx / v.cells.length + 0.5; sy = sy / v.cells.length + 0.5;
    return { x: L.lotLeft + sx * L.cs, y: L.lotTop + sy * L.cs * TILT };
  }

  placeVis(vv) {
    const v = this.s.vehicles[vv.id];
    if (vv.mode === 'lot' || vv.mode === 'bump' || vv.mode === 'spawn') {
      const p = this.lotCenter(v);
      vv.x = p.x; vv.y = p.y; vv.k = 1; vv.ang = DIR_ANG[v.dir];
      if (vv.mode !== 'lot') vv.mode = 'lot';
    } else if (vv.mode === 'bay') {
      const p = this.bayPos(vv.bay, vv.len);
      vv.x = p.x; vv.y = p.y; vv.k = this.L.bcs / this.L.cs; vv.ang = -Math.PI / 2;
    } else if (vv.mode === 'drive' || vv.mode === 'fly') {
      // screen resized mid-drive: skip ahead
      if (vv.hasSlot) this.arrive(vv);
      else { vv.base = null; vv.path = null; vv.x = this.bayX(vv.bay); vv.y = this.L.streetY; vv.mode = 'drive'; this.startDrive(vv, vv.bay, false); }
    }
  }

  slotPos(f) {
    const L = this.L;
    const i0 = Math.floor(f), t = f - i0;
    const a = this.slotXY(i0), b = this.slotXY(i0 + 1);
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }

  slotXY(i) {
    const L = this.L;
    const r = Math.floor(i / L.perRow), c = i % L.perRow;
    const x = r % 2 === 0 ? L.lineLeft + c * L.rStep : L.lineRight - c * L.rStep;
    return { x, y: L.lineBottom - L.cm * 0.32 - r * L.rowH };
  }

  // ------------------------------------------------------------ background --
  buildBg() {
    const L = this.L, dpr = this.dpr, s = this.s;
    if (!this.bg) this.bg = document.createElement('canvas');
    const bg = this.bg;
    bg.width = this.cv.width; bg.height = this.cv.height;
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = makeRng(hashSeed('bg', this.spec.n));
    const { W, H, cs, lane } = L;
    // lawn with mowing stripes
    g.fillStyle = '#93d36c';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = -H; x < W; x += 56) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 28, 0); g.lineTo(x + 28 + H * 0.5, H); g.lineTo(x + H * 0.5, H); g.fill(); }
    for (let i = 0; i < W * H / 900; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(60,140,60,0.18)' : 'rgba(255,255,255,0.12)';
      g.fillRect(rng.next() * W, rng.next() * H, 2, 3);
    }
    const blocked = [];
    // sidewalk under the line
    const swTop = L.lineTop - L.cm * 0.4, swBot = L.bayTop;
    g.fillStyle = '#d8c8aa';
    g.fillRect(0, swTop - 4, W, swBot - swTop + 8);
    g.fillStyle = '#efe3cc';
    g.fillRect(0, swTop, W, swBot - swTop);
    g.strokeStyle = 'rgba(160,135,100,0.25)';
    g.lineWidth = 1;
    const tile = L.cm * 1.1;
    for (let x = (W / 2) % tile; x < W; x += tile) { g.beginPath(); g.moveTo(x, swTop); g.lineTo(x, swBot); g.stroke(); }
    for (let y = swTop + tile * TILT; y < swBot; y += tile * TILT) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    blocked.push([0, swTop - 10, W, swBot - swTop + 10]);
    // bay strip
    const bayBot = L.streetTop;
    g.fillStyle = '#5f6779';
    g.fillRect(0, L.bayTop, W, bayBot - L.bayTop);
    g.fillStyle = '#c9bea8';
    g.fillRect(0, L.bayTop, W, 4);
    for (let b = 0; b < MAX_BAYS; b++) {
      const x = this.bayX(b), w = L.slotW * 0.92;
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(x - w / 2, L.bayTop + 6, w, bayBot - L.bayTop - 8);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - w / 2, bayBot - 2); g.lineTo(x - w / 2, L.bayTop + 8); g.lineTo(x + w / 2, L.bayTop + 8); g.lineTo(x + w / 2, bayBot - 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = `800 ${L.bcs * 0.42}px ui-rounded, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(b + 1), x, bayBot - L.bcs * 0.35);
    }
    // street (top lane) across the whole screen, plus ring road around the lot
    const road = '#565e70';
    g.fillStyle = road;
    g.fillRect(0, L.streetTop, W, lane * TILT);
    g.fillRect(L.lotLeft - lane, L.streetTop, L.lotW + lane * 2, L.lotH + lane * TILT * 2);
    blocked.push([0, L.bayTop - 4, W, L.streetTop + lane * TILT - L.bayTop + 6]);
    blocked.push([L.lotLeft - lane - 6, L.streetTop, L.lotW + lane * 2 + 12, L.lotH + lane * TILT * 2 + 10]);
    // curbs
    g.fillStyle = '#d9d2c3';
    g.fillRect(0, L.streetTop + lane * TILT - 1, L.lotLeft - lane, 3);
    g.fillRect(L.lotLeft + L.lotW + lane, L.streetTop + lane * TILT - 1, W, 3);
    g.fillRect(L.lotLeft - lane - 3, L.streetTop + lane * TILT, 3, L.lotH + lane * TILT);
    g.fillRect(L.lotLeft + L.lotW + lane, L.streetTop + lane * TILT, 3, L.lotH + lane * TILT);
    g.fillRect(L.lotLeft - lane - 3, L.lotBottom + lane * TILT, L.lotW + lane * 2 + 6, 3);
    // dashed lane markings
    g.strokeStyle = 'rgba(255,248,225,0.7)';
    g.lineWidth = Math.max(1.5, cs * 0.06);
    g.setLineDash([cs * 0.4, cs * 0.35]);
    g.beginPath();
    g.moveTo(0, L.streetY); g.lineTo(L.leftLaneX, L.streetY);
    g.moveTo(L.rightLaneX, L.streetY); g.lineTo(W, L.streetY);
    g.moveTo(L.leftLaneX, L.streetY); g.lineTo(L.leftLaneX, L.bottomLaneY); g.lineTo(L.rightLaneX, L.bottomLaneY); g.lineTo(L.rightLaneX, L.streetY);
    g.lineTo(L.leftLaneX, L.streetY);
    g.stroke();
    g.setLineDash([]);
    // lot: asphalt with a painted shape
    g.fillStyle = '#687086';
    g.fillRect(L.lotLeft, L.lotTop, L.lotW, L.lotH);
    const cellX = (x) => L.lotLeft + x * cs, cellY = (y) => L.lotTop + y * cs * TILT;
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (!s.mask[y * s.W + x]) continue;
      g.fillStyle = (x + y) % 2 ? '#7a83a0' : '#7e87a4';
      g.fillRect(cellX(x), cellY(y), cs + 0.5, cs * TILT + 0.5);
    }
    // painted outline + parking ticks
    g.strokeStyle = 'rgba(245,248,255,0.85)';
    g.lineWidth = Math.max(1.5, cs * 0.07);
    g.beginPath();
    const m = (x, y) => x >= 0 && y >= 0 && x < s.W && y < s.H && s.mask[y * s.W + x];
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      if (!m(x, y)) continue;
      if (!m(x, y - 1)) { g.moveTo(cellX(x), cellY(y)); g.lineTo(cellX(x + 1), cellY(y)); }
      if (!m(x, y + 1)) { g.moveTo(cellX(x), cellY(y + 1)); g.lineTo(cellX(x + 1), cellY(y + 1)); }
      if (!m(x - 1, y)) { g.moveTo(cellX(x), cellY(y)); g.lineTo(cellX(x), cellY(y + 1)); }
      if (!m(x + 1, y)) { g.moveTo(cellX(x + 1), cellY(y)); g.lineTo(cellX(x + 1), cellY(y + 1)); }
    }
    g.stroke();
    g.fillStyle = 'rgba(245,248,255,0.28)';
    for (let y = 0; y <= s.H; y++) for (let x = 0; x <= s.W; x++) {
      if (m(x, y) || m(x - 1, y) || m(x, y - 1) || m(x - 1, y - 1)) g.fillRect(cellX(x) - 1, cellY(y) - 1, 2.5, 2.5);
    }
    // hedges
    const hedges = [...s.block].map((b, i) => (b === 1 ? i : -1)).filter((i) => i >= 0);
    for (const c of hedges) drawHedge(g, cellX(c % s.W), cellY((c / s.W) | 0), cs);
    // bus stop sign on the sidewalk
    {
      const sx = L.colX + L.cm * 0.55, sy = L.bayTop - 2;
      g.fillStyle = '#7d8696'; g.fillRect(sx - 1.5, sy - L.cm * 2.4, 3, L.cm * 2.4);
      g.beginPath(); g.arc(sx, sy - L.cm * 2.5, L.cm * 0.42, 0, Math.PI * 2);
      g.fillStyle = '#2f6fe4'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = `900 ${L.cm * 0.36}px ui-rounded, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('STOP', sx, sy - L.cm * 2.5);
    }
    // park: trees, bushes and flowers wherever there is lawn
    const free = (x, y, r) => x > -r && x < W + r && y > -r && y < H + r && !blocked.some(([bx, by, bw, bh]) => x + r > bx && x - r < bx + bw && y + r * 0.5 > by && y - r * 1.8 < by + bh);
    const items = [];
    const n = Math.floor((W * H) / 2600);
    for (let i = 0; i < n; i++) {
      const x = rng.next() * W, y = rng.next() * H;
      const kind = rng.next();
      const r = kind < 0.35 ? cs * rng.range(55, 85) / 100 + 6 : kind < 0.7 ? cs * 0.4 + 4 : 4;
      if (!free(x, y, r)) continue;
      if (items.some((it) => Math.hypot(it.x - x, (it.y - y) * 1.6) < (it.r + r) * 0.9)) continue;
      items.push({ x, y, r, kind });
    }
    items.sort((a, b) => a.y - b.y);
    const flowerCols = ['#ff7aa8', '#ffffff', '#ffd23a', '#c792ff'];
    for (const it of items) {
      if (it.kind < 0.35) drawTree(g, it.x, it.y, it.r, (it.x | 0) % 3);
      else if (it.kind < 0.7) drawBush(g, it.x, it.y, it.r, (it.y | 0) % 2);
      else drawFlower(g, it.x, it.y, it.r * 0.7, flowerCols[(it.x | 0) % 4]);
    }
  }

  // --------------------------------------------------------------- input --
  onDown(e) {
    if (!this.s || this.paused || this.ended) return;
    this.hooks.firstTouch && this.hooks.firstTouch();
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const vv = this.hit(x, y);
    this.ripples.push({ x, y, t: 0 });
    if (!vv) return;
    if (this.pick === 'lift') {
      this.pick = null;
      this.hooks.onPick && this.hooks.onPick(false);
      const ev = engineLift(this.s, vv.id);
      if (ev.length && ev[0].t === 'lift') this.hooks.onBoosterUsed('lift');
      this.apply(ev);
      return;
    }
    this.tapId(vv.id);
  }

  tapId(id) {
    this.moves++;
    this.apply(engineTap(this.s, id));
  }

  hit(x, y) {
    const L = this.L;
    let best = null, bd = Infinity;
    for (const vv of this.vis.values()) {
      if (vv.mode !== 'lot' && vv.mode !== 'bump' && vv.mode !== 'spawn') continue;
      const v = this.s.vehicles[vv.id];
      if (v.state !== 'lot') continue;
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (const c of v.cells) {
        const cx = c % this.s.W, cy = (c / this.s.W) | 0;
        minx = Math.min(minx, cx); maxx = Math.max(maxx, cx + 1); miny = Math.min(miny, cy); maxy = Math.max(maxy, cy + 1);
      }
      const x0 = L.lotLeft + minx * L.cs, x1 = L.lotLeft + maxx * L.cs;
      const y0 = L.lotTop + miny * L.cs * TILT - L.cs * 0.45, y1 = L.lotTop + maxy * L.cs * TILT;
      const pad = L.cs * 0.12;
      if (x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad) {
        // prefer the one whose center is nearest (handles overlap of raised roofs)
        const d = Math.hypot(x - (x0 + x1) / 2, (y - (y0 + y1) / 2) * 1.2);
        if (d < bd) { bd = d; best = vv; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------- events --
  apply(events) {
    const L = this.L, snd = this.hooks.sound, vib = this.hooks.vibrate;
    for (const e of events) {
      const vv = e.id != null ? this.vis.get(e.id) : null;
      switch (e.t) {
        case 'wake':
          vv.nap = false; vv.bv -= 260; snd.wake(); vib(15);
          this.text('!', vv.x, vv.y - L.cs * 0.6, '#ffd23a', L.cs * 0.8);
          break;
        case 'blocked': {
          snd.honk(); snd.bump(); vib(35);
          vv.mode = 'bump'; vv.bt = 0; vv.bdist = e.kind === 'lock' ? 0.12 : e.dist + 0.3; vv.bkind = e.kind; vv.bhit = e.hit;
          if (e.kind === 'lock') { vv.shake = 1; this.text('Locked!', vv.x, vv.y - L.cs * 0.7, '#ffe27a', L.cs * 0.5); }
          else this.text('HONK!', vv.x, vv.y - L.cs * 0.7, '#ffffff', L.cs * 0.5);
          this.streak = 0;
          break;
        }
        case 'nobay':
          snd.nope(); vv.shake = 0.6;
          this.text('No free bay', vv.x, vv.y - L.cs * 0.6, '#ffffff', L.cs * 0.45);
          break;
        case 'exit':
        case 'lift': {
          const v = this.s.vehicles[e.id];
          vv.color = v.color;
          if (vv.hidden) { vv.hidden = false; vv.reveal = 1; }
          vv.nap = false;
          vv.bay = e.bay;
          if (e.t === 'lift') { snd.booster(); this.startDrive(vv, e.bay, true); }
          else { snd.go(); this.startDrive(vv, e.bay, false); }
          vv.bv -= 180;
          this.puff(vv.x, vv.y, 6, 'rgba(255,255,255,0.8)');
          if (e.t === 'exit') this.bumpStreak(vv);
          break;
        }
        case 'reveal':
          vv.hidden = false; vv.reveal = 1; vv.color = this.s.vehicles[e.id].color;
          this.sparkle(vv.x, vv.y - L.cs * 0.3, COLORS[vv.color].hex);
          break;
        case 'gate': {
          const gt = this.s.gates[e.gate];
          gt.anim = 0;
          snd.gate();
          const c = gt.cells[0];
          this.sparkle(L.lotLeft + (c % this.s.W + 0.5) * L.cs, L.lotTop + (((c / this.s.W) | 0) + 0.5) * L.cs * TILT, '#ffd23a');
          break;
        }
        case 'spawn': {
          const v = this.s.vehicles[e.id];
          const nv = this.mkVis(v);
          const p = this.lotCenter(v);
          const g = this.s.garages[e.garage];
          nv.x = p.x; nv.y = p.y;
          nv.mode = 'spawn'; nv.st = 0;
          nv.sx = L.lotLeft + ((g.cell % this.s.W) + 0.5) * L.cs;
          nv.sy = L.lotTop + (((g.cell / this.s.W) | 0) + 0.5) * L.cs * TILT;
          nv.tx = p.x; nv.ty = p.y;
          this.vis.set(v.id, nv);
          snd.spawn();
          break;
        }
        case 'board': {
          const ci = this.starts[e.unit] + e.k;
          this.boardQ.push({ ci, id: e.id, unit: e.unit });
          break;
        }
        case 'depart':
          vv.depart = true;
          break;
        case 'bay':
          this.bayOpen = 1;
          this.sparkle(this.bayX(MAX_BAYS - 1), L.bayCY, '#ffffff');
          snd.booster();
          break;
        case 'sort':
          this.rebuildRiders(false);
          snd.booster();
          break;
        case 'win':
        case 'lose':
          break;
      }
    }
  }

  bumpStreak(vv) {
    const now = this.time;
    this.streak = now - this.lastExit < STREAK_WINDOW ? this.streak + 1 : 1;
    this.lastExit = now;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (this.streak >= 3) {
      this.hooks.sound.streak(this.streak);
      this.streakCoins++;
      this.hooks.onCoins(1, vv.x, vv.y);
    }
  }

  // Visual parking slots are separate from the engine's bay numbers: a bay the
  // engine has freed may still show a vehicle finishing boarding, so arrivals
  // take any slot that is visually empty (and wait on the street if none is).
  claimSlot(vv, prefer) {
    const open = this.s.bayCount;
    let b = prefer < open && this.bayRes[prefer] < 0 ? prefer : -1;
    if (b < 0) for (let i = 0; i < open; i++) if (this.bayRes[i] < 0) { b = i; break; }
    if (b < 0) return false;
    this.bayRes[b] = vv.id;
    vv.bay = b;
    vv.hasSlot = true;
    return true;
  }

  startDrive(vv, b, fly) {
    const L = this.L;
    if (!vv.hasSlot && !this.claimSlot(vv, b)) { vv.bay = b; vv.hasSlot = false; }
    vv.mode = fly ? 'fly' : 'drive';
    vv.speed = vv.speed || 0;
    vv.k0 = vv.k;
    if (fly) {
      vv.fx = vv.x; vv.fy = vv.y; vv.ft = 0;
      return;
    }
    const target = this.bayPos(vv.bay, vv.len);
    let pts, keep = 0;
    if (vv.base && vv.pd <= vv.baseLen) {
      // still inside the lot: same route, new final leg
      pts = vv.base.slice();
      keep = vv.pd;
    } else if (vv.base) {
      pts = [{ x: vv.x, y: L.streetY }];
    } else {
      const v = this.s.vehicles[vv.id];
      const d = v.dir;
      const side = target.x < L.lotLeft + L.lotW / 2 ? L.leftLaneX : L.rightLaneX;
      pts = [{ x: vv.x, y: vv.y }];
      if (d === 0) pts.push({ x: vv.x, y: L.streetY });
      else if (d === 1) { pts.push({ x: L.rightLaneX, y: vv.y }); pts.push({ x: L.rightLaneX, y: L.streetY }); }
      else if (d === 3) { pts.push({ x: L.leftLaneX, y: vv.y }); pts.push({ x: L.leftLaneX, y: L.streetY }); }
      else { pts.push({ x: vv.x, y: L.bottomLaneY }); pts.push({ x: side, y: L.bottomLaneY }); pts.push({ x: side, y: L.streetY }); }
      vv.base = pts.slice();
      vv.baseLen = buildPath(pts, L.cs * 0.75).len - L.cs;
    }
    pts.push({ x: target.x, y: L.streetY });
    pts.push({ x: target.x, y: target.y });
    vv.path = buildPath(pts, L.cs * 0.75);
    vv.holdAt = vv.path.len - Math.abs(target.y - L.streetY) - 2;
    vv.pd = keep;
  }

  // ---------------------------------------------------------- boosters --
  boost(kind) {
    const s = this.s;
    if (!s || this.ended) return false;
    if (kind === 'bay') {
      if (s.bayCount >= MAX_BAYS) return false;
      this.apply(addBay(s));
      this.ended = false;
      return true;
    }
    if (kind === 'sort') {
      if (s.lp >= s.line.length) return false;
      this.apply(sortLine(s));
      return true;
    }
    if (kind === 'shuffle') {
      if (s.status !== 'playing') return false;
      const before = s.vehicles.map((v) => v.color);
      if (!shuffleLot(s, makeRng((Math.random() * 1e9) | 0))) return false;
      for (const v of s.vehicles) {
        if (v.state === 'lot' && before[v.id] !== v.color) {
          const vv = this.vis.get(v.id);
          vv.color = v.color; vv.reveal = 1; vv.bv -= 200;
          if (!vv.hidden) this.sparkle(vv.x, vv.y - this.L.cs * 0.3, COLORS[v.color].hex);
        }
      }
      this.hooks.sound.booster();
      return true;
    }
    if (kind === 'lift') {
      if (s.status !== 'playing') return false;
      this.pick = this.pick === 'lift' ? null : 'lift';
      return this.pick === 'lift';
    }
    return false;
  }

  canBoost(kind) {
    const s = this.s;
    if (!s || this.ended && s.status !== 'lost') return false;
    if (kind === 'bay') return s.bayCount < MAX_BAYS && s.status !== 'won';
    if (kind === 'sort') return s.status !== 'won' && s.lp < s.line.length;
    if (kind === 'lift') return s.status === 'playing' && s.vehicles.some((v) => v.state === 'lot') && s.bays.slice(0, s.bayCount).some((x) => x < 0);
    if (kind === 'shuffle') return s.status === 'playing' && s.vehicles.filter((v) => v.state === 'lot').length > 1;
    return false;
  }

  // ------------------------------------------------------------ effects --
  text(str, x, y, color, size) { this.texts.push({ str, x, y, color, size: Math.max(11, size), t: 0, life: 1.1 }); }
  puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ kind: 'puff', x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 18 - 10, t: 0, life: 0.45, r: 3 + Math.random() * 4, color });
    }
  }
  sparkle(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 70, t: 0, life: 0.5, r: 2.5, color });
    }
  }
  confetti() {
    const cols = COLORS.map((c) => c.hex);
    for (let i = 0; i < 140; i++) {
      this.parts.push({
        kind: 'conf', x: Math.random() * this.W, y: -20 - Math.random() * this.H * 0.4,
        vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 160, t: 0, life: 3.2 + Math.random(),
        r: 4 + Math.random() * 4, color: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  // --------------------------------------------------------------- update --
  update(dt) {
    if (!this.s || this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const L = this.L, s = this.s, snd = this.hooks.sound;
    let busy = false;

    for (const vv of this.vis.values()) {
      // suspension spring
      vv.bv += (-vv.bz * 260 - vv.bv * 14) * dt;
      vv.bz += vv.bv * dt * 0.06;
      if (vv.shake > 0) vv.shake = Math.max(0, vv.shake - dt * 3);
      if (vv.reveal > 0) vv.reveal = Math.max(0, vv.reveal - dt * 2.5);
      const v = s.vehicles[vv.id];
      if (vv.mode === 'bump') {
        vv.bt += dt;
        const T = 0.34;
        const u = Math.min(1, vv.bt / T);
        const out = u < 0.45 ? ease(u / 0.45) : 1 - ease((u - 0.45) / 0.55);
        const p = this.lotCenter(v);
        const dd = vv.bdist * out;
        vv.x = p.x + DX[v.dir] * dd * L.cs;
        vv.y = p.y + DY[v.dir] * dd * L.cs * TILT;
        if (u >= 0.45 && !vv.hitDone) {
          vv.hitDone = true;
          if (vv.bkind === 'vehicle') { const o = this.vis.get(vv.bhit); if (o) { o.shake = 1; o.bv -= 120; } }
          if (vv.bkind === 'gate' && s.gates[vv.bhit]) s.gates[vv.bhit].wob = 1;
          this.shakeT = 0.12;
          this.puff(vv.x + DX[v.dir] * L.cs * 0.45, vv.y + DY[v.dir] * L.cs * 0.4, 4, 'rgba(255,255,255,0.7)');
        }
        if (u >= 1) { vv.mode = 'lot'; vv.hitDone = false; vv.x = p.x; vv.y = p.y; }
      } else if (vv.mode === 'spawn') {
        vv.st += dt / 0.4;
        const u = ease(Math.min(1, vv.st));
        vv.x = lerp(vv.sx, vv.tx, u); vv.y = lerp(vv.sy, vv.ty, u);
        if (vv.st >= 1) { vv.mode = 'lot'; vv.bv -= 150; }
      } else if (vv.mode === 'drive') {
        busy = true;
        const vmax = Math.max(L.cs, 22) * 15;
        vv.speed = Math.min(vmax, vv.speed + vmax * 3.5 * dt);
        let lim = vv.path.len;
        if (!vv.hasSlot) {
          if (this.claimSlot(vv, vv.bay)) this.startDrive(vv, vv.bay, false);
          else lim = Math.max(0, vv.holdAt);
        }
        vv.pd = Math.min(lim, vv.pd + vv.speed * dt);
        if (vv.pd >= lim && lim < vv.path.len) vv.speed = 0;
        const p = pathAt(vv.path, vv.pd);
        vv.x = p.x; vv.y = p.y;
        if (p.ang != null) vv.ang += angDiff(vv.ang, p.ang) * Math.min(1, dt * 18);
        const prog = vv.pd / vv.path.len;
        vv.k = lerp(vv.k0, L.bcs / L.cs, ease(clamp((prog - 0.4) / 0.6, 0, 1)));
        if (vv.pd >= vv.path.len - 0.01) this.arrive(vv);
      } else if (vv.mode === 'fly') {
        busy = true;
        if (!vv.hasSlot && !this.claimSlot(vv, vv.bay) && vv.ft > 0.6) { /* hover until a slot frees */ }
        else vv.ft = Math.min(1, vv.ft + dt / 0.8);
        const u = ease(vv.ft);
        const t = this.bayPos(vv.bay, vv.len);
        vv.x = lerp(vv.fx, t.x, u);
        vv.y = lerp(vv.fy, t.y, u);
        vv.lift = Math.sin(u * Math.PI) * L.cs * 1.6;
        vv.ang += angDiff(vv.ang, -Math.PI / 2) * Math.min(1, dt * 6);
        vv.k = lerp(vv.k0, L.bcs / L.cs, u);
        if (vv.ft >= 1) { vv.lift = 0; this.arrive(vv); }
      } else if (vv.mode === 'bay') {
        if (vv.depart && vv.landed >= vv.cap && !this.hops.some((h) => h.id === vv.id)) {
          vv.departT += dt;
          if (vv.departT > 0.28) this.leave(vv);
        }
      } else if (vv.mode === 'leave') {
        vv.lt += dt;
        const p0 = this.bayPos(vv.bay, vv.len);
        if (vv.lt < 0.32) {
          const u = ease(vv.lt / 0.32);
          vv.y = lerp(p0.y, L.streetY, u);
        } else {
          if (this.bayRes[vv.bay] === vv.id) this.bayRes[vv.bay] = -1;
          vv.speed = Math.min(L.cs * 18, (vv.speed || 0) + L.cs * 30 * dt);
          vv.x += vv.speed * dt;
          vv.y = L.streetY;
          vv.ang += angDiff(vv.ang, 0) * Math.min(1, dt * 10);
          if (vv.x > this.W + L.cs * 4) { vv.mode = 'gone'; }
        }
      }
    }

    // riders hop on board, one after another (groups together)
    this.hopClock -= dt;
    if (this.boardQ.length && this.hopClock <= 0) {
      const q = this.boardQ[0];
      const tv = this.vis.get(q.id);
      if (tv && tv.mode === 'bay') {
        const unit = q.unit;
        let k = 0;
        while (this.boardQ.length && this.boardQ[0].unit === unit) {
          const e = this.boardQ.shift();
          const from = this.slotPos(Math.max(0, e.ci - this.vfShow));
          const r = this.riders[e.ci];
          this.hops.push({ ci: e.ci, id: e.id, x0: from.x, y0: from.y, t: -k * 0.05, c: r.c, look: r.look });
          this.vf = e.ci + 1;
          k++;
        }
        this.hopClock = Math.max(0.035, 0.1 - this.boardQ.length * 0.003);
      }
    }
    for (const h of this.hops) {
      h.t += dt / 0.34;
      if (h.t >= 1 && !h.done) {
        h.done = true;
        const tv = this.vis.get(h.id);
        tv.landed++;
        tv.bv -= 90;
        snd.pop(tv.landed);
        this.puff(tv.x, tv.y - L.bcs * 0.4, 3, COLORS[tv.color].light);
        if (tv.landed >= tv.cap) { snd.depart(); this.text('Bye!', tv.x, tv.y - L.bcs * 1.2, '#ffffff', L.bcs * 0.5); this.wave(tv); }
      }
    }
    this.hops = this.hops.filter((h) => !h.done);
    this.vfShow += (this.vf - this.vfShow) * Math.min(1, dt * 7);
    if (Math.abs(this.vf - this.vfShow) < 0.01) this.vfShow = this.vf;
    for (const r of this.riders) if (r && r.hop > 0) r.hop = Math.max(0, r.hop - dt * 2);

    s.gates.forEach((g) => {
      if (g.anim != null && g.anim < 1) g.anim = Math.min(1, g.anim + dt * 2.5);
      if (g.wob) g.wob = Math.max(0, g.wob - dt * 3);
    });

    for (const p of this.parts) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'conf') { p.vy += 40 * dt; p.vx += Math.sin(p.t * 3 + p.r) * 20 * dt; p.rot += p.vr * dt; }
      else if (p.kind === 'wave') { p.vy -= 10 * dt; }
      else { p.vx *= 0.92; p.vy *= 0.92; }
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter((t) => t.t < t.life);
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 0.35);
    if (this.shakeT > 0) this.shakeT -= dt;

    // streak meter fades when you slow down
    this.streakLeft = this.streak >= 2 ? Math.max(0, 1 - (this.time - this.lastExit) / STREAK_WINDOW) : 0;
    if (this.streakLeft <= 0 && this.streak > 0 && this.time - this.lastExit > STREAK_WINDOW) this.streak = 0;

    // end of level once every animation has settled
    const animating = busy || this.hops.length || this.boardQ.length ||
      [...this.vis.values()].some((v) => v.mode === 'bump' || v.mode === 'spawn' || (v.mode === 'bay' && v.depart));
    if (!this.ended && s.status !== 'playing' && !animating) {
      this.endTimer += dt;
      if (s.status === 'won' && !this.confettiDone) { this.confettiDone = true; this.confetti(); snd.win(); this.hooks.vibrate([30, 40, 30, 40, 60]); }
      if (this.endTimer > (s.status === 'won' ? 1.0 : 0.5)) {
        this.ended = true;
        if (s.status === 'lost') { snd.lose(); this.hooks.vibrate(140); }
        this.hooks.onEnd(s.status === 'won', this);
      }
    } else if (s.status === 'playing') { this.endTimer = 0; this.confettiDone = false; }
  }

  wave(vv) {
    for (let i = 0; i < 3; i++) {
      this.parts.push({ kind: 'wave', x: vv.x + (i - 1) * this.L.bcs * 0.25, y: vv.y - this.L.bcs * 0.6, vx: (i - 1) * 6, vy: -25, t: -i * 0.08, life: 0.9, r: this.L.bcs * 0.2, color: '#ffe0c0' });
    }
  }

  arrive(vv) {
    const p = this.bayPos(vv.bay, vv.len);
    vv.mode = 'bay';
    vv.x = p.x; vv.y = p.y; vv.ang = -Math.PI / 2; vv.k = this.L.bcs / this.L.cs;
    vv.speed = 0;
    vv.bv -= 160;
  }

  leave(vv) {
    vv.mode = 'leave';
    vv.lt = 0;
    vv.speed = 0;
  }

  // ---------------------------------------------------------------- draw --
  draw() {
    const ctx = this.ctx, L = this.L, dpr = this.dpr;
    if (!this.s || !L) return;
    const s = this.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.bg, 0, 0, this.W, this.H);
    if (this.shakeT > 0) ctx.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3);

    // locked 6th bay
    if (!this.bayOpen) {
      const x = this.bayX(MAX_BAYS - 1), w = L.slotW * 0.92;
      ctx.fillStyle = 'rgba(40,44,58,0.55)';
      ctx.fillRect(x - w / 2, L.bayTop + 6, w, L.streetTop - L.bayTop - 8);
      ctx.strokeStyle = 'rgba(255,210,58,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let yy = L.bayTop + 12; yy < L.streetTop - 6; yy += 14) { ctx.moveTo(x - w / 2 + 3, yy); ctx.lineTo(x + w / 2 - 3, yy + 7); }
      ctx.stroke();
      this.padlock(ctx, x, L.bayCY, L.bcs * 0.32);
    }

    this.drawLine(ctx);

    // depth-sorted lot items: vehicles, gates, garages
    const items = [];
    for (const vv of this.vis.values()) if (vv.mode !== 'gone') items.push({ y: vv.y + (vv.mode === 'bay' || vv.mode === 'leave' ? -10000 : 0), vv });
    s.gates.forEach((g, gi) => { const c = g.cells[0]; items.push({ y: L.lotTop + (((c / s.W) | 0) + 0.5) * L.cs * TILT, gate: gi }); });
    s.garages.forEach((g, gi) => { items.push({ y: L.lotTop + (((g.cell / s.W) | 0) + 0.5) * L.cs * TILT, garage: gi }); });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.vv) this.drawVehicle(ctx, it.vv);
      else if (it.gate != null) this.drawGate(ctx, it.gate);
      else this.drawGarage(ctx, it.garage);
    }
    // seat counters on parked vehicles
    for (const vv of this.vis.values()) {
      if (vv.mode !== 'bay' && !(vv.mode === 'drive' && vv.pd > vv.path.len * 0.8)) continue;
      this.seatPill(ctx, vv);
    }
    // hops in flight
    const H = Math.round(L.cm * this.dpr);
    for (const h of this.hops) {
      if (h.t < 0) continue;
      const tv = this.vis.get(h.id);
      const u = ease(Math.min(1, h.t));
      const tx = tv.x, ty = tv.y - L.bcs * 0.3;
      const x = lerp(h.x0, tx, u), y = lerp(h.y0, ty, u) - Math.sin(u * Math.PI) * L.cm * 1.3;
      const sc = 1 - u * 0.45;
      const sp = commuterSprite(h.c, h.look, H, this.hooks.symbols(), false);
      const w = (sp.cv.width / dpr) * sc, hh = (sp.cv.height / dpr) * sc;
      ctx.drawImage(sp.cv, x - (sp.ox / dpr) * sc, y - (sp.oy / dpr) * sc, w, hh);
    }
    // particles
    for (const p of this.parts) {
      if (p.t < 0) continue;
      const a = 1 - p.t / p.life;
      if (p.kind === 'conf') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, a * 2);
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      } else if (p.kind === 'wave') {
        ctx.globalAlpha = a;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.t * 18) * 0.5);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(-p.r * 0.5, -p.r * 0.9, p.r * 0.22, p.r * 0.6);
        ctx.fillRect(-p.r * 0.2, -p.r * 1.05, p.r * 0.22, p.r * 0.7);
        ctx.fillRect(p.r * 0.1, -p.r * 1.0, p.r * 0.22, p.r * 0.65);
        ctx.restore();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.kind === 'puff' ? 1 + p.t * 2 : 1), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const r of this.ripples) {
      ctx.globalAlpha = 1 - r.t / 0.35;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 6 + r.t * 70, (6 + r.t * 70) * TILT, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = 1 - Math.max(0, t.t - t.life * 0.6) / (t.life * 0.4);
      ctx.globalAlpha = a;
      ctx.font = `900 ${t.size}px ui-rounded, system-ui, sans-serif`;
      const y = t.y - t.t * 26 - (t.t < 0.15 ? (0.15 - t.t) * 40 : 0);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(30,35,55,0.75)'; ctx.strokeText(t.str, t.x, y);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, y);
    }
    ctx.globalAlpha = 1;
    if (this.pick === 'lift') {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(L.lotLeft, L.lotTop, L.lotW, L.lotH);
      ctx.font = `900 ${Math.max(14, L.cs * 0.5)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(30,35,55,0.8)'; ctx.lineWidth = 4;
      const ty = L.lotTop - L.lane * TILT * 0.5 + Math.sin(this.time * 5) * 2;
      ctx.strokeText('Tap any vehicle to lift it', L.colX + L.colW / 2, ty);
      ctx.fillText('Tap any vehicle to lift it', L.colX + L.colW / 2, ty);
    }
  }

  drawLine(ctx) {
    const L = this.L, s = this.s, dpr = this.dpr;
    const H = Math.round(L.cm * dpr);
    const cap = L.rows * L.perRow;
    const total = this.riders.length;
    const sym = this.hooks.symbols();
    const first = this.vf;
    const last = Math.min(total, first + cap + 1);
    for (let i = last - 1; i >= first; i--) {
      const r = this.riders[i];
      if (!r) continue;
      const f = i - this.vfShow;
      if (f > cap - 1) continue;
      const p = this.slotPos(Math.max(0, f));
      const moving = Math.abs(this.vf - this.vfShow) > 0.02;
      const bob = moving ? Math.abs(Math.sin(this.time * 14 + i)) * L.cm * 0.12 : Math.sin(this.time * 2 + i * 0.7) * L.cm * 0.02;
      const hop = r.hop ? Math.sin(r.hop * Math.PI) * L.cm * 0.5 : 0;
      const hidden = s.visible && i - first >= s.visible;
      const sp = commuterSprite(r.c, r.look, H, sym, hidden);
      ctx.drawImage(sp.cv, p.x - sp.ox / dpr, p.y - sp.oy / dpr - bob - hop, sp.cv.width / dpr, sp.cv.height / dpr);
      if (r.group && r.gk < r.group - 1 && i + 1 < last) {
        const q = this.slotPos(Math.max(0, f + 1));
        ctx.strokeStyle = '#ffe3c4'; ctx.lineWidth = Math.max(2, L.cm * 0.12); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y - L.cm * 0.36 - bob); ctx.lineTo(q.x, q.y - L.cm * 0.36); ctx.stroke();
      }
    }
    const more = total - first - cap;
    if (more > 0) {
      const p = this.slotPos(cap - 1);
      ctx.font = `900 ${L.cm * 0.55}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(40,45,60,0.8)';
      ctx.beginPath(); rr(ctx, p.x - L.cm * 0.95, p.y - L.cm * 1.25, L.cm * 1.9, L.cm * 0.75, L.cm * 0.37); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('+' + more, p.x, p.y - L.cm * 0.87);
    }
  }

  drawVehicle(ctx, vv) {
    const L = this.L, dpr = this.dpr;
    const n = Math.round((((vv.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * ANGLES) % ANGLES;
    const sp = vehicleSprite(vv.type, vv.color, vv.hidden, n, L.spriteS, this.hooks.symbols());
    const sc = (vv.k * L.cs) / (L.spriteS / dpr);
    let x = vv.x, y = vv.y - Math.max(0, vv.bz) * 0.6 + Math.min(0, vv.bz) * 0.3 - (vv.lift || 0);
    if (vv.shake > 0) x += Math.sin(this.time * 70) * vv.shake * L.cs * 0.08;
    const w = (sp.cv.width / dpr) * sc, h = (sp.cv.height / dpr) * sc;
    const squash = 1 + clamp(-vv.bz * 0.004, -0.08, 0.08);
    if (vv.lift) {
      ctx.fillStyle = 'rgba(20,30,40,0.18)';
      ctx.beginPath(); ctx.ellipse(vv.x, vv.y, L.cs * 0.5 * vv.k * vv.len, L.cs * 0.3 * vv.k, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (this.pick === 'lift' && (vv.mode === 'lot')) {
      ctx.fillStyle = `rgba(255,240,150,${0.35 + Math.sin(this.time * 6) * 0.15})`;
      ctx.beginPath(); ctx.ellipse(x, y, L.cs * 0.55 * vv.len, L.cs * 0.42 * (vv.len > 1 ? 1.2 : 1), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);
    ctx.drawImage(sp.cv, -(sp.ox / dpr) * sc, -(sp.oy / dpr) * sc, w, h);
    if (vv.reveal > 0) {
      ctx.globalAlpha = vv.reveal;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, -L.cs * 0.2 * vv.k, L.cs * 0.5 * vv.k * vv.len, L.cs * 0.38 * vv.k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    const v = this.s.vehicles[vv.id];
    const topY = y - (sp.top / dpr) * sc - L.cs * 0.12;
    if (vv.nap && vv.mode === 'lot') {
      ctx.font = `900 ${L.cs * 0.34}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        const t = (this.time * 0.6 + vv.zzz + i / 3) % 1;
        ctx.globalAlpha = Math.sin(t * Math.PI);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(40,50,90,0.7)'; ctx.lineWidth = 3;
        const zx = x + L.cs * (0.1 + t * 0.35), zy = topY - t * L.cs * 0.7;
        ctx.strokeText('z', zx, zy); ctx.fillText('z', zx, zy);
      }
      ctx.globalAlpha = 1;
    }
    if (vv.mode === 'lot' || vv.mode === 'bump') {
      if (v.lock >= 0 && this.s.vehicles[v.lock].state === 'lot') this.padlock(ctx, x - L.cs * 0.25, topY, L.cs * 0.2, this.pairLetter(v.lock));
      if (v.key && this.s.vehicles.some((w) => w.lock === v.id && w.state === 'lot')) this.keyIcon(ctx, x + L.cs * 0.2, topY, L.cs * 0.2, this.pairLetter(v.id));
    }
  }

  pairLetter(keyId) {
    const keys = this.s.vehicles.filter((v) => v.key).map((v) => v.id);
    return 'ABCDEFG'[keys.indexOf(keyId)] || '';
  }

  padlock(ctx, x, y, r, label) {
    ctx.lineWidth = r * 0.35; ctx.strokeStyle = '#c99a14';
    ctx.beginPath(); ctx.arc(x, y - r * 0.45, r * 0.55, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); rr(ctx, x - r * 0.85, y - r * 0.45, r * 1.7, r * 1.35, r * 0.3); ctx.fill();
    ctx.strokeStyle = 'rgba(80,60,10,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (label) {
      ctx.fillStyle = '#5a4200'; ctx.font = `900 ${r * 1.05}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + r * 0.22);
    }
  }

  keyIcon(ctx, x, y, r, label) {
    ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = 'rgba(80,60,10,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x - r * 0.4, y, r * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillRect(x, y - r * 0.18, r * 1.2, r * 0.36);
    ctx.fillRect(x + r * 0.8, y, r * 0.22, r * 0.45);
    if (label) {
      ctx.fillStyle = '#5a4200'; ctx.font = `900 ${r * 0.8}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x - r * 0.4, y + r * 0.05);
    }
  }

  seatPill(ctx, vv) {
    const L = this.L;
    const x = vv.x, y = L.streetTop - L.bcs * 0.05;
    const w = L.slotW * 0.86, h = L.bcs * 0.5;
    const full = vv.landed >= vv.cap;
    ctx.fillStyle = full ? '#3fc46a' : 'rgba(25,30,45,0.85)';
    ctx.beginPath(); rr(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    const c = COLORS[vv.color];
    ctx.beginPath(); ctx.arc(x - w / 2 + h / 2, y, h * 0.36, 0, Math.PI * 2); ctx.fillStyle = c.hex; ctx.fill();
    if (this.hooks.symbols()) { symbolPath(ctx, c.sym, x - w / 2 + h / 2, y, h * 0.22); ctx.fillStyle = '#fff'; ctx.fill(); }
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${h * 0.62}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${vv.landed}/${vv.cap}`, x + h * 0.32, y + 1);
  }

  drawGate(ctx, gi) {
    const L = this.L, s = this.s, g = s.gates[gi];
    const c = g.cells[0];
    const x0 = L.lotLeft + (c % s.W) * L.cs, y0 = L.lotTop + ((c / s.W) | 0) * L.cs * TILT;
    const cs = L.cs, h = cs * TILT;
    const open = g.open ? ease(g.anim == null ? 1 : g.anim) : 0;
    // base posts
    ctx.fillStyle = '#ccd3de';
    ctx.fillRect(x0 + cs * 0.06, y0 + h * 0.25 - cs * 0.3, cs * 0.14, cs * 0.3 + h * 0.4);
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath(); rr(ctx, x0 + cs * 0.02, y0 + h * 0.18 - cs * 0.34, cs * 0.22, cs * 0.22, 3); ctx.fill();
    // striped boom: across the cell, swings up when open
    const wob = (g.wob || 0) * Math.sin(this.time * 50) * 0.08;
    ctx.save();
    ctx.translate(x0 + cs * 0.13, y0 + h * 0.18 - cs * 0.24);
    ctx.rotate(-open * Math.PI * 0.45 + wob);
    const len = cs * 0.92;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ef4b4b';
      ctx.fillRect((len / 5) * i, -cs * 0.06, len / 5 + 0.5, cs * 0.12);
    }
    ctx.restore();
    if (!g.open) {
      const left = g.need - s.exited;
      const bx = x0 + cs * 0.62, by = y0 + h * 0.5;
      ctx.fillStyle = '#2f6fe4';
      ctx.beginPath(); ctx.arc(bx, by, cs * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `900 ${cs * 0.28}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(left), bx, by + 1);
    }
  }

  drawGarage(ctx, gi) {
    const L = this.L, s = this.s, g = s.garages[gi];
    const x0 = L.lotLeft + (g.cell % s.W) * L.cs, y0 = L.lotTop + ((g.cell / s.W) | 0) * L.cs * TILT;
    const cs = L.cs, h = cs * TILT, hz = cs * 0.45 * ZK;
    ctx.fillStyle = '#b5644a';
    ctx.beginPath(); rr(ctx, x0 + 2, y0 + 2 - hz + h * 0.2, cs - 4, h - 4 + hz * 0.6, 4); ctx.fill();
    ctx.fillStyle = '#f2e3c6';
    ctx.beginPath(); rr(ctx, x0 + 3, y0 + 3 - hz, cs - 6, h - 6, 5); ctx.fill();
    ctx.fillStyle = '#d9534f';
    ctx.beginPath(); ctx.moveTo(x0 + 1, y0 - hz + 4); ctx.lineTo(x0 + cs / 2, y0 - hz - cs * 0.22); ctx.lineTo(x0 + cs - 1, y0 - hz + 4); ctx.closePath(); ctx.fill();
    // door faces the driveway direction
    const dx = DX[g.dir], dy = DY[g.dir];
    ctx.fillStyle = '#5b6474';
    const cx = x0 + cs / 2 + dx * cs * 0.28, cy = y0 - hz + h / 2 + dy * h * 0.28;
    ctx.beginPath(); rr(ctx, cx - cs * 0.18, cy - cs * 0.12, cs * 0.36, cs * 0.24, 3); ctx.fill();
    const left = g.queue.length - g.made;
    ctx.fillStyle = left ? '#2f6fe4' : '#8a93a3';
    ctx.beginPath(); ctx.arc(x0 + cs * 0.82, y0 - hz - cs * 0.02, cs * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${cs * 0.24}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(left), x0 + cs * 0.82, y0 - hz - cs * 0.01);
  }
}
