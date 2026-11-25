import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng } from '../kit/kit.js'
import { dailyLevel, dailyCandidate, dailySeed, dateKey, isDateKey, shiftDate, levelHash, shareText, money } from '../src/daily.js'
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
const SNAPSHOT = { '2026-11-24': 1761365258, '2026-12-25': 2655669589, '2027-03-14': 452888248, '2028-02-29': 2093691685 }
test('snapshot hashes for a few dates', () => {
  for (const [date, hash] of Object.entries(SNAPSHOT)) assert.equal(levelHash(dailyLevel(date).level), hash, `the daily gap for ${date} changed`)
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
  assert.equal(t, 'Rickety 2026-11-24 · crossed for $4,310 · 3/3 parcels\ngames.oddvale.com/rickety')
  assert.ok(shareText('2026-11-24', null).endsWith('games.oddvale.com/rickety'))
})
