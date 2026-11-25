// Rickety auto-builder: draws a few textbook bridges for a level, runs them headless and keeps the cheapest one that
// crosses with room to spare. The daily generator uses it to prove a canyon is solvable and to set its budget;
// tools/make-refs.mjs uses it for most campaign reference designs. No DOM. Nothing here is shown to the player.
import { MATERIALS, simulate } from './physics.js'
import { beamLen, canAdd, designCost } from './design.js'

/** Road joints from L to R: 2 m steps, climbing or dropping at most 1 m per step. Null when the span does not fit that. */
export function deckNodes(span) {
  const [lx, ly] = span.L, [rx, ry] = span.R, dx = rx - lx, dy = ry - ly
  if (dx < 2 || dx % 2 !== 0 || Math.abs(dy) * 2 > dx) return null
  const out = []
  for (let x = lx; x <= rx; x += 2) out.push([x, ly + Math.round(((x - lx) * dy) / dx)])
  return out
}

function build(level, v) {
  const d = { beams: [] }
  const ok = (m) => level.materials.includes(m)
  const add = (a, b, m) => canAdd(level, d, a[0], a[1], b[0], b[1], m).ok && (d.beams.push([a[0], a[1], b[0], b[1], m]), true)
  const pick = (a, b, list) => { const len = beamLen(a[0], a[1], b[0], b[1]); for (const m of list) if (ok(m) && len <= MATERIALS[m].maxLen) return m; return null }
  for (const span of level.spans) {
    const N = deckNodes(span)
    if (!N) return null
    for (let i = 0; i + 1 < N.length; i++) if (!add(N[i], N[i + 1], 'plank')) return null
    if (v.h && N.length > 2) {
      const T = []
      for (let i = 0; i + 1 < N.length; i++) T.push([N[i][0] + 1, Math.min(N[i][1], N[i + 1][1]) + v.h])
      for (let i = 0; i < T.length; i++) {
        if (!ok(v.diag) || !ok(v.chord)) return null
        if (!add(N[i], T[i], v.diag) || !add(T[i], N[i + 1], v.diag)) return null
        if (i && !add(T[i - 1], T[i], v.chord)) return null
      }
    }
    if (v.extras) {
      const ends = new Set([span.L.join(), span.R.join()])
      for (const A of level.anchors) {
        if (ends.has(A.join())) continue
        const near = N.slice(1, -1).map((n) => ({ n, len: beamLen(A[0], A[1], n[0], n[1]) })).filter((e) => e.len > 0).sort((p, q) => p.len - q.len || p.n[0] - q.n[0])
        let made = 0
        for (const e of near) {
          const above = A[1] > e.n[1] + 1
          const m = pick(A, e.n, above ? ['rope', 'timber', 'steel'] : ['timber', 'steel'])
          if (!m) continue
          if (add(A, e.n, m) && ++made >= (above ? v.extras * 2 : v.extras)) break
        }
      }
    }
  }
  return d.beams.length ? d : null
}

const VARIANTS = [
  { h: 0, extras: 0 }, { h: 0, extras: 2 }, { h: 0, extras: 3 },
  { h: 2, diag: 'timber', chord: 'timber', extras: 0 }, { h: 2, diag: 'timber', chord: 'timber', extras: 2 }, { h: 2, diag: 'timber', chord: 'timber', extras: 3 },
  { h: 3, diag: 'timber', chord: 'timber', extras: 0 }, { h: 3, diag: 'timber', chord: 'timber', extras: 2 }, { h: 3, diag: 'timber', chord: 'timber', extras: 3 },
  { h: 3, diag: 'timber', chord: 'steel', extras: 0 }, { h: 3, diag: 'timber', chord: 'steel', extras: 2 },
  { h: 3, diag: 'steel', chord: 'steel', extras: 0 }, { h: 3, diag: 'steel', chord: 'steel', extras: 3 },
  { h: 4, diag: 'steel', chord: 'steel', extras: 0 }, { h: 4, diag: 'steel', chord: 'steel', extras: 3 },
]

/** All the stock designs that are legal on this level, cheapest first. */
export function candidates(level) {
  if (!level.spans || !level.spans.length) return []
  const seen = new Set(), out = []
  for (const v of VARIANTS) {
    const d = build(level, v)
    if (!d) continue
    const k = JSON.stringify(d.beams)
    if (seen.has(k)) continue
    seen.add(k); out.push({ design: d, cost: designCost(d) })
  }
  return out.sort((a, b) => a.cost - b.cost)
}

/** Cheapest stock design that gets every vehicle across while no beam passes `margin` of its strength. Null if none does. */
export function autoBuild(level, { margin = 0.85, parcels = false } = {}) {
  for (const c of candidates(level)) {
    const r = simulate(level, c.design)
    if (r.success && r.maxStress <= margin && (!parcels || r.kept === r.parcels)) return { design: c.design, cost: c.cost, result: r }
  }
  return null
}
