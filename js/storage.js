// Saves are namespaced with GAME_ID so this game never touches other games'
// data on the same github.io origin. Reset removes only the keys listed here.
import { GAME_ID } from './config.js';

export const KEYS = {
  progress: `${GAME_ID}:progress`,
  settings: `${GAME_ID}:settings`,
};

const DEFAULT_PROGRESS = {
  level: 1,          // level to play next
  maxLevel: 1,       // highest unlocked
  coins: 0,
  done: {},          // level -> best coins earned (marks completed)
  free: {},          // booster -> free uses granted on unlock
  seenTwists: [],
  bestStreak: 0,
  wins: 0,
};
const DEFAULT_SETTINGS = { sound: true, music: true, vibration: true, symbols: true };

function read(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(def);
    return { ...structuredClone(def), ...JSON.parse(raw) };
  } catch (e) {
    return structuredClone(def);
  }
}

function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode or full */ }
}

export const store = {
  progress: read(KEYS.progress, DEFAULT_PROGRESS),
  settings: read(KEYS.settings, DEFAULT_SETTINGS),
  saveProgress() { write(KEYS.progress, this.progress); },
  saveSettings() { write(KEYS.settings, this.settings); },
  // Removes only this game's own keys; never wipes the whole shared storage.
  reset() {
    for (const k of Object.values(KEYS)) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    }
    this.progress = structuredClone(DEFAULT_PROGRESS);
    this.settings = structuredClone(DEFAULT_SETTINGS);
  },
};
