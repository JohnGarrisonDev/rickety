// Rickety entry point: owns the flow (title, build, run, result), the frame loop, building input, and turning
// physics events into sound and particles. The rules live in physics.js / design.js / daily.js / save.js.
import { C, makeStore, wireChrome } from '../kit/kit.js'
import { LEVELS, SANDBOX, CHAPTERS, makeLevel } from './levels.js'
import { H, MATERIALS, createWorld, step, summary, timeLimit, countParcels } from './physics.js'
import { canAdd, checkDesign, cleanDesign, designCost, makeHistory, snapTarget, hasJoint, beamLen, jointsOf } from './design.js'
import { dailyLevel, dateKey, shiftDate, shareText, money } from './daily.js'
import { autoBuild } from './autobuild.js'
import { makeSave, defaults, goals } from './save.js'
import { createRenderer } from './render.js'
import { createInput } from './input.js'
import { createUI } from './ui.js'
import { audio } from './audio.js'

const stage = document.getElementById('stage'), canvas = document.getElementById('game')
const save = makeSave(makeStore('rickety', defaults()), LEVELS)
const R = createRenderer(canvas), fx = R.fx
const ui = createUI(stage, onAction)
const MAX_STARS = LEVELS.length * 3
const MAT_KEYS = ['plank', 'timber', 'steel', 'rope']

// G: the session. Nothing in here is saved directly.
const G = {
  screen: 'title', mode: 'campaign', index: 0, date: '', level: null, key: '', label: '',
  design: { beams: [] }, hist: makeHistory(), phase: 'build', world: null, preview: null,
  mat: 'plank', sel: -1, cursor: null, pending: null, drag: null, hover: null, loupe: null,
  zoom: 1, panX: 0, panY: 0, camZ: 1, camX: 0, camY: 0, speed: save.data.speed, acc: 0, resultShown: false, frozenAt: 0, moods: [], said: [], uiTick: 0, dustT: 0, time: 0,
}

// ---------- title screen: a little bridge that carts keep crossing
const ATTRACT = makeLevel({ id: 'attract', name: '', w: 10, depth: 7, rocks: [[4, -2]], anchors: [[10, 4]], materials: MAT_KEYS, vehicles: [{ type: 'cart' }] })
ATTRACT.view = [-7, -5.5, 17, 7]
let attractDesign = null
function attract() {
  if (!attractDesign) { const a = autoBuild(ATTRACT, { margin: 1 }); attractDesign = a ? a.design : { beams: [] } }
  G.level = ATTRACT; G.phase = 'sim'; G.world = createWorld(ATTRACT, attractDesign, { events: true }); G.preview = null
  G.moods = []; G.said = []; G.acc = 0; G.zoom = 1; G.panX = G.panY = 0; G.loupe = null; G.drag = G.pending = G.cursor = G.hover = null
}
function titleScreen() {
  G.screen = 'title'
  attract()
  ui.hud({ show: false }); ui.tools({ show: false }); ui.sim({ show: false }); ui.toast('')
  save.data.cur = null; save.save()
  const today = dateKey(), d = save.data.daily.days[today]
  const next = save.nextIndex(), history = []
  for (let i = 6; i >= 0; i--) {
    const date = shiftDate(today, -i), e = save.data.daily.days[date]
    history.push({ date, done: !!e, cost: e ? e.cost : 0, today: i === 0, label: 'SMTWTFS'[new Date(date + 'T12:00:00').getDay()] })
  }
  ui.title({
    started: save.totalStars() > 0, nextLabel: `Level ${next + 1}: ${LEVELS[next].name}`, stars: save.totalStars(), maxStars: MAX_STARS,
    daily: d ? { done: true, ...d } : { done: false }, streak: save.streak(today), bestStreak: save.data.daily.best, history,
  })
  layout()
}

