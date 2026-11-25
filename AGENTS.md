# Notes for the next AI working on Rickety

Read the hub's `GAME_GUIDE.md` first (no build step, no dependencies, relative URLs, localStorage only, strict CSP, phone and desktop). This file covers this game.

## What it is
A side-view bridge builder. The player lays beams on a 1 m grid between fixed anchors, within a budget, then presses Go. A deterministic particle-and-constraint simulation drives a Cart (or Truck) over the result. Canvas rendering in the flat Oddvale print style, DOM overlays for the UI.

## Architecture
| File | Job |
| --- | --- |
| `src/physics.js` | The simulation. No DOM. `createWorld(level, design)`, `step(world)` (one 1/240 s substep), `simulate(level, design)` (headless run to the end), `summary`, `timeLimit`, `MATERIALS`, `VEHICLES`, `groundAt`. |
| `src/design.js` | Build rules. A design is `{ beams: [[ax, ay, bx, by, materialId], ...] }` in whole metres. `canAdd`, `checkDesign`, `cleanDesign`, `designCost`, `snapTarget`, `makeHistory`. |
| `src/levels.js` | `makeLevel(options)`, `LEVELS` (24), `SANDBOX` (3), `CHAPTERS`, and the `MONEY` table of `[budget, par]`. |
| `src/autobuild.js` | `candidates(level)` draws stock bridges (deck, Warren trusses of three heights in timber or steel, struts and ropes to spare anchors). `autoBuild(level, { margin, parcels })` returns the cheapest one that crosses. |
| `src/daily.js` | `dailyLevel(date)`, date helpers, `levelHash`, `shareText`, `money`. |
| `src/save.js` | Save schema, `sanitise`, `goals` (the three stars), `makeSave` (unlocks, bests, streak, stored designs). |
| `src/main.js` | Flow (title, build, run, result), frame loop, building input, physics events to sound and particles, keyboard, `?debug` hook. |
| `src/render.js` | Everything on the canvas: scenery, beams with the stress ramp, vehicles, particles, build overlays, the touch loupe, the camera. |
| `src/input.js` | Classifies pointer gestures: grab (drag from a joint), tap, pan, pinch, wheel, right-click. |
| `src/ui.js` | HUD, build toolbar, run bar, toast, and the title / level select / sandbox / menu / result panels. Buttons carry `data-act`; `main.js` `onAction` handles them. |
| `src/audio.js` | Sounds from the kit's `sfx` synth, all rate-limited. |
| `tests/` | `node --test tests/`. `tests/refs.js` holds one reference bridge per campaign level (test data, never shipped). |
| `tools/` | `make-refs.mjs` (writes `tests/refs.js`, prints the `MONEY` table), `probe.mjs` (every stock design on campaign levels), `try.mjs` (probe a made-up canyon), `trace.mjs` (timeline of one run), `daily.mjs` (list daily gaps). |

### Physics in one page
- Units: metres, seconds, y up. Gravity 9.8. Fixed substep `H = 1/240`, `ITER = 10` solver passes per substep. XPBD: each beam is a distance constraint with compliance `breakStrain * length / strength`, so its Lagrange multiplier gives the real force in it.
- **Determinism:** only `+ - * /` and `Math.sqrt` touch simulation state. No trig, no `Math.hypot`, no `Math.random`. Keep it that way: the daily gap's budget comes from a simulated run, so every browser must agree. A test checks two runs hash the same.
- Joints are point masses (0.1 plus half of each attached beam). Anchors have infinite mass. Stress = |force| / strength, low-pass filtered (`STRESS_SMOOTH`) so a single hard bump does not snap things. At 1 a beam snaps into two stubs that keep swinging from their joints (stubs never break and never carry wheels).
- Rope is one-sided: its multiplier is clamped so it can only pull.
- For the first second (`SETTLE`) gravity ramps in and everything is heavily damped, so a bridge settles under its own weight instead of bouncing. Vehicles start after that (plus their `delay`).
- A vehicle is 8 rigidly linked body particles, 2 wheel particles on soft links (the suspension), and loose parcels. Wheels and parcels are circles with spin. Circles collide with plank beams (the only drivable material), the terrain polyline and, for parcels, their own vehicle's tray. Mostly-flat segments are one-sided: a circle up to one radius below the line is pushed back up. That, plus `MAX_SPEED * H` being well under the smallest radius, is the anti-tunnelling argument (tested up to 24 m/s).
- Traction is real: the motor spins the wheels towards a target surface speed (throttle eases in at `ACCEL` so parcels are not thrown off), and Coulomb friction at the contact turns spin into motion and pushes back on the deck.
- Vehicles do not collide with each other (separate lanes), and parcels only collide with parcels from their own vehicle.
- A run ends when every vehicle is `done` (passed its goal x), `lost` (below the pit surface) or `stuck` (under 0.5 m of progress in `STUCK_AFTER` seconds). Parcels count as delivered if they are still within reach of their vehicle's tray at that moment.
- `world.events` (only when created with `{ events: true }`) receives `snap`, `splash`, `start`, `goal`, `lost`, `stuck`, `over`. The game drains it every substep.

