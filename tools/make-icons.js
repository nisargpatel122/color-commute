// Dev tool: renders the app icons with the game's own art code.
// Usage: (serve repo root on :8123) node tools/make-icons.js
import { chromium } from './pw.js';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8123/tools/icon.html');
await page.waitForFunction(() => window.ready);
for (const [name, size, mask] of [['icon-192', 192, false], ['icon-512', 512, false], ['icon-maskable-512', 512, true], ['apple-touch-icon', 180, true]]) {
  const url = await page.evaluate(([s, m]) => window.draw(s, m), [size, mask]);
  writeFileSync(`icons/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await browser.close();