// ---------- opening a level
function openLevel(mode, level, key, label) {
  G.screen = 'play'; G.mode = mode; G.level = level; G.key = key; G.label = label
  G.design = cleanDesign(level, { beams: save.getDesign(key) })
  G.hist = makeHistory(); G.phase = 'build'; G.world = null
  G.preview = createWorld(level, { beams: [] })
  G.mat = level.materials[0]; G.sel = -1; G.cursor = null; G.pending = null; G.drag = null; G.hover = null; G.loupe = null
  G.panX = G.panY = 0; G.moods = []
  // on a narrow screen start zoomed to the part you build in; the run zooms back out to show everything
  const v = level.view, b = level.build, size = R.size
  G.zoom = size[0] < size[1] ? Math.max(1, Math.min(2.2, (v[2] - v[0]) / (b[2] - b[0] + 2))) : 1
  if (G.zoom > 1) G.panX = (b[0] + b[2]) / 2 - (v[0] + v[2]) / 2
  G.camZ = G.zoom; G.camX = G.panX; G.camY = 0
  fx.clear(); ui.hide()
  save.data.cur = { mode, id: mode === 'daily' ? G.date : level.id }; save.save()
  ui.hud({ show: true, label, name: level.name })
  ui.sim({ show: false })
  paint(); layout()
  ui.toast(level.hint, 6500)
}
function openCampaign(i) {
  if (!save.unlocked(i)) return titleScreen()
  G.index = i
  openLevel('campaign', LEVELS[i], LEVELS[i].id, `Level ${i + 1} · ${CHAPTERS[LEVELS[i].chapter]}`)
}
function openDaily(date = dateKey()) {
  G.date = date
  openLevel('daily', dailyLevel(date).level, 'daily:' + date, `Daily gap · ${date}`)
}
function openSandbox(id) {
  const level = SANDBOX.find((l) => l.id === id) || SANDBOX[0]
  openLevel('sandbox', level, level.id, 'Sandbox')
}

function paint() {
  if (G.screen !== 'play') return
  const cost = designCost(G.design), L = G.level
  ui.budget(cost, L.budget, L.par)
  if (G.phase === 'build') ui.tools({ show: true, materials: L.materials, mat: G.mat, canUndo: G.hist.canUndo, canRedo: G.hist.canRedo, hasSel: G.sel >= 0, canGo: L.budget == null || cost <= L.budget, empty: !G.design.beams.length })
  else ui.tools({ show: false })
}
function layout() {
  R.resize()
  const bar = stage.querySelector(G.phase === 'sim' ? '.simbar' : '.tools')
  R.inset.top = G.screen === 'play' ? 54 : 8
  R.inset.bottom = G.screen === 'play' && bar && !bar.hidden ? bar.offsetHeight + 4 : 8
  R.inset.left = 0
  const panel = ui.screen === 'title' && stage.querySelector('.overlay .panel')
  if (panel) { // keep the title's demo bridge clear of the title card
    const a = stage.getBoundingClientRect(), b = panel.getBoundingClientRect()
    if (a.width > 620) R.inset.left = b.right - a.left + 6; else R.inset.top = Math.min(a.height * 0.7, b.bottom - a.top + 4)
  }
}
function changed() { save.setDesign(G.key, G.design.beams); paint() }

// ---------- editing
const WHY = { duplicate: 'already there', place: 'not here', long: 'too long', full: 'too many beams', material: 'not allowed', short: '' }
function placeBeam(ax, ay, bx, by) {
  const r = canAdd(G.level, G.design, ax, ay, bx, by, G.mat)
  if (!r.ok) { audio.nope(); if (WHY[r.reason]) ui.toast(r.reason === 'full' ? 'That is a lot of beams. No room for more.' : `Can't put a beam there: ${WHY[r.reason]}.`, 1800); return false }
  G.hist.push(G.design)
  G.design.beams.push([ax, ay, bx, by, G.mat])
  audio.place(beamLen(ax, ay, bx, by), G.mat)
  fx.dust(bx, by, 4)
  G.sel = -1
  changed()
  ui.toast('')
  return true
}
function deleteSel() {
  if (G.sel < 0 || G.phase !== 'build') return
  G.hist.push(G.design); G.design.beams.splice(G.sel, 1); G.sel = -1
  if (G.pending && !hasJoint(G.level, G.design, G.pending.ax, G.pending.ay)) G.pending = null
  audio.remove(); changed()
}
function setMat(m) {
  if (!G.level.materials.includes(m) || G.phase !== 'build') return
  G.mat = m; audio.pick()
  const b = G.design.beams[G.sel]
  if (b && b[4] !== m && beamLen(b[0], b[1], b[2], b[3]) <= MATERIALS[m].maxLen + 1e-9) { G.hist.push(G.design); b[4] = m; changed() } else paint()
  retarget()
}
function undo(redo) {
  if (G.phase !== 'build') return
  if (redo ? G.hist.redo(G.design) : G.hist.undo(G.design)) { G.sel = -1; G.pending = null; audio.undo(); changed() } else audio.nope()
}
function zoomAt(f, px, py) {
  const old = G.zoom
  const z = Math.max(1, Math.min(5, G.zoom * f))
  if (z === old) return false
  const [wx, wy] = R.toWorld(px, py)
  G.zoom = z; R.setCamera(G.level, G.zoom, G.panX, G.panY)
  const [wx2, wy2] = R.toWorld(px, py)
  G.panX += wx - wx2; G.panY += wy - wy2
  ;[G.panX, G.panY] = R.setCamera(G.level, G.zoom, G.panX, G.panY)
  return true
}

