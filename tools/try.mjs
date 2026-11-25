// Dev tool: probe a made-up canyon with every stock design.
//   node tools/try.mjs '{"w":18,"materials":["plank","timber","steel"]}'
import { makeLevel } from '../src/levels.js'
import { candidates } from '../src/autobuild.js'
import { simulate } from '../src/physics.js'

for (const arg of process.argv.slice(2)) {
  const L = makeLevel(JSON.parse(arg))
  console.log(arg)
  for (const c of candidates(L)) {
    const r = simulate(L, c.design)
    console.log(`  $${c.cost} beams ${c.design.beams.length} -> ${r.reason} stress ${(r.maxStress * 100).toFixed(0)}% broken ${r.broken} parcels ${r.kept}/${r.parcels}`)
  }
}
