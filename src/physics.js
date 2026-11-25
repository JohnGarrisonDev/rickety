// Rickety physics: a small XPBD particle-and-constraint simulation. No DOM, deterministic, fixed timestep.
// Units are metres, seconds and "weight units"; y points UP. Only + - * / and Math.sqrt are used on simulation
// state, so a design behaves the same in every browser and in the node tests.

export const SUB_HZ = 240
export const H = 1 / SUB_HZ
export const ITER = 10
export const GRAV = 9.8
export const SETTLE = 1.0 // seconds the bridge gets to settle under its own weight before anyone drives
const MAX_SPEED = 30 // m/s; times H this stays well under the smallest collision radius
const JOINT_MASS = 0.1
const JOINT_R = 0.07
const STRESS_SMOOTH = 0.06
const ACCEL = 2.5, BRAKE = 4 // m/s^2
const STUCK_AFTER = 3.5 // seconds without half a metre of progress

/** cost: $ per metre. strength: force at which it snaps. breakStrain: stretch at that force (sets stiffness). mass: per metre. */
export const MATERIALS = {
  plank: { id: 'plank', name: 'Plank', cost: 100, maxLen: 2.3, strength: 80, breakStrain: 0.012, mass: 0.12, deck: true, rope: false, damp: 0.06 },
  timber: { id: 'timber', name: 'Timber', cost: 140, maxLen: 3.2, strength: 115, breakStrain: 0.012, mass: 0.1, deck: false, rope: false, damp: 0.06 },
  steel: { id: 'steel', name: 'Steel', cost: 420, maxLen: 4.3, strength: 320, breakStrain: 0.008, mass: 0.24, deck: false, rope: false, damp: 0.06 },
  rope: { id: 'rope', name: 'Rope', cost: 90, maxLen: 8.1, strength: 150, breakStrain: 0.02, mass: 0.03, deck: false, rope: true, damp: 0.1 },
}
export const MATERIAL_IDS = ['plank', 'timber', 'steel', 'rope']

/** Vehicle blueprints. Local coordinates: x forward, y up from the ground under the wheels. */
export const VEHICLES = {
  cart: {
    id: 'cart', name: 'Cart', L: 1.0, wb: 0.66, R: 0.32, gap: 0.12, bodyH: 0.42, cab: 0.12, bodyMass: 1.8, wheelMass: 0.5, speed: 2.6,
    parcels: [[-0.73, 0.26, 0.26], [-0.2, 0.26, 0.26], [-0.465, 0.7, 0.24]], parcelMass: 0.12,
  },
  truck: {
    id: 'truck', name: 'Truck', L: 1.5, wb: 1.0, R: 0.4, gap: 0.14, bodyH: 0.5, cab: 0.45, bodyMass: 4.2, wheelMass: 0.9, speed: 2.2,
    parcels: [[-1.22, 0.27, 0.27], [-0.67, 0.27, 0.27], [-0.12, 0.27, 0.27], [-0.945, 0.74, 0.25], [-0.395, 0.74, 0.25]], parcelMass: 0.12,
  },
}

// ---------- terrain helpers (also used by the build rules and the renderer)
/** Height of the ground at x. Terrain is one polyline with non-decreasing x; at a vertical face pick the top (or the bottom). */
export function groundAt(T, x, lowest = false) {
  let best = null
  for (let i = 0; i + 1 < T.length; i++) {
    const a = T[i], b = T[i + 1]
    if (x < a[0] || x > b[0]) continue
    let y
    if (b[0] === a[0]) y = lowest ? Math.min(a[1], b[1]) : Math.max(a[1], b[1])
    else y = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
    if (best === null || (lowest ? y < best : y > best)) best = y
  }
  return best === null ? -1e9 : best
}
export function pitOf(level) {
  let floor = Infinity
  for (const p of level.terrain) if (p[1] < floor) floor = p[1]
  const pit = level.pit || { kind: 'mist', y: floor + 2 }
  return { kind: pit.kind || 'water', y: pit.y, floor }
}

// ---------- world
const mk = (x, y, m) => ({ x, y, px: x, py: y, vx: 0, vy: 0, w: m > 0 ? 1 / m : 0, m, wet: false, kind: 0 })
const dist = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy) }