// ---------- pointer building
const building = () => G.screen === 'play' && G.phase === 'build' && !ui.screen
function jointNear(px, py, type) {
  const reach = Math.max(type === 'mouse' ? 15 : 27, R.cam.scale * 0.45)
  let best = null, bd = reach
  for (const j of jointsOf(G.level, G.design)) {
    const [sx, sy] = R.toScreen(j[0], j[1]), d = Math.hypot(sx - px, sy - py)
    if (d < bd) { bd = d; best = j }
  }
  return best
}
function beamNear(px, py, type) {
  let best = -1, bd = type === 'mouse' ? 10 : 20
  G.design.beams.forEach((b, i) => {
    const [x1, y1] = R.toScreen(b[0], b[1]), [x2, y2] = R.toScreen(b[2], b[3])
    const ex = x2 - x1, ey = y2 - y1, t = Math.max(0, Math.min(1, ((px - x1) * ex + (py - y1) * ey) / (ex * ex + ey * ey || 1)))
    const d = Math.hypot(px - x1 - ex * t, py - y1 - ey * t)
    if (d < bd) { bd = d; best = i }
  })
  return best
}
/** Point a drag / pending beam at the grid point nearest to a world position. */
function aim(d, wx, wy) {
  const t = snapTarget(G.level, d.ax, d.ay, wx, wy, G.mat)
  const was = d.tx + ',' + d.ty
  if (!t) { d.tx = null; return }
  d.tx = t[0]; d.ty = t[1]
  const r = canAdd(G.level, G.design, d.ax, d.ay, d.tx, d.ty, G.mat)
  d.ok = r.ok; d.why = WHY[r.reason] || ''
  if (was !== d.tx + ',' + d.ty) audio.click()
}
function retarget() { const d = G.pending; if (d && d.tx != null) aim(d, d.tx, d.ty) }

createInput(canvas, {
  onGrab(px, py, type) {
    if (!building()) return false
    const j = jointNear(px, py, type)
    if (!j) return false
    G.drag = { ax: j[0], ay: j[1], tx: null, ty: null, ok: false, why: '' }
    G.hover = null
    return true
  },
  onGrabMove(px, py, type, moved) {
    const d = G.drag
    if (!d) return
    if (!moved) { d.tx = null; G.loupe = null; return }
    // on touch the target floats above the finger, so the finger never covers it
    const [wx, wy] = R.toWorld(px, py - (type === 'mouse' ? 0 : 46))
    if (Math.hypot(wx - d.ax, wy - d.ay) < 0.45) { d.tx = null; G.loupe = null; return }
    aim(d, wx, wy)
    G.loupe = type !== 'mouse' && d.tx != null ? { x: d.tx, y: d.ty } : null
  },
  onGrabEnd(px, py, type, moved) {
    const d = G.drag
    G.drag = null; G.loupe = null
    if (!d) return
    if (d.tx != null) { if (placeBeam(d.ax, d.ay, d.tx, d.ty)) { G.pending = null; G.cursor = type === 'mouse' ? null : G.cursor } return }
    if (!moved) tapJoint(d.ax, d.ay)
  },
  onGrabCancel() { G.drag = null; G.loupe = null },
  onTap(px, py, type) {
    if (!building()) return
    const [wx, wy] = R.toWorld(px, py)
    if (G.pending) { // tap-tap building: second tap picks the far end
      const d = G.pending, M = MATERIALS[G.mat]
      if (Math.hypot(wx - d.ax, wy - d.ay) <= M.maxLen + 0.7) {
        aim(d, wx, wy)
        if (d.tx != null && placeBeam(d.ax, d.ay, d.tx, d.ty)) G.pending = { ax: d.tx, ay: d.ty, tx: null, ty: null, ok: false, why: '' }
        else d.tx = null
        return
      }
      G.pending = null
      return
    }
    const i = beamNear(px, py, type)
    if (i !== G.sel) audio.pick()
    G.sel = i; paint()
  },
  onPan(dx, dy) {
    if (G.screen !== 'play' || G.phase !== 'build' || ui.screen) return
    G.panX -= dx / R.cam.scale; G.panY += dy / R.cam.scale
  },
  onZoom(f, px, py) { if (G.screen !== 'play' || G.phase !== 'build' || ui.screen) return false; return zoomAt(f, px, py) },
  onHover(px, py) { G.hover = building() && px >= 0 && !G.drag ? jointNear(px, py, 'mouse') : null; canvas.style.cursor = G.hover ? 'grab' : '' },
  onAlt(px, py) { if (!building()) return; const i = beamNear(px, py, 'mouse'); if (i >= 0) { G.sel = i; deleteSel() } },
})
function tapJoint(x, y) {
  if (G.pending && (G.pending.ax !== x || G.pending.ay !== y)) { // second tap landed on a joint
    const d = G.pending
    if (placeBeam(d.ax, d.ay, x, y)) { G.pending = { ax: x, ay: y, tx: null, ty: null, ok: false, why: '' }; return }
  }
  if (G.pending && G.pending.ax === x && G.pending.ay === y) { G.pending = null; return }
  G.pending = { ax: x, ay: y, tx: null, ty: null, ok: false, why: '' }
  G.sel = -1; audio.pick(); paint()
}

