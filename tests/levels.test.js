import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, SANDBOX, CHAPTERS, levelById } from '../src/levels.js'
import { MATERIALS, VEHICLES, groundAt, simulate, timeLimit } from '../src/physics.js'
import { checkDesign, designCost, jointOk } from '../src/design.js'
import { goals } from '../src/save.js'
import { REFS } from './refs.js'

function checkData(L) {
  assert.ok(L.name && L.hint && L.hint.length <= 80, `${L.id}: name and a short hint`)
  for (let i = 1; i < L.terrain.length; i++) assert.ok(L.terrain[i][0] >= L.terrain[i - 1][0], `${L.id}: terrain x must not go backwards`)
  assert.ok(L.anchors.length >= 2)
  const seen = new Set()
  for (const a of L.anchors) {
    assert.ok(Number.isInteger(a[0]) && Number.isInteger(a[1]), `${L.id}: anchors on whole metres`)
    assert.ok(!seen.has(a.join()), `${L.id}: duplicate anchor`); seen.add(a.join())
    assert.ok(a[1] > L.pit.y, `${L.id}: anchor above the pit`)
  }
  assert.ok(L.materials.length && L.materials.every((m) => MATERIALS[m]) && L.materials.includes('plank'))
  assert.ok(L.build[0] < L.build[2] && L.build[1] < L.build[3] && L.build[1] > L.pit.y)
  assert.ok(L.vehicles.length >= 1)
  for (const v of L.vehicles) {
    assert.ok(VEHICLES[v.type], `${L.id}: vehicle type`)
    const B = VEHICLES[v.type]
    // the spawn sits on flat ground clear of the gap; the goal is on a cliff too
    const y = groundAt(L.terrain, v.x)
    assert.ok(y > L.pit.y + 1, `${L.id}: spawn ${v.x} is not on a cliff`)
    assert.equal(groundAt(L.terrain, v.x - B.L - 0.3), y, `${L.id}: ground not flat at the spawn`)
    assert.equal(groundAt(L.terrain, v.x + B.L + 0.3), y, `${L.id}: ground not flat at the spawn`)
    assert.ok(groundAt(L.terrain, v.goal) > L.pit.y + 1, `${L.id}: goal ${v.goal} is not on a cliff`)
    assert.ok((v.goal - v.x) * v.dir > 4)
  }
  assert.ok(timeLimit(L) < 60)
}

test('campaign: 24 levels in 3 chapters of 8, with unique ids', () => {
  assert.equal(LEVELS.length, 24)
  assert.equal(CHAPTERS.length, 3)
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, 24)
  assert.equal(new Set(LEVELS.map((l) => l.name)).size, 24)
  LEVELS.forEach((l, i) => { assert.equal(l.id, 'c' + (i + 1)); assert.equal(l.chapter, Math.floor(i / 8)) })
  assert.deepEqual(LEVELS[0].materials, ['plank'])
  assert.equal(levelById('c7'), LEVELS[6])
  assert.equal(levelById('s2'), SANDBOX[1])
  assert.equal(levelById('nope'), null)
})

test('every campaign and sandbox level has valid data', () => {
  for (const L of LEVELS) {
    checkData(L)
    assert.ok(L.budget >= L.par && L.par > 0, `${L.id}: budget ${L.budget} must cover par ${L.par}`)
    assert.ok(L.budget % 100 === 0 && L.par % 100 === 0)
  }
  assert.equal(SANDBOX.length, 3)
  for (const L of SANDBOX) { checkData(L); assert.equal(L.budget, null); assert.equal(L.materials.length, 4) }
})

test('materials are introduced gradually', () => {
  const first = (m) => LEVELS.findIndex((l) => l.materials.includes(m))
  assert.equal(first('plank'), 0)
  assert.equal(first('timber'), 1)
  assert.equal(first('rope'), 8)
  assert.equal(first('steel'), 11)
  assert.ok(LEVELS.slice(0, 8).every((l) => l.vehicles.every((v) => v.type === 'cart')))
})

for (const L of LEVELS) {
  test(`level ${L.id.slice(1)} "${L.name}": the reference design crosses within budget for three stars`, () => {
    const beams = REFS[L.id]
    assert.ok(Array.isArray(beams) && beams.length, 'a reference design is stored')
    const design = { beams }
    const chk = checkDesign(L, design)
    assert.equal(chk.ok, true, `reference design is illegal: ${chk.reason}`)
    assert.ok(designCost(design) <= L.budget)
    for (const b of beams) assert.ok(jointOk(L, b[0], b[1]) && jointOk(L, b[2], b[3]))
    const r = simulate(L, design)
    assert.equal(r.success, true, `reference design ${r.reason}`)
    // the reference earns all three stars, so every star on every level is known to be possible
    assert.deepEqual(goals(L, r, designCost(design)), { crossed: true, parcels: true, par: true, stars: 3 })
    // and doing nothing must not be a solution
    assert.equal(simulate(L, { beams: [] }).success, false, 'an empty design must fail')
  })
}

test('budgets leave room above par, and the squeeze levels are tight', () => {
  for (const L of LEVELS) {
    const slack = L.budget / L.par
    assert.ok(slack >= 1.1 && slack <= 2.05, `${L.id}: budget is ${slack.toFixed(2)} x par`)
  }
  for (const id of ['c11', 'c20']) { const L = levelById(id); assert.ok(L.budget / L.par < 1.2, `${id} should be a squeeze`) }
})
