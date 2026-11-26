// Dev tool: pre-generate the daily gaps so the game never runs the auto-builder for a daily.
//   node tools/daily-table.mjs [from] [to]      (default 2026-11-19 .. 2027-12-31), writes src/daily-table.js
// Each row is [tries, reference cost]; the game replays the rng to that candidate (see tableDaily in src/daily.js).
// Re-run it whenever the generator changes (and version the generator by date, see AGENTS.md). Extend `to` before
// the table runs out; past its end the game falls back to generating in the browser.
import { writeFileSync } from 'node:fs'
import { generateDaily, shiftDate } from '../src/daily.js'

const from = process.argv[2] || '2026-11-19', to = process.argv[3] || '2027-12-31'
const rows = []
const t0 = Date.now()
for (let d = from; d <= to; d = shiftDate(d, 1)) {
  const { refCost, tries } = generateDaily(d)
  rows.push([tries, refCost])
}
const lines = []
for (let i = 0; i < rows.length; i += 10) lines.push('  ' + rows.slice(i, i + 10).map((r) => JSON.stringify(r)).join(', ') + ',')
const src = `// Pre-generated daily gaps: [tries, reference cost] per date, one row per day from \`from\` to ${to}.
// Written by tools/daily-table.mjs from generateDaily() in daily.js. Do not edit by hand; tests/daily.test.js checks it.
export const DAILY_TABLE = { from: '${from}', to: '${to}', rows: [
${lines.join('\n')}
] }
`
writeFileSync(new URL('../src/daily-table.js', import.meta.url), src)
console.log(`${rows.length} days in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
