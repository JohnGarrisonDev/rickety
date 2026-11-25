// Rickety renderer: everything drawn on the canvas, the camera, and the particle pool.
// World units are metres with y up; the camera maps them to CSS pixels with y down.
import { C, FONT, fitCanvas, drawOddFace } from '../kit/kit.js'
import { MATERIALS, groundAt } from './physics.js'
import { jointsOf, jointOk, beamLen, beamCost } from './design.js'

export const MAT_STYLE = {
  plank: { color: '#E9B872', w: 0.26, min: 6 },
  timber: { color: '#C9713A', w: 0.18, min: 4.5 },
  steel: { color: '#93A8CF', w: 0.14, min: 3.5 },
  rope: { color: '#F3E6C6', w: 0.07, min: 2 },
}
const PARCEL = [C.yellow, C.pink, C.mint, '#8F8FFF', C.paper]
const ROCK = '#EAD9B5', ROCK2 = '#D9C394', SKY = '#FBF0D4'
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const lerp = (a, b, t) => a + (b - a) * t
const two = (n) => Math.round(n).toString(16).padStart(2, '0')
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
/** Blend two #rrggbb colours; returns #rrggbb. */
const mix = (a, b, t) => { const p = hex(a), q = hex(b); return '#' + two(lerp(p[0], q[0], t)) + two(lerp(p[1], q[1], t)) + two(lerp(p[2], q[2], t)) }
const RAMP = [[0, C.mint], [0.45, C.yellow], [0.75, C.orange], [1, '#E0245E']]
/** Stress 0..1 to a colour: mint, yellow, orange, hot red. */
export function stressColor(s) {
  s = Math.max(0, Math.min(1, s))
  for (let i = 1; i < RAMP.length; i++) if (s <= RAMP[i][0]) return mix(RAMP[i - 1][1], RAMP[i][1], (s - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]))
  return RAMP[RAMP.length - 1][1]
}