### Materials (balance lives in `MATERIALS`)
| | $/m | max length | strength | notes |
| --- | --- | --- | --- | --- |
| Plank | 100 | 2.3 m | 80 | the road; wheels only roll on planks |
| Timber | 140 | 3.2 m | 115 | structure |
| Steel | 420 | 4.3 m | 320 | stiffer, heavier |
| Rope | 90 | 8.1 m | 150 | tension only |

The Cart weighs about 31 units, the Truck about 64. A hanging, unsupported deck fails under the Cart; a 2 m tall timber truss is good to roughly 12 m.

### Save data (`oddvale:rickety`)
`{ v, levels: { id: { stars, cost } }, designs: { id | 'daily:DATE': beams }, daily: { days: { DATE: { cost, kept, parcels } }, streak, best, last }, speed, cur: { mode, id } | null }`. `sanitise` repairs anything malformed. Never break old saves: add fields with defaults, migrate on `v`. The bridge in progress is saved on every edit and `cur` reopens the level after a reload.

## Level format
```js
{
  id: 'c5', name: 'Uphill Battle', hint: 'One short line, under 80 characters.',
  terrain: [[x, y], ...],          // ONE polyline, x never decreasing. The ground is everything below it.
  anchors: [[x, y], ...],          // fixed joints, whole metres. One hanging in the air is drawn on a pole.
  pit: { kind: 'water' | 'lava' | 'mist', y },  // surface the gap is filled to; a vehicle below it is lost
  vehicles: [{ type: 'cart' | 'truck', x, dir: 1 | -1, goal, delay, speed }],
  budget, par,                     // budget null = unlimited (sandbox); par null = no par star (daily)
  materials: ['plank', 'timber'],  // palette, in order
  build: [x0, y0, x1, y1],         // new joints must be inside this box and not inside rock
  view: [x0, y0, x1, y1],          // what the camera fits
  spans: [{ L: [x, y], R: [x, y] }], // road ends: auto-builder only. Even width, at most 1 m of rise per 2 m.
  rim: [[x, y], ...],              // line across the top of the gap; the far wall is painted under it
}
```
`makeLevel({ w, rh, depth, rocks, anchors, vehicles, materials, pit })` builds all of that for a standard canyon: left edge at (0, 0), right edge at (w, rh), rocks are `[x, topY]` pillars with an anchor on top, `anchors` are extras (cliff faces, towers). Pass `terrain` / `anchorsOnly` / `build` / `view` / `spans` for odd shapes (see `custom()` in `levels.js` for the jump and the double-decker).

## Adding or changing a level
1. Add it to `RAW` in `src/levels.js` (or to `custom()`), with a placeholder row in `MONEY`.
2. `node tools/probe.mjs <levelNumber>` shows what every stock design does on it. `node tools/try.mjs '{"w":14,"rocks":[[6,-3]]}'` tries an idea without editing anything.
3. `node tools/make-refs.mjs` finds the cheapest stock design that crosses with every parcel, writes it to `tests/refs.js`, and prints the `MONEY` table. Paste the table into `levels.js` and run it again until nothing says "differs". If the stock builder cannot solve a level, put a hand-made design in `HAND` in that tool (build it in the browser with `?debug`, then copy `__game.G.design.beams`).
4. `node --test tests/`. The tests insist that every campaign level has valid data, that doing nothing fails, and that its reference design is legal, within budget and earns all three stars.
5. Look at it in the browser at desktop size and at about 390 x 800.

