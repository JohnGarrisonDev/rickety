// Rickety levels. Plain data, built with one helper so every canyon shares the same conventions. No DOM.
//
// Level format (what the physics, the build rules and the renderer read):
//   id, name, hint          text
//   terrain                 one polyline [[x, y], ...] with non-decreasing x; the ground is everything below it
//   anchors                 [[x, y], ...] fixed joints (whole metres)
//   pit                     { kind: 'water' | 'lava' | 'mist', y } surface the gap is filled to
//   vehicles                [{ type: 'cart' | 'truck', x, dir: 1 | -1, goal, delay, speed? }]
//   budget, par             $ limit and the "under par" star (budget null = unlimited)
//   materials               allowed material ids, in palette order
//   build                   [x0, y0, x1, y1] box that new joints must sit in
//   view                    [x0, y0, x1, y1] what the camera fits
//   spans                   [{ L: [x, y], R: [x, y] }] road ends, used by the auto-builder only
//   rim                     [[x, y], ...] line across the top of the gap (the renderer paints the far wall under it)
import { VEHICLES } from './physics.js'

/** Make a level from a short description. The left cliff edge is always (0, 0); the right one is (w, rh). */
export function makeLevel(o) {
  const w = o.w, rh = o.rh || 0, depth = o.depth || 8
  const floor = Math.min(0, rh) - depth
  const lead = 16
  let terrain
  if (o.terrain) terrain = o.terrain
  else {
    const k = Math.min(1, w / 4) // narrow gaps get steeper faces so the two sides never cross
    const T = [[-lead, 0], [0, 0], [0.3 * k, floor * 0.35], [0.5 * k, floor * 0.7], [1.1 * k, floor]]
    for (const r of (o.rocks || []).slice().sort((a, b) => a[0] - b[0])) {
      const [mx, my] = r
      T.push([mx - 1.5, floor], [mx - 0.6, my - (my - floor) * 0.4], [mx - 0.45, my], [mx + 0.45, my], [mx + 0.65, my - (my - floor) * 0.5], [mx + 1.4, floor])
    }
    T.push([w - 1.1 * k, floor], [w - 0.5 * k, floor + (rh - floor) * 0.3], [w - 0.3 * k, floor + (rh - floor) * 0.65], [w, rh], [w + lead, rh])
    terrain = T
  }
  const anchors = o.anchorsOnly ? o.anchorsOnly.map((a) => a.slice()) : [[0, 0], [w, rh], ...(o.rocks || []).map((r) => [r[0], r[1]]), ...(o.anchors || [])]
  const pitY = o.pitY != null ? o.pitY : floor + 2.5
  let minX = 0, maxX = w
  const vehicles = []
  const count = { 1: 0, '-1': 0 }
  for (const v of o.vehicles || [{ type: 'cart' }]) {
    const dir = v.dir === -1 ? -1 : 1, B = VEHICLES[v.type] || VEHICLES.cart
    const k = count[dir]; count[dir] += B.L * 2 + 1.2
    const x = v.x != null ? v.x : dir === 1 ? -4.5 - k : w + 4.5 + k
    const goal = v.goal != null ? v.goal : dir === 1 ? w + 4.5 : -4.5
    vehicles.push({ type: B.id, x, dir, goal, delay: v.delay || 0, ...(v.speed ? { speed: v.speed } : {}) })
    minX = Math.min(minX, x - B.L - 1.2, goal - 2.5); maxX = Math.max(maxX, x + B.L + 1.2, goal + 2.5)
  }
  let top = Math.max(0, rh)
  for (const a of anchors) top = Math.max(top, a[1])
  for (const p of terrain) top = Math.max(top, p[1])
  const build = o.build || [-3, Math.ceil(pitY + 0.5), w + 3, top + 6]
  const view = o.view || [Math.min(minX, -5.5), pitY - 2.2, Math.max(maxX, w + 5.5), top + 6.5]
  return {
    id: o.id, name: o.name, hint: o.hint || '', terrain, anchors, pit: { kind: o.pit || 'water', y: pitY }, vehicles,
    budget: o.budget === undefined ? null : o.budget, par: o.par === undefined ? null : o.par,
    materials: o.materials || ['plank', 'timber'], build, view,
    spans: o.spans || [{ L: [0, 0], R: [w, rh] }], rim: o.rim || [[0, 0], [w, rh]], chapter: o.chapter || 0,
  }
}

export const CHAPTERS = ['First planks', 'Ropes and steel', 'Odd jobs']

