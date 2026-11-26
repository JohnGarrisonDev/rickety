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
| `src/daily.js` | `dailyLevel(date)` (table first, else `generateDaily`), `generateDaily(date, version)`, `tableDaily`, date helpers, `levelHash`, `shareText`, `money`. |
| `src/daily-table.js` | Pre-generated `[tries, refCost]` per date, 2026-11-19 to 2027-12-31 (the whole archive window from launch). Written by `tools/daily-table.mjs`. |
| `src/save.js` | Save schema, `sanitise`, `goals` (the three stars), `makeSave` (unlocks, bests, streak, stored designs). |
| `src/main.js` | Flow (title, build, run, result), frame loop, building input, physics events to sound and particles, keyboard, `?debug` hook. |
| `src/render.js` | Everything on the canvas: scenery, beams with the stress ramp, vehicles, particles, build overlays, the touch loupe, the camera. |
| `src/input.js` | Classifies pointer gestures: grab (drag from a joint), tap, pan, pinch, wheel, right-click. `pointercancel` and lost capture cancel a grab; a touch long-press (contextmenu) is swallowed, never a delete. |
| `src/ui.js` | HUD, build toolbar, run bar, toast, and the title / level select / sandbox / menu / result panels. Buttons carry `data-act`; `main.js` `onAction` handles them. |
| `src/audio.js` | Sounds from the kit's `sfx` synth, all rate-limited. |
| `tests/` | `node --test tests/`. `tests/refs.js` holds one reference bridge per campaign level (test data, never shipped). |
| `tools/` | `make-refs.mjs` (writes `tests/refs.js`, prints the `MONEY` table), `probe.mjs` (every stock design on campaign levels), `try.mjs` (probe a made-up canyon), `trace.mjs` (timeline of one run), `daily.mjs` (list daily gaps), `daily-table.mjs` (rewrite `src/daily-table.js`, about a minute), `tighten.mjs` (trim reference designs for cheaper three-star bridges). |

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
- Pars (1.3): `tools/tighten.mjs` trims the reference designs greedily (drop a beam or swap steel for timber, keep it if it still crosses with every parcel and no beam over 85%). Nine pars came down to the trimmed cost rounded up, but by no more than 25% in one release: c9 4600 to 3500, c10 5600 to 4600, c12 14600 to 12300, c14 10000 to 7500, c16 8300 to 7900, c19 12000 to 9600, c22 12300 to 9300, c23 15000 to 11300, c24 26500 to 19900. Budgets did not change. c20 got a cheaper reference but kept par 4800 to stay a squeeze. The trimmed bridges for c22, c23 and c24 cost less than the new pars ($8,890, $8,500, $19,310), so those can come down again later. `tools/make-refs.mjs` now reports these levels as "differs" (it only knows the stock designs) and rewrites `tests/refs.js` with stock designs: after running it, run `node tools/tighten.mjs --write` again, and do not paste its MONEY table back over the tightened pars. Stars are stored as earned (`recordLevel` keeps the max), so tighter pars never take stars away.

## The daily gap
- `generateDaily(date, version)` seeds `makeRng(hashString('rickety:' + date))`, draws up to 8 candidate canyons with whole-number choices only, and takes the first one that `autoBuild(level, { margin: 0.85 })` can cross. Budget = that design's cost x 1.35, rounded up to $50. If all 8 fail (not seen in testing) it uses a fixed easy canyon.
- **Versions by date** (`dailyVersion`): 1 up to 2026-11-27, 2 from `DAILY_V2_FROM` = 2026-11-28. Version 2 passes over a Cart-only candidate whose reference bridge spends more than 40% of its cost on steel (`steelShare`) and takes the next one (or the first heavy one if all are heavy). Days whose first solvable candidate was not steel-heavy are identical in both versions; in the first 40 days after the cut-over only 2026-12-19 and 2027-01-01 change, and 2028-02-29 (a snapshot date) went from $29,020 to $7,800. Never change version 1. A new rule is version 3 from a future date.
- **The table**: the browser never runs the auto-builder for a dated daily inside `src/daily-table.js`. `tableDaily(date)` replays the rng to the winning candidate (`tries`) and sets the budget from the stored reference cost, a few ms instead of up to most of a second. Dates outside the table (before 2026-11-19, after 2027-12-31) fall back to `generateDaily`. **Extend the table before 2027-12-31** (`node tools/daily-table.mjs 2026-11-19 2028-12-31`) and **re-run it after any generator change**. `tests/daily.test.js` checks the first two weeks and every 23rd day against `generateDaily` byte for byte.
- **Snapshot rule:** `tests/daily.test.js` pins `SNAPSHOT_V1` (generator 1 must never change), `SNAPSHOT` (what players get), and compares every date from 2026-10-25 to 2026-11-27 with generator 1 field for field. If those fail, you changed published dailies. That happens if you touch `dailyCandidate`, `makeLevel`, the auto-builder's designs or order, material numbers, vehicle numbers or anything in `step`: version it by date instead.
- The streak counts a day once, on the day itself. Replaying a day only improves its best cost.
- **Archive (1.3):** the title's 7-day strip is buttons (`data-act="day"`): today and the six days before it (`inArchive` in `main.js`) open with `openDaily(date)`; past days record a best cost but never touch the streak (`recordDaily` already did that), and a reload resumes any day in the window. `setDesign` keeps the 7 most recent daily designs (it used to keep one). Day buttons are 44px tall and up to 44px wide (about 40px wide on a 360px phone; seven do not fit at 44).

