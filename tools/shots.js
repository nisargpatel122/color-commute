// Dev tool: screenshots at phone and desktop sizes. Serve repo root on :8123 first.
// Usage: node tools/shots.js [outdir]
import { chromium } from './pw.js';
const out = process.argv[2] || 'shots';
const browser = await chromium.launch();
const sizes = [['phone', 390, 844, 3, true], ['small', 360, 640, 2, true], ['desktop', 1280, 800, 1, false]];
for (const [name, w, h, dpr, mobile] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://localhost:8123/index.html');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-title.png` });
  for (const lv of (process.env.LEVELS || '1,9,37,60').split(',').map(Number)) {
    await page.evaluate((l) => window.__cc.startLevel(l), lv);
    await page.evaluate(() => { const o = document.querySelector('#tw-ok'); if (o) o.click(); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-level${lv}.png` });
  }
  // play a few moves of level 9's own solution and capture mid-animation
  await page.evaluate(() => window.__cc.startLevel(9));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const v = window.__cc.view; const sol = v.spec.solution.slice(0, 5);
    sol.forEach((tag, i) => setTimeout(() => { const veh = v.s.vehicles.find((x) => x.tag === tag); v.tapId(veh.id); }, i * 150));
  }).catch(() => {});
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${name}-play.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-play2.png` });
  await page.evaluate(() => window.__cc.showMap());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-map.png` });
  console.log(name, errs.length ? errs.join('\n') : 'no errors');
  await ctx.close();
}
await browser.close();
