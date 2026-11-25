// Dev tool: list the daily gaps for a run of dates.   node tools/daily.mjs [startDate] [days]
import { dailyLevel, shiftDate, levelHash } from '../src/daily.js'

const start = process.argv[2] || '2026-11-24', n = +process.argv[3] || 30
let worst = 0
for (let i = 0; i < n; i++) {
  const date = shiftDate(start, i), t0 = Date.now()
  const { level: L, refCost, tries } = dailyLevel(date)
  const ms = Date.now() - t0
  if (ms > worst) worst = ms
  const w = L.spans[0].R[0], rh = L.spans[0].R[1]
  console.log(date, L.name.padEnd(16), `w${w} rh${rh}`.padEnd(9), L.vehicles[0].type.padEnd(5), L.pit.kind.padEnd(5), `anchors ${L.anchors.length}`, L.materials.join('+').padEnd(24), `ref $${refCost} budget $${L.budget} tries ${tries} ${ms}ms hash ${levelHash(L)}`)
}
console.log('slowest', worst, 'ms')
