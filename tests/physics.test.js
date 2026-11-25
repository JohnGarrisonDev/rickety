import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H, SUB_HZ, MATERIALS, VEHICLES, createWorld, step, simulate, kineticEnergy, stateHash, groundAt } from '../src/physics.js'
import { makeLevel } from '../src/levels.js'

const gap = (w, extra = {}) => makeLevel({ id: 't', name: 't', w, materials: ['plank', 'timber', 'steel', 'rope'], ...extra })
// a plain timber truss over an 8 m gap
const TRUSS = { beams: [
  [0, 0, 2, 0, 'plank'], [2, 0, 4, 0, 'plank'], [4, 0, 6, 0, 'plank'], [6, 0, 8, 0, 'plank'],
  [0, 0, 1, 2, 'timber'], [1, 2, 2, 0, 'timber'], [2, 0, 3, 2, 'timber'], [3, 2, 4, 0, 'timber'], [4, 0, 5, 2, 'timber'], [5, 2, 6, 0, 'timber'], [6, 0, 7, 2, 'timber'], [7, 2, 8, 0, 'timber'],
  [1, 2, 3, 2, 'timber'], [3, 2, 5, 2, 'timber'], [5, 2, 7, 2, 'timber'],
] }
const finite = (W) => W.P.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy))
const run = (W, seconds, each) => { for (let i = 0; i < seconds * SUB_HZ; i++) { step(W); if (each) each(W) } }

test('a truss with nobody on it settles and then stays put', () => {
  const W = createWorld(gap(8, { vehicles: [] }), TRUSS)
  run(W, 3)
  const before = W.P.map((p) => [p.x, p.y])
  run(W, 5)
  let drift = 0
  W.P.forEach((p, i) => { drift = Math.max(drift, Math.abs(p.x - before[i][0]), Math.abs(p.y - before[i][1])) })
  assert.ok(finite(W))
  assert.ok(drift < 0.002, `drifted ${drift} m`)
  assert.ok(kineticEnergy(W) < 1e-4, `still moving: ${kineticEnergy(W)}`)
  assert.equal(W.broken, 0)
  // it sags a little under its own weight, but only a little
  const mid = W.joints.get('4,0')
  assert.ok(mid.y < 0 && mid.y > -0.1, `mid sag ${mid.y}`)
})

test('energy never blows up and nothing goes NaN during a crossing or a collapse', () => {
  for (const design of [TRUSS, { beams: TRUSS.beams.slice(0, 4) }, { beams: [] }]) {
    const W = createWorld(gap(8), design)
    let peak = 0
    run(W, 12, (w) => { const e = kineticEnergy(w); if (e > peak) peak = e })
    assert.ok(finite(W))
    // a falling Cart has about m*g*h = 3.2 * 9.8 * 8 = 250 units to give; nothing may exceed a small multiple of that
    assert.ok(peak < 700, `kinetic energy peaked at ${peak}`)
  }
})

test('a single plank over a short gap holds the Cart', () => {
  const r = simulate(gap(2), { beams: [[0, 0, 2, 0, 'plank']] })
  assert.equal(r.success, true)
  assert.equal(r.broken, 0)
  assert.equal(r.kept, r.parcels)
})

test('no bridge means no crossing, and a long unsupported deck snaps', () => {
  assert.equal(simulate(gap(2), { beams: [] }).success, false) // it wedges nose-down in the gap
  assert.equal(simulate(gap(6), { beams: [] }).reason, 'fell')
  const r = simulate(gap(8), { beams: TRUSS.beams.slice(0, 4) })
  assert.equal(r.success, false)
  assert.ok(r.broken > 0)
  assert.equal(r.maxStress, 1)
  // the same deck with the truss on top is fine
  const ok = simulate(gap(8), TRUSS)
  assert.equal(ok.success, true)
  assert.ok(ok.maxStress > 0.1 && ok.maxStress < 0.9, `truss stress ${ok.maxStress}`)
})

