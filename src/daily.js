// Rickety daily gap: one canyon per calendar date, the same for everyone. No DOM.
// The canyon comes from a seeded rng (whole-number choices only), and is only accepted once the auto-builder has
// driven a stock bridge across it with room to spare, so every day is solvable. The budget is a multiple of that
// bridge's cost. CHANGING ANYTHING HERE, IN autobuild.js, physics.js OR makeLevel CAN CHANGE EVERYONE'S DAILY:
// tests/daily.test.js pins a few dates with snapshot hashes.
import { makeRng, hashString } from '../kit/kit.js'
import { makeLevel } from './levels.js'
import { autoBuild } from './autobuild.js'

export const DAILY_VERSION = 1
const pad = (n) => String(n).padStart(2, '0')
/** Local calendar date as YYYY-MM-DD. */
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const isDateKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00'))
/** The date n days after (or before) a date key. */
export function shiftDate(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + n, 12))
}
export const dailySeed = (date) => hashString('rickety:' + date)

const ADJ = ['Grumpy', 'Wobbly', 'Soggy', 'Crooked', 'Dizzy', 'Creaky', 'Lumpy', 'Windy', 'Sneezy', 'Rusty', 'Mossy', 'Wonky', 'Hungry', 'Sleepy', 'Jittery', 'Bashful']
const NOUN = ['Gulch', 'Gap', 'Gorge', 'Canyon', 'Crack', 'Chasm', 'Ditch', 'Ravine', 'Drop', 'Notch', 'Hollow', 'Crevice']

/** One random canyon description (may or may not be solvable). */
export function dailyCandidate(rng) {
  const w = 8 + 2 * rng.int(6) // 8..18 m
  let rh = rng.int(5) - 2
  if (Math.abs(rh) * 4 > w) rh = rh > 0 ? 1 : -1
  const layout = rng.int(5) // 0 plain, 1 rock, 2 cliff-face anchors, 3 towers, 4 rock with a pole
  const truck = w <= 12 && rng.int(4) === 0
  const steel = w >= 16 || rng.int(2) === 0
  const tall = 4 + rng.int(2)
  const rockX = 4 + 2 * rng.int(Math.max(1, (w - 8) / 2 + 1)) // an even x at least 4 m from each side
  const rockDrop = 2 + rng.int(2)
  const pit = ['water', 'water', 'mist', 'lava'][rng.int(4)]
  const depth = 7 + rng.int(3)
  const name = ADJ[rng.int(ADJ.length)] + ' ' + NOUN[rng.int(NOUN.length)]
  const deckY = (x) => Math.round((x * rh) / w)
  const o = { w, rh, depth, pit, name, rocks: [], anchors: [], materials: ['plank', 'timber'], vehicles: [{ type: truck ? 'truck' : 'cart' }] }
  if (steel) o.materials.push('steel')
  if (layout === 1 || layout === 4) o.rocks.push([rockX, deckY(rockX) - rockDrop])
  if (layout === 2) o.anchors.push([0, -2], [w, rh - 2])
  if (layout === 3) o.anchors.push([0, tall], [w, rh + tall])
  if (layout === 4) o.anchors.push([rockX, deckY(rockX) + tall])
  if (layout >= 3 || rng.int(3) === 0) o.materials.push('rope')
  return o
}

const FALLBACK = { w: 8, rh: 0, depth: 8, pit: 'water', name: 'Plain Old Gap', rocks: [[4, -2]], anchors: [], materials: ['plank', 'timber'], vehicles: [{ type: 'cart' }] }
const cache = new Map()

/** The level for a date. Returns { level, refCost, tries }. */
export function dailyLevel(date) {
  if (cache.has(date)) return cache.get(date)
  const rng = makeRng(dailySeed(date))
  let out = null
  for (let tries = 1; tries <= 8 && !out; tries++) {
    const o = dailyCandidate(rng)
    const level = makeLevel({ ...o, id: 'daily', hint: 'Cheapest bridge that gets the parcels across wins the day.' })
    const ref = autoBuild(level, { margin: 0.85 })
    if (ref) out = finish(level, ref, tries)
  }
  if (!out) {
    const level = makeLevel({ ...FALLBACK, id: 'daily', hint: 'Cheapest bridge that gets the parcels across wins the day.' })
    out = finish(level, autoBuild(level, { margin: 1 }) || { cost: 2000 }, 0)
  }
  out.level.date = date
  if (cache.size > 12) cache.clear()
  cache.set(date, out)
  return out
}
function finish(level, ref, tries) {
  level.budget = Math.ceil((ref.cost * 1.35) / 50) * 50
  level.par = null
  return { level, refCost: ref.cost, tries }
}

/** Fingerprint of a daily level, for the snapshot tests. */
export function levelHash(level) {
  return hashString(JSON.stringify([level.name, level.terrain, level.anchors, level.pit, level.vehicles, level.budget, level.materials, level.build]))
}

export const money = (n) => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
/** Spoiler-free result text for the Copy button. */
export function shareText(date, entry) {
  const first = entry ? `crossed for ${money(entry.cost)} · ${entry.kept}/${entry.parcels} parcels` : 'still building'
  return `Rickety ${date} · ${first}\ngames.oddvale.com/rickety`
}