/** Build a world from a level and a design ({ beams: [[ax, ay, bx, by, materialId], ...] } on the 1 m grid). */
export function createWorld(level, design, opts = {}) {
  const pit = pitOf(level)
  const W = {
    t: 0, steps: 0, level, P: [], beams: [], links: [], decks: [], colliders: [], vehicles: [], parcels: [], T: [],
    events: opts.events ? [] : null, pitY: pit.y, pitKind: pit.kind, maxStress: 0, broken: 0, over: false, success: false, reason: '', overT: 0,
    joints: new Map(), nJoints: 0,
  }
  for (const p of level.terrain) W.T.push({ x: p[0], y: p[1], w: 0, vx: 0, vy: 0 })
  // joints: every beam end and every anchor
  const anchors = new Set(level.anchors.map((a) => a[0] + ',' + a[1]))
  const joint = (x, y) => {
    const k = x + ',' + y
    let p = W.joints.get(k)
    if (!p) { p = mk(x, y, JOINT_MASS); p.fixed = anchors.has(k); p.gx = x; p.gy = y; W.joints.set(k, p); W.P.push(p) }
    return p
  }
  for (const a of level.anchors) joint(a[0], a[1])
  const beams = (design && design.beams) || []
  for (let i = 0; i < beams.length; i++) {
    const [ax, ay, bx, by, mat] = beams[i], M = MATERIALS[mat]
    if (!M) continue
    const a = joint(ax, ay), b = joint(bx, by), rest = dist(a, b)
    if (rest < 1e-6) continue
    const half = (M.mass * rest) / 2
    a.m += half; b.m += half
    const beam = { a, b, rest, mat, M, alpha: (M.breakStrain * rest) / M.strength, strength: M.strength, lam: 0, stress: 0, peak: 0, broken: false, stub: false, deck: M.deck, rope: M.rope, damp: M.damp, src: i, slack: false }
    W.beams.push(beam)
    if (M.deck) W.decks.push(beam)
  }
  for (const p of W.P) p.w = p.fixed ? 0 : 1 / p.m
  W.nJoints = W.P.length
  const list = level.vehicles || []
  for (let i = 0; i < list.length; i++) addVehicle(W, list[i], i)
  return W
}

function addVehicle(W, spec, index) {
  const B = VEHICLES[spec.type] || VEHICLES.cart, d = spec.dir === -1 ? -1 : 1
  const gx = spec.x, gy = groundAt(W.level.terrain, gx)
  const add = (lx, ly, m) => { const p = mk(gx + d * lx, gy + ly, m); p.kind = 1; W.P.push(p); return p }
  const bot = B.R + B.gap, top = bot + B.bodyH, bm = B.bodyMass / 8
  const BL = add(-B.L, bot, bm), BR = add(B.L, bot, bm), TR = add(B.L, top, bm), TL = add(-B.L, top, bm)
  const LIP = add(-B.L, top + 0.32, bm), CM = add(B.cab, top, bm), CT = add(B.cab, top + 0.5, bm), CF = add(B.L, top + 0.5, bm)
  const body = [BL, BR, TR, TL, LIP, CM, CT, CF]
  const link = (a, b, alpha, damp) => W.links.push({ a, b, rest: dist(a, b), alpha, lam: 0, rope: false, damp, broken: false })
  for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) link(body[i], body[j], 0, 0)
  const W0 = add(-B.wb, B.R, B.wheelMass), W1 = add(B.wb, B.R, B.wheelMass)
  const k = 1 / (170 * B.bodyMass)
  link(W0, BR, k * 0.05, 0.1); link(W0, BL, k, 0.25); link(W0, TL, k, 0.25)
  link(W1, BL, k * 0.05, 0.1); link(W1, BR, k, 0.25); link(W1, TR, k, 0.25)
  const total = B.bodyMass + 2 * B.wheelMass + B.parcels.length * B.parcelMass
  const v = {
    index, type: B.id, B, dir: d, speed: spec.speed || B.speed, goal: spec.goal, delay: spec.delay || 0, body, BL, BR, TL, TR, LIP, CM, CT, CF, wheels: [],
    tray: [[TL, CM], [TL, LIP], [CM, CT]], state: 'wait', throttle: 0, x: gx, y: gy + bot, startX: gx, lastX: gx, lastT: 0, doneT: 0, torque: total * GRAV * 0.75 * B.R, parcels: [], air: 0,
  }
  for (const wp of [W0, W1]) {
    const c = { p: wp, r: B.R, spin: true, om: 0, ang: 0, invI: 1 / (0.6 * B.wheelMass * B.R * B.R), mu: 1.15, drive: true, veh: v, parcel: false, cn: 0, cA: null, cB: null, ct: 0, nx: 0, ny: 1, ground: 0 }
    v.wheels.push(c); W.colliders.push(c)
  }
  for (const bp of [BL, BR, CF, LIP, CT]) W.colliders.push({ p: bp, r: 0.1, spin: false, om: 0, ang: 0, invI: 0, mu: 0.5, drive: false, veh: v, parcel: false, cn: 0, cA: null, cB: null, ct: 0, nx: 0, ny: 1, ground: 0 })
  for (let i = 0; i < B.parcels.length; i++) {
    const [lx, ly, r] = B.parcels[i]
    const p = add(lx, top + ly, B.parcelMass); p.kind = 2
    const c = { p, r, spin: true, om: 0, ang: 0, invI: 1 / (0.5 * B.parcelMass * r * r), mu: 0.7, drive: false, veh: v, parcel: true, cn: 0, cA: null, cB: null, ct: 0, nx: 0, ny: 1, ground: 0, lost: false, hue: (index * 2 + i) % 5 }
    v.parcels.push(c); W.parcels.push(c); W.colliders.push(c)
  }
  W.vehicles.push(v)
}

