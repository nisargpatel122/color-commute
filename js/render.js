// All art is drawn in code: chunky toy vehicles, round-headed commuters,
// roads, lot, park. Sprites are cached per size/angle so frames stay cheap.
import { COLORS } from './config.js';
import { TYPES } from './engine.js';

export const TILT = 0.8;   // ground is squashed vertically: tilted top-down view
export const ZK = 0.8;     // how much height lifts things up the screen
export const ANGLES = 48;  // cached headings per vehicle

const GRAY = { hex: '#a3acb8', dark: '#6f7988', light: '#d0d6de' };

// --- symbols (one per color, for colorblind play) ---------------------------
export function symbolPath(ctx, sym, x, y, r) {
  ctx.beginPath();
  switch (sym) {
    case 'heart': {
      const s = r * 1.05;
      ctx.moveTo(x, y + s * 0.85);
      ctx.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.75, y - s * 1.05, x, y - s * 0.4);
      ctx.bezierCurveTo(x + s * 0.75, y - s * 1.05, x + s * 1.25, y + s * 0.05, x, y + s * 0.85);
      break;
    }
    case 'triangle':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.72); ctx.lineTo(x - r * 0.95, y + r * 0.72); ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r * 1.05;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
      break;
    case 'circle':
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y); ctx.closePath();
      break;
    case 'cross': {
      const t = r * 0.36;
      ctx.moveTo(x - t, y - r); ctx.lineTo(x + t, y - r); ctx.lineTo(x + t, y - t); ctx.lineTo(x + r, y - t);
      ctx.lineTo(x + r, y + t); ctx.lineTo(x + t, y + t); ctx.lineTo(x + t, y + r); ctx.lineTo(x - t, y + r);
      ctx.lineTo(x - t, y + t); ctx.lineTo(x - r, y + t); ctx.lineTo(x - r, y - t); ctx.lineTo(x - t, y - t); ctx.closePath();
      break;
    }
    case 'moon':
      ctx.arc(x, y, r * 0.9, Math.PI * 0.32, Math.PI * 1.68, false);
      ctx.arc(x + r * 0.42, y, r * 0.7, Math.PI * 1.55, Math.PI * 0.45, true);
      ctx.closePath();
      break;
    case 'q':
      break;
  }
}