const PT = ['plank', 'timber'], PTR = ['plank', 'timber', 'rope'], PTS = ['plank', 'timber', 'steel'], ALL = ['plank', 'timber', 'steel', 'rope']

// [budget, par] per level, from tools/make-refs.mjs (par: the stored three-star reference design, rounded up; budget: 40% above it, 15% on the squeeze levels).
// [budget, par]. Budgets come from tools/make-refs.mjs. 1.3 tightened nine pars (c9, c10, c12, c14, c16, c19, c22,
// c23, c24) to trimmed reference bridges from tools/tighten.mjs (tests/refs.js proves each one earns three stars),
// cutting no par by more than 25% in one release. c20 keeps its par so it stays a squeeze level (budget < 1.2 x par).
// Stars already earned are kept by the save.
const MONEY = [
  [400, 200], [2700, 2000], [4300, 3100], [2700, 1900], [7000, 5000], [5800, 4200], [7300, 5200], [8900, 6400],
  [6400, 3500], [7800, 4600], [2300, 2000], [20400, 12300], [5800, 4200], [14000, 7500], [8900, 6400], [11700, 7900],
  [2200, 1600], [11100, 7900], [16800, 9600], [5500, 4800], [6900, 4900], [17200, 9300], [21000, 11300], [37100, 19900],
]

const RAW = [
  // ---- chapter 1: planks and timber
  { name: 'Mind the Gap', hint: 'Drag from one orange anchor to the other to lay a plank. Then press Go.', w: 2, depth: 6, materials: ['plank'] },
  { name: 'Two Planks', hint: 'A joint in mid-air sags. Hold it up with a timber triangle.', w: 4, depth: 6 },
  { name: 'Triangle Club', hint: 'Triangles do not squash. Run a row of them along the road.', w: 6 },
  { name: 'Rock Bottom', hint: 'That rock has an anchor on top. Stand the middle of the road on it.', w: 8, rocks: [[4, -2]] },
  { name: 'Uphill Battle', hint: 'The far side is higher. Step the road up a metre at a time.', w: 8, rh: 2 },
  { name: 'Underpinnings', hint: 'Anchors in the cliff faces. Prop the road up from below.', w: 8, anchors: [[0, -2], [8, -2]] },
  { name: 'Downhill Dash', hint: 'Downhill is quicker and bumpier. Mind the parcels.', w: 10, rh: -1, rocks: [[6, -3]], pit: 'mist' },
  { name: 'The Long Way', hint: 'Twelve metres, no rock, no rope. A tall truss will do it.', w: 12, depth: 9 },
  // ---- chapter 2: rope and steel
  { name: 'Hang On', hint: 'Rope only pulls. Hang the road from the two high anchors.', w: 10, anchors: [[-1, 4], [11, 4]], materials: PTR },
  { name: 'Maypole', hint: 'One tall pole in the middle. Fan the ropes out from its top.', w: 14, rocks: [[7, -3]], anchors: [[7, 5]], materials: PTR },
  { name: 'Penny Pincher', hint: 'Not much money. Every beam has to earn its keep.', w: 8, anchors: [[4, 4]], materials: PTR, pit: 'mist' },
  { name: 'Steel Yourself', hint: 'Steel is strong, long and dear. Spend it where the load is.', w: 16, depth: 9, materials: PTS },
  { name: 'Heavy Parcel Day', hint: 'The Truck weighs twice as much as the Cart. Prop it well.', w: 8, anchors: [[0, -3], [8, -3]], vehicles: [{ type: 'truck' }], materials: PTS },
  { name: 'Wonky Canyon', hint: 'Nothing lines up here. Use whichever rock is nearest.', w: 16, rh: 1, rocks: [[5, -3], [11, -1]], materials: PTR },
  { name: 'Convoy', hint: 'Two Carts, one after the other. The bridge has to last twice.', w: 12, anchors: [[0, -2], [12, -2]], vehicles: [{ type: 'cart' }, { type: 'cart', delay: 2.5 }], materials: PTR },
  { name: 'Big Rig Bridge', hint: 'A Truck, fourteen metres and one rock. Steel will help.', w: 14, rocks: [[7, -3]], vehicles: [{ type: 'truck' }], materials: ALL, pit: 'lava' },
  // ---- chapter 3: odd jobs
  { name: 'Leap of Faith', hint: 'No anchors over there. Build a ramp and let the fast Cart fly.', custom: 'jump' },
  { name: 'Both Ways', hint: 'One Cart from each side. They meet in the middle, so brace it.', w: 12, anchors: [[0, -3], [12, -3]], vehicles: [{ type: 'cart' }, { type: 'cart', dir: -1 }], materials: ALL },
  { name: 'Lava Lunch', hint: 'Two rocks at different heights and a lot of hot soup.', w: 18, rocks: [[6, -2], [12, -4]], materials: ALL, pit: 'lava' },
  { name: 'Shoestring', hint: 'A long gap on small change. Rope is the cheap way to be strong.', w: 12, anchors: [[0, 5], [12, 5]], materials: PTR, pit: 'mist' },
  { name: 'Stairway', hint: 'Five metres up in ten across. Steep, but the Cart can climb it.', w: 10, rh: 5, anchors: [[0, -3], [10, 1]], materials: ALL },
  { name: 'Truck Stop', hint: 'The Truck first, the Cart close behind, and one rock to lean on.', w: 16, rocks: [[8, -2]], anchors: [[0, -3], [16, -3]], vehicles: [{ type: 'truck' }, { type: 'cart', delay: 3 }], materials: ALL },
  { name: 'The Big One', hint: 'Twenty-two metres. Every anchor you can see is there for a reason.', w: 22, depth: 10, rocks: [[11, -4]], anchors: [[-1, 6], [23, 6], [0, -3], [22, -3], [11, 6]], materials: ALL },
  { name: 'Double Decker', hint: 'Cart on the top road, Truck on the bottom one. Build both.', custom: 'double' },
]

