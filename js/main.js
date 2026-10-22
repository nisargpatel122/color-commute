// Boots the game: screens, HUD, boosters, coins, saving, sound and the loop.
import { GAME_ID, VERSION, BOOSTERS, COLORS } from './config.js';
import { store } from './storage.js';
import { Sound, buzz } from './audio.js';
import { GameView } from './view.js';
import { getLevel, demoLevel, primeLevel, hasLevel, TWISTS } from './levels.js';
import { difficulty } from './generator.js';
import { cloneState, addBay, sortLine } from './engine.js';
import { botMove } from './solver.js';
import { makeRng } from './rng.js';

const $ = (sel) => document.querySelector(sel);
const P = store.progress, S = store.settings;
const sound = new Sound();
sound.setSfx(S.sound);
sound.musicOn = S.music;

const overlay = $('#overlay');
const hud = $('#hud'), bar = $('#boosters'), streakEl = $('#streak'), tipEl = $('#tip');
let screen = 'title';
let current = 0;

const view = new GameView($('#game'), {
  sound,
  vibrate: (p) => buzz(p, S.vibration && !view.demo),
  symbols: () => S.symbols,
  insets: () => {
    const cs = getComputedStyle($('#safe-probe'));
    const playing = screen === 'game';
    return {
      t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0,
      hud: 58, bar: playing || screen === 'title' ? 92 : 92,
    };
  },
  firstTouch: () => { sound.unlock(); hideTip(); },
  onCoins: (n, x, y) => { if (!view.demo) addCoins(n, x, y); },
  onEnd: (won) => {
    if (view.demo) { setTimeout(() => { if (view.demo) startDemo(); }, 1200); return; }
    if (won) showWin(); else showLose();
  },
  onBoosterUsed: (kind) => chargeBooster(kind),
  onPick: () => refreshBoosters(),
});

// ------------------------------------------------------------------ helpers --
function save() { store.saveProgress(); }
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
function setCoins() {
  $('#hud-coins .num').textContent = P.coins;
  document.querySelectorAll('.coins-num').forEach((e) => { e.textContent = P.coins; });
}
function addCoins(n, x, y) {
  P.coins += n;
  save();
  if (x != null) {
    const c = document.createElement('span');
    c.className = 'coin fly-coin';
    c.style.left = x - 11 + 'px'; c.style.top = y - 11 + 'px';
    document.body.appendChild(c);
    const r = $('#hud-coins').getBoundingClientRect();
    requestAnimationFrame(() => {
      c.style.transform = `translate(${r.left + 20 - x}px, ${r.top + 18 - y}px) scale(.8)`;
      c.style.opacity = '0.4';
    });
    setTimeout(() => { c.remove(); setCoins(); const h = $('#hud-coins'); h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); sound.coin(); }, 600);
  } else setCoins();
}
function show(html, cls = 'scrim') {
  overlay.innerHTML = `<div class="${cls}">${html}</div>`;
  overlay.classList.add('show');
}
function hide() { overlay.classList.remove('show'); overlay.innerHTML = ''; }
function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e) => { sound.unlock(); sound.tap(); fn(e); });
}
function setHud(visible) {
  hud.classList.toggle('hidden', !visible);
  bar.classList.toggle('hidden', !visible);
}
let tipTimer = 0;
function showTip(title, text, ms = 0) {
  tipEl.innerHTML = `<b>${title}</b>${text}`;
  tipEl.classList.remove('hidden');
  clearTimeout(tipTimer);
  if (ms) tipTimer = setTimeout(hideTip, ms);
}
function hideTip() {
  if (tipEl.dataset.sticky === '1') return;
  tipEl.classList.add('hidden');
}

// ---------------------------------------------------------------- boosters --
function grantBoosters() {
  P.granted = P.granted || {};
  for (const [k, b] of Object.entries(BOOSTERS)) {
    if (P.maxLevel >= b.unlock && !P.granted[k]) {
      P.granted[k] = 1;
      P.free[k] = (P.free[k] || 0) + 1;
    }
  }
  save();
}

