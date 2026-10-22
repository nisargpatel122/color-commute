// Dev tool: exercises screens, boosters, saving and auto-pause in a real browser.
import { chromium } from './pw.js';
const out = process.argv[2] || 'shots';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const ok = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);
await page.goto('http://localhost:8123/index.html');
await page.evaluate(() => localStorage.setItem('other-game:progress', '{"level":99}'));
await page.waitForTimeout(400);

// lose on purpose: always send the vehicle whose color is needed last
await page.evaluate(() => { window.__cc.store.progress.coins = 500; window.__cc.store.progress.maxLevel = 30; window.__cc.startLevel(20); });
await page.evaluate(() => { const o = document.querySelector('#tw-ok'); if (o) o.click(); });
await page.evaluate(async () => {
  const { freeVehicles, colorNeeds } = await import('./js/solver.js');
  const v = window.__cc.view;
  for (let i = 0; i < 40 && v.s.status === 'playing'; i++) {
    const need = colorNeeds(v.s);
    const f = freeVehicles(v.s).sort((a, b) => (need.get(b.color) ?? 999) - (need.get(a.color) ?? 999));
    if (!f.length) break;
    v.tapId(f[0].id);
  }
});
await page.waitForSelector('#l-retry', { timeout: 20000 });
await page.screenshot({ path: `${out}/ui-lose.png` });
const coins0 = await page.evaluate(() => window.__cc.store.progress.coins);
await page.click('#l-bay');
await page.waitForTimeout(800);
const st = await page.evaluate(() => ({ status: window.__cc.view.s.status, bays: window.__cc.view.s.bayCount, coins: window.__cc.store.progress.coins }));
ok(st.bays === 6 && (st.coins === coins0 - 60 || st.coins === coins0) , `extra bay from lose screen -> ${JSON.stringify(st)}`);
await page.screenshot({ path: `${out}/ui-afterbay.png` });

// lift: pick mode then tap a blocked vehicle
await page.evaluate(() => window.__cc.startLevel(12));
await page.waitForTimeout(300);
await page.click('.booster[data-b="lift"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/ui-liftmode.png` });
const blocked = await page.evaluate(async () => {
  const { probe } = await import('./js/engine.js');
  const v = window.__cc.view;
  const veh = v.s.vehicles.find((x) => x.state === 'lot' && !probe(v.s, x).ok);
  const vv = v.vis.get(veh.id);
  return { id: veh.id, x: vv.x, y: vv.y };
});
await page.touchscreen.tap(blocked.x, blocked.y);
await page.waitForTimeout(300);
const lifted = await page.evaluate((id) => window.__cc.view.s.vehicles[id].state, blocked.id);
ok(lifted === 'bay', 'lift pulls a blocked vehicle: ' + lifted);
await page.screenshot({ path: `${out}/ui-lifting.png` });

// sort and shuffle
const sorted = await page.evaluate(() => { const b = document.querySelector('.booster[data-b="sort"]'); b.click(); return window.__cc.view.s.status; });
ok(sorted === 'playing', 'sort used');
await page.waitForTimeout(200);
const shuf = await page.evaluate(() => { const before = window.__cc.view.s.vehicles.map((v) => v.color).join(); document.querySelector('.booster[data-b="shuffle"]').click(); return before !== window.__cc.view.s.vehicles.map((v) => v.color).join(); });
ok(shuf, 'shuffle recolored the lot');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ui-boosted.png` });

// auto-pause on app switch
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__cc.view.paused && !!document.querySelector('#p-resume')), 'auto-pause when hidden');
await page.screenshot({ path: `${out}/ui-pause.png` });
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.click('#p-set');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/ui-settings.png` });
await page.click('.switch[data-k="music"]');
const music = await page.evaluate(() => JSON.parse(localStorage.getItem('color-commute:settings')).music);
ok(music === false, 'settings saved');
await page.click('#s-back');
await page.click('#p-how');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/ui-howto.png` });
await page.click('#h-back');
await page.click('#p-resume');

// win screen via solution
await page.evaluate(() => window.__cc.startLevel(8));
await page.evaluate(() => { const v = window.__cc.view; for (const t of v.spec.solution) { const veh = v.s.vehicles.find((x) => x.tag === t); v.tapId(veh.id); if (veh.napping) v.tapId(veh.id); } });
await page.waitForSelector('#w-next', { timeout: 30000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/ui-win.png` });
const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('color-commute:progress')));
ok(prog.level === 9 && prog.done['8'] > 0, 'progress saved after win');

// twist intro card
await page.evaluate(() => { window.__cc.store.progress.seenTwists = []; window.__cc.startLevel(25); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ui-twist.png` });
await page.click('#tw-ok');
await page.evaluate(() => window.__cc.showMap());
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/ui-map.png` });

// reload keeps progress; keys are namespaced; reset leaves other games alone
await page.reload();
await page.waitForTimeout(500);
ok(await page.evaluate(() => window.__cc.store.progress.level === 25 || window.__cc.store.progress.level === 9), 'progress survives reload');
const keys = await page.evaluate(() => Object.keys(localStorage));
ok(keys.filter((k) => k !== 'other-game:progress').every((k) => k.startsWith('color-commute:')), 'all keys namespaced: ' + keys.join(','));
await page.evaluate(() => window.__cc.store.reset());
const after = await page.evaluate(() => Object.keys(localStorage));
ok(after.length === 1 && after[0] === 'other-game:progress', 'reset only removed our keys: ' + after.join(','));
// service worker + cache naming
await page.waitForTimeout(1500);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r && r.scope, caches: await caches.keys() }; });
ok(sw.scope && sw.scope.endsWith('/') && sw.caches.every((c) => c.startsWith('color-commute-v')), 'service worker ' + JSON.stringify(sw));
console.log(errs.length ? errs : 'no errors');
await browser.close();