// ---------- solver pieces
function solveList(list, n, a2) {
  for (let i = 0; i < n; i++) {
    const c = list[i]
    if (c.broken) continue
    const a = c.a, b = c.b, ws = a.w + b.w
    if (ws === 0) continue
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy)
    if (d < 1e-9) continue
    const al = c.alpha * a2
    let dl = (c.rest - d - al * c.lam) / (ws + al)
    if (c.rope && c.lam + dl > 0) dl = -c.lam // ropes only pull
    c.lam += dl
    const nx = dx / d, ny = dy / d
    a.x -= nx * a.w * dl; a.y -= ny * a.w * dl
    b.x += nx * b.w * dl; b.y += ny * b.w * dl
  }
}

/** Circle (collider c) against the segment A-B. A and B are particles, or static terrain points with w = 0.
 *  Mostly-flat segments are one-sided (unless twoSided): anything up to a radius below the line is pushed back up, which is the anti-tunnelling net. */
function contact(c, A, B, twoSided) {
  const p = c.p, r = c.r
  const ex = B.x - A.x, ey = B.y - A.y, l2 = ex * ex + ey * ey
  if (l2 < 1e-9) return
  let t = ((p.x - A.x) * ex + (p.y - A.y) * ey) / l2
  let nx, ny, s
  if (t > 0 && t < 1) {
    const l = Math.sqrt(l2)
    nx = -ey / l; ny = ex / l
    if (ny < 0) { nx = -nx; ny = -ny }
    s = (p.x - A.x) * nx + (p.y - A.y) * ny
    if (twoSided || ny < 0.35) { if (s < 0) { s = -s; nx = -nx; ny = -ny } } else if (s < -r) return
  } else {
    t = t <= 0 ? 0 : 1
    const dx = p.x - (A.x + ex * t), dy = p.y - (A.y + ey * t)
    s = Math.sqrt(dx * dx + dy * dy)
    if (s < 1e-9) return
    nx = dx / s; ny = dy / s
  }
  if (s >= r) return
  const wa = A.w * (1 - t), wb = B.w * t
  const wsum = p.w + wa * (1 - t) + wb * t
  if (wsum === 0) return
  const dl = (r - s) / wsum
  p.x += nx * dl * p.w; p.y += ny * dl * p.w
  if (wa) { A.x -= nx * dl * wa; A.y -= ny * dl * wa }
  if (wb) { B.x -= nx * dl * wb; B.y -= ny * dl * wb }
  if (c.cA === A && c.cB === B) { c.cn += dl; c.ct = t; c.nx = nx; c.ny = ny } else if (dl > c.cn) { c.cA = A; c.cB = B; c.cn = dl; c.ct = t; c.nx = nx; c.ny = ny }
}

