import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng } from '../kit/kit.js'
import { dailyLevel, dailyCandidate, dailySeed, dateKey, isDateKey, shiftDate, levelHash, shareText, money, generateDaily, tableDaily, tableRow, dailyVersion, DAILY_V2_FROM, steelShare } from '../src/daily.js'
import { DAILY_TABLE } from '../src/daily-table.js'
import { autoBuild, candidates, deckNodes } from '../src/autobuild.js'
import { simulate } from '../src/physics.js'
import { checkDesign } from '../src/design.js'

test('date keys', () => {
  assert.equal(dateKey(new Date(2026, 10, 24, 23, 59)), '2026-11-24')
  assert.equal(dateKey(new Date(2027, 0, 1, 0, 0)), '2027-01-01')
  assert.equal(shiftDate('2026-11-24', -1), '2026-11-23')
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDate('2028-03-01', -1), '2028-02-29')
  assert.equal(isDateKey('2026-11-24'), true)
  for (const bad of ['', '2026-1-1', 'yesterday', null, 20261124, '2026-99-99x']) assert.equal(isDateKey(bad), false)
  assert.notEqual(dailySeed('2026-11-24'), dailySeed('2026-11-25'))
})

test('the generator never touches Math.random and is the same every time', () => {
  const real = Math.random
  Math.random = () => { throw new Error('Math.random used in the daily generator') }
  try {
    const a = dailyCandidate(makeRng(dailySeed('2026-11-24'))), b = dailyCandidate(makeRng(dailySeed('2026-11-24')))
    assert.deepEqual(a, b)
    const one = dailyLevel('2031-05-06')
    assert.equal(dailyLevel('2031-05-06'), one) // cached
    assert.equal(one.level.date, '2031-05-06')
  } finally { Math.random = real }
})

test('every daily gap is solvable: the auto-builder crosses it within budget, with margin', () => {
  let d = '2026-11-24'
  const kinds = new Set(), widths = new Set()
  for (let i = 0; i < 45; i++, d = shiftDate(d, 1)) {
    const { level, refCost, tries } = dailyLevel(d)
    assert.ok(tries >= 1, `${d}: fell back to the stock canyon`)
    assert.equal(level.id, 'daily'); assert.equal(level.par, null)
    assert.ok(level.name.length > 3)
    const ref = autoBuild(level, { margin: 0.85 })
    assert.ok(ref, `${d}: no stock design crosses`)
    assert.equal(ref.cost, refCost)
    assert.ok(ref.result.maxStress <= 0.85)
    assert.ok(level.budget >= refCost * 1.3 && level.budget <= refCost * 1.4 + 50 && level.budget % 50 === 0, `${d}: budget ${level.budget} vs ref ${refCost}`)
    assert.equal(checkDesign(level, ref.design).ok, true)
    assert.equal(simulate(level, { beams: [] }).success, false, `${d}: crossing must need a bridge`)
    kinds.add(level.pit.kind); widths.add(level.spans[0].R[0])
    for (const p of level.terrain) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]))
  }
  assert.ok(kinds.size >= 3 && widths.size >= 4, 'the canyons vary')
})

// Snapshot: if any of these change, every player's daily gap changed. Only update them on purpose (see AGENTS.md).
// Generator 1 (the 1.0-1.2 generator) must keep producing exactly these.
const SNAPSHOT_V1 = { '2026-11-24': 1761365258, '2026-12-25': 2655669589, '2027-03-14': 452888248, '2028-02-29': 2093691685 }
// What players get. 1.3 changed 2028-02-29 on purpose: under generator 1 it was a $29,020 bridge, 91% steel.
const SNAPSHOT = { '2026-11-24': 1761365258, '2026-12-25': 2655669589, '2027-03-14': 452888248, '2028-02-29': 3825834858 }
test('snapshot hashes for a few dates', () => {
  for (const [date, hash] of Object.entries(SNAPSHOT_V1)) assert.equal(levelHash(generateDaily(date, 1).level), hash, `generator 1 changed for ${date}`)
  for (const [date, hash] of Object.entries(SNAPSHOT)) assert.equal(levelHash(dailyLevel(date).level), hash, `the daily gap for ${date} changed`)
})

