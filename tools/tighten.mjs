// Dev tool: look for cheaper three-star bridges by trimming the reference designs in tests/refs.js.
//   node tools/tighten.mjs [levelId ...]      prints what it found; add --write to update tests/refs.js
// Greedy: try every single-beam removal and every steel -> timber swap, biggest saving first; keep the first change
// that still crosses with every parcel and no beam past 85% of its strength (stricter than make-refs.mjs, so the trimmed bridge is not razor-thin).
// Repeat until nothing helps. Par in src/levels.js is then the new cost rounded up to $100 (paste it by hand;
// never raise a par, and stars already earned are kept by the save whatever par says).
import { writeFileSync } from 'node:fs'
import { LEVELS } from '../src/levels.js'
import { simulate, MATERIALS } from '../src/physics.js'
import { designCost, checkDesign, beamLen } from '../src/design.js'
import { REFS } from '../tests/refs.js'

const args = process.argv.slice(2), write = args.includes('--write'), only = args.filter((a) => !a.startsWith('--'))
const good = (L, beams) => {
  if (!checkDesign(L, { beams }).ok) return false
  const r = simulate(L, { beams })
  return r.success && r.kept === r.parcels && r.maxStress <= 0.85
}
const out = { ...REFS }
for (const L of LEVELS) {
  if (only.length && !only.includes(L.id)) continue
  let beams = REFS[L.id].map((b) => b.slice())
  const start = designCost({ beams })
  for (let changed = true; changed;) {
    changed = false
    const moves = []
    beams.forEach((b, i) => {
      const len = beamLen(b[0], b[1], b[2], b[3])
      moves.push({ save: len * MATERIALS[b[4]].cost, next: beams.filter((_, k) => k !== i) })
      if (b[4] === 'steel' && L.materials.includes('timber') && len <= MATERIALS.timber.maxLen) moves.push({ save: len * (MATERIALS.steel.cost - MATERIALS.timber.cost), next: beams.map((c, k) => (k === i ? [c[0], c[1], c[2], c[3], 'timber'] : c)) })
    })
    moves.sort((a, b) => b.save - a.save)
    for (const m of moves) if (good(L, m.next)) { beams = m.next; changed = true; break }
  }
  const cost = designCost({ beams }), par = Math.ceil(cost / 100) * 100
  console.log(L.id.padEnd(4), L.name.padEnd(18), `$${start} -> $${cost}`.padEnd(18), `par ${L.par} -> ${par}`, par < L.par ? '  <-- tighter' : '')
  if (par < L.par) out[L.id] = beams
}
if (write) {
  const body = Object.keys(out).map((k) => '  ' + k + ': ' + JSON.stringify(out[k]) + ',').join('\n')
  writeFileSync(new URL('../tests/refs.js', import.meta.url), '// Reference designs: one bridge per campaign level that is known to cross within budget.\n// Written by tools/make-refs.mjs and trimmed by tools/tighten.mjs. Test data only, never shipped in the game.\nexport const REFS = {\n' + body + '\n}\n')
  console.log('wrote tests/refs.js')
}