function contacts(W) {
  const C = W.colliders, D = W.decks, T = W.T, nT = T.length - 1
  for (let i = 0; i < C.length; i++) {
    const c = C[i], p = c.p, r = c.r
    for (let k = 0; k < D.length; k++) {
      const d = D[k]
      if (d.broken) continue
      const a = d.a, b = d.b
      if ((a.x < b.x ? a.x : b.x) > p.x + r || (a.x > b.x ? a.x : b.x) < p.x - r || (a.y < b.y ? a.y : b.y) > p.y + r || (a.y > b.y ? a.y : b.y) < p.y - r) continue
      contact(c, a, b, false)
    }
    for (let k = 0; k < nT; k++) {
      if (T[k].x > p.x + r || T[k + 1].x < p.x - r) continue
      contact(c, T[k], T[k + 1], false)
    }
    if (c.parcel) { const tr = c.veh.tray; for (let k = 0; k < 3; k++) contact(c, tr[k][0], tr[k][1], k > 0) }
  }
  const Q = W.parcels
  for (let i = 0; i < Q.length; i++) {
    for (let j = i + 1; j < Q.length; j++) {
      if (Q[i].veh !== Q[j].veh) continue // vehicles run in separate lanes, and so do their parcels
      const a = Q[i].p, b = Q[j].p, rr = Q[i].r + Q[j].r
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy
      if (d2 >= rr * rr || d2 < 1e-12) continue
      const d = Math.sqrt(d2), dl = (rr - d) / (a.w + b.w), nx = dx / d, ny = dy / d
      a.x -= nx * dl * a.w; a.y -= ny * dl * a.w
      b.x += nx * dl * b.w; b.y += ny * dl * b.w
      // parcels grip each other like boxes: cancel this step's sideways sliding, up to the friction limit
      const tx = ny, ty = -nx
      let f = (((b.x - b.px) - (a.x - a.px)) * tx + ((b.y - b.py) - (a.y - a.py)) * ty) / (a.w + b.w)
      const fm = 0.6 * dl
      if (f > fm) f = fm; else if (f < -fm) f = -fm
      a.x += tx * f * a.w; a.y += ty * f * a.w
      b.x -= tx * f * b.w; b.y -= ty * f * b.w
      Q[i].ground = 24; Q[j].ground = 24
    }
  }
}

function jointsVsTerrain(W) {
  const P = W.P, T = W.T, nT = T.length - 1, r = JOINT_R
  for (let i = 0; i < P.length; i++) {
    const p = P[i]
    if (p.w === 0 || p.kind !== 0) continue
    p.hit = false
    for (let k = 0; k < nT; k++) {
      const A = T[k], B = T[k + 1]
      if (A.x > p.x + r || B.x < p.x - r) continue
      const ex = B.x - A.x, ey = B.y - A.y, l2 = ex * ex + ey * ey
      if (l2 < 1e-9) continue
      let t = ((p.x - A.x) * ex + (p.y - A.y) * ey) / l2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const dx = p.x - (A.x + ex * t), dy = p.y - (A.y + ey * t), d2 = dx * dx + dy * dy
      if (d2 >= r * r || d2 < 1e-12) continue
      const d = Math.sqrt(d2), push = (r - d) / d
      p.x += dx * push; p.y += dy * push; p.hit = true
    }
  }
}

function dampList(list, n) {
  for (let i = 0; i < n; i++) {
    const c = list[i]
    if (c.broken || !c.damp) continue
    const a = c.a, b = c.b, ws = a.w + b.w
    if (ws === 0) continue
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy)
    if (d < 1e-9 || (c.rope && d < c.rest)) continue
    const nx = dx / d, ny = dy / d
    const j = (c.damp * ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny)) / ws
    a.vx += j * a.w * nx; a.vy += j * a.w * ny
    b.vx -= j * b.w * nx; b.vy -= j * b.w * ny
  }
}

function friction(W) {
  const C = W.colliders, h = H
  for (let i = 0; i < C.length; i++) {
    const c = C[i]
    if (c.spin) { c.ang += c.om * h; if (!c.drive) c.om *= c.cA || c.ground === 24 ? 0.9 : 0.999 }
    if (!c.cA) { if (c.ground > 0) c.ground--; continue }
    c.ground = 24
    const p = c.p, A = c.cA, B = c.cB, t = c.ct
    const tx = c.ny, ty = -c.nx // tangent: to the right when the normal points up
    const wa = A.w * (1 - t), wb = B.w * t
    const sx = A.vx * (1 - t) + B.vx * t, sy = A.vy * (1 - t) + B.vy * t
    const slip = (p.vx - sx) * tx + (p.vy - sy) * ty - c.om * c.r
    const k = p.w + c.r * c.r * c.invI + wa * (1 - t) + wb * t
    if (k === 0) continue
    let j = -slip / k
    const jmax = (c.mu * c.cn) / h
    if (j > jmax) j = jmax; else if (j < -jmax) j = -jmax
    p.vx += j * p.w * tx; p.vy += j * p.w * ty
    c.om -= j * c.r * c.invI
    if (wa) { A.vx -= j * wa * tx; A.vy -= j * wa * ty }
    if (wb) { B.vx -= j * wb * tx; B.vy -= j * wb * ty }
  }
}