function refreshBoosters() {
  for (const btn of bar.querySelectorAll('.booster')) {
    const k = btn.dataset.b, b = BOOSTERS[k];
    const price = btn.querySelector('.price');
    const locked = current < b.unlock && P.maxLevel < b.unlock;
    btn.classList.toggle('locked', locked);
    btn.classList.toggle('active', view.pick === k);
    btn.classList.toggle('off', !locked && !view.canBoost(k));
    price.classList.toggle('free', !locked && (P.free[k] || 0) > 0);
    price.textContent = locked ? `Lv ${b.unlock}` : (P.free[k] || 0) > 0 ? `FREE x${P.free[k]}` : String(b.cost);
  }
}

function canAfford(kind) {
  return (P.free[kind] || 0) > 0 || P.coins >= BOOSTERS[kind].cost;
}
function chargeBooster(kind) {
  if ((P.free[kind] || 0) > 0) P.free[kind]--;
  else P.coins -= BOOSTERS[kind].cost;
  save();
  setCoins();
  refreshBoosters();
  buzz(20, S.vibration);
}

function useBooster(kind) {
  const b = BOOSTERS[kind];
  if (current < b.unlock && P.maxLevel < b.unlock) { toast(`${b.name} unlocks at level ${b.unlock}`); return false; }
  if (view.pick === 'lift' && kind === 'lift') { view.boost('lift'); refreshBoosters(); return false; }
  if (!view.canBoost(kind)) {
    toast(kind === 'bay' ? 'The 6th bay is already open' : kind === 'lift' ? 'Lift needs a free bay' : 'Not available right now');
    sound.nope();
    return false;
  }
  if (!canAfford(kind)) { toast(`Need ${b.cost} coins. Win levels and keep streaks to earn more!`); sound.nope(); return false; }
  if (kind === 'lift') {
    view.boost('lift');
    toast('Tap any vehicle in the lot');
    refreshBoosters();
    return true;
  }
  const ok = view.boost(kind);
  if (!ok) { toast(kind === 'shuffle' ? 'No better shuffle found. Coins kept!' : 'Not available right now'); return false; }
  chargeBooster(kind);
  return true;
}

bar.addEventListener('click', (e) => {
  const btn = e.target.closest('.booster');
  if (!btn || screen !== 'game') return;
  sound.unlock();
  useBooster(btn.dataset.b);
});

// ------------------------------------------------------------------ levels --
function levelTag(spec) {
  if (spec.intro) return ['New!', 'twist'];
  if (spec.hard) return ['Hard', ''];
  if (spec.breather) return ['Breather', 'easy'];
  return ['', ''];
}

function startLevel(n) {
  current = n;
  P.level = n;
  save();
  let spec;
  try { spec = getLevel(n); } catch (e) { console.error(e); toast('Could not build that level'); return; }
  screen = 'game';
  hide();
  setHud(true);
  view.demo = false;
  sound.quiet = false;
  view.paused = false;
  view.load(spec);
  banner(n, spec);
  $('#hud-level').textContent = `Level ${n}`;
  const [tag, cls] = levelTag(spec);
  const t = $('#hud-tag');
  t.textContent = tag; t.className = cls;
  setCoins();
  grantBoosters();
  refreshBoosters();
  tipEl.dataset.sticky = '0';
  hideTip();
  if (!P.seenHowTo && !P.wins) {
    // Brand-new players get the rules once, instead of tutorial levels.
    view.paused = true;
    showHowTo(() => { P.seenHowTo = true; save(); hide(); screen = 'game'; view.paused = false; });
  } else if (spec.intro && !P.seenTwists.includes(spec.intro)) {
    const tw = TWISTS.find((x) => x.id === spec.intro);
    view.paused = true;
    show(`<div class="card"><span class="tag">NEW TWIST</span>${twistIcon(tw.id)}<h2>${tw.name}</h2><p>${tw.text}</p><button class="btn green" id="tw-ok">Got it!</button></div>`);
    on('tw-ok', () => { P.seenTwists.push(tw.id); save(); hide(); view.paused = false; });
  } else {
    const unlocked = Object.entries(BOOSTERS).find(([, b]) => b.unlock === n);
    if (unlocked) showTip(`New booster: ${unlocked[1].name}`, unlocked[1].desc + ' Your first one is free!', 5000);
  }
  prefetch(n + 1);
}

