# Rickety

Build a bridge on a budget. Press Go. Hope.

Rickety is a bridge-building physics game for [Oddvale Games](https://games.oddvale.com/rickety/). The robots of Oddvale need the Cart, its odd robot driver and a teetering stack of parcels on the other side of a canyon. You drag planks, timber, steel and rope between joints, press Go, and watch the bridge hold, sag, creak or fall in the water. Every beam shows how close it is to snapping.

- **Campaign:** 24 levels in three chapters. Three stars each: get across, deliver every parcel, spend no more than par.
- **Daily gap:** one generated canyon per date, the same for everyone. The cheapest bridge that crosses is your score, with a streak and a copyable result.
- **Sandbox:** three wide maps with no budget.

Like every Oddvale game it was designed and coded by AI models, and AI models keep updating it.

## Run it
No build step and no dependencies. Serve the folder with any static server and open it:

```
npx serve .
```

Tests (Node 20 or newer):

```
node --test tests/
```

Add `?debug` to the URL for the `window.__game` test hook (see AGENTS.md).

## How the code is laid out
```
index.html          the page (shell from kit/, the game lives in .stage)
game.json           metadata the Oddvale hub reads
src/main.js         flow, frame loop, building input, events to sound and particles, debug hook
src/physics.js      the simulation: particles, beams, vehicles, contacts, breaking. No DOM
src/design.js       build rules: what a design is, what may be added, cost, undo history. No DOM
src/levels.js       the level format, the 24 campaign levels and the 3 sandbox maps. No DOM
src/autobuild.js    draws stock bridges and tests them headless (daily solvability, reference designs). No DOM
src/daily.js        the daily generator, date helpers, share text. No DOM
src/save.js         save schema, repair of bad data, stars, unlocks, streak. No DOM
src/render.js       canvas drawing, camera, particles
src/input.js        pointer gestures (grab, tap, pan, pinch, wheel)
src/ui.js           DOM overlays: HUD, toolbars, title, level select, result card
src/audio.js        synth sound effects
kit/                copy of the Oddvale kit (do not edit; re-copy from the hub)
tests/              node tests, plus refs.js (one known three-star bridge per campaign level)
tools/              dev scripts: make-refs, probe, try, trace, daily
```

See [AGENTS.md](AGENTS.md) for the physics in detail, the level format, how to add levels and the ideas backlog.

## License
Code is MIT licensed, see [LICENSE](LICENSE). The fonts in `kit/fonts/` (Fraunces, Figtree, DM Mono) are under the SIL Open Font License 1.1. The Oddvale name and mark are not covered by the MIT license.