// ---------- running
function go() {
  if (G.screen !== 'play' || G.phase !== 'build') return
  const chk = checkDesign(G.level, G.design)
  if (!chk.ok) {
    audio.nope()
    ui.toast(chk.reason === 'budget' ? `Over budget by ${money(chk.cost - G.level.budget)}. Take something out.` : 'Something in this bridge is not allowed here.', 2600)
    return
  }
  G.world = createWorld(G.level, G.design, { events: true })
  G.phase = 'sim'; G.acc = 0; G.resultShown = false; G.moods = []; G.said = []
  G.sel = -1; G.pending = null; G.drag = null; G.cursor = null; G.hover = null; G.loupe = null
  fx.clear(); ui.toast(''); audio.go()
  paint(); ui.sim({ show: true, speed: G.speed, stress: 0 }); layout()
}
function stop() {
  if (G.screen !== 'play' || G.phase !== 'sim') return
  G.phase = 'build'; G.world = null; G.moods = []
  fx.clear(); ui.hide(); ui.sim({ show: false }); audio.stop()
  paint(); layout()
}
const QUIPS = {
  perfect: ['Every parcel, under par. The robots are impressed.', 'Cheap, strong and tidy. Suspiciously good.', 'Nothing fell off and nothing was wasted.'],
  win: ['It creaked, but it held.', 'The Cart made it. So did most of your nerves.', 'A bridge! Technically.', 'Delivered. Nobody look down.'],
  fell: ['Gravity wins this round.', 'That was a short delivery.', 'The parcels are someone else\'s problem now.', 'Back to the drawing board. It is a nice board.'],
  stuck: ['The Cart has stopped and is thinking about it.', 'So close to moving. Not close to arriving.', 'Wheels need road. Check for holes and steep bits.'],
}
const pickQuip = (list, n) => list[n % list.length]
function showResult() {
  G.resultShown = true
  const W = G.world, L = G.level, r = summary(W), cost = designCost(G.design), gl = goals(L, r, cost)
  const d = {
    mode: G.mode, label: G.label, crossed: gl.crossed, reason: r.reason, kept: r.kept, parcels: r.parcels, allParcels: gl.parcels, par: G.mode === 'campaign' ? L.par : null,
    underPar: gl.par, cost, maxStress: r.maxStress, stars: gl.stars, best: null, extra: '', canNext: false, last: false, dailyDone: false,
  }
  const n = W.steps + cost
  if (gl.crossed) {
    d.title = gl.stars === 3 || (G.mode !== 'campaign' && gl.parcels) ? 'Perfect delivery!' : 'Delivered!'
    d.quip = pickQuip(gl.stars === 3 ? QUIPS.perfect : QUIPS.win, n)
  } else {
    d.title = r.reason === 'fell' ? (L.pit.kind === 'lava' ? 'Sizzle!' : L.pit.kind === 'mist' ? 'Gone!' : 'Splash!') : r.reason === 'stuck' ? 'Stuck!' : 'Too slow!'
    d.quip = pickQuip(r.reason === 'fell' ? QUIPS.fell : QUIPS.stuck, n)
  }
  if (G.mode === 'campaign') {
    if (gl.crossed) save.recordLevel(L.id, gl.stars, cost)
    d.best = save.best(L.id) || null
    d.canNext = save.stars(L.id) > 0; d.last = G.index === LEVELS.length - 1
    if (gl.crossed) for (let i = 0; i < gl.stars; i++) audio.star(i)
  } else if (G.mode === 'daily') {
    const today = dateKey()
    if (gl.crossed) save.recordDaily(G.date, today, cost, r.kept, r.parcels)
    const e = save.data.daily.days[G.date]
    d.dailyDone = !!e
    if (e) { d.best = e.cost; d.extra = G.date === today ? `Daily streak: <b>${save.streak(today)}</b>. Cheaper is better, so keep trimming.` : 'A past day: it does not count for the streak.' }
  }
  ui.result(d)
}
function copyResult() {
  const text = shareText(G.date, save.data.daily.days[G.date])
  const fallback = () => {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
    stage.appendChild(t); t.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    t.remove(); ui.copied(ok, text)
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => ui.copied(true, text), fallback); else fallback()
}

