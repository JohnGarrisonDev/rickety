// Dev tool: run every stock auto-builder design on campaign levels and print what happens.
//   node tools/probe.mjs [levelNumber ...]
import { LEVELS, SANDBOX } from '../src/levels.js'
import { candidates } from '../src/autobuild.js'
import { simulate } from '../src/physics.js'

const pick = process.argv.slice(2).map(Number)
const all = [...LEVELS, ...SANDBOX]
for (let i = 0; i < all.length; i++) {
  if (pick.length && !pick.includes(i + 1)) continue
  const L = all[i]
  console.log(`\n#${i + 1} ${L.name}  budget ${L.budget} par ${L.par}`)
  const t0 = Date.now()
  for (const c of candidates(L)) {
    const r = simulate(L, c.design)
    console.log(`  $${c.cost} beams ${c.design.beams.length} -> ${r.reason} t=${r.t.toFixed(1)} stress ${(r.maxStress * 100).toFixed(0)}% broken ${r.broken} parcels ${r.kept}/${r.parcels}`)
  }
  console.log(`  (${Date.now() - t0} ms)`)
}
