// Rickety build rules: what a design is, what may be added to it, what it costs. No DOM.
// A design is { beams: [[ax, ay, bx, by, materialId], ...] } with whole-metre grid coordinates.
import { MATERIALS, groundAt } from './physics.js'

export const MAX_BEAMS = 260

export const beamLen = (ax, ay, bx, by) => Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
/** Price of one beam, rounded to the nearest $10. */
export const beamCost = (len, mat) => Math.round((len * MATERIALS[mat].cost) / 10) * 10
export function designCost(design) {
  let c = 0
  for (const b of design.beams) c += beamCost(beamLen(b[0], b[1], b[2], b[3]), b[4])
  return c
}
/** Same key whichever way round the beam was drawn. */
export function beamKey(ax, ay, bx, by) {
  return ax < bx || (ax === bx && ay <= by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`
}
export const isAnchor = (level, x, y) => level.anchors.some((a) => a[0] === x && a[1] === y)

/** May a joint sit at this grid point? Anchors always; otherwise inside the build box and not inside the rock. */
export function jointOk(level, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false
  if (isAnchor(level, x, y)) return true
  const b = level.build
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false
  return y >= groundAt(level.terrain, x, true) - 1e-9
}
/** Every joint in use: anchors first, then beam ends. Returns [[x, y, isAnchor], ...]. */
export function jointsOf(level, design) {
  const seen = new Set(), out = []
  const add = (x, y, anchor) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push([x, y, anchor]) } }
  for (const a of level.anchors) add(a[0], a[1], true)
  for (const b of design.beams) { add(b[0], b[1], false); add(b[2], b[3], false) }
  return out
}
export function hasJoint(level, design, x, y) {
  if (isAnchor(level, x, y)) return true
  for (const b of design.beams) if ((b[0] === x && b[1] === y) || (b[2] === x && b[3] === y)) return true
  return false
}
export function findBeam(design, ax, ay, bx, by) {
  const k = beamKey(ax, ay, bx, by)
  return design.beams.findIndex((b) => beamKey(b[0], b[1], b[2], b[3]) === k)
}

/** Check one new beam. Returns { ok, reason }. The start must be an existing joint (the game only lets you drag from one). */
export function canAdd(level, design, ax, ay, bx, by, mat) {
  const M = MATERIALS[mat]
  if (!M || !(level.materials || []).includes(mat)) return { ok: false, reason: 'material' }
  if (![ax, ay, bx, by].every(Number.isInteger)) return { ok: false, reason: 'grid' }
  if (ax === bx && ay === by) return { ok: false, reason: 'short' }
  if (beamLen(ax, ay, bx, by) > M.maxLen + 1e-9) return { ok: false, reason: 'long' }
  if (!jointOk(level, ax, ay) || !jointOk(level, bx, by)) return { ok: false, reason: 'place' }
  if (findBeam(design, ax, ay, bx, by) >= 0) return { ok: false, reason: 'duplicate' }
  if (design.beams.length >= MAX_BEAMS) return { ok: false, reason: 'full' }
  return { ok: true, reason: '' }
}
export function addBeam(level, design, ax, ay, bx, by, mat) {
  const r = canAdd(level, design, ax, ay, bx, by, mat)
  if (r.ok) design.beams.push([ax, ay, bx, by, mat])
  return r
}
/** Is the whole design legal for this level and within budget? (Go is only allowed when this says ok.) */
export function checkDesign(level, design) {
  const tmp = { beams: [] }
  for (const b of design.beams) { const r = canAdd(level, tmp, b[0], b[1], b[2], b[3], b[4]); if (!r.ok) return r; tmp.beams.push(b) }
  const cost = designCost(design)
  if (level.budget != null && cost > level.budget) return { ok: false, reason: 'budget', cost }
  return { ok: true, reason: '', cost }
}
/** Drop anything illegal from a design loaded from storage. */
export function cleanDesign(level, raw) {
  const out = { beams: [] }
  const list = raw && Array.isArray(raw.beams) ? raw.beams : Array.isArray(raw) ? raw : []
  for (const b of list) {
    if (!Array.isArray(b) || b.length < 5) continue
    if (canAdd(level, out, b[0], b[1], b[2], b[3], b[4]).ok) out.beams.push([b[0], b[1], b[2], b[3], b[4]])
  }
  return out
}

/** Grid point within maxLen of (ax, ay) that is closest to the free point (px, py) and may hold a joint. */
export function snapTarget(level, ax, ay, px, py, mat) {
  const R = MATERIALS[mat].maxLen, n = Math.floor(R)
  let best = null, bd = Infinity
  for (let dx = -n; dx <= n; dx++) {
    for (let dy = -n; dy <= n; dy++) {
      if ((!dx && !dy) || dx * dx + dy * dy > R * R + 1e-9) continue
      const x = ax + dx, y = ay + dy
      const d = (x - px) * (x - px) + (y - py) * (y - py)
      if (d < bd && jointOk(level, x, y)) { bd = d; best = [x, y] }
    }
  }
  return best
}

/** Undo / redo over whole-design snapshots. */
export function makeHistory(limit = 200) {
  let past = [], future = []
  const snap = (d) => JSON.stringify(d.beams)
  return {
    /** Call BEFORE changing the design. */
    push(design) { past.push(snap(design)); if (past.length > limit) past.shift(); future = [] },
    undo(design) { if (!past.length) return false; future.push(snap(design)); design.beams = JSON.parse(past.pop()); return true },
    redo(design) { if (!future.length) return false; past.push(snap(design)); design.beams = JSON.parse(future.pop()); return true },
    clear() { past = []; future = [] },
    get canUndo() { return past.length > 0 }, get canRedo() { return future.length > 0 },
  }
}
