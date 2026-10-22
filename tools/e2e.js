// Dev tool: plays levels in a real browser by tapping vehicles on screen with the
// level's own solution, and checks the win screen appears. Also times frames.
import { chromium } from './pw.js';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:8123/index.html');
await page.waitForTimeout(500);
for (const lv of (process.argv[2] || '1,2,3,4,5,6,7,13').split(',').map(Number)) {
  await page.evaluate((l) => window.__cc.startLevel(l), lv);
  await page.waitForTimeout(200);
  await page.evaluate(() => { const o = document.querySelector('#tw-ok'); if (o) o.click(); });
  const sol = await page.evaluate(() => window.__cc.view.spec.solution || null);
  let moves = sol;
  if (!moves) {
    // tutorials have no stored solution: use the solver in-page
    moves = await page.evaluate(async () => {
      const { solve } = await import('./js/solver.js');
      const { createGame } = await import('./js/engine.js');
      return solve(createGame(window.__cc.view.spec));
    });
  }
  for (const tag of moves) {
    for (let k = 0; k < 2; k++) {
      const pt = await page.evaluate((t) => {
        const v = window.__cc.view; const veh = v.s.vehicles.find((x) => x.tag === t);
        if (!veh || veh.state !== 'lot') return null;
        const vv = v.vis.get(veh.id);
        return { x: vv.x, y: vv.y - v.L.cs * 0.1, nap: veh.napping };
      }, tag);
      if (!pt) break;
      await page.touchscreen.tap(pt.x, pt.y);
      await page.waitForTimeout(60);
      if (!pt.nap) break;
    }
    await page.waitForTimeout(90);
  }
  await page.waitForFunction(() => document.querySelector('#w-next') || document.querySelector('#l-retry'), null, { timeout: 30000 }).catch(() => {});
  const res = await page.evaluate(() => (document.querySelector('#w-next') ? 'WIN' : document.querySelector('#l-retry') ? 'LOSE' : 'STUCK:' + window.__cc.view.s.status));
  console.log('level', lv, res);
}
// frame timing on a big level
await page.evaluate(() => window.__cc.startLevel(120));
await page.evaluate(() => { const o = document.querySelector('#tw-ok'); if (o) o.click(); });
const t = await page.evaluate(() => {
  const v = window.__cc.view;
  const n = v.s.vehicles.length, riders = v.riders.length;
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) { v.update(1 / 60); v.draw(); }
  return { ms: (performance.now() - t0) / 120, n, riders };
});
console.log('frame', t);
console.log(errs.length ? errs : 'no errors');
await browser.close();