Rules that have held up:
- One new idea per level in a chapter's first half, then combine.
- Keep spans even and put rocks at even x if you want the stock builder (and so the reference) to use them directly.
- Downhill steps are bumpy and shake the top parcel loose. Check the parcel star is still possible (the reference test does).
- Par is the reference cost rounded up to $100; the budget is 40% above the reference (15% on the two squeeze levels, 11 and 20). A careful player can beat par by leaving beams out.

## The daily gap
- `dailyLevel(date)` seeds `makeRng(hashString('rickety:' + date))`, draws up to 8 candidate canyons with whole-number choices only, and takes the first one that `autoBuild(level, { margin: 0.85 })` can cross. Budget = that design's cost x 1.35, rounded up to $50. If all 8 fail (not seen in testing) it uses a fixed easy canyon.
- **Snapshot rule:** `tests/daily.test.js` pins the level hash for four dates. If that test fails, you changed everyone's daily gap. That happens if you touch `dailyCandidate`, `makeLevel`, the auto-builder's designs or order, material numbers, vehicle numbers or anything in `step`. Only update the hashes on purpose, in a release whose changelog says the daily changed, and never in a way that changes a day already played if you can avoid it (version the generator with `DAILY_VERSION` and a date cut-over instead).
- The streak counts a day once, on the day itself. Replaying a day only improves its best cost.

## Player input (`kit/talk.js`)
The hub's anonymous player-input widgets (copy of the kit, do not edit). `showResult` asks `ui.result` for a `[data-talk]` slot under the buttons when a daily run crossed (today's gap, or yesterday's finished after midnight) and calls `dailyTalk` with `key` = the gap's date and `score` = the day's best cost in dollars (lower is better; API board `gap`, the default). Only the first score is stored by the API; later, cheaper crossings just re-check the percentile. Boot calls `tellUs` into `#tell-us`. Both stay hidden when the API (`/api/v1/`) is unreachable.

## Testing in a browser
- `?debug` exposes `window.__game`: `state()`, `goto(i)`, `daily(date)`, `sandbox(id)`, `title()`, `unlockAll()`, `add(ax, ay, bx, by, mat)`, `setDesign(beams)`, `solve()` (loads the reference from `tests/refs.js` on a dev server, else the auto-builder's), `go()`, `stop()`, `action(name, arg)`, `advance(seconds)` (runs the loop without waiting for frames; background tabs throttle `requestAnimationFrame`), `draw()`.
- Before shipping: no console errors, play a level with the mouse, with the keyboard only, and with touch-style pointer events at phone size, reload mid-build and check the bridge is still there.

## Known weak spots
- The stock builder only knows trusses, struts and stays, so par on some levels is generous. Hand-tuned pars would be tighter.
- Build joints only exist on the 1 m grid, so every slope is a 27 or 45 degree step. Half-metre snapping would make gentler ramps possible but would change the feel of every level.
- Vehicles pass through each other and through structure (only planks are solid to wheels). It reads fine, but a convoy can visually overlap.
- Parcels are circles drawn as boxes. They behave, but they do not stack like real boxes.
- The clipboard copy cannot be tested in an automated background tab; if the browser refuses, the result text is shown for manual copying.
- Sound was tuned by reading the code, not by ear.

## Backlog (ideas for future updates)
- Replay of your best run per level, and a slow-motion toggle for collapses.
- A stress heat-map overlay in build mode from the last run, so players can see what to trim.
- Hydraulics: a beam that changes length on a timer, for drawbridges.
- Boats or balloons that need clearance under or over the bridge.
- A second campaign chapter set with wind, or with a cart that carries one giant parcel.
- Daily archive (past days, never counting for the streak) and a weekly "big gap".
- Per-level leaderboards are impossible without a server, but a shareable design code in the URL hash would let friends compare bridges.
- Half-metre grid as an optional fine mode.
- Colour-blind check of the stress ramp (it already has swelling, shaking and crack marks as non-colour cues).
- Robots that react more: the watchers could cover their eye when a beam cracks.
