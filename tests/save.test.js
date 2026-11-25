import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaults, sanitise, goals, makeSave } from '../src/save.js'
import { LEVELS } from '../src/levels.js'

const store = (data) => ({ data: { ...defaults(), ...data }, saves: 0, save() { this.saves++ } })

test('junk save data is repaired, never thrown on', () => {
  for (const junk of [null, undefined, 7, 'x', [], { levels: 5, designs: 'no', daily: [], speed: 'fast', cur: 9 }]) assert.deepEqual(sanitise(junk), defaults())
  const s = sanitise({
    levels: { c1: { stars: 9, cost: 200.4 }, c2: { stars: 'x' }, zz: { stars: 3, cost: 1 }, c3: { stars: 2, cost: -5 }, c4: null },
    designs: { c1: [[0, 0, 2, 0, 'plank'], [0, 0, 2, 0, 'cheese'], [0, 0, 2.5, 0, 'plank'], 'x', [1, 2, 3]], hack: [[0, 0, 2, 0, 'plank']], 'daily:2026-11-24': [[0, 0, 2, 0, 'rope']], c2: 'no' },
    daily: { days: { '2026-11-24': { cost: 4310, kept: 9, parcels: 3 }, bad: { cost: 1 }, '2026-11-23': { cost: 'x' } }, streak: 4.6, best: 2, last: '2026-11-24' },
    speed: 2, cur: { mode: 'daily', id: '2026-11-24' }, extra: 'ignored',
  })
  assert.deepEqual(s.levels, { c1: { stars: 3, cost: 200 }, c3: { stars: 2, cost: 0 } })
  assert.deepEqual(s.designs, { c1: [[0, 0, 2, 0, 'plank']], 'daily:2026-11-24': [[0, 0, 2, 0, 'rope']] })
  assert.deepEqual(s.daily, { days: { '2026-11-24': { cost: 4310, kept: 3, parcels: 3 } }, streak: 5, best: 5, last: '2026-11-24' })
  assert.equal(s.speed, 2)
  assert.deepEqual(s.cur, { mode: 'daily', id: '2026-11-24' })
  assert.equal(s.extra, undefined)
  // a streak with no matching day is dropped
  assert.deepEqual(sanitise({ daily: { streak: 9, best: 12, last: '2026-11-24', days: {} } }).daily, { days: {}, streak: 0, best: 12, last: '' })
  assert.equal(sanitise({ cur: { mode: 'hack', id: 'c1' } }).cur, null)
})

test('stars: get across, deliver every parcel, spend par or less', () => {
  const L = { par: 1000 }
  assert.equal(goals(L, { success: false, kept: 0, parcels: 3 }, 500).stars, 0)
  assert.deepEqual(goals(L, { success: true, kept: 2, parcels: 3 }, 1200), { crossed: true, parcels: false, par: false, stars: 1 })
  assert.equal(goals(L, { success: true, kept: 3, parcels: 3 }, 1200).stars, 2)
  assert.equal(goals(L, { success: true, kept: 1, parcels: 3 }, 1000).stars, 2)
  assert.equal(goals(L, { success: true, kept: 3, parcels: 3 }, 1000).stars, 3)
  assert.equal(goals({ par: null }, { success: true, kept: 3, parcels: 3 }, 1).stars, 2)
})

test('levels unlock one at a time and bests only improve', () => {
  const st = store(), save = makeSave(st, LEVELS)
  assert.equal(save.unlocked(0), true); assert.equal(save.unlocked(1), false); assert.equal(save.nextIndex(), 0)
  assert.deepEqual(save.recordLevel('c1', 1, 400), { newStars: true, newBest: true })
  assert.equal(save.unlocked(1), true); assert.equal(save.unlocked(2), false); assert.equal(save.nextIndex(), 1)
  assert.deepEqual(save.recordLevel('c1', 3, 200), { newStars: true, newBest: true })
  assert.deepEqual(save.recordLevel('c1', 1, 300), { newStars: false, newBest: false })
  assert.equal(save.stars('c1'), 3); assert.equal(save.best('c1'), 200); assert.equal(save.best('c2'), null)
  assert.equal(save.totalStars(), 3)
  assert.equal(save.unlocked(99), false)
  assert.ok(st.saves >= 3)
})

test('daily streak: one per day, broken by a missed day, untouched by past days', () => {
  const st = store(), save = makeSave(st, LEVELS)
  assert.equal(save.streak('2026-11-24'), 0)
  assert.deepEqual(save.recordDaily('2026-11-24', '2026-11-24', 5000, 2, 3), { first: true, newBest: true })
  assert.equal(save.streak('2026-11-24'), 1)
  assert.deepEqual(save.recordDaily('2026-11-24', '2026-11-24', 4000, 3, 3), { first: false, newBest: true })
  assert.deepEqual(save.recordDaily('2026-11-24', '2026-11-24', 4500, 3, 3), { first: false, newBest: false })
  assert.deepEqual(st.data.daily.days['2026-11-24'], { cost: 4000, kept: 3, parcels: 3 })
  assert.equal(save.streak('2026-11-24'), 1)
  save.recordDaily('2026-11-25', '2026-11-25', 3000, 3, 3)
  assert.equal(save.streak('2026-11-25'), 2)
  assert.equal(save.streak('2026-11-26'), 2) // still alive the next morning
  assert.equal(save.streak('2026-11-27'), 0) // missed a day
  // playing an old day later does not rescue or extend anything
  save.recordDaily('2026-11-20', '2026-11-27', 3000, 3, 3)
  assert.equal(save.streak('2026-11-27'), 0)
  assert.equal(st.data.daily.last, '2026-11-25')
  save.recordDaily('2026-11-27', '2026-11-27', 3000, 3, 3)
  assert.equal(save.streak('2026-11-27'), 1)
  assert.equal(st.data.daily.best, 2)
})

test('designs in progress are stored per level; only one daily design is kept', () => {
  const st = store({ designs: { c1: [[0, 0, 2, 0, 'plank']] } }), save = makeSave(st, LEVELS)
  assert.deepEqual(save.getDesign('c1'), [[0, 0, 2, 0, 'plank']])
  assert.deepEqual(save.getDesign('c9'), [])
  const beams = [[0, 0, 2, 0, 'plank']]
  save.setDesign('daily:2026-11-24', beams)
  beams[0][4] = 'rope' // the store keeps its own copy
  assert.deepEqual(save.getDesign('daily:2026-11-24'), [[0, 0, 2, 0, 'plank']])
  save.setDesign('daily:2026-11-25', [])
  assert.equal(st.data.designs['daily:2026-11-24'], undefined)
  assert.ok(st.data.designs.c1)
})

test('makeSave cleans whatever the store loaded', () => {
  const st = { data: { levels: 'broken', daily: null, speed: 9, designs: [1, 2] }, save() {} }
  const save = makeSave(st, LEVELS)
  assert.deepEqual(save.data.levels, {})
  assert.equal(save.data.speed, 1)
  assert.equal(save.totalStars(), 0)
})
