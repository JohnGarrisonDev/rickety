// Rickety DOM overlays inside .stage: HUD, build toolbar, run bar, toast and the menu / result panels.
// Buttons carry data-act (and data-arg); main.js handles them in onAction.
import { MATERIALS } from './physics.js'
import { money } from './daily.js'
import { MAT_STYLE } from './render.js'

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`
const IC = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  undo: svg('<path d="M9 5 4 10l5 5"/><path d="M4 10h10a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 5 5 5-5 5"/><path d="M20 10H10a5 5 0 0 0 0 10h3"/>'),
  del: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'),
  clear: svg('<path d="M5 5l14 14M19 5 5 19"/>'),
  plus: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>'),
  minus: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.500 3.64A1 1 0 0 0 7 4.500z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 'class="lock"'),
  check: svg('<path d="m5 12.500 4.500 4.500L19 7.500"/>'),
  cross: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
}
const star = (on) => `<svg class="star${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.9-4.700 4.600 1.100 6.500L12 17.500l-5.800 3.100 1.100-6.500L2.600 9.500l6.500-.9z"/></svg>`
const stars = (n) => `<span class="stars" role="img" aria-label="${n} of 3 stars">${star(n > 0)}${star(n > 1)}${star(n > 2)}</span>`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function createUI(stage, onAction) {
  const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; stage.appendChild(d); return d }
  const hud = el('hud', `<button class="hud-btn" type="button" data-act="menu" aria-label="Menu" title="Menu (Esc)">${IC.menu}</button>
    <div class="hud-title"><span class="hud-label"></span><span class="hud-name"></span></div>
    <div class="budget" role="status"><span class="budget-nums"><b></b><small></small></span><span class="budget-bar"><i></i><u></u></span></div>`)
  const tools = el('tools')
  const simbar = el('simbar', `<button class="go stop" type="button" data-act="stop">${IC.stop}<span>Stop</span></button>
    <button class="tool speed" type="button" data-act="speed" title="Speed"><b>1x</b></button>
    <div class="stress" role="status"><small>Max stress</small><b>0%</b><span class="stress-bar"><i></i></span></div>`)
  const toast = el('toast'); toast.setAttribute('role', 'status')
  const overlay = el('overlay', '<div class="panel"></div>')
  const panel = overlay.firstChild
  hud.hidden = tools.hidden = simbar.hidden = overlay.hidden = true
  let toastTimer = 0, toolsKey = ''

  stage.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]')
    if (!b || b.disabled || !stage.contains(b)) return
    onAction(b.dataset.act, b.dataset.arg)
  })

  const ui = {
    screen: '',
    hud({ show, label = '', name = '' }) {
      hud.hidden = !show
      if (!show) return
      hud.querySelector('.hud-label').textContent = label; hud.querySelector('.hud-name').textContent = name
    },
    budget(cost, budget, par) {
      const b = hud.querySelector('.budget'), over = budget != null && cost > budget
      b.classList.toggle('over', over)
      b.querySelector('b').textContent = money(cost)
      b.querySelector('small').textContent = budget == null ? 'no limit' : over ? `over by ${money(cost - budget)}` : `of ${money(budget)}`
      const bar = b.querySelector('.budget-bar'); bar.hidden = budget == null
      if (budget != null) {
        bar.querySelector('i').style.width = Math.min(100, (cost / budget) * 100) + '%'
        const u = bar.querySelector('u'); u.hidden = par == null; if (par != null) u.style.left = Math.min(100, (par / budget) * 100) + '%'
      }
    },
    /** Build toolbar. Rebuilt only when the material list changes; otherwise just updated. */
    tools({ show, materials = [], mat, canUndo, canRedo, hasSel, canGo, empty }) {
      tools.hidden = !show
      if (!show) return
      const key = materials.join()
      if (key !== toolsKey) {
        toolsKey = key
        tools.innerHTML = `<div class="mats" role="group" aria-label="Materials">${materials.map((m) => {
          const M = MATERIALS[m], n = ['plank', 'timber', 'steel', 'rope'].indexOf(m) + 1
          return `<button class="mat" type="button" data-act="mat" data-arg="${m}" title="${M.name}: $${M.cost} a metre, up to ${Math.floor(M.maxLen)} m (key ${n})"><i class="sw" style="background:${MAT_STYLE[m].color}"></i><b>${M.name}</b><small>$${M.cost}/m</small></button>`
        }).join('')}</div>
        <div class="acts">
          <button class="tool" type="button" data-act="undo" aria-label="Undo" title="Undo (Z)">${IC.undo}</button>
          <button class="tool" type="button" data-act="redo" aria-label="Redo" title="Redo (Y)">${IC.redo}</button>
          <button class="tool" type="button" data-act="delete" aria-label="Delete selected beam" title="Delete the selected beam (Del)">${IC.del}</button>
          <button class="tool" type="button" data-act="zoomout" aria-label="Zoom out" title="Zoom out (-)">${IC.minus}</button>
          <button class="tool" type="button" data-act="zoomin" aria-label="Zoom in" title="Zoom in (+)">${IC.plus}</button>
          <button class="go" type="button" data-act="go" aria-label="Go" title="Send the Cart (Space)">${IC.play}<span>Go</span></button>
        </div>`
      }
      for (const b of tools.querySelectorAll('.mat')) { const on = b.dataset.arg === mat; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
      const q = (a) => tools.querySelector(`[data-act="${a}"]`)
      q('undo').disabled = !canUndo; q('redo').disabled = !canRedo; q('delete').disabled = !hasSel
      q('go').disabled = !canGo; q('go').classList.toggle('ready', canGo && !empty)
    },
    sim({ show, speed = 1, stress = 0 }) {
      simbar.hidden = !show
      if (!show) return
      simbar.querySelector('.speed b').textContent = speed + 'x'
      const pc = Math.round(Math.min(1, stress) * 100)
      const s = simbar.querySelector('.stress'); s.querySelector('b').textContent = pc + '%'
      s.querySelector('i').style.width = pc + '%'
      s.classList.toggle('hot', pc >= 75); s.classList.toggle('warm', pc >= 45 && pc < 75)
    },
    toast(text, ms = 3200) {
      clearTimeout(toastTimer)
      if (!text) { toast.classList.remove('on'); return }
      toast.textContent = text; toast.classList.add('on')
      if (ms) toastTimer = setTimeout(() => toast.classList.remove('on'), ms)
    },
    show(name, html, cls = '') {
      ui.screen = name
      overlay.className = 'overlay scr-' + name
      panel.className = 'panel ' + cls
      panel.innerHTML = html
      overlay.hidden = false
      panel.scrollTop = 0
      const f = panel.querySelector('.btn.primary') || panel.querySelector('button')
      if (f && document.activeElement !== document.body && !stage.contains(document.activeElement)) return
      if (f) f.focus({ preventScroll: true })
    },
    hide() { ui.screen = ''; overlay.hidden = true; panel.innerHTML = ''; if (stage.contains(document.activeElement)) document.activeElement.blur() },

    title(d) {
      const dl = d.daily
      const days = d.history.map((h) => `<span class="day${h.done ? ' done' : ''}${h.today ? ' today' : ''}" title="${h.date}${h.done ? ': ' + money(h.cost) : ''}"><i>${h.label}</i></span>`).join('')
      ui.show('title', `
        <span class="eyebrow">Physics builder</span>
        <h2 class="logo-title">Rick<em>e</em>ty</h2>
        <p class="sub">Build a bridge on a budget. Press Go. Hope.</p>
        <div class="btns col">
          <button class="btn primary" type="button" data-act="campaign"><span>${d.started ? 'Continue' : 'Play'}</span><small>${esc(d.nextLabel)}</small></button>
          <button class="btn daily" type="button" data-act="daily"><span>Daily gap</span><small>${dl.done ? `crossed for ${money(dl.cost)} · ${dl.kept}/${dl.parcels}` : 'not crossed yet'}</small></button>
          <div class="btns">
            <button class="btn small" type="button" data-act="select">Levels <small>${d.stars}/${d.maxStars}★</small></button>
            <button class="btn small" type="button" data-act="sandbox">Sandbox</button>
          </div>
        </div>
        <div class="streak"><span class="days">${days}</span><span class="note">Daily streak <b>${d.streak}</b> · best <b>${d.bestStreak}</b></span></div>`)
    },
    select(d) {
      const chapters = d.chapters.map((name, c) => `<h3>${c + 1}. ${esc(name)}</h3><div class="grid">${d.levels.slice(c * 8, c * 8 + 8).map((l) => l.open
        ? `<button class="cell" type="button" data-act="play" data-arg="${l.i}"><span class="num">${l.i + 1}</span><span class="nm">${esc(l.name)}</span>${stars(l.stars)}<span class="bs">${l.best != null ? money(l.best) : '&nbsp;'}</span></button>`
        : `<button class="cell locked" type="button" disabled aria-label="Level ${l.i + 1}, locked"><span class="num">${l.i + 1}</span><span class="nm">${esc(l.name)}</span>${IC.lock}<span class="bs">&nbsp;</span></button>`).join('')}</div>`).join('')
      ui.show('select', `<span class="eyebrow">${d.stars} of ${d.maxStars} stars</span><h2>Levels</h2>${chapters}
        <div class="btns"><button class="btn small" type="button" data-act="back">Back</button></div>`, 'wide')
    },
    sandbox(d) {
      ui.show('sandbox', `<span class="eyebrow">No budget, no stars</span><h2>Sandbox</h2><p class="sub">Three big maps for building silly things.</p>
        <div class="btns col">${d.maps.map((m) => `<button class="btn" type="button" data-act="sand" data-arg="${m.id}"><span>${esc(m.name)}</span><small>${esc(m.hint)}</small></button>`).join('')}</div>
        <div class="btns"><button class="btn small" type="button" data-act="back">Back</button></div>`)
    },
    menu(d) {
      ui.show('menu', `<span class="eyebrow">${esc(d.label)}</span><h2>${esc(d.name)}</h2><p class="sub">${esc(d.hint)}</p>
        <p class="note">${d.rule}</p>
        <div class="btns col">
          <button class="btn primary" type="button" data-act="resume">Back to building</button>
          <div class="btns"><button class="btn small" type="button" data-act="clear">Clear bridge</button><button class="btn small" type="button" data-act="${d.mode === 'campaign' ? 'select' : d.mode === 'sandbox' ? 'sandbox' : 'quit'}">${d.mode === 'campaign' ? 'Levels' : d.mode === 'sandbox' ? 'Maps' : 'Title'}</button></div>
          ${d.mode === 'daily' ? '' : '<button class="btn small" type="button" data-act="quit">Title screen</button>'}
        </div>
        <p class="how"><kbd>1</kbd>-<kbd>4</kbd> material · <kbd>Z</kbd> <kbd>Y</kbd> undo, redo · <kbd>Space</kbd> go · arrows + <kbd>Enter</kbd> build</p>`)
    },
    confirm(d) {
      ui.show('confirm', `<h2>${esc(d.title)}</h2><p class="sub">${esc(d.text)}</p>
        <div class="btns"><button class="btn small" type="button" data-act="resume">Keep it</button><button class="btn primary small" type="button" data-act="${d.act}">${esc(d.yes)}</button></div>`)
    },
    result(d) {
      const row = (ok, text, extra = '') => `<li class="${ok ? 'ok' : 'no'}"><span class="tick">${ok ? IC.check : IC.cross}</span><span>${text}</span>${extra ? `<small>${extra}</small>` : ''}</li>`
      const rows = [row(d.crossed, d.crossed ? 'Got across' : d.reason === 'fell' ? 'Fell in' : d.reason === 'stuck' ? 'Got stuck' : 'Ran out of time')]
      if (d.crossed || d.parcels) rows.push(row(d.allParcels, 'All parcels delivered', `${d.kept}/${d.parcels}`))
      if (d.par != null) rows.push(row(d.underPar, `At or under par ${money(d.par)}`, d.crossed ? money(d.cost) : ''))
      const btns = []
      if (d.mode === 'daily' && d.dailyDone) btns.push(`<button class="btn small" type="button" data-act="copy">Copy result</button>`)
      btns.push(`<button class="btn small${d.crossed ? '' : ' primary'}" type="button" data-act="edit">Edit bridge</button>`)
      btns.push(`<button class="btn small" type="button" data-act="rerun">Watch again</button>`)
      if (d.mode === 'campaign' && d.canNext) btns.push(`<button class="btn small${d.crossed ? ' primary' : ''}" type="button" data-act="next">${d.last ? 'Finish' : 'Next level'}</button>`)
      if (d.mode === 'daily' && d.crossed) btns.push(`<button class="btn small primary" type="button" data-act="quit">Done</button>`)
      ui.show('result', `<span class="eyebrow">${esc(d.label)}</span>
        <h2 class="${d.crossed ? 'win' : 'lose'}">${esc(d.title)}</h2>
        ${d.mode === 'campaign' ? stars(d.stars) : ''}
        <p class="sub">${esc(d.quip)}</p>
        <ul class="goals">${rows.join('')}</ul>
        <p class="stats"><span>Cost <b>${money(d.cost)}</b></span><i>·</i><span>Max stress <b>${Math.round(d.maxStress * 100)}%</b></span>${d.best != null ? `<i>·</i><span>Best <b>${money(d.best)}</b></span>` : ''}</p>
        ${d.extra ? `<p class="note">${d.extra}</p>` : ''}
        <div class="btns">${btns.join('')}</div>
        ${d.talk ? '<div data-talk></div>' : ''}`)
      return d.talk ? panel.querySelector('[data-talk]') : null
    },
    /** After Copy: say so, or (when the browser refuses the clipboard) show the text so it can be copied by hand. */
    copied(ok, text) {
      const b = panel.querySelector('[data-act="copy"]')
      if (!b) return
      b.textContent = ok ? 'Copied!' : 'Copy it below'
      setTimeout(() => { if (b.isConnected) b.textContent = 'Copy result' }, 1800)
      if (ok || panel.querySelector('.sharebox')) return
      const box = document.createElement('div'); box.className = 'sharebox'; box.textContent = text
      b.closest('.btns').before(box)
    },
  }
  return ui
}