export function createRenderer(canvas) {
  const g = canvas.getContext('2d')
  let W = 1, H = 1, dpr = 1
  const cam = { scale: 20, ox: 0, oy: 0 }
  const inset = { top: 52, bottom: 70, left: 0 }
  const still = reduced()
  let shake = 0, time = 0

  const sx = (x) => cam.ox + x * cam.scale
  const sy = (y) => cam.oy - y * cam.scale

  // ---------- particles (world space, pooled)
  const MAXP = still ? 60 : 320
  const parts = []
  for (let i = 0; i < MAXP; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 0.1, color: C.ink, rot: 0, vr: 0, grav: 1, round: false })
  let pi = 0
  function spawn(x, y, vx, vy, life, size, color, grav = 1, round = false) {
    const p = parts[pi]; pi = (pi + 1) % MAXP
    p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.size = size; p.color = color; p.rot = Math.random() * 6.3; p.vr = (Math.random() - 0.5) * 14; p.grav = grav; p.round = round
  }
  const texts = []
  const rings = []
  const fx = {
    splinters(x, y, mat, n = 9) { const col = MAT_STYLE[mat].color; for (let i = 0; i < n; i++) spawn(x, y, (Math.random() - 0.5) * 7, Math.random() * 5 + 1, 0.6 + Math.random() * 0.6, 0.1 + Math.random() * 0.16, i % 3 ? col : C.ink) },
    splash(x, y, kind, power = 1) {
      const col = kind === 'lava' ? C.yellow : kind === 'mist' ? C.paper : '#C9C9FF'
      const n = Math.round((kind === 'mist' ? 5 : 9) * Math.min(1.6, power))
      for (let i = 0; i < n; i++) spawn(x + (Math.random() - 0.5) * 0.5, y, (Math.random() - 0.5) * 4 * power, (2 + Math.random() * 5) * power * (kind === 'mist' ? 0.3 : 1), 0.5 + Math.random() * 0.5, 0.12 + Math.random() * 0.14, col, kind === 'mist' ? 0.1 : 1, true)
      rings.push({ x, y, t: 0, max: 0.5, r: 0.5 + power * 0.7, color: col })
    },
    dust(x, y, n = 3) { for (let i = 0; i < n; i++) spawn(x, y, (Math.random() - 0.5) * 2, Math.random() * 1.2, 0.35 + Math.random() * 0.3, 0.1 + Math.random() * 0.1, ROCK2, 0.2, true) },
    confetti(x, y, n = 40) { const cols = [C.orange, C.yellow, C.mint, C.blue, C.pink]; for (let i = 0; i < n; i++) spawn(x + (Math.random() - 0.5) * 2, y + Math.random(), (Math.random() - 0.5) * 9, 4 + Math.random() * 7, 1.2 + Math.random() * 1.2, 0.14 + Math.random() * 0.12, cols[i % 5], 0.7) },
    text(x, y, str, color = C.ink, size = 18) { if (texts.length < 12) texts.push({ x, y, str, color, size, t: 0 }) },
    shake(a) { if (!still) shake = Math.min(1, Math.max(shake, a)) },
    clear() { for (const p of parts) p.on = false; texts.length = 0; rings.length = 0; shake = 0 },
  }

  function resize() { const r = fitCanvas(canvas); W = r.w; H = r.h; dpr = r.dpr }

  /** Point the camera at a level. zoom >= 1; pan in metres from the view centre. Returns the clamped pan. */
  function setCamera(level, zoom, panX, panY) {
    const v = level.view, vw = v[2] - v[0], vh = v[3] - v[1]
    const pw = W - 12 - inset.left, ph = H - inset.top - inset.bottom - 12
    const base = Math.max(4, Math.min(pw / vw, ph / vh))
    cam.scale = base * zoom
    const halfW = pw / cam.scale / 2, halfH = ph / cam.scale / 2
    const maxX = Math.max(0, vw / 2 - halfW), maxY = Math.max(0, vh / 2 - halfH)
    panX = Math.max(-maxX, Math.min(maxX, panX)); panY = Math.max(-maxY, Math.min(maxY, panY))
    cam.ox = inset.left + (W - inset.left) / 2 - ((v[0] + v[2]) / 2 + panX) * cam.scale
    cam.oy = inset.top + 6 + ph / 2 + ((v[1] + v[3]) / 2 + panY) * cam.scale
    return [panX, panY]
  }
  const toWorld = (px, py) => [(px - cam.ox) / cam.scale, (cam.oy - py) / cam.scale]

  // ---------- scenery
  function hills(base, amp, f, ph, color, par) {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, H)
    const off = cam.ox * par
    for (let x = 0; x <= W + 24; x += 24) { const u = (x - off) * f; g.lineTo(x, base - amp * (0.6 * Math.sin(u + ph) + 0.4 * Math.sin(u * 2.3 + ph * 1.7))) }
    g.lineTo(W, H); g.closePath(); g.fill()
  }
  function backdrop(level) {
    g.fillStyle = SKY; g.fillRect(0, 0, W, H)
    const hy = sy(Math.min(0, level.spans && level.spans[0] ? level.spans[0].R[1] : 0)) // horizon near the road
    g.fillStyle = C.yellow; g.beginPath(); g.arc(W * 0.78 + cam.ox * 0.02, Math.max(inset.top + 50, hy - H * 0.33), Math.min(W, H) * 0.09, 0, 7); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 2; g.stroke()
    hills(hy - H * 0.05, H * 0.07, 0.006, 1, '#CFEFE0', 0.08)
    hills(hy + H * 0.03, H * 0.06, 0.009, 3, '#A9E4CE', 0.16)
    hills(hy + H * 0.1, H * 0.05, 0.013, 5, '#84D6B8', 0.28)
    // clouds
    g.fillStyle = '#FFFDF8'; g.strokeStyle = C.ink; g.lineWidth = 2
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 0.37 + 0.12) * W + cam.ox * 0.05 + time * (3 + i)) % (W + 160) - 80, cy = inset.top + 26 + i * 34 + (i % 2) * 12, s = 0.8 + i * 0.15
      g.beginPath(); g.ellipse(cx, cy, 34 * s, 11 * s, 0, 0, 7); g.fill(); g.stroke()
      g.beginPath(); g.ellipse(cx - 10 * s, cy - 8 * s, 16 * s, 10 * s, 0, 3.3, 6.2); g.fill(); g.stroke()
    }
  }
  function terrainPath(T, dx, dy) {
    g.beginPath(); g.moveTo(sx(T[0][0]) + dx - 400, H + 60)
    g.lineTo(sx(T[0][0]) + dx - 400, sy(T[0][1]) + dy)
    for (const p of T) g.lineTo(sx(p[0]) + dx, sy(p[1]) + dy)
    const l = T[T.length - 1]
    g.lineTo(sx(l[0]) + dx + 400, sy(l[1]) + dy); g.lineTo(sx(l[0]) + dx + 400, H + 60); g.closePath()
  }
  function pitSurface(level, front) {
    const pit = level.pit, y = sy(pit.y)
    if (y > H + 10) return
    if (pit.kind === 'mist') {
      if (!front) return
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `rgba(251,246,236,${0.5 + k * 0.17})`
        g.beginPath(); g.moveTo(0, H)
        for (let x = 0; x <= W + 30; x += 30) g.lineTo(x, y + k * 16 - 7 * Math.sin(x * 0.02 + time * (0.5 + k * 0.2) + k * 2))
        g.lineTo(W, H); g.closePath(); g.fill()
      }
      return
    }
    const lava = pit.kind === 'lava'
    g.fillStyle = front ? (lava ? 'rgba(255,91,46,0.6)' : 'rgba(91,91,255,0.55)') : lava ? C.orange : C.blue
    g.beginPath(); g.moveTo(0, H)
    for (let x = 0; x <= W + 20; x += 20) g.lineTo(x, y - 3 * Math.sin(x * 0.045 + time * 2))
    g.lineTo(W, H); g.closePath(); g.fill()
    if (front) {
      g.strokeStyle = lava ? C.yellow : '#C9C9FF'; g.lineWidth = 3; g.lineCap = 'round'
      g.beginPath()
      for (let x = 0; x <= W + 20; x += 20) { const yy = y - 3 * Math.sin(x * 0.045 + time * 2); if (x) g.lineTo(x, yy); else g.moveTo(x, yy) }
      g.stroke()
      g.lineWidth = 2
      for (let i = 0; i < 6; i++) { const x = ((i * 0.19 + 0.07) * W + time * (lava ? 6 : 14) * (i % 2 ? 1 : -1) + W * 4) % W, yy = y + 14 + (i % 3) * 13; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 16, yy); g.stroke() }
      if (lava) { g.fillStyle = C.yellow; for (let i = 0; i < 5; i++) { const ph = (time * 0.5 + i * 0.23) % 1, x = ((i * 0.23 + 0.11) * W) % W; g.beginPath(); g.arc(x, y + 10 - ph * 6, 2 + ph * 4, 0, 7); g.fill() } }
    }
  }
  /** The far wall of the canyon: everything under the rim line that is not rock in front. */
  function backWall(level) {
    const T = level.terrain, rim = level.rim
    g.save()
    g.beginPath(); g.moveTo(sx(T[0][0]) - 400, -50)
    g.lineTo(sx(T[0][0]) - 400, sy(T[0][1]))
    for (const p of T) g.lineTo(sx(p[0]), sy(p[1]))
    g.lineTo(sx(T[T.length - 1][0]) + 400, sy(T[T.length - 1][1])); g.lineTo(sx(T[T.length - 1][0]) + 400, -50); g.closePath(); g.clip()
    g.beginPath(); g.moveTo(-50, H + 50); g.lineTo(-50, sy(rim[0][1]))
    for (const p of rim) g.lineTo(sx(p[0]), sy(p[1]))
    g.lineTo(W + 50, sy(rim[rim.length - 1][1])); g.lineTo(W + 50, H + 50); g.closePath()
    g.fillStyle = '#C6B283'; g.fill(); g.clip()
    g.strokeStyle = '#B49E6C'; g.lineWidth = 2
    for (let y = Math.ceil(level.view[3]); y > level.view[1] - 12; y -= 1.9) {
      const yy = sy(y - 0.3); g.beginPath()
      for (let x = -20; x <= W + 40; x += 40) { const w = yy + 5 * Math.sin((x - cam.ox) * 0.024 + y * 1.3); if (x === -20) g.moveTo(x, w); else g.lineTo(x, w) }
      g.stroke()
    }
    g.restore()
  }
  function terrain(level) {
    const T = level.terrain
    g.fillStyle = C.ink; terrainPath(T, 5, 5); g.fill() // hard shadow
    terrainPath(T, 0, 0); g.fillStyle = ROCK; g.fill()
    g.save(); g.clip()
    g.strokeStyle = ROCK2; g.lineWidth = 2
    for (let y = Math.ceil(level.view[3]); y > level.view[1] - 12; y -= 1.4) { // wonky strata
      const yy = sy(y - 0.7); g.beginPath()
      for (let x = -20; x <= W + 40; x += 40) { const w = yy + 4 * Math.sin((x - cam.ox) * 0.03 + y * 2.1); if (x === -20) g.moveTo(x, w); else g.lineTo(x, w) }
      g.stroke()
    }
    g.restore()
    terrainPath(T, 0, 0); g.strokeStyle = C.ink; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke()
    // road: a thick dark strip on the flat tops
    g.lineCap = 'butt'
    for (let i = 0; i + 1 < T.length; i++) {
      const a = T[i], b = T[i + 1]
      if (Math.abs(b[1] - a[1]) > (b[0] - a[0]) * 0.2 || b[0] - a[0] < 1.5 || a[1] < level.pit.y) continue
      const x0 = i === 0 ? -50 : sx(a[0]), x1 = i + 2 === T.length ? W + 50 : sx(b[0])
      g.strokeStyle = C.ink; g.lineWidth = 7; g.beginPath(); g.moveTo(x0, sy(a[1]) + 2); g.lineTo(x1, sy(b[1]) + 2); g.stroke()
      g.strokeStyle = C.yellow; g.lineWidth = 1.5; g.setLineDash([10, 12]); g.beginPath(); g.moveTo(x0, sy(a[1]) + 2); g.lineTo(x1, sy(b[1]) + 2); g.stroke(); g.setLineDash([])
    }
  }
  function flag(x, y, t, cheer) {
    const px = sx(x), py = sy(y), h = Math.max(30, cam.scale * 2.2)
    g.strokeStyle = C.ink; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - h); g.stroke()
    const wv = Math.sin(t * (cheer ? 9 : 3)) * 3
    g.fillStyle = cheer ? C.mint : C.orange; g.beginPath(); g.moveTo(px, py - h); g.lineTo(px + h * 0.5, py - h * 0.82 + wv); g.lineTo(px, py - h * 0.64); g.closePath(); g.fill(); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke()
  }
  function face(x, y, s, mood, look = 0.5, lookY = 0.3) {
    if (mood === 'calm') return drawOddFace(g, x, y, s, { look, lookY })
    const u = s / 64
    g.save(); g.translate(x - 32 * u, y - 32 * u); g.scale(u, u)
    g.lineCap = 'round'; g.lineJoin = 'round'
    if (mood === 'cheer') { g.strokeStyle = C.ink; g.lineWidth = 6; g.beginPath(); g.arc(21, 26, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke() }
    else {
      const r = mood === 'ohno' ? 16 : 14.5
      g.fillStyle = C.orange; g.beginPath(); g.arc(21, 22, r, 0, 7); g.fill()
      g.fillStyle = C.ink; g.beginPath(); g.arc(21 + look * 7, 22 + lookY * 7, mood === 'ohno' ? 3.4 : 4.4, 0, 7); g.fill()
    }
    g.fillStyle = C.ink; g.beginPath(); g.arc(47, 19, 5.5, 0, 7); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 7
    if (mood === 'cheer') { g.beginPath(); g.moveTo(10, 40); g.quadraticCurveTo(32, 68, 54, 40); g.closePath(); g.fill(); g.stroke() }
    else if (mood === 'ohno') { g.beginPath(); g.ellipse(32, 50, 8, 10, 0, 0, 7); g.fill() }
    else { g.beginPath(); g.moveTo(11, 50); g.quadraticCurveTo(21, 41, 32, 50); g.quadraticCurveTo(43, 59, 53, 50); g.stroke() }
    g.restore()
  }
  /** A little robot standing on the ground, watching. */
  function bystander(level, x, color, mood, t, i) {
    const gy = groundAt(level.terrain, x), s = Math.max(16, cam.scale * 1.05)
    const hop = mood === 'cheer' ? Math.abs(Math.sin(t * 7 + i)) * s * 0.35 : 0
    const px = sx(x), py = sy(gy) - hop
    g.strokeStyle = C.ink; g.lineWidth = 2.5; g.lineCap = 'round'
    g.beginPath(); g.moveTo(px - s * 0.2, py - s * 0.3); g.lineTo(px - s * 0.22, py); g.moveTo(px + s * 0.2, py - s * 0.3); g.lineTo(px + s * 0.22, py); g.stroke()
    const arm = mood === 'cheer' ? -0.9 : mood === 'ohno' ? -0.5 : 0.25
    g.beginPath(); g.moveTo(px - s * 0.42, py - s * 0.75); g.lineTo(px - s * 0.7, py - s * (0.75 - arm * 0.5)); g.moveTo(px + s * 0.42, py - s * 0.75); g.lineTo(px + s * 0.7, py - s * (0.75 - arm * 0.5)); g.stroke()
    g.fillStyle = color; g.beginPath(); g.roundRect(px - s * 0.45, py - s * 1.2, s * 0.9, s * 0.95, s * 0.2); g.fill(); g.lineWidth = 2; g.stroke()
    g.beginPath(); g.moveTo(px, py - s * 1.2); g.lineTo(px + s * 0.08, py - s * 1.5); g.stroke()
    g.fillStyle = C.ink; g.beginPath(); g.arc(px + s * 0.08, py - s * 1.52, s * 0.07, 0, 7); g.fill()
    face(px, py - s * 0.72, s * 0.62, mood, 0.6, mood === 'ohno' ? 0.8 : 0.1)
  }

  // ---------- bridge parts
  function anchor(level, a) {
    const px = sx(a[0]), py = sy(a[1]), r = Math.max(5.5, Math.min(11, cam.scale * 0.24))
    const gy = groundAt(level.terrain, a[0])
    if (a[1] > gy + 0.4) { // an anchor in mid-air stands on a pole
      g.strokeStyle = C.ink; g.lineWidth = Math.max(5, cam.scale * 0.2); g.lineCap = 'butt'; g.beginPath(); g.moveTo(px, py); g.lineTo(px, sy(gy)); g.stroke()
      g.strokeStyle = '#8A7FA0'; g.lineWidth = Math.max(2, cam.scale * 0.2 - 4); g.beginPath(); g.moveTo(px, py); g.lineTo(px, sy(gy) - 1); g.stroke()
    }
    g.fillStyle = C.ink; g.beginPath(); g.roundRect(px - r - 2.5, py - r - 2.5, 2 * r + 5, 2 * r + 5, 4); g.fill()
    g.fillStyle = C.orange; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(px - r * 0.45, py - r * 0.45); g.lineTo(px + r * 0.45, py + r * 0.45); g.moveTo(px + r * 0.45, py - r * 0.45); g.lineTo(px - r * 0.45, py + r * 0.45); g.stroke()
  }
  function joint(x, y, hot) {
    const r = Math.max(3.5, Math.min(8, cam.scale * 0.15))
    g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, r + 2, 0, 7); g.fill()
    g.fillStyle = hot ? C.yellow : C.paper; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
  }
  /** One beam between two screen points. o: { stress (0..1 or null in build mode), sel, ghost, bad, stub, sag } */
  function bar(x1, y1, x2, y2, mat, o = {}) {
    const st = MAT_STYLE[mat]
    const s = o.stress == null ? 0 : o.stress
    let w = Math.max(st.min, st.w * cam.scale) * (1 + (o.stress == null ? 0 : s * 0.3))
    if (s > 0.7 && !still && !o.stub) { const j = (s - 0.7) * 5; x1 += (Math.random() - 0.5) * j; y1 += (Math.random() - 0.5) * j; x2 += (Math.random() - 0.5) * j; y2 += (Math.random() - 0.5) * j }
    const col = o.bad ? '#E0245E' : o.stress == null || o.stub ? st.color : s < 0.06 ? st.color : mix(st.color, stressColor(s), Math.min(1, (s - 0.06) / 0.22))
    g.lineCap = 'round'; g.globalAlpha = o.ghost ? 0.75 : 1
    const path = () => {
      g.beginPath(); g.moveTo(x1, y1)
      if (o.sag) g.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + o.sag, x2, y2); else g.lineTo(x2, y2)
    }
    if (o.sel) { g.strokeStyle = C.blue; g.lineWidth = w + 11; path(); g.stroke() }
    g.strokeStyle = C.ink; g.lineWidth = w + 4; path(); g.stroke()
    g.strokeStyle = col; g.lineWidth = w; path(); g.stroke()
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
    g.strokeStyle = C.ink; g.lineCap = 'butt'
    if (mat === 'plank' && w >= 5) { // board gaps
      g.lineWidth = 1.2; g.globalAlpha *= 0.55
      const n = Math.max(1, Math.round(len / Math.max(9, cam.scale * 0.5)))
      g.beginPath(); for (let i = 1; i < n; i++) { const t = i / n, cx = x1 + dx * t, cy = y1 + dy * t; g.moveTo(cx - uy * w * 0.5, cy + ux * w * 0.5); g.lineTo(cx + uy * w * 0.5, cy - ux * w * 0.5) } g.stroke()
    } else if (mat === 'steel' && w >= 3.5) { // rivets
      g.fillStyle = C.ink; g.globalAlpha *= 0.7
      const n = Math.max(2, Math.round(len / Math.max(12, cam.scale * 0.7)))
      for (let i = 1; i < n; i++) { const t = i / n; g.beginPath(); g.arc(x1 + dx * t, y1 + dy * t, Math.max(1, w * 0.22), 0, 7); g.fill() }
    } else if (mat === 'rope' && !o.sag) { // twist
      g.lineWidth = 1; g.globalAlpha *= 0.6; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([])
    } else if (mat === 'timber' && w >= 4.5) { // grain
      g.lineWidth = 1; g.globalAlpha *= 0.35; g.beginPath(); g.moveTo(x1 + ux * w, y1 + uy * w); g.lineTo(x2 - ux * w, y2 - uy * w); g.stroke()
    }
    g.globalAlpha = 1
    if (o.stress != null && s > 0.85 && !o.stub) { // crack marks: a second, colour-free warning
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, k = Math.max(4, w * 0.7)
      g.strokeStyle = C.ink; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round'
      g.beginPath(); g.moveTo(cx - uy * k - ux * 2, cy + ux * k - uy * 2); g.lineTo(cx + ux * 2, cy + uy * 2); g.lineTo(cx - ux * 2, cy - uy * 2); g.lineTo(cx + uy * k + ux * 2, cy - ux * k + uy * 2); g.stroke()
    }
    if (o.stub) { // splintered end
      g.strokeStyle = C.ink; g.lineWidth = 2; g.lineCap = 'round'
      g.beginPath(); g.moveTo(x2 - uy * w * 0.6, y2 + ux * w * 0.6); g.lineTo(x2 + ux * w * 0.5, y2 + uy * w * 0.5); g.lineTo(x2 + uy * w * 0.6, y2 - ux * w * 0.6); g.stroke()
    }
  }
  const ORDER = { rope: 0, steel: 1, timber: 2, plank: 3 }

  // ---------- vehicles
  function wheel(c) {
    const px = sx(c.p.x), py = sy(c.p.y), r = c.r * cam.scale
    g.fillStyle = C.ink; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill()
    g.fillStyle = '#453E52'; g.beginPath(); g.arc(px, py, r * 0.72, 0, 7); g.fill()
    g.fillStyle = C.yellow; g.beginPath(); g.arc(px, py, r * 0.34, 0, 7); g.fill()
    g.strokeStyle = C.paper; g.lineWidth = Math.max(1.5, r * 0.12); g.lineCap = 'round'
    for (let k = 0; k < 3; k++) { const a = -c.ang + k * 2.094; g.beginPath(); g.moveTo(px + Math.cos(a) * r * 0.34, py + Math.sin(a) * r * 0.34); g.lineTo(px + Math.cos(a) * r * 0.7, py + Math.sin(a) * r * 0.7); g.stroke() }
  }
  function parcel(c) {
    const px = sx(c.p.x), py = sy(c.p.y), r = c.r * cam.scale * 0.94
    g.save(); g.translate(px, py); g.rotate(-c.ang)
    g.fillStyle = PARCEL[c.hue % PARCEL.length]; g.strokeStyle = C.ink; g.lineWidth = Math.max(1.5, r * 0.14); g.lineJoin = 'round'
    g.beginPath(); g.roundRect(-r, -r, 2 * r, 2 * r, r * 0.3); g.fill(); g.stroke()
    g.lineWidth = Math.max(1, r * 0.1); g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r); g.stroke()
    g.restore()
  }
  function vehicle(v, mood, t) {
    const B = v.B, bl = v.BL, br = v.BR, tl = v.TL
    // local frame: x along the body (0..2L, forward), y up the body (0..bodyH); metres
    const ax = ((br.x - bl.x) / (2 * B.L)) * cam.scale, ay = (-(br.y - bl.y) / (2 * B.L)) * cam.scale
    const bx = ((tl.x - bl.x) / B.bodyH) * cam.scale, by = (-(tl.y - bl.y) / B.bodyH) * cam.scale
    for (const c of v.parcels) if (!c.p.wet || true) parcel(c)
    g.save(); g.transform(ax, ay, bx, by, sx(bl.x), sy(bl.y))
    const lw = 2.4 / cam.scale, L2 = 2 * B.L, h = B.bodyH, cab = B.L + B.cab, truck = v.type === 'truck'
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.ink; g.lineWidth = lw
    // tray rail and cab back
    g.fillStyle = truck ? '#8F8FFF' : C.yellow
    g.beginPath(); g.rect(-0.04, h - 0.02, 0.1, 0.36); g.fill(); g.stroke()
    // cab
    g.fillStyle = truck ? C.blue : C.orange
    g.beginPath(); g.moveTo(cab - 0.04, h); g.lineTo(cab - 0.04, h + 0.52); g.lineTo(L2 - 0.28, h + 0.52); g.lineTo(L2, h + 0.18); g.lineTo(L2, h); g.closePath(); g.fill(); g.stroke()
    // body
    g.fillStyle = truck ? C.blue : C.orange
    g.beginPath(); g.roundRect(0, 0, L2, h, 0.1); g.fill(); g.stroke()
    g.fillStyle = truck ? C.yellow : C.paper
    g.beginPath(); g.roundRect(0.12, h * 0.3, L2 - 0.24, h * 0.3, 0.05); g.fill(); g.stroke()
    // head of the driver, poking out of the cab
    const hs = truck ? 0.62 : 0.56, hx = (cab + L2) / 2 - 0.08, bob = Math.sin(t * 9 + v.index) * (v.state === 'drive' ? 0.015 : 0.004), hy = h + 0.52 + hs * 0.42 + bob
    g.beginPath(); g.moveTo(hx, hy + hs * 0.5); g.lineTo(hx - 0.06, hy + hs * 0.5 + 0.2); g.stroke()
    g.fillStyle = C.ink; g.beginPath(); g.arc(hx - 0.06, hy + hs * 0.5 + 0.22, 0.055, 0, 7); g.fill()
    g.fillStyle = truck ? C.pink : C.mint
    g.beginPath(); g.roundRect(hx - hs / 2, hy - hs / 2, hs, hs, hs * 0.24); g.fill(); g.stroke()
    g.restore()
    // the face is drawn upright-ish in screen space so the kit face is never mirrored into nonsense
    const fxw = bl.x + ((br.x - bl.x) * hx) / L2 + ((tl.x - bl.x) * hy) / h, fyw = bl.y + ((br.y - bl.y) * hx) / L2 + ((tl.y - bl.y) * hy) / h
    const ang = Math.atan2(-(br.y - bl.y) * v.dir, (br.x - bl.x) * v.dir)
    g.save(); g.translate(sx(fxw), sy(fyw)); g.rotate(ang); if (v.dir < 0) g.scale(-1, 1)
    face(0, 0, hs * 0.74 * cam.scale, mood, 0.7, mood === 'ohno' ? 0.9 : mood === 'worried' ? 0.7 : 0.25)
    g.restore()
    for (const c of v.wheels) wheel(c)
  }

  // ---------- frame
  /**
   * S: { level, phase: 'build' | 'sim', design, world, preview, mat, sel, drag, cursor, pending, hover, moods, result, touch, dim }
   */
  function draw(S, dt) {
    time += dt
    const level = S.level
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.save()
    if (shake > 0.01) { g.translate((Math.random() - 0.5) * shake * 9, (Math.random() - 0.5) * shake * 9); shake *= Math.pow(0.002, dt) } else shake = 0
    backdrop(level)
    backWall(level)
    pitSurface(level, false)
    terrain(level)
    const sim = S.phase === 'sim' && S.world, Wd = sim ? S.world : S.preview
    const cheer = sim && S.world.over && S.world.success, sad = sim && S.world.over && !S.world.success
    // watchers and flags
    const v0 = level.view
    const mood = cheer ? 'cheer' : sad ? 'ohno' : sim && S.world.maxStress > 0.75 ? 'worried' : 'calm'
    bystander(level, v0[0] + 1.6, C.pink, mood, time, 0)
    bystander(level, v0[2] - 1.6, C.yellow, mood, time, 2)
    for (const v of level.vehicles) flag(v.goal, groundAt(level.terrain, v.goal), time, cheer)
    // build grid
    if (S.phase === 'build' && cam.scale >= 9) {
      const b = level.build
      g.fillStyle = 'rgba(23,19,31,0.28)'
      const r = cam.scale >= 18 ? 1.6 : 1.2
      for (let x = b[0]; x <= b[2]; x++) { const px = sx(x); if (px < -4 || px > W + 4) continue; for (let y = b[1]; y <= b[3]; y++) if (jointOk(level, x, y)) g.fillRect(px - r, sy(y) - r, r * 2, r * 2) }
    }
    for (const a of level.anchors) anchor(level, a)
    // beams
    if (sim) {
      const list = S.world.beams.filter((b) => !b.broken).sort((p, q) => ORDER[p.mat] - ORDER[q.mat])
      for (const b of list) {
        const x1 = sx(b.a.x), y1 = sy(b.a.y), x2 = sx(b.b.x), y2 = sy(b.b.y)
        let sag = 0
        if (b.rope) { const d = Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y); if (d < b.rest * 0.999) sag = Math.sqrt(Math.max(0, b.rest * b.rest - d * d)) * 0.45 * cam.scale }
        bar(x1, y1, x2, y2, b.mat, { stress: Math.min(1, b.stress), stub: b.stub, sag })
      }
      for (let i = 0; i < S.world.nJoints; i++) { const p = S.world.P[i]; if (!p.fixed) joint(sx(p.x), sy(p.y), false) }
    } else {
      const beams = S.design.beams.map((b, i) => [b, i]).sort((p, q) => ORDER[p[0][4]] - ORDER[q[0][4]])
      for (const [b, i] of beams) bar(sx(b[0]), sy(b[1]), sx(b[2]), sy(b[3]), b[4], { sel: i === S.sel })
      for (const j of jointsOf(level, S.design)) if (!j[2]) joint(sx(j[0]), sy(j[1]), S.hover && S.hover[0] === j[0] && S.hover[1] === j[1])
      if (S.hover) { g.strokeStyle = C.blue; g.lineWidth = 3; g.beginPath(); g.arc(sx(S.hover[0]), sy(S.hover[1]), Math.max(11, cam.scale * 0.42), 0, 7); g.stroke() }
    }
    // vehicles
    if (Wd) for (const v of Wd.vehicles) vehicle(v, S.moods ? S.moods[v.index] || 'calm' : 'calm', time)
    // particles
    for (const p of parts) {
      if (!p.on) continue
      p.life -= dt; if (p.life <= 0) { p.on = false; continue }
      p.vy -= 9.8 * p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt
      const s = p.size * cam.scale * Math.min(1, p.life / p.max + 0.3)
      g.globalAlpha = Math.min(1, (p.life / p.max) * 2.2); g.fillStyle = p.color
      if (p.round) { g.beginPath(); g.arc(sx(p.x), sy(p.y), s * 0.5, 0, 7); g.fill() } else { g.save(); g.translate(sx(p.x), sy(p.y)); g.rotate(p.rot); g.fillRect(-s * 0.6, -s * 0.22, s * 1.2, s * 0.44); g.restore() }
    }
    g.globalAlpha = 1
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt; if (r.t >= r.max) { rings.splice(i, 1); continue }
      const k = r.t / r.max
      g.globalAlpha = 1 - k; g.strokeStyle = r.color; g.lineWidth = 3; g.beginPath(); g.ellipse(sx(r.x), sy(r.y), r.r * k * cam.scale, r.r * k * cam.scale * 0.3, 0, 0, 7); g.stroke()
    }
    g.globalAlpha = 1
    pitSurface(level, true)
    // floating words
    g.textAlign = 'center'; g.textBaseline = 'middle'
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.t += dt; if (t.t > 1.4) { texts.splice(i, 1); continue }
      const k = t.t / 1.4, px = sx(t.x), py = sy(t.y) - 20 - k * 34
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1
      g.font = `800 ${t.size}px ${FONT.display}`; g.lineWidth = 5; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.strokeText(t.str, px, py); g.fillStyle = t.color; g.fillText(t.str, px, py)
    }
    g.globalAlpha = 1
    if (S.phase === 'build') overlays(S)
    g.restore()
    if (S.loupe) loupe(S.loupe)
  }

  function overlays(S) {
    const level = S.level
    // keyboard cursor
    if (S.cursor) {
      const px = sx(S.cursor[0]), py = sy(S.cursor[1]), r = Math.max(10, cam.scale * 0.4), k = 4 + Math.sin(time * 6) * 1.5
      g.strokeStyle = C.ink; g.lineWidth = 4; g.lineCap = 'round'
      for (const pass of [C.ink, C.yellow]) {
        g.strokeStyle = pass; g.lineWidth = pass === C.ink ? 5 : 2.5; g.beginPath()
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(px + dx * (r - k), py + dy * (r - k)); g.lineTo(px + dx * (r + 5), py + dy * (r + 5)) }
        g.stroke()
      }
    }
    if (S.tutor) { // level 1: show the drag
      const x1 = sx(S.tutor.a[0]), y1 = sy(S.tutor.a[1]), x2 = sx(S.tutor.b[0]), y2 = sy(S.tutor.b[1])
      const k = still ? 0.5 : (time * 0.7) % 1.3, t = Math.min(1, k), e = t * t * (3 - 2 * t)
      g.strokeStyle = C.ink; g.lineWidth = 3; g.setLineDash([7, 7]); g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([])
      const hx = x1 + (x2 - x1) * e, hy = y1 + (y2 - y1) * e
      g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = 2.5
      g.beginPath(); g.arc(hx, hy + 16, 11, 0, 7); g.fill(); g.stroke()
      g.beginPath(); g.moveTo(hx, hy + 5); g.lineTo(hx - 5, hy + 11); g.lineTo(hx + 5, hy + 11); g.closePath(); g.fillStyle = C.ink; g.fill()
    }
    const d = S.drag || S.pending
    if (!d) return
    const M = MATERIALS[S.mat], ax = sx(d.ax), ay = sy(d.ay)
    // reach ring
    g.strokeStyle = 'rgba(23,19,31,0.55)'; g.lineWidth = 2; g.setLineDash([6, 6]); g.beginPath(); g.arc(ax, ay, M.maxLen * cam.scale, 0, 7); g.stroke(); g.setLineDash([])
    g.fillStyle = 'rgba(255,201,60,0.12)'; g.beginPath(); g.arc(ax, ay, M.maxLen * cam.scale, 0, 7); g.fill()
    if (d.tx == null) return
    const bx = sx(d.tx), by = sy(d.ty)
    bar(ax, ay, bx, by, S.mat, { ghost: true, bad: !d.ok })
    joint(ax, ay, true); joint(bx, by, true)
    const len = beamLen(d.ax, d.ay, d.tx, d.ty)
    const label = d.ok ? `$${beamCost(len, S.mat)}` : d.why || 'no'
    g.font = `700 13px ${FONT.body}`; g.textAlign = 'center'; g.textBaseline = 'middle'
    const tw = g.measureText(label).width + 14, lx = Math.max(tw / 2 + 4, Math.min(W - tw / 2 - 4, bx)), ly = Math.max(inset.top + 14, by - 26)
    g.fillStyle = C.ink; g.beginPath(); g.roundRect(lx - tw / 2, ly - 11, tw, 22, 11); g.fill()
    g.fillStyle = d.ok ? C.yellow : C.pink; g.fillText(label, lx, ly + 1)
  }
  /** Magnified copy of what is under the finger's target, so the finger never hides it. o: { x, y } in world units. */
  function loupe(o) {
    const R = 46, zoom = 2, px = sx(o.x), py = sy(o.y)
    const cx = px < W / 2 ? W - R - 12 : R + 12, cy = inset.top + R + 12
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.save(); g.beginPath(); g.arc(cx * dpr, cy * dpr, R * dpr, 0, 7); g.clip()
    const sw = (2 * R * dpr) / zoom
    g.fillStyle = SKY; g.fillRect((cx - R) * dpr, (cy - R) * dpr, 2 * R * dpr, 2 * R * dpr)
    g.drawImage(canvas, px * dpr - sw / 2, py * dpr - sw / 2, sw, sw, (cx - R) * dpr, (cy - R) * dpr, 2 * R * dpr, 2 * R * dpr)
    g.restore()
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.strokeStyle = C.ink; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke()
    g.strokeStyle = C.yellow; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R - 3, 0, 7); g.stroke()
  }

  return { resize, draw, setCamera, toWorld, toScreen: (x, y) => [sx(x), sy(y)], cam, inset, fx, get size() { return [W, H] } }
}