function onAction(act, arg) {
  if (act !== 'go' && act !== 'stop' && act !== 'mat' && act !== 'undo' && act !== 'redo' && act !== 'delete') audio.click()
  switch (act) {
    case 'campaign': openCampaign(save.nextIndex()); break
    case 'daily': ui.toast('Surveying today\'s canyon...', 0); setTimeout(() => { ui.toast(''); openDaily() }, 30); break
    case 'select': selectScreen(); break
    case 'sandbox': G.screen === 'play' ? (stopIfRunning(), sandboxScreen()) : sandboxScreen(); break
    case 'sand': openSandbox(arg); break
    case 'play': openCampaign(+arg); break
    case 'back': titleScreen(); break
    case 'quit': stopIfRunning(); titleScreen(); break
    case 'menu': openMenu(); break
    case 'resume': ui.hide(); break
    case 'clear': ui.confirm({ title: 'Clear the bridge?', text: 'Every beam goes. Undo can bring them back.', yes: 'Clear it', act: 'clear!' }); break
    case 'clear!': ui.hide(); if (G.phase === 'sim') stop(); if (G.design.beams.length) { G.hist.push(G.design); G.design.beams = []; G.sel = -1; G.pending = null; audio.remove(); changed() } break
    case 'mat': setMat(arg); break
    case 'undo': undo(false); break
    case 'redo': undo(true); break
    case 'delete': deleteSel(); break
    case 'zoomin': if (G.phase === 'build') zoomAt(1.5, R.size[0] / 2, R.size[1] / 2); break
    case 'zoomout': if (G.phase === 'build') zoomAt(1 / 1.5, R.size[0] / 2, R.size[1] / 2); break
    case 'go': go(); break
    case 'stop': case 'edit': stop(); break
    case 'rerun': stop(); go(); break
    case 'speed': G.speed = G.speed === 1 ? 2 : 1; save.data.speed = G.speed; save.save(); ui.sim({ show: true, speed: G.speed, stress: G.world ? G.world.maxStress : 0 }); break
    case 'next': stopIfRunning(); if (G.index + 1 < LEVELS.length) openCampaign(G.index + 1); else selectScreen(); break
    case 'copy': copyResult(); break
  }
}
function stopIfRunning() { if (G.phase === 'sim' && G.screen === 'play') { G.phase = 'build'; G.world = null; fx.clear(); ui.sim({ show: false }) } }
function selectScreen() {
  stopIfRunning()
  if (G.screen === 'play') { ui.hud({ show: false }); ui.tools({ show: false }); G.screen = 'title'; attract(); layout() }
  ui.select({ chapters: CHAPTERS, stars: save.totalStars(), maxStars: MAX_STARS, levels: LEVELS.map((l, i) => ({ i, name: l.name, stars: save.stars(l.id), best: save.best(l.id) || null, open: save.unlocked(i) })) })
}
function sandboxScreen() {
  if (G.screen === 'play') { ui.hud({ show: false }); ui.tools({ show: false }); G.screen = 'title'; attract(); layout() }
  ui.sandbox({ maps: SANDBOX })
}
function openMenu() {
  if (G.screen !== 'play' || ui.screen === 'menu') return
  const L = G.level
  const rule = G.mode === 'campaign' ? `Stars: get across · deliver every parcel · spend ${money(L.par)} or less.` : G.mode === 'daily' ? `Cheapest crossing wins the day. Budget ${money(L.budget)}.` : 'No budget and no stars. Go wild.'
  ui.menu({ mode: G.mode, label: G.label, name: L.name, hint: L.hint, rule })
}

