// Dev tool: a simple bot plays levels many times and reports win rates.
// Usage: node tools/balance.js [from] [to] [runs]
import { getLevel } from '../js/levels.js';
import { createGame } from '../js/engine.js';
import { botPlay } from '../js/solver.js';
import { makeRng } from '../js/rng.js';
const a = +process.argv[2] || 1, b = +process.argv[3] || 100, runs = +process.argv[4] || 30;
const skills = [0.2, 0.5, 0.85];
const rows = [];
for (let n = a; n <= b; n++) {
  const spec = getLevel(n);
  const rates = skills.map((sk) => {
    let w = 0;
    for (let r = 0; r < runs; r++) if (botPlay(createGame(spec), makeRng(n * 1000 + r), sk)) w++;
    return w / runs;
  });
  rows.push([n, rates]);
  const tag = spec.tutorial ? 'tut' : spec.hard ? 'HARD' : spec.breather ? 'easy' : '';
  console.log(`${n}\t${tag}\t${rates.map((x) => (x * 100).toFixed(0).padStart(3) + '%').join(' ')}\t${spec.twists.join(',')}`);
}
const avg = (lo, hi, i) => { const r = rows.filter(([n]) => n >= lo && n <= hi); return (r.reduce((x, [, v]) => x + v[i], 0) / r.length * 100).toFixed(0) + '%'; };
for (const [lo, hi] of [[1, 10], [11, 25], [26, 50], [51, 75], [76, 100]]) if (lo >= a && hi <= b) console.log(`levels ${lo}-${hi}: casual ${avg(lo, hi, 0)}  normal ${avg(lo, hi, 1)}  smart ${avg(lo, hi, 2)}`);
