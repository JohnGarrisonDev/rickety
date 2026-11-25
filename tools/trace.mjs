// Dev tool: print a timeline of one stock design on one level.  node tools/trace.mjs <levelNumber> <candidateIndex>
import { LEVELS } from '../src/levels.js'
import { candidates } from '../src/autobuild.js'
import { createWorld, step } from '../src/physics.js'
const L = LEVELS[+process.argv[2] - 1], c = candidates(L)[+process.argv[3] || 0]
const W = createWorld(L, c.design, { events: true })
for (let i = 0; i < 240 * 20 && !W.over; i++) {
  step(W)
  for (const e of W.events) if (e.type !== 'splash') console.log(W.t.toFixed(3), JSON.stringify(e))
  W.events.length = 0
  if (i % 60 === 0) { const v = W.vehicles[0]; console.log(W.t.toFixed(2), v.state, 'x', v.x.toFixed(2), 'y', v.y.toFixed(3), 'tilt', (v.BR.y - v.BL.y).toFixed(3), 'stress', W.maxStress.toFixed(2)) }
}