// ---------- physics events -> sound and particles
function handleEvents(W) {
  const ev = W.events, kind = W.pitKind, play = G.screen === 'play'
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k]
    switch (e.type) {
      case 'snap':
        fx.splinters(e.x, e.y, e.mat, e.mat === 'rope' ? 4 : 10)
        if (play) { audio.snap(e.mat); fx.shake(0.35); if (W.broken <= 2) fx.text(e.x, e.y, 'SNAP!', C.yellow, 20) }
        break
      case 'splash':
        fx.splash(e.x, e.y, kind, e.kind === 1 ? 1.5 : e.kind === 2 ? 0.8 : 0.6)
        if (play) audio.splash(kind, e.kind === 1)
        break
      case 'goal': fx.confetti(e.x, e.y + 1, 26); if (play) { audio.goal(); fx.text(e.x, e.y + 1.6, 'Made it!', C.mint, 22) } break
      case 'lost': if (play) fx.text(e.x, W.pitY + 0.5, kind === 'lava' ? 'tsss' : kind === 'mist' ? 'aaaah' : 'glub', C.paper, 20); break
      case 'stuck': if (play) fx.text(e.x, e.y + 1.6, 'stuck!', C.pink, 20); break
      case 'over': if (play) { if (e.success) { audio.fanfare(); fx.confetti(W.vehicles[0].x, W.vehicles[0].y + 1, 50) } else audio.fail() } break
    }
  }
  ev.length = 0
}
function vehicleFeel(W, dt) {
  const play = G.screen === 'play'
  let rolling = 0
  for (const v of W.vehicles) {
    // worry: the most stressed beam near this vehicle
    let s = 0
    for (const b of W.beams) { if (b.broken || b.stub) continue; const dx = (b.a.x + b.b.x) / 2 - v.x; if (dx > -3.5 && dx < 3.5 && b.stress > s) s = b.stress }
    const falling = v.state === 'drive' && v.BL.vy < -5 && !v.wheels[0].ground && !v.wheels[1].ground
    if (falling && !G.said[v.index]) { G.said[v.index] = 1; fx.text(v.x, v.y + 1.8, 'oh no!', C.paper, 22); if (play) audio.ohno() }
    G.moods[v.index] = v.state === 'done' ? 'cheer' : v.state === 'lost' || falling || G.said[v.index] ? 'ohno' : s > 0.55 ? 'worried' : 'calm'
    for (const c of v.wheels) {
      if (c.ground) { if (c.airT > 0.25 && play) { audio.thud(Math.abs(c.p.vy) + 3); fx.dust(c.p.x, c.p.y - c.r, 5) } c.airT = 0 } else c.airT = (c.airT || 0) + dt
    }
    if (v.state === 'drive' && (v.wheels[0].ground || v.wheels[1].ground)) rolling = Math.max(rolling, Math.abs(v.BL.vx))
  }
  if (rolling > 0.4) {
    if (play) audio.rumble(rolling)
    G.dustT -= dt
    if (G.dustT <= 0) { G.dustT = 0.22; const v = W.vehicles.find((q) => q.state === 'drive'); if (v) { const c = v.wheels[0]; if (c.ground) fx.dust(c.p.x, c.p.y - c.r, 1) } }
  }
  if (play) { let live = 0; for (const b of W.beams) if (!b.broken && !b.stub && b.stress > live) live = b.stress; if (live > 0.55) audio.creak(live) }
}

