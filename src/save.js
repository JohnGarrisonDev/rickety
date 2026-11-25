// Rickety save data: schema, repair of junk data, stars, unlocks and the daily streak. No DOM.
import { MATERIALS } from './physics.js'
import { MAX_BEAMS } from './design.js'
import { isDateKey, shiftDate } from './daily.js'

export const SAVE_VERSION = 1
export const defaults = () => ({
  v: SAVE_VERSION,
  levels: {}, // id -> { stars: 0..3, cost: best crossing cost }
  designs: {}, // level id (or 'daily:DATE') -> [[ax, ay, bx, by, material], ...] the bridge in progress
  daily: { days: {}, streak: 0, best: 0, last: '' }, // days: DATE -> { cost, kept, parcels }
  speed: 1,
  cur: null, // { mode: 'campaign' | 'daily' | 'sandbox', id } the level that was open, so a reload resumes
})

const int = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d)
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o)

/** Return a clean save object whatever was in storage. Never throws. */
export function sanitise(raw) {
  const out = defaults()
  if (!isObj(raw)) return out
  if (isObj(raw.levels)) {
    for (const [id, e] of Object.entries(raw.levels)) {
      if (!/^[cs]\d{1,2}$/.test(id) || !isObj(e)) continue
      const stars = int(e.stars, 0, 3, 0)
      if (stars > 0) out.levels[id] = { stars, cost: int(e.cost, 0, 9999990, 0) }
    }
  }
  if (isObj(raw.designs)) {
    let n = 0
    for (const [id, list] of Object.entries(raw.designs)) {
      if (!/^([cs]\d{1,2}|daily:\d{4}-\d{2}-\d{2})$/.test(id) || !Array.isArray(list) || n >= 40) continue
      const beams = []
      for (const b of list) {
        if (beams.length >= MAX_BEAMS) break
        if (Array.isArray(b) && b.length === 5 && b.slice(0, 4).every((v) => Number.isInteger(v) && Math.abs(v) < 500) && Object.prototype.hasOwnProperty.call(MATERIALS, b[4])) beams.push([b[0], b[1], b[2], b[3], b[4]])
      }
      out.designs[id] = beams; n++
    }
  }
  if (isObj(raw.daily)) {
    const d = raw.daily
    if (isObj(d.days)) {
      const keys = Object.keys(d.days).filter(isDateKey).sort().slice(-90)
      for (const k of keys) {
        const e = d.days[k]
        if (!isObj(e) || !Number.isFinite(e.cost) || e.cost < 0) continue
        const parcels = int(e.parcels, 0, 20, 0)
        out.daily.days[k] = { cost: int(e.cost, 0, 9999990, 0), kept: int(e.kept, 0, parcels, 0), parcels }
      }
    }
    out.daily.last = isDateKey(d.last) && out.daily.days[d.last] ? d.last : ''
    out.daily.streak = out.daily.last ? int(d.streak, 1, 99999, 1) : 0
    out.daily.best = Math.max(out.daily.streak, int(d.best, 0, 99999, 0))
  }
  out.speed = raw.speed === 2 ? 2 : 1
  if (isObj(raw.cur) && ['campaign', 'daily', 'sandbox'].includes(raw.cur.mode) && typeof raw.cur.id === 'string' && raw.cur.id.length < 20) out.cur = { mode: raw.cur.mode, id: raw.cur.id }
  return out
}

/** The three goals of a run, and how many stars that makes. par may be null (sandbox, daily). */
export function goals(level, result, cost) {
  const crossed = !!result.success
  const parcels = crossed && result.kept === result.parcels
  const par = crossed && level.par != null && cost <= level.par
  return { crossed, parcels, par, stars: crossed ? 1 + (parcels ? 1 : 0) + (par ? 1 : 0) : 0 }
}

/** Wrap a kit store. `levels` is the campaign list (for unlocks). */
export function makeSave(store, levels) {
  const data = store.data
  Object.assign(data, sanitise({ ...data }))
  const api = {
    data,
    save: () => store.save(),
    stars: (id) => (data.levels[id] ? data.levels[id].stars : 0),
    best: (id) => (data.levels[id] ? data.levels[id].cost : null),
    totalStars: () => levels.reduce((n, l) => n + api.stars(l.id), 0),
    /** A campaign level opens once the one before it has a star. */
    unlocked: (i) => i === 0 || (i < levels.length && api.stars(levels[i - 1].id) > 0),
    /** Index of the first level without a star (or the last level). */
    nextIndex: () => { for (let i = 0; i < levels.length; i++) if (!api.stars(levels[i].id)) return i; return levels.length - 1 },
    /** Record a crossing. Returns { newStars, newBest }. */
    recordLevel(id, stars, cost) {
      const old = data.levels[id] || { stars: 0, cost: 0 }
      const newStars = stars > old.stars, newBest = !old.stars || cost < old.cost
      data.levels[id] = { stars: Math.max(old.stars, stars), cost: newBest ? cost : old.cost }
      store.save()
      return { newStars, newBest }
    },
    /** Record a daily crossing made on `date` while today is `today`. Past days never touch the streak. Returns { first, newBest }. */
    recordDaily(date, today, cost, kept, parcels) {
      const D = data.daily, old = D.days[date]
      const first = !old, newBest = !old || cost < old.cost || (cost === old.cost && kept > old.kept)
      if (newBest) D.days[date] = { cost, kept, parcels }
      if (first && date === today) {
        D.streak = D.last === shiftDate(today, -1) ? D.streak + 1 : 1
        D.last = today
        if (D.streak > D.best) D.best = D.streak
      }
      store.save()
      return { first, newBest }
    },
    /** The streak as of today: it only counts if the last daily crossing was today or yesterday. */
    streak(today) { const D = data.daily; return D.last === today || D.last === shiftDate(today, -1) ? D.streak : 0 },
    getDesign: (key) => (Array.isArray(data.designs[key]) ? data.designs[key] : []),
    setDesign(key, beams) {
      data.designs[key] = beams.map((b) => b.slice())
      for (const k of Object.keys(data.designs)) if (k.startsWith('daily:') && k !== key && key.startsWith('daily:')) delete data.designs[k]
      store.save()
    },
  }
  return api
}
