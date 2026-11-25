// Dev tool: find a reference design for every campaign level, write them to tests/refs.js and print the
// [budget, par] table to paste into src/levels.js.
//   node tools/make-refs.mjs
import { writeFileSync } from 'node:fs'
import { LEVELS } from '../src/levels.js'
import { autoBuild } from '../src/autobuild.js'
import { simulate } from '../src/physics.js'
import { designCost } from '../src/design.js'

// Levels the stock truss builder cannot do get a hand-made design here.
const HAND = {
  c17: [[0, 0, 2, 0, 'plank'], [2, 0, 4, 0, 'plank'], [0, -2, 2, 0, 'timber'], [0, -2, 2, -1, 'timber'], [2, -1, 4, 0, 'timber'], [2, -1, 2, 0, 'timber']],
}
const SQUEEZE = { c11: 1.15, c20: 1.15 } // the "low budget" levels
const up = (n, to = 100) => Math.ceil(n / to) * to

const refs = {}, money = []
for (const L of LEVELS) {
  // The reference is the cheapest stock design that crosses with every parcel still on board, so it earns all three
  // stars: par is its cost rounded up, and the budget sits 40% above it (15% on the "low budget" levels).
  let design
  if (HAND[L.id]) design = { beams: HAND[L.id] }
  else { const a = autoBuild(L, { margin: 0.92, parcels: true }); design = a && a.design }
  if (!design) { console.log(L.id, L.name, 'NO REFERENCE'); money.push([0, 0]); continue }
  const r = simulate(L, design), cost = designCost(design)
  const par = up(cost), budget = Math.max(400, up(cost * (SQUEEZE[L.id] || 1.4)))
  refs[L.id] = design.beams
  money.push([budget, par])
  const same = L.budget === budget && L.par === par
  console.log(L.id.padEnd(4), L.name.padEnd(18), ('$' + cost).padEnd(7), r.reason, (r.maxStress * 100).toFixed(0) + '%', r.kept + '/' + r.parcels, 'budget', budget, 'par', par, same ? '' : '  <-- levels.js differs')
}
const body = Object.keys(refs).map((k) => '  ' + k + ': ' + JSON.stringify(refs[k]) + ',').join('\n')
writeFileSync(new URL('../tests/refs.js', import.meta.url), '// Reference designs: one bridge per campaign level that is known to cross within budget.\n// Written by tools/make-refs.mjs. Test data only, never shipped in the game.\nexport const REFS = {\n' + body + '\n}\n')
const rows = []
for (let i = 0; i < money.length; i += 8) rows.push('  ' + money.slice(i, i + 8).map((m) => '[' + m[0] + ', ' + m[1] + ']').join(', ') + ',')
console.log('\nconst MONEY = [\n' + rows.join('\n') + '\n]')