// ---------- main loop
let last = 0
function frame(ts) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000))
  last = ts
  if (document.hidden) return
  update(dt); draw(dt)
}
function update(dt) {
  G.time += dt
  const W = G.world
  if (G.phase !== 'sim' || !W) return
  const play = G.screen === 'play'
  if (play && (ui.screen === 'menu' || ui.screen === 'confirm')) return
  if (W.over && W.t > W.overT + (play ? 9 : 2.5)) { if (!play) attract(); return } // let the wreckage settle, then rest
  G.acc += dt * (play ? G.speed : 1)
  let n = Math.min(Math.floor(G.acc / H), play ? 6 * G.speed : 6)
  G.acc -= n * H; if (G.acc > H * 4) G.acc = 0
  const limit = timeLimit(G.level)
  while (n-- > 0) {
    step(W)
    if (!W.over && W.t > limit) { W.over = true; W.overT = W.t; W.success = false; W.reason = 'timeout'; countParcels(W); W.events.push({ type: 'over', success: false }) }
    if (W.events.length) handleEvents(W)
  }
  vehicleFeel(W, dt)
  if (!play) return
  if (++G.uiTick % 6 === 0) ui.sim({ show: true, speed: G.speed, stress: W.maxStress })
  if (W.over && !G.resultShown && W.t > W.overT + (W.success ? 1.4 : 2.4) && !ui.screen) showResult()
}
function draw(dt) {
  if (!G.level) return
  if (G.screen === 'play' && G.phase === 'sim') { // ease out to the whole level while the Cart drives
    const k = 1 - Math.pow(0.02, dt)
    G.camZ += (1 - G.camZ) * k; G.camX += (0 - G.camX) * k; G.camY += (0 - G.camY) * k
    R.setCamera(G.level, G.camZ, G.camX, G.camY)
  } else {
    ;[G.panX, G.panY] = R.setCamera(G.level, G.zoom, G.panX, G.panY)
    G.camZ = G.zoom; G.camX = G.panX; G.camY = G.panY
  }
  const tutor = G.screen === 'play' && G.mode === 'campaign' && G.index === 0 && G.phase === 'build' && !G.design.beams.length && !G.drag ? { a: [0, 0], b: [2, 0] } : null
  R.draw({ level: G.level, phase: G.phase, design: G.design, world: G.world, preview: G.preview, mat: G.mat, sel: G.sel, drag: G.drag, pending: G.pending, cursor: G.cursor, hover: G.hover, moods: G.moods, loupe: G.loupe, tutor }, dt)
}

// ---------- keyboard
function moveCursor(dx, dy) {
  const L = G.level
  if (!G.cursor) { const d = G.pending; G.cursor = d ? [d.ax, d.ay] : L.anchors[0].slice() } else {
    const b = L.build
    G.cursor = [Math.max(b[0], Math.min(b[2], G.cursor[0] + dx)), Math.max(b[1], Math.min(b[3], G.cursor[1] + dy))]
  }
  if (G.pending) { const d = G.pending; if (G.cursor[0] === d.ax && G.cursor[1] === d.ay) d.tx = null; else { d.tx = G.cursor[0]; d.ty = G.cursor[1]; const r = canAdd(L, G.design, d.ax, d.ay, d.tx, d.ty, G.mat); d.ok = r.ok; d.why = WHY[r.reason] || '' } }
}
function enterCursor() {
  if (!G.cursor) { moveCursor(0, 0); return }
  const [x, y] = G.cursor
  if (!G.pending) {
    if (hasJoint(G.level, G.design, x, y)) { G.pending = { ax: x, ay: y, tx: null, ty: null, ok: false, why: '' }; audio.pick() } else { audio.nope(); ui.toast('Start a beam on a joint or an anchor.', 2000) }
    return
  }
  const d = G.pending
  if (d.ax === x && d.ay === y) { G.pending = null; return }
  if (placeBeam(d.ax, d.ay, x, y)) G.pending = { ax: x, ay: y, tx: null, ty: null, ok: false, why: '' }
}
function cycleSel() {
  if (!G.cursor) return
  const [x, y] = G.cursor, at = []
  G.design.beams.forEach((b, i) => { if ((b[0] === x && b[1] === y) || (b[2] === x && b[3] === y)) at.push(i) })
  if (!at.length) { G.sel = -1; return }
  G.sel = at[(at.indexOf(G.sel) + 1) % at.length]; audio.pick(); paint()
}
document.addEventListener('keydown', (e) => {
  if (e.altKey) return
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (ui.screen) {
    const btns = [...stage.querySelectorAll('.overlay button:not([disabled])')], at = btns.indexOf(document.activeElement)
    if (k === 'Escape') {
      if (ui.screen === 'menu' || ui.screen === 'confirm') onAction('resume')
      else if (ui.screen === 'select' || ui.screen === 'sandbox') onAction('back')
      else if (ui.screen === 'result') onAction('edit')
      e.preventDefault()
    } else if ((k === 'ArrowRight' || k === 'ArrowDown') && btns.length) { btns[(at + 1) % btns.length].focus(); e.preventDefault() }
    else if ((k === 'ArrowLeft' || k === 'ArrowUp') && btns.length) { btns[(at - 1 + btns.length) % btns.length].focus(); e.preventDefault() }
    else if (k === ' ' && ui.screen === 'result' && at < 0) { onAction('edit'); e.preventDefault() }
    else if ((k === ' ' || k === 'Enter') && at < 0 && btns.length && document.activeElement === document.body) { (stage.querySelector('.overlay .btn.primary') || btns[0]).click(); e.preventDefault() }
    return
  }
  if (G.screen !== 'play') return
  const t = e.target
  if (t && t !== document.body && t.closest && t.closest('a, button, input, textarea, select') && !stage.contains(t)) return
  let used = true
  if (mod) { if (k === 'z') undo(e.shiftKey); else if (k === 'y') undo(true); else used = false }
  else if (k === ' ') { if (stage.contains(document.activeElement)) document.activeElement.blur(); G.phase === 'sim' ? stop() : go() }
  else if (k === 'Escape') { if (G.pending || G.drag) { G.pending = null; G.drag = null } else if (G.sel >= 0) { G.sel = -1; paint() } else openMenu() }
  else if (G.phase === 'sim') { if (k === 's' || k === '2' || k === '1') onAction('speed'); else used = false }
  else if (k >= '1' && k <= '4') setMat(MAT_KEYS[+k - 1])
  else if (k === 'z') undo(false)
  else if (k === 'y') undo(true)
  else if (k === 'Delete' || k === 'Backspace') deleteSel()
  else if (k === 'ArrowLeft') moveCursor(-1, 0)
  else if (k === 'ArrowRight') moveCursor(1, 0)
  else if (k === 'ArrowUp') moveCursor(0, 1)
  else if (k === 'ArrowDown') moveCursor(0, -1)
  else if (k === 'Enter') { if (stage.contains(document.activeElement) && document.activeElement !== canvas) used = false; else enterCursor() }
  else if (k === 'x') cycleSel()
  else if (k === '+' || k === '=') onAction('zoomin')
  else if (k === '-') onAction('zoomout')
  else used = false
  if (used) e.preventDefault()
})
document.addEventListener('visibilitychange', () => { last = performance.now(); G.acc = 0; G.drag = null; G.loupe = null })

