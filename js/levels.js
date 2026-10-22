// Hand-made tutorials, then seeded levels from the generator.
import { generateLevel, TWISTS } from './generator.js';

const R = 0, O = 1, Y = 2, G = 3, B = 4, P = 5, K = 6;
const car = (color, fx, fy, dir) => ({ type: 'car', color, fx, fy, dir });
const van = (color, fx, fy, dir) => ({ type: 'van', color, fx, fy, dir });
const bus = (color, fx, fy, dir) => ({ type: 'bus', color, fx, fy, dir });
const ln = (...parts) => parts.flatMap(([c, k]) => Array.from({ length: k }, () => ({ c, n: 1 })));

function tut(n, W, H, vehicles, line, title, tip) {
  return { n, W, H, mask: new Array(W * H).fill(1), walls: [], vehicles, gates: [], garages: [], line, bays: 5, visible: 0, twists: [], tutorial: { title, tip }, shape: 'rect', d: 0 };
}

export const TUTORIALS = [
  tut(1, 4, 4, [car(R, 1, 1, 0), car(R, 2, 2, 1)], ln([R, 8]),
    'Tap to go', 'Tap a car. It drives to the stop and the riders in its color hop on.'),
  tut(2, 4, 5, [car(B, 1, 1, 0), car(R, 1, 3, 0), car(G, 2, 3, 3), car(Y, 2, 1, 1)], ln([B, 4], [R, 4], [G, 4], [Y, 4]),
    'Follow the arrows', 'Each car only drives the way its arrow points. Clear the way first!'),
  tut(3, 5, 5, [car(Y, 1, 1, 0), car(R, 2, 1, 0), car(B, 3, 1, 0), car(Y, 1, 3, 0), car(R, 2, 3, 3)],
    ln([Y, 4], [R, 4], [B, 4], [Y, 4], [R, 4]),
    'Match the line', 'Riders only board their own color. Look at who is at the front.'),
  tut(4, 5, 6, [bus(B, 4, 1, 1), van(R, 1, 2, 0), car(G, 3, 3, 0), van(Y, 2, 3, 0)],
    ln([B, 10], [R, 6], [G, 4], [Y, 6]),
    'Bigger rides', 'Cars seat 4, vans seat 6 and buses seat 10. Long vehicles take more room.'),
  tut(5, 7, 4, [car(R, 0, 1, 0), car(O, 1, 1, 0), car(Y, 2, 1, 0), car(G, 3, 1, 0), car(B, 4, 1, 0), car(P, 5, 1, 0), car(K, 6, 1, 0)],
    ln([G, 4], [R, 4], [P, 4], [O, 4], [K, 4], [Y, 4], [B, 4]),
    'Only five bays', 'Vehicles wait in the bays until their riders come. Fill all five with the wrong colors and you’re stuck!'),
  tut(6, 5, 5, [car(G, 2, 3, 0), car(R, 2, 2, 3), car(B, 2, 1, 1), car(Y, 4, 4, 0), car(O, 0, 3, 0)],
    ln([G, 4], [B, 4], [O, 4], [R, 4], [Y, 4]),
    'Dig it out', 'The green car is stuck. Park the cars in its way for a moment, then send it.'),
];
export const TUT_COUNT = TUTORIALS.length;

const cache = new Map();
export function getLevel(n) {
  if (n <= TUT_COUNT) return TUTORIALS[n - 1];
  if (!cache.has(n)) {
    if (cache.size > 40) cache.clear();
    cache.set(n, generateLevel(n));
  }
  return cache.get(n);
}

export { TWISTS };
