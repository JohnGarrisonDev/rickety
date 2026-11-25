import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BEAMS, addBeam, beamCost, beamKey, canAdd, checkDesign, cleanDesign, designCost, findBeam, hasJoint, jointOk, jointsOf, makeHistory, snapTarget } from '../src/design.js'
import { makeLevel } from '../src/levels.js'

const level = makeLevel({ id: 't', name: 't', w: 8, budget: 1000, par: 600, materials: ['plank', 'timber', 'rope'] })
const fresh = () => ({ beams: [] })

test('beams cost by the metre, rounded to $10', () => {
  assert.equal(beamCost(2, 'plank'), 200)
  assert.equal(beamCost(Math.sqrt(5), 'timber'), 310)
  const d = { beams: [[0, 0, 2, 0, 'plank'], [0, 0, 1, 2, 'timber']] }
  assert.equal(designCost(d), 510)
})

test('max length is enforced per material', () => {
  const d = fresh()
  assert.equal(canAdd(level, d, 0, 0, 2, 0, 'plank').ok, true)
  assert.equal(canAdd(level, d, 0, 0, 2, 1, 'plank').ok, true) // 2.24 m
  assert.equal(canAdd(level, d, 0, 0, 3, 0, 'plank').reason, 'long')
  assert.equal(canAdd(level, d, 0, 0, 3, 1, 'timber').ok, true) // 3.16 m
  assert.equal(canAdd(level, d, 0, 0, 3, 2, 'timber').reason, 'long')
  assert.equal(canAdd(level, d, 0, 0, 8, 1, 'rope').ok, true) // 8.06 m
  assert.equal(canAdd(level, d, 0, 0, 8, 2, 'rope').reason, 'long')
  assert.equal(canAdd(level, d, 0, 0, 0, 0, 'plank').reason, 'short')
})

test('no duplicate beams, whichever way round they are drawn', () => {
  const d = fresh()
  assert.equal(addBeam(level, d, 0, 0, 2, 0, 'plank').ok, true)
  assert.equal(addBeam(level, d, 0, 0, 2, 0, 'timber').reason, 'duplicate')
  assert.equal(addBeam(level, d, 2, 0, 0, 0, 'plank').reason, 'duplicate')
  assert.equal(d.beams.length, 1)
  assert.equal(beamKey(2, 0, 0, 0), beamKey(0, 0, 2, 0))
  assert.equal(findBeam(d, 2, 0, 0, 0), 0)
})

test('only allowed materials, only whole metres, only legal places', () => {
  const d = fresh()
  assert.equal(canAdd(level, d, 0, 0, 2, 0, 'steel').reason, 'material')
  assert.equal(canAdd(level, d, 0, 0, 2, 0, 'cheese').reason, 'material')
  assert.equal(canAdd(level, d, 0, 0, 1.5, 0, 'plank').reason, 'grid')
  assert.equal(canAdd(level, d, 0, 0, -1, -1, 'plank').reason, 'place') // inside the left cliff
  assert.equal(canAdd(level, d, 0, 0, 1, 99, 'rope').reason, 'long')
  assert.equal(jointOk(level, 4, 0), true)
  assert.equal(jointOk(level, 4, 50), false) // above the build box
  assert.equal(jointOk(level, -2, 0), true) // on the cliff top
  assert.equal(jointOk(level, -2, -1), false)
  assert.equal(jointOk(level, 0, 0), true) // anchors always
})

test('budget is checked on the whole design', () => {
  const d = fresh()
  for (const x of [0, 2, 4, 6]) addBeam(level, d, x, 0, x + 2, 0, 'plank')
  assert.deepEqual(checkDesign(level, d), { ok: true, reason: '', cost: 800 })
  addBeam(level, d, 0, 0, 1, 2, 'timber')
  const r = checkDesign(level, d)
  assert.equal(r.ok, false); assert.equal(r.reason, 'budget'); assert.equal(r.cost, 1110)
  assert.equal(checkDesign({ ...level, budget: null }, d).ok, true)
})

test('there is a cap on the number of beams', () => {
  const big = makeLevel({ id: 't', name: 't', w: 8, materials: ['plank'] })
  const d = fresh()
  let n = 0
  for (let y = 0; y <= 6 && n < MAX_BEAMS; y++) for (let x = -3; x < 11 && n < MAX_BEAMS; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 0], [0, 2]]) { if (n < MAX_BEAMS && addBeam(big, d, x, y, x + dx, y + dy, 'plank').ok) n++ }
  assert.equal(d.beams.length, MAX_BEAMS)
  assert.equal(canAdd(big, d, 0, 0, -1, 1, 'plank').reason, 'full')
})

test('joints are the anchors plus every beam end', () => {
  const d = { beams: [[0, 0, 2, 0, 'plank'], [2, 0, 3, 2, 'timber']] }
  assert.deepEqual(jointsOf(level, d), [[0, 0, true], [8, 0, true], [2, 0, false], [3, 2, false]])
  assert.equal(hasJoint(level, d, 3, 2), true)
  assert.equal(hasJoint(level, d, 8, 0), true)
  assert.equal(hasJoint(level, d, 4, 0), false)
})

test('snapTarget picks the nearest legal grid point within reach', () => {
  assert.deepEqual(snapTarget(level, 0, 0, 1.8, 0.2, 'plank'), [2, 0])
  assert.deepEqual(snapTarget(level, 0, 0, 9, 0, 'plank'), [2, 0]) // clamped to the plank's reach
  assert.deepEqual(snapTarget(level, 0, 0, 2.9, 3.1, 'rope'), [3, 3])
  assert.deepEqual(snapTarget(level, 0, 0, -1.2, -1.4, 'plank'), [-1, 0]) // not inside the cliff
})

test('undo and redo walk through whole-design snapshots', () => {
  const d = fresh(), h = makeHistory()
  assert.equal(h.undo(d), false)
  h.push(d); d.beams.push([0, 0, 2, 0, 'plank'])
  h.push(d); d.beams.push([2, 0, 4, 0, 'plank'])
  assert.equal(h.canUndo, true); assert.equal(h.canRedo, false)
  assert.equal(h.undo(d), true); assert.equal(d.beams.length, 1)
  assert.equal(h.undo(d), true); assert.equal(d.beams.length, 0)
  assert.equal(h.undo(d), false)
  assert.equal(h.redo(d), true); assert.equal(h.redo(d), true); assert.equal(d.beams.length, 2)
  assert.equal(h.redo(d), false)
  h.undo(d); h.push(d); d.beams.push([0, 0, 1, 2, 'timber'])
  assert.equal(h.canRedo, false) // a new edit drops the redo branch
})

test('cleanDesign drops anything illegal from stored data', () => {
  const raw = { beams: [[0, 0, 2, 0, 'plank'], [0, 0, 2, 0, 'plank'], [0, 0, 9, 0, 'plank'], [0, 0, 2, 1, 'steel'], 'junk', [1, 2], [2, 0, 4, 0, 'plank'], [0, 0, 1.5, 0, 'plank'], null] }
  assert.deepEqual(cleanDesign(level, raw).beams, [[0, 0, 2, 0, 'plank'], [2, 0, 4, 0, 'plank']])
  assert.deepEqual(cleanDesign(level, null).beams, [])
  assert.deepEqual(cleanDesign(level, { beams: 'no' }).beams, [])
})