test('the Truck loads a bridge more than the Cart', () => {
  const cart = simulate(gap(8), TRUSS), truck = simulate(gap(8, { vehicles: [{ type: 'truck' }] }), TRUSS)
  assert.ok(truck.maxStress > cart.maxStress * 1.3, `${truck.maxStress} vs ${cart.maxStress}`)
})

test('rope pulls but cannot push', () => {
  // a 4 m road with its middle joint held from a rock 2 m below: timber props it, rope just dangles
  const level = gap(4, { rocks: [[2, -2]] })
  const road = [[0, 0, 2, 0, 'plank'], [2, 0, 4, 0, 'plank']]
  assert.equal(simulate(level, { beams: [...road, [2, -2, 2, 0, 'timber']] }).success, true)
  assert.equal(simulate(level, { beams: [...road, [2, -2, 2, 0, 'rope']] }).success, false)
  // hung from above, rope does the job
  const high = gap(4, { anchors: [[2, 3]] })
  assert.equal(simulate(high, { beams: [...road, [2, 3, 2, 0, 'rope']] }).success, true)
})

test('a snapped beam becomes two swinging halves', () => {
  const W = createWorld(gap(8), { beams: TRUSS.beams.slice(0, 4) }, { events: true })
  const n = W.P.length
  let snaps = 0
  run(W, 8, (w) => { for (const e of w.events) if (e.type === 'snap') snaps++; w.events.length = 0 })
  assert.ok(snaps > 0)
  assert.equal(W.beams.filter((b) => b.stub).length, snaps * 2)
  assert.equal(W.P.length, n + snaps * 2)
})

test('wheels never tunnel through a deck, even at silly speeds', () => {
  assert.ok(30 * H < 0.24, 'top speed times the step must stay under the smallest radius')
  for (const speed of [2.6, 8, 16, 24]) {
    const level = gap(2, { vehicles: [{ type: 'cart', speed }] })
    const W = createWorld(level, { beams: [[0, 0, 2, 0, 'plank']] })
    let low = Infinity
    while (!W.over && W.t < 20) { step(W); for (const c of W.vehicles[0].wheels) if (c.p.x > 0.2 && c.p.x < 1.8 && c.p.y < low) low = c.p.y }
    assert.ok(low > VEHICLES.cart.R - 0.06, `speed ${speed}: a wheel sank to ${low}`)
    assert.equal(W.success, true, `speed ${speed}`)
  }
})

test('the simulation is deterministic', () => {
  const level = gap(8, { vehicles: [{ type: 'truck' }, { type: 'cart', dir: -1 }] })
  const hashes = []
  for (let k = 0; k < 2; k++) {
    const W = createWorld(level, { beams: TRUSS.beams.slice(0, 9) })
    const trail = []
    run(W, 7, (w) => { if (w.steps % 240 === 0) trail.push(stateHash(w)) })
    hashes.push(trail.join())
  }
  assert.equal(hashes[0], hashes[1])
  assert.deepEqual(simulate(level, TRUSS), simulate(level, TRUSS))
})

test('materials and terrain helpers are sane', () => {
  for (const m of Object.values(MATERIALS)) assert.ok(m.cost > 0 && m.maxLen >= 2 && m.strength > 0 && m.breakStrain > 0 && m.mass > 0, m.id)
  assert.ok(MATERIALS.plank.strength < MATERIALS.timber.strength && MATERIALS.timber.strength < MATERIALS.steel.strength)
  const T = [[-5, 0], [0, 0], [0, -6], [4, -6], [4, 1], [9, 1]]
  assert.equal(groundAt(T, -2), 0)
  assert.equal(groundAt(T, 0), 0)
  assert.equal(groundAt(T, 0, true), -6)
  assert.equal(groundAt(T, 2), -6)
  assert.equal(groundAt(T, 6), 1)
})
