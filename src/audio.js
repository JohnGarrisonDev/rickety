// Rickety sound effects, all synthesised through the kit's sfx (no audio files). Everything is rate-limited.
import { sfx } from '../kit/kit.js'

const last = {}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** True if `key` has not fired within `ms`. */
function ok(key, ms) { const t = now(); if (last[key] && t - last[key] < ms) return false; last[key] = t; return true }

export const audio = {
  click() { if (ok('click', 40)) sfx.tone({ freq: 520, dur: 0.05, type: 'triangle', vol: 0.12 }) },
  /** Laying a beam: short beams ping high, long ones thunk low. */
  place(len, mat) {
    const f = mat === 'steel' ? 760 : mat === 'rope' ? 420 : 560
    sfx.tone({ freq: f / (0.6 + len * 0.28), dur: mat === 'steel' ? 0.16 : 0.09, type: mat === 'steel' ? 'triangle' : 'square', vol: 0.13 })
    if (mat !== 'rope') sfx.noise({ dur: 0.05, vol: 0.1, freq: 1800 })
  },
  remove() { sfx.tone({ freq: 300, dur: 0.09, type: 'triangle', vol: 0.13, slide: 170 }) },
  undo() { sfx.tone({ freq: 380, dur: 0.06, type: 'triangle', vol: 0.11, slide: 300 }) },
  nope() { if (ok('nope', 160)) sfx.tone({ freq: 150, dur: 0.12, type: 'sawtooth', vol: 0.1, slide: 110 }) },
  pick() { sfx.tone({ freq: 660, dur: 0.05, type: 'triangle', vol: 0.1 }) },
  go() { sfx.tune([[392, 0.07], [523, 0.07], [659, 0.1]], { type: 'square', vol: 0.11 }) },
  stop() { sfx.tune([[523, 0.06], [392, 0.09]], { type: 'triangle', vol: 0.12 }) },
  /** Wood under strain. stress 0.6..1. */
  creak(stress) {
    if (!ok('creak', 520 - stress * 380)) return
    const f = 90 + stress * 150 + Math.random() * 40
    sfx.tone({ freq: f, dur: 0.14 + Math.random() * 0.1, type: 'sawtooth', vol: 0.05 + stress * 0.05, slide: f * (1.2 + Math.random() * 0.5) })
  },
  snap(mat) {
    if (!ok('snap', 55)) return
    sfx.noise({ dur: 0.16, vol: 0.3, freq: mat === 'steel' ? 5200 : 3000, slide: 500 })
    sfx.tone({ freq: mat === 'steel' ? 900 : mat === 'rope' ? 520 : 240, dur: 0.12, type: mat === 'steel' ? 'triangle' : 'square', vol: 0.16, slide: mat === 'rope' ? 900 : 90 })
  },
  rumble(speed) { if (ok('rumble', 150)) sfx.noise({ dur: 0.1, vol: 0.035 + Math.min(0.05, speed * 0.008), freq: 260 + speed * 30 }) },
  thud(v) { if (ok('thud', 120)) sfx.noise({ dur: 0.12, vol: Math.min(0.26, 0.06 + v * 0.03), freq: 420, slide: 120 }) },
  splash(kind, big) {
    if (!ok('splash', big ? 200 : 110)) return
    if (kind === 'mist') { sfx.noise({ dur: 0.25, vol: 0.07, freq: 700, slide: 200 }); return }
    sfx.noise({ dur: big ? 0.5 : 0.22, vol: big ? 0.3 : 0.12, freq: kind === 'lava' ? 900 : 2600, slide: 300 })
    if (kind === 'lava') sfx.tone({ freq: 200, dur: 0.3, type: 'sawtooth', vol: 0.06, slide: 60 })
    else sfx.tone({ freq: big ? 300 : 620, dur: 0.14, type: 'sine', vol: 0.1, slide: big ? 120 : 260 })
  },
  ohno() { if (ok('ohno', 900)) sfx.tune([[620, 0.11], [440, 0.2]], { type: 'sine', vol: 0.16 }) },
  goal() { sfx.tune([[659, 0.08], [784, 0.08], [1047, 0.14]], { type: 'triangle', vol: 0.15 }) },
  fanfare() { sfx.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.16], [0, 0.04], [988, 0.09], [1047, 0.24]], { type: 'square', vol: 0.12 }) },
  fail() { sfx.tune([[330, 0.16], [294, 0.16], [262, 0.16], [196, 0.36]], { type: 'sawtooth', vol: 0.09 }) },
  star(i) { sfx.tone({ freq: [784, 988, 1319][i] || 784, dur: 0.14, type: 'triangle', vol: 0.15, delay: 0.25 + i * 0.16 }) },
}
