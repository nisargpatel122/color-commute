// Every level comes from the seeded generator: level N is always the same lot.
import { generateLevel, TWISTS } from './generator.js';

const cache = new Map();
export function getLevel(n) {
  if (!cache.has(n)) {
    if (cache.size > 40) cache.clear();
    cache.set(n, generateLevel(n));
  }
  return cache.get(n);
}

// Store a level that was built in the background worker.
export function primeLevel(n, spec) {
  if (!cache.has(n)) cache.set(n, spec);
}
export function hasLevel(n) { return cache.has(n); }

// A separate lot (not one of the real levels) for the title screen demo.
let demo = null;
export function demoLevel() {
  if (!demo) demo = generateLevel(34, 1, 'demo');
  return demo;
}

export { TWISTS };
