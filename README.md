# Color Commute

A bright, toy-like puzzle game about rush hour. A packed parking lot of cars, vans and buses is jammed, and a long line of commuters is waiting at the bus stop. Tap vehicles to drive them out in the direction of their roof arrow. Each one parks at the stop, and riders hop aboard the vehicle of their own color. There are only five bays, so plan which vehicles to send and when.

**Play:** https://nisargpatel122.github.io/color-commute/

- Hundreds of levels: 6 hand-made tutorials, then seeded levels (level N is always the same). Lots come in fun shapes: hearts, stars, spirals, hedge mazes, letters and more.
- Every level is built backwards from a known winning order and checked by the rules engine, so every level can be won.
- New twists every dozen levels: sleepy drivers, mystery rides, boom gates, garages, valet keys, tour groups and rainy days.
- Boosters bought with coins you earn in the game (Extra Bay, Lift, Sort, Shuffle). No real money, ads, lives or timers.
- Colorblind friendly: every color also has its own symbol.
- Works offline and installs as its own app (Android: browser menu → *Add to Home screen* / *Install app*).

## How to play
1. Tap a vehicle. If its way is clear it drives to the stop. If not, it bumps and honks.
2. The rider at the front of the line boards a parked vehicle of their color. Cars seat 4, vans 6, buses 10.
3. Full vehicles drive home and free their bay. If all bays fill up and the front rider can't board, the level is lost.
4. Clear vehicles quickly in a row for a streak and bonus coins.

## For developers
Plain static files, no build step: `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/`. Nothing is loaded from outside this repo.

- `npm test` runs the rules engine tests, checks levels 1–300 are well formed and winnable, and checks the separation rules (namespaced storage keys `color-commute:*`, relative paths, manifest id, service worker cache `color-commute-v<N>`).
- `tools/` holds dev-only scripts: `balance.js` (bot win rates), `levelstats.js`, and browser checks `e2e.js`, `uitest.js`, `shots.js` (serve the repo root on port 8123 first).
- **When you change the game, bump `VERSION` in both `js/config.js` and `sw.js`** so installed copies update.
- See `DESIGN.md` for the rules, generator, difficulty curve and twists.