// ---------- boot
wireChrome({ stage })
new ResizeObserver(layout).observe(stage)
layout()
function boot() {
  const cur = save.data.cur
  if (cur && cur.mode === 'campaign') { const i = LEVELS.findIndex((l) => l.id === cur.id); if (i >= 0 && save.unlocked(i)) return openCampaign(i) }
  if (cur && cur.mode === 'sandbox' && SANDBOX.some((l) => l.id === cur.id)) return openSandbox(cur.id)
  if (cur && cur.mode === 'daily' && cur.id === dateKey()) return openDaily()
  titleScreen()
}
boot()
requestAnimationFrame((ts) => { last = ts; frame(ts) })

// Debug hook for automated play-testing: only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = {
    G, LEVELS, SANDBOX, save, ui, R,
    state: () => ({ screen: G.screen, mode: G.mode, level: G.level && G.level.id, phase: G.phase, ui: ui.screen, beams: G.design.beams.length, cost: designCost(G.design), t: G.world ? +G.world.t.toFixed(2) : 0, over: G.world ? G.world.over : false, success: G.world ? G.world.success : false, stress: G.world ? +G.world.maxStress.toFixed(2) : 0 }),
    goto: (i) => openCampaign(i), daily: (date) => openDaily(date), sandbox: (id) => openSandbox(id), title: () => titleScreen(),
    unlockAll: () => { for (const l of LEVELS) if (!save.stars(l.id)) save.data.levels[l.id] = { stars: 1, cost: 0 }; save.save() },
    add: (ax, ay, bx, by, mat) => { if (mat) G.mat = mat; return placeBeam(ax, ay, bx, by) },
    setDesign: (beams) => { G.hist.push(G.design); G.design = cleanDesign(G.level, { beams }); changed(); return G.design.beams.length },
    /** Load a working bridge: the stored reference design if tests/refs.js is reachable (dev server), else the auto-builder's. */
    solve: async () => {
      let beams = null
      try { const m = await import('../tests/refs.js'); beams = m.REFS[G.level.id] } catch { /* not published */ }
      if (!beams) { const a = autoBuild(G.level, { margin: 1 }); beams = a ? a.design.beams : [] }
      return window.__game.setDesign(beams)
    },
    go, stop, action: onAction,
    /** Run the game loop for some seconds without waiting for frames (background tabs throttle them). */
    advance: (seconds) => { for (let n = Math.round(seconds * 60); n > 0; n--) update(1 / 60); draw(1 / 60); return window.__game.state() },
    draw: () => draw(1 / 60),
  }
}