// Build the next level in a background worker so it opens instantly.
let worker = null;
function prefetch(n) {
  if (hasLevel(n)) return;
  try {
    if (!worker) {
      worker = new Worker('./js/worker.js', { type: 'module' });
      worker.onmessage = (e) => { if (e.data.spec) primeLevel(e.data.n, e.data.spec); };
    }
    worker.postMessage(n);
  } catch (e) { /* no module workers: the level is built when needed */ }
}

const SHAPE_NAMES = {
  rect: 'Classic lot', rounded: 'Comfy lot', circle: 'Round lot', diamond: 'Diamond lot', heart: 'Heart lot',
  star: 'Star lot', cross: 'Crossroads', ring: 'Ring road', hourglass: 'Hourglass', arrow: 'Arrow lot',
  house: 'House lot', spiral: 'Spiral garden', maze: 'Hedge maze', letter: 'Letter lot',
};
function banner(n, spec) {
  const old = document.getElementById('banner');
  if (old) old.remove();
  const [kind, letter] = (spec.shape || 'rect').split(':');
  const name = letter ? `Letter ${letter} lot` : SHAPE_NAMES[kind] || '';
  const b = document.createElement('div');
  b.id = 'banner';
  b.innerHTML = `<div class="b1">Level ${n}</div><div class="b2">${name}</div>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 1700);
}

// Title screen demo: a bot quietly plays a lot behind the menu.
let demoRng = makeRng(7), demoClock = 0;
function startDemo() {
  try {
    view.load(demoLevel());
    view.demo = true;
    view.paused = false;
    sound.quiet = true;
    demoClock = 1;
  } catch (e) { console.error(e); }
}
function demoTick(dt) {
  if (!view.demo || screen !== 'title' || view.s.status !== 'playing') return;
  demoClock -= dt;
  if (demoClock > 0) return;
  demoClock = 0.65 + Math.random() * 0.4;
  const v = botMove(view.s, demoRng, 0.9);
  if (!v) return;
  view.tapId(v.id);
  if (v.napping) view.tapId(v.id);
}

function twistIcon(id) {
  const icons = {
    nap: '<svg class="twist-icon" viewBox="0 0 96 96"><rect x="14" y="44" width="68" height="34" rx="12" fill="#3d86f0"/><rect x="26" y="34" width="44" height="22" rx="8" fill="#8ab8ff"/><text x="62" y="30" font-size="22" font-weight="900" fill="#26304a">z</text><text x="74" y="18" font-size="16" font-weight="900" fill="#26304a">z</text></svg>',
    mystery: '<svg class="twist-icon" viewBox="0 0 96 96"><rect x="14" y="40" width="68" height="36" rx="12" fill="#a3acb8"/><rect x="26" y="30" width="44" height="22" rx="8" fill="#d0d6de"/><circle cx="48" cy="58" r="14" fill="#fff"/><text x="48" y="66" text-anchor="middle" font-size="22" font-weight="900" fill="#5b6474">?</text></svg>',
    gate: '<svg class="twist-icon" viewBox="0 0 96 96"><rect x="12" y="30" width="10" height="50" rx="3" fill="#ccd3de"/><g transform="rotate(-12 17 36)"><rect x="17" y="31" width="70" height="10" fill="#ef4b4b"/><rect x="31" y="31" width="14" height="10" fill="#fff"/><rect x="59" y="31" width="14" height="10" fill="#fff"/></g><circle cx="60" cy="66" r="16" fill="#2f6fe4" stroke="#fff" stroke-width="3"/><text x="60" y="73" text-anchor="middle" font-size="20" font-weight="900" fill="#fff">3</text></svg>',
    garage: '<svg class="twist-icon" viewBox="0 0 96 96"><path d="M12 44L48 16l36 28z" fill="#d9534f"/><rect x="18" y="42" width="60" height="40" rx="5" fill="#f2e3c6"/><rect x="32" y="56" width="32" height="26" rx="3" fill="#5b6474"/><circle cx="76" cy="24" r="13" fill="#2f6fe4"/><text x="76" y="30" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">2</text></svg>',
    key: '<svg class="twist-icon" viewBox="0 0 96 96"><path d="M30 44v-8a12 12 0 0 1 24 0v8" stroke="#c99a14" stroke-width="7" fill="none"/><rect x="20" y="42" width="44" height="34" rx="8" fill="#ffd23a"/><text x="42" y="68" text-anchor="middle" font-size="20" font-weight="900" fill="#5a4200">A</text><circle cx="72" cy="30" r="10" fill="#ffd23a" stroke="#c99a14" stroke-width="3"/><rect x="66" y="38" width="6" height="22" fill="#ffd23a"/></svg>',
    group: '<svg class="twist-icon" viewBox="0 0 96 96"><g fill="#ff6fb5"><rect x="12" y="46" width="22" height="26" rx="9"/><rect x="38" y="46" width="22" height="26" rx="9"/><rect x="64" y="46" width="22" height="26" rx="9"/></g><g fill="#f6d3b3"><circle cx="23" cy="36" r="10"/><circle cx="49" cy="36" r="10"/><circle cx="75" cy="36" r="10"/></g><path d="M30 58h12M56 58h12" stroke="#ffe3c4" stroke-width="5" stroke-linecap="round"/></svg>',
    rain: '<svg class="twist-icon" viewBox="0 0 96 96"><path d="M14 48a34 30 0 0 1 68 0z" fill="#5b6578"/><path d="M48 48v26a6 6 0 0 1-12 0" stroke="#444b5a" stroke-width="4" fill="none"/><g stroke="#79c7f2" stroke-width="3" stroke-linecap="round"><path d="M20 60l-3 8M78 58l-3 8M66 72l-3 8M28 76l-3 8"/></g></svg>',
  };
  return icons[id] || '';
}

// ----------------------------------------------------------------- screens --
function showTitle() {
  screen = 'title';
  setHud(false);
  hideTip();
  startDemo();
  const letters = 'Color'.split('').map((ch, i) => `<span style="color:${COLORS[[0, 1, 2, 3, 4][i]].hex}">${ch}</span>`).join('');
  show(`<div class="title-wrap">
      <div class="logo"><span class="l1">${letters}</span><span class="l2">Commute</span></div>
      <p class="tagline">Clear the lot. Match the colors. Get everyone home!</p>
      <div class="title-btns">
        <button class="btn green big" id="t-play">Play &nbsp;▶&nbsp; Level ${P.level}</button>
        <div class="row"><button class="btn white" id="t-map">Levels</button><button class="btn white" id="t-set">Settings</button></div>
        <button class="btn white small" id="t-how">How to play</button>
      </div>
    </div>`, '');
  on('t-play', () => startLevel(P.level));
  on('t-map', () => showMap());
  on('t-set', () => showSettings(showTitle));
  on('t-how', () => showHowTo(showTitle));
}

function showMap() {
  screen = 'map';
  setHud(false);
  hideTip();
  view.paused = true;
  sound.quiet = false;
  const max = Math.max(P.maxLevel + 15, 30);
  const rowH = 86;
  let nodes = '';
  const pts = [];
  for (let i = 1; i <= max; i++) {
    const x = Math.sin(i * 0.85) * 100;
    const y = (max - i) * rowH + 12;
    pts.push(`${210 + x},${y + 31}`);
    const done = P.done[i] != null;
    const locked = i > P.maxLevel;
    const tw = TWISTS.find((t) => t.level === i);
    let cls = 'node' + (done ? ' done' : '') + (locked ? ' locked' : '') + (i === P.level && !locked ? ' current' : '') + (difficulty(i).hard ? ' hard' : '');
    nodes += `<button class="${cls}" data-l="${i}" style="top:${y}px;--x:${x}px">${i}${tw ? `<span class="badge">${tw.name}</span>` : ''}</button>`;
  }
  const h = max * rowH + 20;
  show(`<div class="map">
      <div class="map-head"><button class="round-btn" id="m-back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke="#26304a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <h2>Levels</h2><div class="coins" style="color:#26304a"><span class="coin"></span><span class="coins-num">${P.coins}</span></div></div>
      <div class="map-scroll" id="m-scroll"><div class="map-list" style="height:${h}px">
        <svg width="420" height="${h}" style="position:absolute;left:50%;margin-left:-210px;top:0" aria-hidden="true">
          <polyline points="${pts.join(' ')}" fill="none" stroke="#5f6779" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="${pts.join(' ')}" fill="none" stroke="#fff8e1" stroke-width="2.5" stroke-dasharray="10 10" stroke-linecap="round"/>
        </svg>
        ${nodes}
      </div></div></div>`, '');
  on('m-back', () => showTitle());
  overlay.querySelector('.map-list').addEventListener('click', (e) => {
    const b = e.target.closest('.node');
    if (!b) return;
    sound.unlock();
    const l = +b.dataset.l;
    if (l > P.maxLevel) { toast('Finish the levels before it first'); sound.nope(); return; }
    sound.tap();
    startLevel(l);
  });
  const cur = overlay.querySelector('.node.current') || overlay.querySelector(`.node[data-l="${P.maxLevel}"]`);
  const sc = $('#m-scroll');
  if (cur) sc.scrollTop = cur.offsetTop - sc.clientHeight / 2;
}

function pause() {
  if ((screen !== 'game' && screen !== 'pause') || view.ended) return;
  view.paused = true;
  screen = 'pause';
  show(`<div class="card"><h1>Paused</h1><p>Level ${current}</p>
    <button class="btn green" id="p-resume">Resume</button>
    <button class="btn" id="p-restart">Restart level</button>
    <div class="row"><button class="btn white small" id="p-set">Settings</button><button class="btn white small" id="p-how">How to play</button></div>
    <button class="btn white small" id="p-home">Home</button></div>`);
  on('p-resume', resume);
  on('p-restart', () => startLevel(current));
  on('p-set', () => showSettings(pause));
  on('p-how', () => showHowTo(pause));
  on('p-home', () => showTitle());
}
function resume() {
  hide();
  screen = 'game';
  view.paused = false;
  sound.resume();
}
on('btn-pause', pause);

function showSettings(back) {
  const prev = screen;
  screen = prev === 'game' ? 'pause' : prev;
  const row = (key, label) => `<div class="toggle"><span>${label}</span><button class="switch ${S[key] ? 'on' : ''}" data-k="${key}" aria-label="${label}" aria-pressed="${S[key]}"></button></div>`;
  show(`<div class="card"><h2>Settings</h2>
    ${row('sound', 'Sound effects')}${row('music', 'Music')}${row('vibration', 'Vibration')}${row('symbols', 'Colorblind symbols')}
    <button class="btn green" id="s-back">Done</button>
    <button class="btn red small" id="s-reset">Reset progress</button></div>`);
  overlay.querySelectorAll('.switch').forEach((sw) => sw.addEventListener('click', () => {
    sound.unlock();
    const k = sw.dataset.k;
    S[k] = !S[k];
    store.saveSettings();
    sw.classList.toggle('on', S[k]);
    sw.setAttribute('aria-pressed', S[k]);
    if (k === 'sound') sound.setSfx(S.sound);
    if (k === 'music') sound.setMusic(S.music);
    if (k === 'vibration' && S.vibration) buzz(30, true);
    sound.tap();
  }));
  on('s-back', back);
  on('s-reset', () => {
    show(`<div class="card"><h2>Reset progress?</h2><p>This clears Color Commute's levels, coins and settings on this device. Your other games are not affected.</p>
      <button class="btn red" id="r-yes">Yes, reset</button><button class="btn white" id="r-no">Cancel</button></div>`);
    on('r-yes', () => {
      store.reset();
      location.reload();
    });
    on('r-no', () => showSettings(back));
  });
}

function showHowTo(back) {
  show(`<div class="card howto"><h2 style="text-align:center">How to play</h2>
    <ul>
      <li><b>Tap a vehicle</b> to drive it the way its roof arrow points. If something is in the way it bumps, honks and rolls back.</li>
      <li>Free vehicles drive to the <b>bus stop</b> and park in a bay. The rider at the front of the line boards any parked vehicle of <b>their color</b>.</li>
      <li>Cars seat <b>4</b>, vans <b>6</b>, buses <b>10</b>. Full vehicles drive home and free their bay.</li>
      <li>There are only <b>5 bays</b>. If they're all full and the front rider can't board, the level is lost.</li>
      <li>Every color has its own <b>symbol</b> (heart, triangle, star, square, circle, diamond, cross, moon).</li>
      <li>Clear vehicles quickly in a row for a <b>streak</b> and bonus coins. Spend coins on <b>boosters</b>.</li>
    </ul>
    <button class="btn green" id="h-back">Got it</button></div>`);
  on('h-back', back);
}

function winReward(n, first) {
  const spec = getLevel(n);
  let base = 10 + Math.min(30, Math.floor(n / 3)) + (spec.hard ? 10 : 0);
  if (!first) base = Math.max(3, Math.round(base / 3));
  return base;
}

function showWin() {
  screen = 'end';
  const first = P.done[current] == null;
  const reward = winReward(current, first);
  const streakBonus = view.bestStreak >= 8 ? 10 : view.bestStreak >= 5 ? 5 : 0;
  P.done[current] = Math.max(P.done[current] || 0, reward);
  P.wins = (P.wins || 0) + 1;
  P.bestStreak = Math.max(P.bestStreak || 0, view.bestStreak);
  if (current >= P.maxLevel) P.maxLevel = current + 1;
  P.level = current + 1;
  const before = P.coins;
  P.coins += reward + streakBonus;
  save();
  setCoins();
  grantBoosters();
  const cheers = ['Everyone’s home!', 'Rush hour cleared!', 'Smooth commute!', 'All aboard!', 'Lot cleared!'];
  show(`<div class="card"><div class="big-icon">⭐</div><h1>${cheers[current % cheers.length]}</h1><p>Level ${current} complete</p>
    <div class="reward">
      <div><span>Level reward</span><span class="amt">+${reward} <span class="coin"></span></span></div>
      <div><span>Streak coins (live)</span><span class="amt">+${view.streakCoins} <span class="coin"></span></span></div>
      ${streakBonus ? `<div><span>Best streak x${view.bestStreak}</span><span class="amt">+${streakBonus} <span class="coin"></span></span></div>` : ''}
      <div class="total"><span>Coins</span><span class="amt"><span id="w-total">${before}</span> <span class="coin"></span></span></div>
    </div>
    <button class="btn green" id="w-next">Next level ▶</button>
    <div class="row"><button class="btn white small" id="w-map">Levels</button><button class="btn white small" id="w-again">Replay</button></div></div>`);
  countUp($('#w-total'), before, P.coins);
  on('w-next', () => startLevel(current + 1));
  on('w-map', () => showMap());
  on('w-again', () => startLevel(current));
  refreshBoosters();
}

function countUp(el, from, to) {
  const t0 = performance.now(), dur = 900;
  let lastTick = from;
  const step = (now) => {
    if (!el.isConnected) return;
    const u = Math.min(1, (now - t0 - 350) / dur);
    const v = Math.round(from + (to - from) * Math.max(0, u));
    el.textContent = v;
    if (v - lastTick >= 3) { lastTick = v; sound.coin(); }
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Would this booster get a lost board moving again?
function rescues(kind) {
  const t = cloneState(view.s);
  if (kind === 'bay') { if (t.bayCount >= 6) return false; addBay(t); }
  else sortLine(t);
  return t.status !== 'lost';
}

function showLose() {
  screen = 'end';
  const opts = ['bay', 'sort'].filter((k) => P.maxLevel >= BOOSTERS[k].unlock || current >= BOOSTERS[k].unlock).map((k) => {
    const b = BOOSTERS[k], free = (P.free[k] || 0) > 0;
    const ok = rescues(k) && canAfford(k);
    return `<button class="btn yellow small" id="l-${k}" ${ok ? '' : 'disabled'}>${b.name} — ${free ? 'FREE' : b.cost + ' coins'}</button>`;
  }).join('');
  show(`<div class="card"><svg class="twist-icon" viewBox="0 0 96 96" aria-hidden="true"><rect x="45" y="30" width="6" height="60" rx="3" fill="#7d8696"/><circle cx="48" cy="28" r="22" fill="#2f6fe4" stroke="#fff" stroke-width="4"/><text x="48" y="35" text-anchor="middle" font-size="17" font-weight="900" fill="#fff" font-family="system-ui, sans-serif">STOP</text><circle cx="74" cy="66" r="16" fill="#ef4b4b" stroke="#fff" stroke-width="4"/><path d="M68 60l12 12M80 60L68 72" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg><h1>The stop is jammed!</h1><p>Every bay is full and the rider at the front can’t board.</p>
    <button class="btn green" id="l-retry">Retry</button>
    ${opts ? `<p style="margin:14px 0 0">or use a booster:</p>${opts}` : ''}
    <button class="btn white small" id="l-map">Levels</button></div>`);
  on('l-retry', () => startLevel(current));
  on('l-map', () => showMap());
  for (const k of ['bay', 'sort']) on(`l-${k}`, () => {
    hide();
    screen = 'game';
    view.ended = false;
    view.endTimer = 0;
    if (!useBooster(k)) view.ended = true;
  });
}

// ------------------------------------------------------------- lifecycle --
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    sound.suspend();
  } else if (screen !== 'game') {
    sound.resume();
  }
});
window.addEventListener('resize', () => view.layout());
window.addEventListener('orientationchange', () => setTimeout(() => view.layout(), 200));
document.addEventListener('pointerdown', () => sound.unlock(), { once: false, passive: true });
document.addEventListener('contextmenu', (e) => e.preventDefault());

let last = performance.now();
let lastStreak = 0, lastRefresh = 0;
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  demoTick(Math.min(dt, 0.1));
  view.update(dt);
  view.draw();
  if (screen === 'game') {
    const st = view.streak;
    const showS = st >= 2 && view.streakLeft > 0;
    streakEl.classList.toggle('hidden', !showS);
    if (showS) {
      $('#streak-bar').style.width = (view.streakLeft * 100).toFixed(1) + '%';
      if (st !== lastStreak) { $('#streak-x').textContent = 'x' + st; streakEl.classList.remove('pop'); void streakEl.offsetWidth; streakEl.classList.add('pop'); }
    }
    lastStreak = st;
    if (now - lastRefresh > 250) { lastRefresh = now; refreshBoosters(); }
  } else streakEl.classList.add('hidden');
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- start --
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}
current = P.level;
grantBoosters();
setCoins();
showTitle();
requestAnimationFrame(loop);

// Expose a tiny hook for automated screenshots/tests.
window.__cc = { view, store, startLevel, showMap, showTitle, pause, showWin, showLose, GAME_ID, VERSION };