function snap(W, b) {
  b.broken = true; W.broken++
  const a = b.a, e = b.b, mx = (a.x + e.x) / 2, my = (a.y + e.y) / 2
  const m = (b.M.mass * b.rest) / 4 + 0.03
  for (const end of [a, e]) {
    const q = mk(mx, my, m)
    q.vx = (a.vx + e.vx) / 2; q.vy = (a.vy + e.vy) / 2
    W.P.push(q)
    W.beams.push({ a: end, b: q, rest: b.rest * 0.47, mat: b.mat, M: b.M, alpha: b.alpha / 2, strength: Infinity, lam: 0, stress: 0, peak: 1, broken: false, stub: true, deck: false, rope: b.rope, damp: b.damp, src: -1, slack: false })
  }
  if (W.events) W.events.push({ type: 'snap', x: mx, y: my, mat: b.mat, len: b.rest })
}

function updateVehicles(W) {
  let open = 0
  for (let i = 0; i < W.vehicles.length; i++) {
    const v = W.vehicles[i]
    v.x = (v.BL.x + v.BR.x) / 2; v.y = (v.BL.y + v.BR.y) / 2
    if (v.state === 'wait') { if (W.t >= SETTLE + v.delay) { v.state = 'drive'; v.lastX = v.x; v.lastT = W.t; if (W.events) W.events.push({ type: 'start', v: i }) } open++; continue }
    if (v.state !== 'drive') continue
    if (v.y < W.pitY - 0.2) { v.state = 'lost'; v.doneT = W.t; if (W.events) W.events.push({ type: 'lost', v: i, x: v.x, y: v.y }); continue }
    if ((v.x - v.goal) * v.dir >= 0) { v.state = 'done'; v.doneT = W.t; if (W.events) W.events.push({ type: 'goal', v: i, x: v.x, y: v.y }); continue }
    const dx = v.x - v.lastX
    if (dx > 0.5 || dx < -0.5) { v.lastX = v.x; v.lastT = W.t } else if (W.t - v.lastT > STUCK_AFTER) { v.state = 'stuck'; v.doneT = W.t; if (W.events) W.events.push({ type: 'stuck', v: i, x: v.x, y: v.y }); continue }
    open++
  }
  if (!open && !W.over && W.vehicles.length) {
    W.over = true; W.overT = W.t
    W.success = W.vehicles.every((v) => v.state === 'done')
    W.reason = W.success ? 'crossed' : W.vehicles.some((v) => v.state === 'lost') ? 'fell' : 'stuck'
    countParcels(W)
    if (W.events) W.events.push({ type: 'over', success: W.success })
  }
}

/** Mark which parcels are still riding their vehicle. Called once when the run ends. */
export function countParcels(W) {
  let kept = 0, total = 0
  for (const v of W.vehicles) {
    const cx = (v.TL.x + v.CM.x) / 2, cy = (v.TL.y + v.CM.y) / 2, reach = v.B.L + 0.5
    for (const c of v.parcels) {
      total++
      const dx = c.p.x - cx, dy = c.p.y - cy
      c.lost = !(v.state === 'done' && !c.p.wet && dx * dx + dy * dy < reach * reach)
      if (!c.lost) kept++
    }
  }
  W.kept = kept; W.parcelTotal = total
  return kept
}