## Keys and full screen (1.3)
- The keydown handler returns early on Escape while `html.stage-focus` is set (iPhone full-screen path): the kit's window listener leaves full screen, and the game does nothing else. The document listener runs before the kit's window listener, so the class is still there when it checks.
- In full screen on an upright phone, `.overlay` (and the result overlay) get 60px top padding so panels never sit under the exit button.
- The day strip's `.cue` ("Tap a day to play it") shows only under `max-height: 470px`, where the note is hidden.
- Share text ends with `https://games.oddvale.com/rickety/`. In the page (not full screen) at 844x390 the title panel still scrolls inside a 470x294 stage, as before 1.3.

## Player input (`kit/talk.js`)
The hub's anonymous player-input widgets (copy of the kit, do not edit). `showResult` asks `ui.result` for a `[data-talk]` slot under the buttons when a daily run crossed (today's gap, or yesterday's finished after midnight) and calls `dailyTalk` with `key` = the gap's date and `score` = the day's best cost in dollars (lower is better; API board `gap`, the default). Only the first score is stored by the API; later, cheaper crossings just re-check the percentile. Boot calls `tellUs` into `#tell-us`. Both stay hidden when the API (`/api/v1/`) is unreachable.

## Phones and full screen
- `wireChrome({ stage })` (kit) gives native full screen or, on iPhone, the focus mode; both set `.stage.is-full`. `src/game.css` pads the HUD, bars, toast and overlays with `env(safe-area-inset-*)` there and keeps the HUD clear of the kit's exit button.
- `layout()` measures the HUD and the bottom bar against the canvas rect (the canvas is inset by the safe areas in full screen) to set `R.inset`. When the stage flips between tall and wide it re-runs `fitZoom()`, unless the player has zoomed or panned (`G.autoZoom`).
- Touch drag: the target floats 46 px above the finger and the loupe shows it magnified. Dragging onto the toolbar/HUD (`d.off`) cancels on release, with a toast.
- `haptic()` on place, the first snap and the end of a run.

## Testing in a browser
- `?debug` exposes `window.__game`: `state()`, `goto(i)`, `daily(date)`, `sandbox(id)`, `title()`, `unlockAll()`, `add(ax, ay, bx, by, mat)`, `setDesign(beams)`, `solve()` (loads the reference from `tests/refs.js` on a dev server, else the auto-builder's), `go()`, `stop()`, `action(name, arg)`, `advance(seconds)` (runs the loop without waiting for frames; background tabs throttle `requestAnimationFrame`), `draw()`.
- Before shipping: no console errors, play a level with the mouse, with the keyboard only, and with touch-style pointer events at phone size, reload mid-build and check the bridge is still there.

## Known weak spots
- The stock builder only knows trusses, struts and stays; 1.3 trimmed nine pars (see above), the rest still come from untrimmed stock designs, and nobody has played the new pars by hand.
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
- A weekly "big gap". (The 7-day daily archive shipped in 1.3.)
- Per-level leaderboards are impossible without a server, but a shareable design code in the URL hash would let friends compare bridges.
- Half-metre grid as an optional fine mode.
- Colour-blind check of the stress ramp (it already has swelling, shaking and crack marks as non-colour cues).
- Robots that react more: the watchers could cover their eye when a beam cracks.
