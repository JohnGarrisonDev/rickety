// Rickety pointer gestures on the canvas: grab-and-drag, tap, one-finger pan, two-finger pinch, wheel zoom, hover.
// It only classifies gestures; main.js decides what they do. All coordinates are CSS pixels inside the canvas.
export function createInput(canvas, h) {
  const pts = new Map() // pointerId -> { x, y }
  let main = null // { id, x0, y0, x, y, type, mode: 'grab' | 'pan' | 'tap', moved }
  let pinch = 0
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const mid = () => { const [a, b] = [...pts.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2] }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const [x, y] = pos(e)
    try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic events have no capture */ }
    pts.set(e.pointerId, { x, y })
    if (pts.size === 2) { // second finger: whatever the first was doing becomes a pinch
      if (main && main.mode === 'grab') h.onGrabCancel()
      main = null; pinch = spread(); return
    }
    if (pts.size > 2) return
    main = { id: e.pointerId, x0: x, y0: y, x, y, type: e.pointerType || 'mouse', mode: 'tap', moved: false }
    if (h.onGrab(x, y, main.type)) main.mode = 'grab'
    e.preventDefault()
  })
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e)
    const p = pts.get(e.pointerId)
    if (!p) { if (e.pointerType === 'mouse') h.onHover(x, y); return }
    const dx = x - p.x, dy = y - p.y
    p.x = x; p.y = y
    if (pts.size === 2) {
      const s = spread(), m = mid()
      if (pinch > 10 && s > 10) h.onZoom(s / pinch, m[0], m[1])
      h.onPan(dx / 2, dy / 2)
      pinch = s; return
    }
    if (!main || main.id !== e.pointerId) return
    main.x = x; main.y = y
    const far = Math.hypot(x - main.x0, y - main.y0) > (main.type === 'mouse' ? 5 : 9)
    if (far) main.moved = true
    if (main.mode === 'grab') h.onGrabMove(x, y, main.type, main.moved)
    else if (main.moved) { main.mode = 'pan'; h.onPan(dx, dy) }
  })
  const end = (e, cancelled) => {
    if (!pts.has(e.pointerId)) return
    pts.delete(e.pointerId)
    const [x, y] = pos(e)
    if (main && main.id === e.pointerId) {
      const m = main; main = null
      if (m.mode === 'grab') { if (cancelled) h.onGrabCancel(); else h.onGrabEnd(x, y, m.type, m.moved) }
      else if (m.mode === 'tap' && !cancelled) h.onTap(x, y, m.type)
    }
    if (pts.size < 2) pinch = 0
  }
  canvas.addEventListener('pointerup', (e) => end(e, false))
  canvas.addEventListener('pointercancel', (e) => end(e, true))
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pts.size) h.onHover(-1, -1) })
  canvas.addEventListener('wheel', (e) => { const [x, y] = pos(e); if (h.onZoom(Math.exp(-e.deltaY * 0.0015), x, y)) e.preventDefault() }, { passive: false })
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); const [x, y] = pos(e); h.onAlt(x, y) })
  return { cancel() { if (main && main.mode === 'grab') h.onGrabCancel(); main = null; pts.clear(); pinch = 0 } }
}