export function drawBadge(ctx, x, y, r, color, hidden) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf6';
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = 'rgba(30,35,50,0.55)';
  ctx.stroke();
  if (hidden) {
    ctx.fillStyle = '#5b6474';
    ctx.font = `900 ${r * 1.5}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y + r * 0.08);
    return;
  }
  const c = COLORS[color];
  symbolPath(ctx, c.sym, x, y, r * 0.62);
  ctx.fillStyle = c.dark;
  ctx.fill();
}

// --- geometry helpers --------------------------------------------------------
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { rr as roundRectPath };

// Rounded rectangle lying on the ground (rotated by heading), lifted by z.
function groundRect(ctx, cx, cy, ang, along, l, w, r, z, side = 0) {
  ctx.save();
  ctx.translate(cx, cy - z * ZK);
  ctx.scale(1, TILT);
  ctx.rotate(ang);
  ctx.beginPath();
  rr(ctx, along - l / 2, side - w / 2, l, w, r);
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export { shade };

// --- vehicle sprites ----------------------------------------------------------
const vCache = new Map();
export function clearSprites() { vCache.clear(); cCache.clear(); }

export function vehicleSprite(type, color, hidden, angIdx, S, symbols) {
  const key = `${type}|${color}|${hidden ? 1 : 0}|${angIdx}|${S}|${symbols ? 1 : 0}`;
  let sp = vCache.get(key);
  if (sp) return sp;
  const len = TYPES[type].len;
  const ang = (angIdx / ANGLES) * Math.PI * 2;
  const reach = (len * S) / 2 + S * 0.5;
  const w = Math.ceil(reach * 2);
  const h = Math.ceil(reach * 2 * TILT + S * 0.9);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const cx = w / 2, cy = h - reach * TILT - S * 0.12;
  const col = hidden ? GRAY : COLORS[color];

  const Lb = len * S - S * 0.2;
  const Wb = S * 0.7;
  const R = S * 0.2;
  const hw = S * 0.08, hb = type === 'bus' ? S * 0.3 : S * 0.24;
  const zTop = hw + hb;
  const cab = type === 'car' ? { l: Lb * 0.56, off: -Lb * 0.06, h: S * 0.2 }
    : type === 'van' ? { l: Lb * 0.66, off: -Lb * 0.1, h: S * 0.22 }
    : { l: Lb * 0.9, off: -Lb * 0.01, h: S * 0.2 };
  const cw = Wb * 0.84;

  // soft shadow
  for (let i = 3; i >= 1; i--) {
    groundRect(ctx, cx + S * 0.05, cy + S * 0.06, ang, 0, Lb + i * S * 0.08, Wb + i * S * 0.08, R + i * S * 0.04, 0);
    ctx.fillStyle = `rgba(20,30,40,${0.09})`;
    ctx.fill();
  }
  // wheels
  ctx.fillStyle = '#2b2f3a';
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const along = sx * (Lb / 2 - S * 0.18);
    for (let z = 0; z <= hw * 1.6; z += 1) {
      groundRect(ctx, cx, cy, ang, along, S * 0.22, S * 0.12, S * 0.05, z, sy * (Wb / 2 - S * 0.02));
      ctx.fill();
    }
  }
  if (type === 'bus') {
    const along = 0;
    for (const sy of [-1, 1]) for (let z = 0; z <= hw * 1.6; z += 1) {
      groundRect(ctx, cx, cy, ang, along - Lb * 0.05, S * 0.22, S * 0.12, S * 0.05, z, sy * (Wb / 2 - S * 0.02));
      ctx.fill();
    }
  }
  // body sides (stacked layers make a chunky extrusion)
  const steps = Math.max(2, Math.ceil(hb * ZK));
  for (let i = 0; i <= steps; i++) {
    const z = hw + (hb * i) / steps;
    groundRect(ctx, cx, cy, ang, 0, Lb, Wb, R, z);
    ctx.fillStyle = i < steps * 0.35 ? shade(col.dark, -0.12) : col.dark;
    ctx.fill();
  }
  // bumper stripe
  groundRect(ctx, cx, cy, ang, 0, Lb, Wb, R, hw + hb * 0.35);
  ctx.fillStyle = shade(col.dark, -0.2);
  ctx.fill();
  // body top
  groundRect(ctx, cx, cy, ang, 0, Lb, Wb, R, zTop);
  ctx.fillStyle = col.hex;
  ctx.fill();
  groundRect(ctx, cx, cy, ang, 0, Lb - S * 0.1, Wb - S * 0.1, R * 0.8, zTop + 0.5);
  ctx.strokeStyle = shade(col.hex, 0.25);
  ctx.lineWidth = Math.max(1, S * 0.03);
  ctx.stroke();
  // headlights
  ctx.fillStyle = '#fff6c8';
  for (const sy of [-1, 1]) {
    groundRect(ctx, cx, cy, ang, Lb / 2 - S * 0.07, S * 0.07, S * 0.13, S * 0.03, zTop - hb * 0.3, sy * (Wb / 2 - S * 0.14));
    ctx.fill();
  }
  // cabin: glass sides then roof
  const csteps = Math.max(2, Math.ceil(cab.h * ZK));
  for (let i = 0; i <= csteps; i++) {
    groundRect(ctx, cx, cy, ang, cab.off, cab.l, cw, R * 0.8, zTop + (cab.h * i) / csteps);
    ctx.fillStyle = i === 0 ? '#2d3a52' : '#3f5578';
    ctx.fill();
  }
  // a glint across the windows
  groundRect(ctx, cx, cy, ang, cab.off + cab.l * 0.18, cab.l * 0.12, cw, 2, zTop + cab.h * 0.5);
  ctx.fillStyle = 'rgba(190,225,255,0.55)';
  ctx.fill();
  const zRoof = zTop + cab.h;
  groundRect(ctx, cx, cy, ang, cab.off, cab.l - S * 0.04, cw - S * 0.04, R * 0.7, zRoof);
  ctx.fillStyle = col.light;
  ctx.fill();
  // roof arrow (white, outlined) pointing forward
  {
    const al = Math.min(cab.l * 0.82, S * 0.62), aw = cw * 0.66;
    ctx.save();
    ctx.translate(cx, cy - zRoof * ZK);
    ctx.scale(1, TILT);
    ctx.rotate(ang);
    ctx.translate(cab.off, 0);
    ctx.beginPath();
    const hl = al * 0.48, sw = aw * 0.38;
    ctx.moveTo(al / 2, 0);
    ctx.lineTo(al / 2 - hl, -aw / 2);
    ctx.lineTo(al / 2 - hl, -sw / 2);
    ctx.lineTo(-al / 2, -sw / 2);
    ctx.lineTo(-al / 2, sw / 2);
    ctx.lineTo(al / 2 - hl, sw / 2);
    ctx.lineTo(al / 2 - hl, aw / 2);
    ctx.closePath();
    ctx.restore();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, S * 0.06);
    ctx.strokeStyle = 'rgba(25,30,45,0.55)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  // color symbol badge on the back
  if (symbols || hidden) {
    const o = -(Lb / 2 - S * 0.16);
    const bx = cx + Math.cos(ang) * o, by = cy + Math.sin(ang) * o * TILT - (zTop + S * 0.06) * ZK;
    drawBadge(ctx, bx, by, S * 0.16, color, hidden);
  }
  sp = { cv, ox: cx, oy: cy, top: zRoof * ZK };
  vCache.set(key, sp);
  return sp;
}

// --- commuters -------------------------------------------------------------------
const SKIN = ['#f6d3b3', '#e9b48a', '#c98c5e', '#9a6342', '#6e4630', '#f2c9a0'];
const HAIR = ['#2d211b', '#5a3a24', '#e0b350', '#a8482c', '#1c1c24', '#cfcfd6', '#6b4a8a'];
const cCache = new Map();

export function commuterSprite(color, look, H, symbols, umbrella) {
  const key = `${color}|${look}|${H}|${symbols ? 1 : 0}|${umbrella ? 1 : 0}`;
  let sp = cCache.get(key);
  if (sp) return sp;
  const W = Math.ceil(H * 0.9), HH = Math.ceil(H * 1.15);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = HH;
  const ctx = cv.getContext('2d');
  const cx = W / 2, base = HH - H * 0.08;
  const skin = SKIN[look % SKIN.length], hair = HAIR[(look * 3 + 1) % HAIR.length];
  const shirt = umbrella ? { hex: '#8b93a3', dark: '#5f6676' } : COLORS[color];
  // shadow
  ctx.beginPath();
  ctx.ellipse(cx, base, H * 0.26, H * 0.08, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,30,40,0.25)';
  ctx.fill();
  // legs
  ctx.fillStyle = '#3a3f52';
  ctx.beginPath(); rr(ctx, cx - H * 0.15, base - H * 0.22, H * 0.12, H * 0.22, H * 0.05); ctx.fill();
  ctx.beginPath(); rr(ctx, cx + H * 0.03, base - H * 0.22, H * 0.12, H * 0.22, H * 0.05); ctx.fill();
  // body (shirt)
  ctx.beginPath(); rr(ctx, cx - H * 0.24, base - H * 0.58, H * 0.48, H * 0.42, H * 0.17);
  ctx.fillStyle = shirt.hex; ctx.fill();
  ctx.lineWidth = Math.max(1, H * 0.045); ctx.strokeStyle = shirt.dark; ctx.stroke();
  if (symbols && !umbrella) {
    symbolPath(ctx, COLORS[color].sym, cx, base - H * 0.37, H * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
  }
  // head
  const hy = base - H * 0.74, hr = H * 0.2;
  ctx.beginPath(); ctx.arc(cx, hy, hr, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
  ctx.lineWidth = Math.max(1, H * 0.035); ctx.strokeStyle = 'rgba(60,40,30,0.35)'; ctx.stroke();
  // hair: a few simple styles
  ctx.fillStyle = hair;
  ctx.beginPath();
  const style = look % 4;
  if (style === 0) { ctx.arc(cx, hy - hr * 0.1, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); }
  else if (style === 1) { ctx.arc(cx, hy - hr * 0.15, hr * 1.04, Math.PI, Math.PI * 2); ctx.lineTo(cx + hr * 1.04, hy + hr * 0.2); ctx.lineTo(cx + hr * 0.7, hy - hr * 0.1); ctx.lineTo(cx - hr * 0.7, hy - hr * 0.1); ctx.lineTo(cx - hr * 1.04, hy + hr * 0.2); ctx.closePath(); }
  else if (style === 2) { ctx.arc(cx, hy - hr * 0.2, hr * 0.95, Math.PI * 1.1, Math.PI * 1.9); ctx.closePath(); ctx.moveTo(cx + hr * 0.5, hy - hr * 1.1); ctx.arc(cx + hr * 0.45, hy - hr * 1.15, hr * 0.32, 0, Math.PI * 2); }
  else { ctx.arc(cx, hy - hr * 0.05, hr * 1.06, Math.PI * 0.95, Math.PI * 2.05); ctx.closePath(); }
  ctx.fill();
  // face
  ctx.fillStyle = '#2a2230';
  ctx.beginPath(); ctx.arc(cx - hr * 0.36, hy + hr * 0.12, hr * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + hr * 0.36, hy + hr * 0.12, hr * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,120,0.35)';
  ctx.beginPath(); ctx.arc(cx - hr * 0.55, hy + hr * 0.45, hr * 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + hr * 0.55, hy + hr * 0.45, hr * 0.15, 0, Math.PI * 2); ctx.fill();
  if (umbrella) {
    const uy = hy - hr * 0.6, ur = H * 0.42;
    ctx.strokeStyle = '#444b5a'; ctx.lineWidth = Math.max(1, H * 0.04);
    ctx.beginPath(); ctx.moveTo(cx + H * 0.05, uy); ctx.lineTo(cx + H * 0.05, base - H * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, uy, ur, Math.PI, Math.PI * 2);
    for (let i = 3; i >= 0; i--) { const x = cx - ur + (ur * 2 * i) / 3; ctx.quadraticCurveTo(x + ur / 3, uy - ur * 0.15, x, uy); }
    ctx.closePath();
    ctx.fillStyle = ['#5b6578', '#77808f', '#3f4656'][look % 3];
    ctx.fill();
  }
  sp = { cv, ox: cx, oy: base };
  cCache.set(key, sp);
  return sp;
}

// --- scenery ---------------------------------------------------------------------------
export function drawTree(ctx, x, y, r, seed) {
  ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 0.15, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,50,20,0.22)'; ctx.fill();
  ctx.fillStyle = '#8a5a3b';
  ctx.beginPath(); rr(ctx, x - r * 0.14, y - r * 0.7, r * 0.28, r * 0.75, r * 0.1); ctx.fill();
  const greens = ['#3f9e4f', '#4cae5a', '#5cbf63'];
  const blobs = [[0, -1.25, 0.72], [-0.48, -0.95, 0.55], [0.5, -0.95, 0.55], [0, -0.85, 0.6]];
  blobs.forEach(([bx, by, br], i) => {
    ctx.beginPath(); ctx.arc(x + bx * r, y + by * r, br * r, 0, Math.PI * 2);
    ctx.fillStyle = greens[(i + seed) % 3]; ctx.fill();
  });
  ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 1.45, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
}

export function drawBush(ctx, x, y, r, hue = 0) {
  ctx.beginPath(); ctx.ellipse(x + r * 0.15, y + r * 0.2, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,50,20,0.2)'; ctx.fill();
  const g = ['#4aa85a', '#3d9a4e'][hue % 2];
  for (const [bx, br] of [[-0.55, 0.6], [0.55, 0.6], [0, 0.8]]) {
    ctx.beginPath(); ctx.arc(x + bx * r, y - r * 0.35, br * r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.75, r * 0.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();
}

export function drawFlower(ctx, x, y, r, c) {
  ctx.fillStyle = c;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, r * 0.7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffe680'; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
}

// A hedge block that fills one grid cell (cell size cs, screen top-left x,y).
export function drawHedge(ctx, x, y, cs) {
  const h = cs * 0.32 * ZK, w = cs, d = cs * TILT;
  ctx.fillStyle = '#2f7d3e';
  ctx.beginPath(); rr(ctx, x + 1, y + 1 - h + h, w - 2, d - 2, cs * 0.2); ctx.fill();
  ctx.fillStyle = '#3f9a52';
  ctx.beginPath(); rr(ctx, x + 1, y + 1 - h, w - 2, d - 2, cs * 0.22); ctx.fill();
  ctx.fillStyle = '#57b866';
  for (const [bx, by] of [[0.3, 0.32], [0.68, 0.38], [0.48, 0.62]]) {
    ctx.beginPath(); ctx.arc(x + bx * w, y - h + by * d, cs * 0.16, 0, Math.PI * 2); ctx.fill();
  }
}