const same = (a, b) => JSON.stringify(a.level) === JSON.stringify(b.level) && a.refCost === b.refCost && a.tries === b.tries

test('no published daily changes: every date up to 2026-11-27 comes out exactly as the 1.2 generator made it', () => {
  assert.equal(DAILY_V2_FROM, '2026-11-28')
  // Everything from a month before launch (2026-11-24) to the cut-over, through the path the game uses (the table
  // where it has the date, else the generator), compared field for field with generator 1.
  for (let d = '2026-10-25'; d <= '2026-11-27'; d = shiftDate(d, 1)) {
    assert.equal(dailyVersion(d), 1, d)
    assert.ok(same(dailyLevel(d), generateDaily(d, 1)), `the daily gap for ${d} changed`)
  }
})

test('generator 2 only passes over steel-heavy Cart days', () => {
  for (let d = '2026-11-28', i = 0; i < 40; i++, d = shiftDate(d, 1)) {
    const v1 = generateDaily(d, 1), v2 = generateDaily(d, 2)
    if (same(v1, v2)) continue
    const ref = autoBuild(v1.level, { margin: 0.85 })
    assert.ok(v1.level.vehicles.every((v) => v.type === 'cart') && steelShare(ref.design) > 0.4, `${d} changed without being steel-heavy`)
  }
})

test('the pre-generated table matches the generator byte for byte', () => {
  const days = DAILY_TABLE.rows.length
  assert.ok(days >= 365, 'the table covers at least a year')
  assert.equal(shiftDate(DAILY_TABLE.from, days - 1), DAILY_TABLE.to)
  assert.equal(tableRow(shiftDate(DAILY_TABLE.from, -1)), null); assert.equal(tableRow(shiftDate(DAILY_TABLE.to, 1)), null)
  assert.equal(tableDaily(shiftDate(DAILY_TABLE.to, 1)), null)
  // the first two weeks and every 23rd day after (a full check is `node tools/daily-table.mjs` and a diff)
  for (let i = 0; i < days; i += i < 14 ? 1 : 23) {
    const d = shiftDate(DAILY_TABLE.from, i), t = tableDaily(d)
    assert.ok(t, `${d} missing from the table`)
    assert.ok(same(t, generateDaily(d)), `the table is stale for ${d}: re-run tools/daily-table.mjs`)
  }
})

test('the auto-builder draws legal bridges', () => {
  assert.deepEqual(deckNodes({ L: [0, 0], R: [8, 2] }), [[0, 0], [2, 1], [4, 1], [6, 2], [8, 2]])
  assert.equal(deckNodes({ L: [0, 0], R: [7, 0] }), null)
  assert.equal(deckNodes({ L: [0, 0], R: [4, 3] }), null)
  const { level } = dailyLevel('2026-11-24')
  const list = candidates(level)
  assert.ok(list.length >= 2)
  for (let i = 0; i < list.length; i++) {
    assert.equal(checkDesign({ ...level, budget: null }, list[i].design).ok, true)
    if (i) assert.ok(list[i].cost >= list[i - 1].cost, 'cheapest first')
  }
})

test('share text is short, spoiler-free and ends with the URL', () => {
  assert.equal(money(4310), '$4,310'); assert.equal(money(950), '$950'); assert.equal(money(1234567), '$1,234,567')
  const t = shareText('2026-11-24', { cost: 4310, kept: 3, parcels: 3 })
  assert.equal(t, 'Rickety 2026-11-24 · crossed for $4,310 · 3/3 parcels\nhttps://games.oddvale.com/rickety/')
  assert.ok(shareText('2026-11-24', null).endsWith('\nhttps://games.oddvale.com/rickety/'))
})
