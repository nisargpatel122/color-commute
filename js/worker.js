// Builds levels in the background so the game never stutters while you play.
import { getLevel } from './levels.js';

self.onmessage = (e) => {
  const n = e.data;
  try {
    self.postMessage({ n, spec: getLevel(n) });
  } catch (err) {
    self.postMessage({ n, error: String(err) });
  }
};