/** Advance the world by one substep (1/240 s). */
export function step(W) {
  const h = H, P = W.P, ev = W.events
  const g = GRAV * (W.t < 0.4 ? W.t / 0.4 : 1)
  const drag = W.t < SETTLE ? 0.985 : 0.9995
  const pitY = W.pitY, liquid = W.pitKind !== 'mist'
  for (let i = 0; i < P.length; i++) {
    const p = P[i]
    if (p.w === 0) continue
    p.vy -= g * h
    p.vx *= drag; p.vy *= drag
    if (p.y < pitY) {
      if (!p.wet) { p.wet = true; if (ev) ev.push({ type: 'splash', x: p.x, y: pitY, kind: p.kind, v: Math.sqrt(p.vx * p.vx + p.vy * p.vy) }) }
      if (liquid) { p.vx *= 0.96; p.vy = p.vy * 0.96 + g * h * 0.75 }
    }
    const s2 = p.vx * p.vx + p.vy * p.vy
    if (s2 > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(s2); p.vx *= k; p.vy *= k }
    p.px = p.x; p.py = p.y
    p.x += p.vx * h; p.y += p.vy * h
  }
  const C = W.colliders
  for (let i = 0; i < C.length; i++) {
    const c = C[i]
    c.cn = 0; c.cA = null; c.cB = null
    if (!c.drive) continue
    const v = c.veh, target = (v.dir * v.throttle) / c.r
    const dmax = v.torque * h * c.invI
    let d = target - c.om
    if (d > dmax) d = dmax; else if (d < -dmax) d = -dmax
    c.om += d
  }
  for (let i = 0; i < W.vehicles.length; i++) { // ease the throttle so nobody is thrown off the back
    const v = W.vehicles[i]
    if (v.state === 'drive') { if (v.throttle < v.speed) { v.throttle += ACCEL * h; if (v.throttle > v.speed) v.throttle = v.speed } } else if (v.throttle > 0) { v.throttle -= BRAKE * h; if (v.throttle < 0) v.throttle = 0 }
  }
  const nb = W.beams.length, nl = W.links.length, a2 = SUB_HZ * SUB_HZ
  for (let i = 0; i < nb; i++) W.beams[i].lam = 0
  for (let i = 0; i < nl; i++) W.links[i].lam = 0
  for (let it = 0; it < ITER; it++) {
    solveList(W.beams, nb, a2)
    solveList(W.links, nl, a2)
    contacts(W)
  }
  jointsVsTerrain(W)
  for (let i = 0; i < P.length; i++) {
    const p = P[i]
    if (p.w === 0) continue
    p.vx = (p.x - p.px) * SUB_HZ; p.vy = (p.y - p.py) * SUB_HZ
    if (p.hit) { p.vx *= 0.8; p.vy *= 0.8 }
  }
  dampList(W.beams, nb)
  dampList(W.links, nl)
  friction(W)
  for (let i = 0; i < nb; i++) {
    const b = W.beams[i]
    if (b.broken || b.stub) continue
    const f = b.lam * a2 // negative = tension
    b.slack = b.rope && f === 0
    b.stress += ((f < 0 ? -f : f) / b.strength - b.stress) * STRESS_SMOOTH
    if (b.stress > b.peak) b.peak = b.stress
    if (b.stress > W.maxStress) W.maxStress = b.stress
    if (b.stress >= 1) snap(W, b)
  }
  W.t += h; W.steps++
  updateVehicles(W)
}

/** Seconds a run of this level may take before it is called off. */
export function timeLimit(level) {
  let t = SETTLE + 8
  for (const v of level.vehicles || []) {
    const sp = v.speed || (VEHICLES[v.type] || VEHICLES.cart).speed
    const need = SETTLE + (v.delay || 0) + (Math.abs(v.goal - v.x) / sp) * 2.2 + 8
    if (need > t) t = need
  }
  return t
}

export function summary(W) {
  if (!W.over) countParcels(W)
  return { success: W.over && W.success, reason: W.over ? W.reason : 'timeout', t: W.t, steps: W.steps, maxStress: W.maxStress > 1 ? 1 : W.maxStress, broken: W.broken, kept: W.kept, parcels: W.parcelTotal }
}

/** Run a design headless from start to finish. */
export function simulate(level, design, opts = {}) {
  const W = createWorld(level, design)
  const limit = opts.maxT || timeLimit(level)
  const n = Math.ceil(limit * SUB_HZ)
  while (!W.over && W.steps < n) step(W)
  const out = summary(W)
  if (opts.world) out.world = W
  return out
}

/** Kinetic energy of everything that can move (tests use it to check nothing blows up). */
export function kineticEnergy(W) {
  let e = 0
  for (const p of W.P) if (p.w) e += (0.5 * (p.vx * p.vx + p.vy * p.vy)) / p.w
  return e
}
/** A cheap fingerprint of the whole state, for determinism tests. */
export function stateHash(W) {
  let h = 2166136261
  const f = new Float64Array(1), u = new Uint32Array(f.buffer)
  for (const p of W.P) for (const v of [p.x, p.y]) { f[0] = v; h = Math.imul(h ^ u[0], 16777619); h = Math.imul(h ^ u[1], 16777619) }
  return h >>> 0
}
