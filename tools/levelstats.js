// Dev tool: generate levels and print stats. Usage: node tools/levelstats.js 1 300
import { getLevel } from '../js/levels.js';
import { createGame, replay } from '../js/engine.js';
import { solve, freeVehicles } from '../js/solver.js';
const a = +process.argv[2] || 1, b = +process.argv[3] || 60;
let t0 = Date.now();
for (let n = a; n <= b; n++) {
  const t1 = Date.now();
  const spec = getLevel(n);
  const gen = Date.now() - t1;
  const s = createGame(spec);
  const riders = spec.line.reduce((x, u) => x + u.n, 0);
  const rep = spec.solution ? replay(spec, spec.solution).ok : '-';
  const t2 = Date.now();
  const sol = solve(createGame(spec), 20000);
  const sv = Array.isArray(sol) ? 'ok' : sol && sol.budget ? 'BUDGET' : 'NOSOL';
  console.log(`${n}\t${spec.shape}\t${spec.W}x${spec.H}\tveh=${s.vehicles.length}\tfree=${freeVehicles(s).length}\triders=${riders}\tcol=${spec.colors||'-'}\td=${(spec.d||0).toFixed(2)}\t${spec.twists.join(',')}\treplay=${rep}\tsolve=${sv}(${Date.now()-t2}ms)\tgen=${gen}ms`);
}
console.log('total', Date.now() - t0, 'ms');
