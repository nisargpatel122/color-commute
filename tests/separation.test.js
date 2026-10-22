// Guards the rules that keep this game separate from the owner's other games
// on the same github.io site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GAME_ID, VERSION } from '../js/config.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const runtime = ['index.html', 'sw.js', 'manifest.webmanifest', 'css/style.css', ...readdirSync(new URL('../js/', import.meta.url)).map((f) => 'js/' + f)];

test('GAME_ID matches the repository name', () => {
  assert.equal(GAME_ID, 'color-commute');
});

test('storage keys are namespaced and nothing calls localStorage.clear()', () => {
  for (const f of runtime) assert.ok(!/localStorage\.clear\s*\(/.test(read(f)), f);
  const st = read('js/storage.js');
  assert.ok(/\$\{GAME_ID\}:progress/.test(st) && /\$\{GAME_ID\}:settings/.test(st));
  const keys = [...runtime.map(read).join('\n').matchAll(/localStorage\.(?:setItem|getItem|removeItem)\(([^,)]+)/g)].map((m) => m[1].trim());
  for (const k of keys) assert.ok(k === 'key' || k === 'k', 'only namespaced keys via storage.js: ' + k);
});

test('all paths are relative and nothing loads from outside the repo', () => {
  for (const f of runtime) {
    const src = read(f);
    assert.ok(!/(?:src|href)\s*=\s*["']\//.test(src), `${f}: absolute src/href`);
    assert.ok(!/(?:import|from)\s*\(?\s*["']\//.test(src), `${f}: absolute import`);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(src), `${f}: external URL`);
  }
});

test('manifest makes a separate installable app', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.id, '/color-commute/');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.name, 'Color Commute');
  for (const i of m.icons) assert.ok(i.src.startsWith('./icons/'));
});

test('service worker: relative registration, namespaced versioned cache, precaches every file', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes(`const GAME_ID = '${GAME_ID}';`));
  assert.ok(sw.includes(`const VERSION = ${VERSION};`), 'sw.js VERSION matches js/config.js');
  assert.ok(sw.includes('k.startsWith(`${GAME_ID}-v`)'), 'only deletes this game\'s caches');
  assert.ok(read('js/main.js').includes("register('./sw.js', { scope: './' })"));
  for (const f of runtime.filter((x) => x !== 'sw.js')) assert.ok(sw.includes(`'./${f}'`), 'precached: ' + f);
  for (const f of readdirSync(new URL('../icons/', import.meta.url))) assert.ok(sw.includes(`'./icons/${f}'`), 'precached icon: ' + f);
});