function custom(kind, base) {
  if (kind === 'jump') {
    // A fast Cart, an 8 m gap, a lower far side and nothing to fix a bridge to over there.
    const floor = -11
    return makeLevel({
      ...base, w: 8, rh: -2,
      terrain: [[-22, 0], [0, 0], [0.3, -4], [0.5, -8], [1.1, floor], [6.9, floor], [7.5, -8], [7.7, -5], [8, -2], [28, -2]],
      anchorsOnly: [[0, 0], [0, -2], [-2, 0]], pitY: -8.5, materials: PT, pit: 'mist',
      vehicles: [{ type: 'cart', x: -12, goal: 15, speed: 7.5 }],
      build: [-3, -6, 5, 6], spans: [],
    })
  }
  // double: upper road at y = 4 with a 20 m hole in it, lower ledges at y = 0 with a 12 m gap.
  const floor = -9
  return makeLevel({
    ...base, w: 12,
    terrain: [[-20, 4], [-4, 4], [-4, 0], [0, 0], [0.3, -3], [0.5, -6], [1.1, floor], [10.9, floor], [11.5, -6], [11.7, -3], [12, 0], [16, 0], [16, 4], [32, 4]],
    anchorsOnly: [[-4, 4], [16, 4], [0, 0], [12, 0], [-4, 8], [16, 8], [6, -4]], pitY: -6.5, materials: ALL,
    vehicles: [{ type: 'cart', x: -9, goal: 20.5 }, { type: 'truck', x: 14, dir: -1, goal: -1.6, delay: 1 }],
    build: [-5, -5, 17, 11], view: [-12, -8.6, 24, 12.5],
    spans: [{ L: [-4, 4], R: [16, 4] }, { L: [0, 0], R: [12, 0] }], rim: [[-4, 4], [16, 4]],
  })
}

export const LEVELS = RAW.map((r, i) => {
  const base = { ...r, id: 'c' + (i + 1), chapter: Math.floor(i / 8), budget: MONEY[i][0], par: MONEY[i][1] }
  return r.custom ? custom(r.custom, base) : makeLevel(base)
})

export const SANDBOX = [
  makeLevel({ id: 's1', name: 'The Big Empty', hint: 'No budget, no rules. Build something silly.', w: 24, depth: 10, rocks: [[8, -3], [16, -5]], anchors: [[-1, 6], [25, 6], [0, -3], [24, -3]], materials: ALL }),
  makeLevel({ id: 's2', name: 'Stair Country', hint: 'A big climb and two Carts to send up it.', w: 18, rh: 5, rocks: [[9, -2]], anchors: [[0, -3], [18, 1], [9, 8]], vehicles: [{ type: 'cart' }, { type: 'cart', delay: 3 }], materials: ALL, pit: 'mist' }),
  makeLevel({ id: 's3', name: 'Rush Hour', hint: 'A Truck one way, a Cart the other, lava underneath.', w: 20, depth: 9, rocks: [[10, -4]], anchors: [[-1, 6], [21, 6], [0, -3], [20, -3]], vehicles: [{ type: 'truck' }, { type: 'cart', dir: -1 }], materials: ALL, pit: 'lava' }),
]

export function levelById(id) { return LEVELS.find((l) => l.id === id) || SANDBOX.find((l) => l.id === id) || null }
