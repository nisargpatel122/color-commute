# Color Commute: Design

An original color-matching traffic-jam puzzle. A packed parking lot of toy cars,
vans and buses has to be cleared so a line of matching-colored commuters can
board and head home.

## Core rules

**The lot** is a grid (up to 12 × 15). Painted parking areas come in shapes
(heart, circle, star, spiral, maze, letters, and so on). Hedges are solid
walls. The asphalt outside the painted shape can be driven across.

**Vehicles** each face one of four directions, shown by a big roof arrow.

| Type | Footprint | Seats |
|------|-----------|-------|
| Car  | 1 cell    | 4     |
| Van  | 2 cells   | 6     |
| Bus  | 3 cells   | 10    |

**Tapping a vehicle** drives it straight ahead:
- The path is every cell from its nose to the edge of the grid. If a vehicle,
  hedge, closed gate or garage is in the way, it bumps the blocker, honks and
  rolls back. Nothing changes.
- If the path is clear but no boarding bay is free, it refuses with a shrug.
- Otherwise it leaves the lot, drives round the ring road to the stop and takes
  the lowest free bay. The bay is reserved the instant it leaves.

**The stop** has 5 bays, plus a locked 6th that the Extra Bay booster opens.
Commuters wait in a snaking line. The person at the front boards the parked
vehicle of their color with a free seat that arrived earliest. They board one at
a time. A full vehicle drives off and frees its bay.

- **Win:** the line is empty.
- **Lose:** the front person can't board and every open bay is taken, or the
  lot is empty.
- Each color has exactly as many seats as commuters of that color.
- Every color also has a symbol (♥ ▲ ★ ■ ● ◆ ✚ ☾) on vehicles and shirts.

### Why a solution never disappears from the lot
Vehicles only ever leave the lot, so removing vehicles never blocks anything
new. If a level has a valid clearing order, the lot can always still be
cleared. Only the bays can run out. Garages add vehicles, but only on cells
that no later vehicle needs (see below).

## Level generator (built backwards from a known win)

`level N` is seeded by `N`, so the same N always gives the same layout.

1. **Difficulty** `d ∈ [0,1]` comes from N (see the curve below). It sets the
   number of colors, the number of vehicles, the size mix, how deep vehicles
   are buried, how tangled the line is, and how many bays the intended
   solution needs.
2. **Shape.** Pick a lot shape from the ones unlocked so far, and size the grid
   to fit the vehicle count.
3. **Reverse placement.** Vehicles are placed one at a time. Each new vehicle
   must have a clear path to the edge *given the vehicles already placed*.
   Reversing the placement order then gives a valid clearing order: every
   vehicle's path only crosses vehicles that left earlier. A placement bias
   puts new vehicles on cells that lie on many existing paths, which makes
   blocking deeper.
4. **Twists** are added to that order without breaking it (rules below).
5. **Colors** go to vehicles along the exit order.
6. **Line by intended play.** We play the exit order with a bay cap `k ≤ 5`.
   We either send the next vehicle to a bay or emit the next commuter for a
   parked vehicle, using the engine's own boarding rule. Higher difficulty
   means more parking ahead, last-in-first-out emission (blockers wait in
   bays) and more interleaved colors. The commuters emitted form the line.
7. **Proof.** The intended move list is replayed through the real rules engine,
   and the level is rejected (re-rolled) unless it wins. Tests check levels
   1–300 this way, and an independent search solver checks them too.

## Difficulty curve

`base = 1 − e^(−N/70)`. Every 5th level is a **hard** spike (+0.15). The level
after it is a **breather** (−0.22).

| d     | colors | vehicles | bay cap k | notes                           |
|-------|--------|----------|-----------|---------------------------------|
| < .2  | 2–3    | 8–18     | 2–3       | cars and vans, open layouts     |
| .2–.5 | 3–5    | 18–35    | 3–4       | buses appear, deeper blocking   |
| .5–.8 | 5–7    | 35–55    | 4–5       | LIFO line order                 |
| > .8  | 7–8    | 55–70    | 5         | no spare bay in intended play   |

A balancing bot plays the first 100 levels many times. Tuning aims for:
tutorials and the first levels ≈ always won, mid levels mostly won, hard
spikes lost sometimes by a casual bot but never unwinnable.

## Tutorials (hand made)
1. Tap to go. 2. Arrows and blocking. 3. Match the colors.
4. Vans and buses. 5. Only five bays. 6. Dig out what you need.

## Twists (new one every ~12 levels, each with an intro card)

| Level | Twist | Rule | Why levels stay winnable |
|---|---|---|---|
| 13 | **Sleepy drivers** | First tap wakes the driver, second drives. | No change to the rules. |
| 25 | **Mystery rides** | Color hidden (gray, "?") until the path is clear. | Information only. |
| 37 | **Boom gates** | A barrier on a lane opens after X vehicles have left. | X ≤ the exit index of every vehicle in the intended solution whose path crosses it. |
| 49 | **Garages** | When the space in front is empty, the next queued vehicle rolls out. | Spawn cells are a vehicle's own footprint, which only earlier-leaving vehicles needed. Spawns share its path. |
| 61 | **Valet keys** *(original)* | A padlocked vehicle can't move until its key vehicle leaves. | The key leaves before the lock in the intended order. |
| 73 | **Tour groups** *(original)* | 2–3 friends board together and need that many free seats in one vehicle. | The line is generated with the same rule. |
| 86 | **Rainy days** *(original)* | Umbrellas hide the colors of everyone past the first few in line. | Information only. |

After a twist is introduced, it appears again at random, at most 2 per level.

## Boosters (coins only; no real money, ads, lives or timers)
- **Extra Bay (60):** opens bay 6 for this level. Can rescue a lost board.
- **Lift (80):** pulls any vehicle straight out of the lot into a bay.
- **Sort (50):** reorders the next 16 riders so the ones who can board now
  come first, finishing the fullest vehicles first. Can rescue a lost board.
- **Shuffle (70):** swaps colors between same-sized vehicles in the lot.
  Seat counts stay exact, and a solver must confirm the result is winnable or
  nothing changes.

Each booster unlocks with one free use. Coins come from wins (more on higher
levels) and from streaks: a vehicle leaving within 2 s of the last one builds the
streak meter, and every exit at streak 3 or more pays a coin.

## Separation rules
`GAME_ID = "color-commute"`. All storage keys are `color-commute:*`. Reset removes
only those keys. All paths are relative. Manifest `id = "/color-commute/"`, `start_url
= scope = "./"`. Service worker `./sw.js` with scope `./`, cache
`color-commute-v<N>`, and only `color-commute-v*` caches are ever deleted. Nothing is loaded
from outside the repo.
