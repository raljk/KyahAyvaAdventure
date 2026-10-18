#!/usr/bin/env node
// Procedural audio fallback + shared audio utilities for the Starlight Gem Chase.
//
// Generates any missing voice/sfx/music key with no external deps: samples are
// computed in plain JS (sine/triangle/additive tones, filtered noise, ADSR-ish
// envelopes, a music-box melody over a gentle I-V-vi-IV progression), written as
// 44.1 kHz 16-bit WAV, then mastered to mp3 with ffmpeg (silence trim, two-pass loudness
// mastering with a peak limiter, seamless-loop crossfade, 128 kbps). gen-audio.mjs imports
// postProcess/synthKey/etc. from here. AUDIO_DEBUG=1 prints the mastering search per clip.
//
// CLI:
//   node tools/synth-fallback.mjs                 # fill every missing key in public/assets/audio
//   node tools/synth-fallback.mjs --keys a,b      # only these keys (still skips existing unless --force)
//   node tools/synth-fallback.mjs --force         # overwrite
//   node tools/synth-fallback.mjs --test-dir DIR  # render ALL keys into DIR (public/ untouched)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const SR = 44100;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIO_DIR = path.join(ROOT, 'public/assets/audio');
export const RAW_DIR = path.join(ROOT, 'tools/_raw/audio');
export const MANIFEST_SRC = path.join(ROOT, 'tools/manifests/audio.json');
export const FFMPEG = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
export const FFPROBE = fs.existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

export const LUFS = { voice: -16, sfx: -18, music: -20 };

/* ------------------------------------------------------------------ */
/* DSP primitives                                                      */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function hz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  const semi = NOTE_SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  return mtof(semi);
}

const buf = (sec) => new Float32Array(Math.max(1, Math.ceil(sec * SR)));

function addInto(dst, src, startSec, gain = 1) {
  const s = Math.round(startSec * SR);
  for (let i = 0; i < src.length; i++) {
    const j = s + i;
    if (j >= dst.length) break;
    if (j >= 0) dst[j] += src[i] * gain;
  }
}

/** Additive tone with per-partial decay, soft attack, cosine release, optional glide/vibrato/tremolo. */
function synth(dur, o) {
  const {
    freq, glide = null, partials = [[1, 1]], decay = 0, a = 0.004, r = 0.04, vib = null, trem = null,
  } = o;
  const n = Math.ceil((dur + r) * SR);
  const out = new Float32Array(n);
  const pm = partials.map((p) => p[0]);
  const pa = partials.map((p) => p[1]);
  const pd = partials.map((p) => decay * (p[2] ?? 1));
  const np = pm.length;
  const f0 = typeof freq === 'number' ? freq : 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = f0 || freq(t);
    if (glide) {
      const k = Math.min(1, t / glide.time);
      const e = glide.ease === 'lin' ? k : 1 - (1 - k) * (1 - k);
      f = f * Math.pow(glide.to / f, e);
    }
    if (vib) f *= 1 + vib.depth * Math.sin(TAU * vib.rate * t) * Math.min(1, t / (vib.delay || 1e-4));
    ph += f / SR;
    let s = 0;
    for (let k = 0; k < np; k++) s += pa[k] * Math.exp(-pd[k] * t) * Math.sin(TAU * pm[k] * ph);
    let e = t < a ? 0.5 - 0.5 * Math.cos(Math.PI * t / a) : 1;
    if (t > dur) e *= 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (t - dur) / r));
    if (trem) e *= 1 - trem.depth * (0.5 + 0.5 * Math.sin(TAU * trem.rate * t));
    out[i] = s * e;
  }
  return out;
}

function noiseBuf(dur, rng) {
  const b = buf(dur);
  for (let i = 0; i < b.length; i++) b[i] = rng() * 2 - 1;
  return b;
}

/** multiply a buffer by an envelope function of time */
function shape(b, fn) {
  for (let i = 0; i < b.length; i++) b[i] *= fn(i / SR);
  return b;
}

/** TPT state-variable filter; cutoff may be a number or fn(t). type: lp | bp | hp */
function svf(input, type, cutoff, q = 0.7) {
  const out = new Float32Array(input.length);
  let ic1 = 0, ic2 = 0;
  const k = 1 / q;
  const fixed = typeof cutoff === 'number';
  let a1 = 0, a2 = 0, a3 = 0;
  if (fixed) {
    const g = Math.tan(Math.PI * Math.min(cutoff, SR * 0.45) / SR);
    a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
  }
  for (let i = 0; i < input.length; i++) {
    if (!fixed) {
      const fc = Math.min(Math.max(cutoff(i / SR), 20), SR * 0.45);
      const g = Math.tan(Math.PI * fc / SR);
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    const x = input[i];
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[i] = type === 'lp' ? v2 : type === 'bp' ? v1 * k : x - k * v1 - v2;
  }
  return out;
}

/** vowel-ish formant bank: [[freq, q, gain], ...] */
function formants(sig, bank, dry = 0) {
  const out = new Float32Array(sig.length);
  if (dry) for (let i = 0; i < sig.length; i++) out[i] = sig[i] * dry;
  for (const [f, q, g] of bank) {
    const y = svf(sig, 'bp', f, q);
    for (let i = 0; i < y.length; i++) out[i] += y[i] * g;
  }
  return out;
}

const harm = (n, rolloff = 1) => Array.from({ length: n }, (_, i) => [i + 1, 1 / Math.pow(i + 1, rolloff)]);

/** Freeverb-lite on a stereo pair, in place. */
function reverb(L, R, { mix = 0.2, fb = 0.82, damp = 0.25 } = {}) {
  const combsL = [1116, 1188, 1277, 1356].map((d) => ({ b: new Float32Array(d), i: 0, lp: 0 }));
  const combsR = [1139, 1211, 1300, 1379].map((d) => ({ b: new Float32Array(d), i: 0, lp: 0 }));
  const apL = [556, 441].map((d) => ({ b: new Float32Array(d), i: 0 }));
  const apR = [579, 464].map((d) => ({ b: new Float32Array(d), i: 0 }));
  const n = L.length;
  const wetL = new Float32Array(n), wetR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = (L[i] + R[i]) * 0.5;
    let sl = 0, sr = 0;
    for (const c of combsL) {
      const y = c.b[c.i]; c.lp = y * (1 - damp) + c.lp * damp; c.b[c.i] = m + c.lp * fb; if (++c.i >= c.b.length) c.i = 0; sl += y;
    }
    for (const c of combsR) {
      const y = c.b[c.i]; c.lp = y * (1 - damp) + c.lp * damp; c.b[c.i] = m + c.lp * fb; if (++c.i >= c.b.length) c.i = 0; sr += y;
    }
    sl *= 0.25; sr *= 0.25;
    for (const a of apL) { const y = a.b[a.i]; const x = sl; a.b[a.i] = x + y * 0.5; if (++a.i >= a.b.length) a.i = 0; sl = y - x; }
    for (const a of apR) { const y = a.b[a.i]; const x = sr; a.b[a.i] = x + y * 0.5; if (++a.i >= a.b.length) a.i = 0; sr = y - x; }
    wetL[i] = sl; wetR[i] = sr;
  }
  for (let i = 0; i < n; i++) { L[i] += wetL[i] * mix * 2; R[i] += wetR[i] * mix * 2; }
}

class Track {
  constructor(sec, stereo = false) {
    this.n = Math.ceil(sec * SR);
    this.stereo = stereo;
    this.L = new Float32Array(this.n);
    this.R = stereo ? new Float32Array(this.n) : this.L;
  }
  add(sig, t, gain = 1, pan = 0) {
    if (!this.stereo) { addInto(this.L, sig, t, gain); return; }
    const ang = (pan + 1) * Math.PI / 4;
    addInto(this.L, sig, t, gain * Math.cos(ang) * Math.SQRT2);
    addInto(this.R, sig, t, gain * Math.sin(ang) * Math.SQRT2);
  }
  channels() { return this.stereo ? [this.L, this.R] : [this.L]; }
}

/** Write 16-bit PCM WAV. channels: array of Float32Array (1 or 2). Peak-normalises to `peak`. */
export function writeWav(file, channels, peak = 0.85) {
  const n = channels[0].length;
  let mx = 1e-9;
  for (const c of channels) for (let i = 0; i < n; i++) { const v = Math.abs(c[i]); if (v > mx) mx = v; }
  const g = peak / mx;
  const nc = channels.length;
  const data = Buffer.alloc(n * nc * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      let v = channels[c][i] * g;
      v = Math.max(-1, Math.min(1, v));
      data.writeInt16LE(Math.round(v * 32767), (i * nc + c) * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(nc, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * nc * 2, 28); h.writeUInt16LE(nc * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

const inst = {
  bell(f, d = 1.2, decay = 3) {
    return synth(d, { freq: f, partials: [[1, 1, 1], [2.0, 0.35, 1.6], [2.76, 0.3, 2.2], [5.4, 0.14, 3.5], [8.93, 0.06, 4.5]], decay, a: 0.002, r: 0.15 });
  },
  glock(f, d = 1.0, decay = 3.5) {
    return synth(d, { freq: f, partials: [[1, 1, 1], [2.76, 0.32, 2.4], [5.4, 0.16, 4], [8.93, 0.07, 6]], decay, a: 0.002, r: 0.12 });
  },
  musicBox(f, d = 1.0, decay = 3.6) {
    return synth(d, { freq: f, partials: [[1, 1, 1], [2.0, 0.2, 2.2], [4.0, 0.08, 3.5], [5.97, 0.05, 5]], decay, a: 0.002, r: 0.15 });
  },
  pad(f, d, att = 0.4, rel = 0.8) {
    return synth(d, { freq: f, partials: [[1, 1], [1.004, 0.7], [0.996, 0.5], [2, 0.18], [3, 0.07]], a: att, r: rel, vib: { rate: 4.6, depth: 0.0015, delay: 0.5 } });
  },
  pluck(f, d = 0.25, decay = 9) {
    const s = synth(d, { freq: f, partials: [[1, 1, 1], [2, 0.5, 1.5], [3, 0.25, 2.5], [4, 0.1, 3]], decay, a: 0.002, r: 0.05 });
    return s;
  },
  bass(f, d = 0.35) {
    return synth(d, { freq: f, partials: [[1, 1], [2, 0.3, 1.3], [3, 0.08, 2]], decay: 5, a: 0.004, r: 0.08 });
  },
  flute(f, d, rng) {
    const s = synth(d, { freq: f, partials: [[1, 1], [2, 0.18], [3, 0.05]], a: 0.05, r: 0.12, vib: { rate: 5.2, depth: 0.0055, delay: 0.18 } });
    const nz = svf(noiseBuf(d + 0.12, rng), 'bp', f * 2, 2);
    const att = 0.05;
    for (let i = 0; i < s.length; i++) {
      const t = i / SR;
      const e = (t < att ? t / att : 1) * (t > d ? Math.max(0, 1 - (t - d) / 0.12) : 1);
      s[i] += nz[i] * 0.05 * e;
    }
    return s;
  },
  choir(f, d, rng) {
    const s = synth(d, { freq: f, partials: harm(10, 1.1), a: 0.25, r: 0.5, vib: { rate: 5.3, depth: 0.004, delay: 0.3 } });
    const s2 = synth(d, { freq: f * 1.006, partials: harm(10, 1.1), a: 0.3, r: 0.5, vib: { rate: 4.9, depth: 0.004, delay: 0.4 } });
    const mix = new Float32Array(Math.max(s.length, s2.length));
    for (let i = 0; i < mix.length; i++) mix[i] = (s[i] || 0) + (s2[i] || 0);
    return formants(mix, [[780, 3, 0.9], [1150, 4, 0.5], [2800, 6, 0.1]], 0.12);
  },
  bassoon(f, d) {
    const s = synth(d, { freq: f, partials: harm(14, 0.9), a: 0.03, r: 0.1, vib: { rate: 5, depth: 0.01, delay: 0.1 } });
    return formants(s, [[420, 2.5, 0.8], [900, 3, 0.35]], 0.08);
  },
  brass(f, d) {
    const s = synth(d, { freq: f, partials: harm(9, 1.0), a: 0.025, r: 0.12, vib: { rate: 5.5, depth: 0.003, delay: 0.25 } });
    return svf(s, 'lp', 2600, 0.8);
  },
  shaker(rng, d = 0.06) {
    const n = noiseBuf(d, rng);
    return shape(svf(n, 'hp', 5500, 0.8), (t) => Math.exp(-t * 55) * Math.min(1, t / 0.004));
  },
  wood(f = 1300, d = 0.12) {
    return synth(d, { freq: f, glide: { to: f * 0.7, time: 0.02 }, partials: [[1, 1, 1], [2.4, 0.4, 1.4]], decay: 50, a: 0.001, r: 0.03 });
  },
  kick(f = 110) {
    return synth(0.18, { freq: f, glide: { to: f * 0.5, time: 0.1 }, partials: [[1, 1]], decay: 16, a: 0.003, r: 0.04 });
  },
};

/** soft thump */
const thump = (f0, f1, decay = 18, d = 0.15) => synth(d, { freq: f0, glide: { to: f1, time: d * 0.6 }, partials: [[1, 1], [2.1, 0.25, 1.5]], decay, a: 0.002, r: 0.03 });

/** short noise tick/click */
function click(rng, bpHz, d = 0.012, q = 1.5) {
  return shape(svf(noiseBuf(d + 0.004, rng), 'bp', bpHz, q), (t) => Math.exp(-t * (4.6 / d)));
}

/** water bubble pop */
function bubble(rng) {
  const f = 450 + rng() * 800;
  return synth(0.05, { freq: f, glide: { to: f * (1.6 + rng() * 0.8), time: 0.04 }, partials: [[1, 1], [2, 0.15]], decay: 40, a: 0.002, r: 0.02 });
}

/** big wet splash noise */
function splash(rng, d, hi, lo, decay = 6) {
  const n = noiseBuf(d, rng);
  const f = svf(n, 'lp', (t) => lo + (hi - lo) * Math.exp(-t * 7), 0.8);
  return shape(f, (t) => Math.min(1, t / 0.006) * Math.exp(-t * decay));
}

/* ------------------------------------------------------------------ */
/* SFX recipes (mono)                                                  */
/* ------------------------------------------------------------------ */

const PENT = ['C', 'D', 'E', 'G', 'A'];
const pentHz = (i, baseOct = 5) => hz(PENT[((i % 5) + 5) % 5] + (baseOct + Math.floor(i / 5)));

const SFX = {
  ui_tap(rng) {
    const o = buf(0.5);
    addInto(o, synth(0.18, { freq: 900, glide: { to: 620, time: 0.05 }, partials: [[1, 1], [2, 0.18, 1.5]], decay: 9, a: 0.002, r: 0.1 }), 0, 0.7);
    addInto(o, synth(0.3, { freq: 540, partials: [[1, 1]], decay: 8, a: 0.003, r: 0.1 }), 0.012, 0.25);
    addInto(o, click(rng, 2800, 0.01), 0, 0.5);
    return o;
  },
  ui_join(rng) {
    const o = buf(1.4);
    addInto(o, inst.bell(hz('G5'), 0.7, 3.6), 0, 0.6);
    addInto(o, inst.bell(hz('C6'), 0.9, 3.2), 0.15, 0.6);
    addInto(o, shape(svf(noiseBuf(0.3, rng), 'hp', 7000), (t) => Math.exp(-t * 14)), 0.15, 0.06);
    return o;
  },
  dice_roll(rng) {
    const o = buf(1.6);
    let t = 0, k = 0;
    while (t < 1.35) {
      const g = (0.45 + rng() * 0.55) * (t > 0.9 ? 0.7 : 1);
      addInto(o, click(rng, 1500 + rng() * 2200, 0.018, 1.2), t, g);
      addInto(o, synth(0.05, { freq: 280 + rng() * 260, partials: [[1, 1], [2.3, 0.3]], decay: 55, a: 0.001, r: 0.02 }), t, g * 0.35);
      t += 0.028 + 0.0075 * Math.pow(k, 1.08) + rng() * 0.012; k++;
    }
    return o;
  },
  dice_land(rng) {
    const o = buf(0.6);
    addInto(o, thump(210, 95, 20, 0.2), 0, 0.9);
    addInto(o, click(rng, 2200, 0.01), 0, 0.6);
    addInto(o, thump(250, 130, 28, 0.12), 0.13, 0.4);
    addInto(o, click(rng, 2600, 0.008), 0.13, 0.3);
    addInto(o, thump(280, 150, 30, 0.1), 0.24, 0.2);
    addInto(o, click(rng, 2800, 0.006), 0.24, 0.15);
    return o;
  },
  pawn_hop(rng) {
    const o = buf(0.5);
    addInto(o, synth(0.28, { freq: (t) => 420 + 360 * Math.sin(Math.PI * Math.min(1, t / 0.3)), partials: [[1, 1], [2, 0.25]], decay: 5, a: 0.005, r: 0.08 }), 0, 0.7);
    addInto(o, thump(260, 140, 25, 0.1), 0.24, 0.4);
    return o;
  },
  shard_ting(rng) {
    const o = buf(1.4);
    addInto(o, inst.bell(hz('D7'), 1.0, 3.8), 0, 0.55);
    addInto(o, inst.bell(hz('G7'), 0.8, 5), 0.06, 0.3);
    addInto(o, shape(svf(noiseBuf(0.5, rng), 'hp', 8000), (t) => Math.exp(-t * 10)), 0, 0.05);
    return o;
  },
  swish_net(rng) {
    const o = buf(0.9);
    const n = noiseBuf(0.7, rng);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.55)), 1.6);
    addInto(o, shape(svf(n, 'bp', (t) => 700 + 3000 * env(t), 1.1), env), 0, 1);
    return o;
  },
  pup_woof(rng) {
    const o = buf(0.85);
    const woof = (f0, g) => {
      const s = synth(0.2, { freq: f0, glide: { to: f0 * 0.55, time: 0.2 }, partials: harm(12, 1), a: 0.005, r: 0.08 });
      const body = formants(s, [[650, 4, 1.0], [1350, 5, 0.45], [2300, 6, 0.15]]);
      const nz = shape(svf(noiseBuf(0.28, rng), 'bp', 1200, 1), (t) => Math.exp(-t * 20));
      for (let i = 0; i < body.length; i++) body[i] = body[i] * Math.exp(-i / SR * 8) + (nz[i] || 0) * 0.08;
      return [body, g];
    };
    const [a, ga] = woof(330, 1); addInto(o, a, 0, ga);
    const [b, gb] = woof(370, 0.7); addInto(o, b, 0.3, gb);
    return o;
  },
  cake_party(rng) {
    const o = buf(2.8);
    const run = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'];
    run.forEach((n, i) => addInto(o, inst.glock(hz(n), 0.8, 3.2), 0.05 + i * 0.085, 0.4));
    addInto(o, inst.brass(hz('G4'), 0.18), 0.9, 0.3);
    addInto(o, inst.brass(hz('C5'), 0.3), 1.12, 0.3);
    for (let i = 0; i < 8; i++) addInto(o, inst.shaker(rng), 0.8 + i * 0.12, 0.35);
    [['C6', 1.5], ['E6', 1.58], ['G6', 1.66], ['C7', 1.74]].forEach(([n, t]) => addInto(o, inst.bell(hz(n), 0.9, 3), t, 0.3));
    return o;
  },
  flight_whoosh(rng) {
    const o = buf(1.8);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.4)), 1.3);
    addInto(o, shape(svf(noiseBuf(1.5, rng), 'bp', (t) => 300 * Math.pow(14, Math.min(1, t / 1.3)), 0.9), env), 0, 0.9);
    [0, 1, 2, 3, 4, 5, 6].forEach((i) => addInto(o, inst.glock(pentHz(i + 5, 5), 0.5, 5), 0.25 + i * 0.12, 0.18));
    return o;
  },
  bridge_land(rng) {
    const o = buf(0.8);
    addInto(o, thump(150, 60, 14, 0.25), 0, 0.9);
    addInto(o, shape(svf(noiseBuf(0.15, rng), 'lp', 900), (t) => Math.exp(-t * 25)), 0, 0.5);
    addInto(o, click(rng, 2500, 0.012), 0.06, 0.35);
    addInto(o, click(rng, 3200, 0.01), 0.11, 0.25);
    return o;
  },
  bell_ding(rng) {
    const o = buf(1.6);
    addInto(o, inst.bell(hz('G6'), 1.1, 2.6), 0, 0.7);
    addInto(o, shape(svf(noiseBuf(0.2, rng), 'hp', 7000), (t) => Math.exp(-t * 30)), 0, 0.07);
    return o;
  },
  net_swing(rng) {
    const o = buf(1.1);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.95)), 1.5);
    addInto(o, shape(svf(noiseBuf(0.95, rng), 'bp', (t) => 500 + 2300 * env(t), 1.0), env), 0, 1);
    addInto(o, synth(0.9, { freq: (t) => 160 + 60 * Math.sin(Math.PI * t / 0.9), partials: [[1, 1]], a: 0.2, r: 0.2 }), 0, 0.08);
    return o;
  },
  bucket_bump(rng) {
    const o = buf(1.2);
    addInto(o, shape(svf(noiseBuf(0.3, rng), 'lp', 700), (t) => Math.min(1, t / 0.25) * Math.exp(-t * 3)), 0, 0.25);
    addInto(o, thump(160, 80, 14, 0.3), 0.08, 1);
    addInto(o, synth(0.25, { freq: 330, partials: [[1, 1], [1.6, 0.4]], decay: 22, a: 0.002, r: 0.05 }), 0.08, 0.35);
    [[0.36, 0.45], [0.5, 0.3], [0.62, 0.18]].forEach(([t, g]) => addInto(o, thump(190, 100, 24, 0.1), t, g));
    return o;
  },
  apple_roll_stairs(rng) {
    const o = buf(2.7);
    let t = 0.02;
    for (let i = 0; i < 12; i++) {
      const g = (i < 9 ? 0.55 + rng() * 0.4 : 0.3 - (i - 9) * 0.08);
      addInto(o, thump(260 - i * 6, 120, 22, 0.12), t, g);
      addInto(o, click(rng, 1800 + rng() * 800, 0.008), t, g * 0.35);
      t += i < 9 ? 0.22 + rng() * 0.07 : 0.1 + (i - 9) * 0.03;
    }
    addInto(o, shape(svf(noiseBuf(2.4, rng), 'lp', 420), (x) => Math.min(1, x / 0.1) * Math.max(0, 1 - x / 2.4)), 0, 0.12);
    return o;
  },
  vine_bloom(rng) {
    const o = buf(2.2);
    addInto(o, shape(svf(noiseBuf(1.0, rng), 'bp', (t) => 350 + 900 * t, 2.5), (t) => Math.min(1, t / 0.2) * (0.6 + 0.4 * Math.sin(TAU * 22 * t)) * Math.max(0, 1 - t)), 0, 0.22);
    addInto(o, synth(1.0, { freq: 330, glide: { to: 1320, time: 0.95, ease: 'lin' }, partials: [[1, 1], [2, 0.3], [3, 0.1]], a: 0.06, r: 0.12, trem: { rate: 9, depth: 0.4 } }), 0, 0.28);
    [['C6', 0], ['E6', 0.04], ['G6', 0.08], ['C7', 0.12]].forEach(([n, d]) => addInto(o, inst.bell(hz(n), 0.9, 3.2), 0.95 + d, 0.35));
    addInto(o, shape(svf(noiseBuf(0.4, rng), 'hp', 6000), (t) => Math.exp(-t * 9)), 0.95, 0.08);
    return o;
  },
  tub_splash_bubbles(rng) {
    const o = buf(2.3);
    addInto(o, splash(rng, 0.6, 4200, 600, 6), 0, 0.9);
    addInto(o, thump(220, 85, 14, 0.25), 0.02, 0.5);
    for (let i = 0; i < 16; i++) addInto(o, bubble(rng), 0.15 + rng() * 1.6, 0.12 + rng() * 0.25);
    addInto(o, shape(svf(noiseBuf(1.2, rng), 'bp', 2500, 1.5), (t) => Math.exp(-t * 3) * 0.5), 0.1, 0.05);
    return o;
  },
  pipe_rattle(rng) {
    const o = buf(2.3);
    let t = 0.02, k = 0;
    while (t < 1.85) {
      const g = 0.45 + rng() * 0.45;
      const f = 1250 - t * 220 + rng() * 350;
      addInto(o, synth(0.09, { freq: f, partials: [[1, 1], [2.4, 0.5, 1.2], [3.7, 0.25, 1.5]], decay: 32, a: 0.001, r: 0.03 }), t, g * 0.5);
      addInto(o, click(rng, 2600, 0.01), t, g * 0.3);
      t += 0.055 + rng() * 0.03; k++;
    }
    addInto(o, synth(1.9, { freq: 230, partials: [[1, 1], [2.02, 0.4]], a: 0.1, r: 0.2, trem: { rate: 14, depth: 0.6 } }), 0, 0.07);
    addInto(o, synth(0.4, { freq: 520, partials: [[1, 1], [2.4, 0.6], [4.1, 0.3]], decay: 9, a: 0.002, r: 0.05 }), 1.85, 0.5);
    return o;
  },
  seesaw_boing(rng) {
    const o = buf(1.5);
    addInto(o, thump(230, 100, 20, 0.15), 0, 0.7);
    addInto(o, click(rng, 1400, 0.01), 0, 0.4);
    addInto(o, synth(1.2, { freq: (t) => 240 * (1 + 0.35 * Math.exp(-3 * t) * Math.sin(TAU * 11 * t)) + 140 * Math.exp(-6 * t), partials: [[1, 1], [2, 0.4], [3, 0.2]], decay: 2.6, a: 0.004, r: 0.12 }), 0.03, 0.6);
    return o;
  },
  dog_splash(rng) {
    const o = buf(2.2);
    addInto(o, splash(rng, 0.9, 5000, 300, 4), 0, 1);
    addInto(o, thump(170, 50, 6, 0.4), 0, 0.7);
    addInto(o, splash(rng, 0.5, 3500, 400, 7), 0.35, 0.35);
    addInto(o, shape(svf(noiseBuf(1.2, rng), 'lp', 650), (t) => (0.5 + 0.5 * Math.sin(TAU * 5 * t)) * Math.exp(-t * 2.2)), 0.3, 0.25);
    for (let i = 0; i < 20; i++) addInto(o, bubble(rng), 0.3 + rng() * 1.6, 0.1 + rng() * 0.25);
    return o;
  },
  music_rise(rng) {
    const o = buf(3.4);
    const N = 11;
    for (let k = 0; k < N; k++) {
      const t = 2.2 * Math.pow(k / (N - 1), 1.25);
      addInto(o, inst.musicBox(pentHz(k + 2, 5), 0.5, 5), t, 0.2 + 0.4 * (k / (N - 1)));
    }
    addInto(o, synth(2.3, { freq: 300, glide: { to: 1200, time: 2.2, ease: 'lin' }, partials: [[1, 1], [2, 0.2]], a: 0.5, r: 0.2, trem: { rate: 6, depth: 0.5 } }), 0, 0.12);
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 1.0, 2.2), 2.25 + i * 0.03, 0.35));
    addInto(o, shape(svf(noiseBuf(1.2, rng), 'hp', 6500), (t) => Math.exp(-t * 3)), 2.25, 0.07);
    return o;
  },
  basket_whoosh_drop(rng) {
    const o = buf(2.8);
    addInto(o, shape(synth(0.5, { freq: 520, glide: { to: 780, time: 0.5, ease: 'lin' }, partials: harm(8, 1), a: 0.05, r: 0.1, trem: { rate: 18, depth: 0.7 } }), (t) => 1), 0, 0.045);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.9)), 1.4);
    addInto(o, shape(svf(noiseBuf(0.9, rng), 'bp', (t) => 3200 * Math.pow(0.12, t / 0.9), 0.9), env), 0.3, 0.95);
    addInto(o, thump(130, 55, 10, 0.3), 1.22, 0.7);
    const rustle = shape(svf(noiseBuf(0.9, rng), 'hp', 2800), (t) => Math.exp(-t * 4) * (rng() > 0.55 ? 1 : 0.3));
    addInto(o, rustle, 1.22, 0.3);
    addInto(o, synth(0.8, { freq: 190, glide: { to: 150, time: 0.8, ease: 'lin' }, partials: [[1, 1], [2.01, 0.25]], a: 0.2, r: 0.3, trem: { rate: 3.2, depth: 0.7 } }), 1.6, 0.08);
    return o;
  },
  caught_stuck(rng) {
    const o = buf(2.2);
    [0, 0.11, 0.22].forEach((t, i) => addInto(o, synth(0.09, { freq: 700 + i * 120, glide: { to: 1500 + i * 150, time: 0.08 }, partials: [[1, 1], [2, 0.3]], a: 0.004, r: 0.02 }), t, 0.35));
    addInto(o, thump(200, 90, 14, 0.2), 0.35, 0.7);
    addInto(o, synth(0.5, { freq: (t) => 260 * (1 + 0.3 * Math.exp(-4 * t) * Math.sin(TAU * 12 * t)) + 90 * Math.exp(-7 * t), partials: [[1, 1], [2, 0.35]], decay: 4, a: 0.004, r: 0.08 }), 0.37, 0.4);
    const wah = (n, t, d) => {
      const s = inst.brass(hz(n), d);
      return [formants(s, [[600, 3, 0.9], [1000, 3, 0.4]], 0.1), t];
    };
    [['Bb3', 0.95, 0.2], ['A3', 1.2, 0.2], ['Ab3', 1.45, 0.2], ['G3', 1.7, 0.45]].forEach(([n, t, d]) => { const [s, tt] = wah(n, t, d); addInto(o, s, tt, 0.4); });
    return o;
  },
  missed_hop(rng) {
    const o = buf(1.3);
    addInto(o, shape(svf(noiseBuf(0.25, rng), 'bp', (t) => 800 + 2500 * t / 0.25, 1), (t) => Math.sin(Math.PI * Math.min(1, t / 0.25))), 0, 0.5);
    addInto(o, synth(0.22, { freq: 350, glide: { to: 900, time: 0.15 }, partials: [[1, 1], [2, 0.3]], decay: 4, a: 0.004, r: 0.06 }), 0.05, 0.55);
    addInto(o, thump(240, 120, 22, 0.1), 0.34, 0.45);
    addInto(o, inst.bell(hz('E6'), 0.5, 5), 0.5, 0.4);
    addInto(o, inst.bell(hz('G6'), 0.6, 4.5), 0.62, 0.4);
    return o;
  },
  lap_fanfare(rng) {
    const o = buf(3.0);
    [['C5', 0, 0.16], ['C5', 0.2, 0.16], ['C5', 0.4, 0.16], ['E5', 0.6, 0.5]].forEach(([n, t, d]) => { addInto(o, inst.brass(hz(n), d), t, 0.4); addInto(o, inst.brass(hz(n) * 0.5, d), t, 0.25); });
    [['G5', 1.2], ['E5', 1.2], ['C5', 1.2]].forEach(([n, t]) => addInto(o, inst.brass(hz(n), 1.0), t, 0.28));
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 1.0, 2.6), 1.2 + i * 0.05, 0.28));
    addInto(o, shape(svf(noiseBuf(1.2, rng), 'hp', 6000), (t) => Math.exp(-t * 3.5)), 1.2, 0.06);
    return o;
  },
  almost_win_sparkle(rng) {
    const o = buf(2.5);
    ['C6', 'E6', 'G6', 'C7', 'E7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 0.8, 3.4), i * 0.1, 0.35));
    ['C6', 'E6', 'G6'].forEach((n) => addInto(o, synth(1.5, { freq: hz(n), partials: [[1, 1], [2, 0.15]], a: 0.2, r: 0.5, decay: 0.8, trem: { rate: 7, depth: 0.5 } }), 0.4, 0.14));
    addInto(o, shape(svf(noiseBuf(1.8, rng), 'hp', (t) => 3000 + 3500 * t, 1), (t) => Math.min(1, t / 0.5) * Math.exp(-t * 1.2)), 0.1, 0.06);
    return o;
  },
  win_fanfare(rng) {
    const o = buf(4.0);
    [['C5', 0, 0.16], ['C5', 0.2, 0.16], ['C5', 0.4, 0.16], ['E5', 0.6, 0.4], ['D5', 1.1, 0.16], ['E5', 1.3, 0.16]].forEach(([n, t, d]) => { addInto(o, inst.brass(hz(n), d), t, 0.38); addInto(o, inst.brass(hz(n) * 0.5, d), t, 0.2); });
    ['G5', 'E5', 'C5', 'C4'].forEach((n) => addInto(o, inst.brass(hz(n), 1.5), 1.5, 0.28));
    ['C6', 'E6', 'G6', 'C7', 'G6', 'E6', 'C7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 1.0, 2.6), 1.5 + i * 0.07, 0.28));
    [['C6', 1.5], ['G6', 1.55], ['C7', 1.6]].forEach(([n, t]) => addInto(o, inst.bell(hz(n), 1.4, 1.8), t, 0.25));
    addInto(o, shape(svf(noiseBuf(2.2, rng), 'hp', 5500), (t) => Math.exp(-t * 2.2)), 1.5, 0.09);
    return o;
  },
  gem_assemble(rng) {
    const o = buf(3.6);
    ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'].forEach((n, i) => {
      const t = i * 0.27;
      addInto(o, inst.bell(hz(n), 0.7, 3.4), t, 0.4);
      addInto(o, shape(svf(noiseBuf(0.2, rng), 'bp', (x) => 1500 + 3000 * x / 0.2, 1.5), (x) => Math.sin(Math.PI * Math.min(1, x / 0.2))), t - 0.12 > 0 ? t - 0.12 : 0, 0.12);
    });
    ['C4', 'E4', 'G4', 'C5'].forEach((n) => addInto(o, inst.pad(hz(n), 1.4, 0.7, 0.8), 1.7, 0.2));
    ['C6', 'E6', 'G6', 'C7', 'E7', 'G6', 'C7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 1.0, 2.6), 2.0 + i * 0.07, 0.25));
    addInto(o, inst.bell(hz('C7'), 1.5, 1.8), 2.0, 0.35);
    return o;
  },
  timer_tick(rng) {
    const o = buf(0.4);
    addInto(o, inst.wood(1250, 0.12), 0, 0.8);
    addInto(o, synth(0.3, { freq: 520, partials: [[1, 1]], decay: 9, a: 0.001, r: 0.08 }), 0, 0.35);
    addInto(o, click(rng, 3000, 0.006), 0, 0.3);
    return o;
  },
  confetti(rng) {
    const o = buf(2.4);
    addInto(o, shape(svf(noiseBuf(0.12, rng), 'bp', 1300, 0.8), (t) => Math.exp(-t * 45)), 0, 0.9);
    addInto(o, thump(210, 80, 24, 0.15), 0, 0.7);
    let t = 0.12;
    while (t < 1.9) {
      addInto(o, click(rng, 2500 + rng() * 5000, 0.004 + rng() * 0.006), t, 0.12 + rng() * 0.2);
      t += (0.01 + rng() * 0.05) * (1 + t * 0.8);
    }
    for (let i = 0; i < 9; i++) addInto(o, inst.glock(pentHz(Math.floor(rng() * 10), 6), 0.5, 5), 0.15 + rng() * 1.5, 0.12 + rng() * 0.12);
    addInto(o, shape(svf(noiseBuf(1.8, rng), 'bp', 4500, 0.8), (t2) => Math.exp(-t2 * 1.6) * (0.6 + 0.4 * Math.sin(TAU * 17 * t2))), 0.1, 0.07);
    return o;
  },
  shard_fly(rng) {
    const o = buf(1.6);
    addInto(o, synth(1.0, { freq: 500, glide: { to: 2800, time: 0.95, ease: 'lin' }, partials: [[1, 1], [2, 0.2]], a: 0.05, r: 0.2, trem: { rate: 14, depth: 0.5 } }), 0, 0.22);
    addInto(o, shape(svf(noiseBuf(1.1, rng), 'hp', (t) => 1500 + 3000 * t, 1), (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.1)), 1.3)), 0, 0.2);
    for (let i = 0; i < 12; i++) addInto(o, inst.glock(pentHz(i + 3, 6), 0.35, 8), 0.05 + i * 0.075, 0.18 * (1 - i * 0.05));
    return o;
  },
  camera_whoosh(rng) {
    const o = buf(1.2);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.0)), 2);
    addInto(o, shape(svf(noiseBuf(1.0, rng), 'bp', (t) => 300 + 1500 * Math.sin(Math.PI * t / 1.0), 0.8), env), 0, 0.9);
    addInto(o, synth(1.0, { freq: 120, glide: { to: 240, time: 1.0, ease: 'lin' }, partials: [[1, 1]], a: 0.3, r: 0.4 }), 0, 0.06);
    return o;
  },
  /* ---------------- v2: mini-games + Grabble ---------------- */
  flap_wing(rng) {
    const o = buf(0.8);
    [[0, 0.24, 0.9], [0.22, 0.22, 0.65], [0.42, 0.2, 0.4]].forEach(([t0, d, g]) => {
      const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / d)), 1.3);
      addInto(o, shape(svf(noiseBuf(d, rng), 'bp', (t) => 1500 - 800 * (t / d), 0.8), env), t0, g);
      addInto(o, shape(synth(d, { freq: 170, glide: { to: 120, time: d, ease: 'lin' }, partials: [[1, 1]], a: 0.04, r: 0.06 }), env), t0, g * 0.18);
    });
    return o;
  },
  ring_pass(rng) {
    const o = buf(1.1);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.45)), 1.4);
    addInto(o, shape(svf(noiseBuf(0.45, rng), 'bp', (t) => 500 * Math.pow(6, t / 0.45), 1.0), env), 0, 0.3);
    ['E6', 'G6', 'C7', 'E7'].forEach((n, i) => addInto(o, inst.glock(hz(n), 0.6, 5), 0.12 + i * 0.07, 0.38));
    addInto(o, shape(svf(noiseBuf(0.5, rng), 'hp', 6500), (t) => Math.exp(-t * 8)), 0.2, 0.06);
    return o;
  },
  tumble(rng) {
    const o = buf(1.3);
    addInto(o, synth(0.6, { freq: 950, glide: { to: 170, time: 0.6, ease: 'lin' }, partials: [[1, 1], [2, 0.18]], a: 0.01, r: 0.12, vib: { rate: 9, depth: 0.03, delay: 0.01 } }), 0, 0.28);
    [[0.04, 0.9], [0.27, 0.65], [0.46, 0.5], [0.62, 0.36], [0.74, 0.22]].forEach(([t, g], i) => {
      addInto(o, thump(250 - i * 22, 105, 22, 0.13), t, g);
      addInto(o, click(rng, 1700 + rng() * 900, 0.01), t, g * 0.4);
    });
    addInto(o, synth(0.45, { freq: 300, partials: [[1, 1], [2, 0.35]], decay: 5, a: 0.004, r: 0.1, vib: { rate: 12, depth: 0.04, delay: 0.01 } }), 0.85, 0.25);
    return o;
  },
  twinkle(rng) {
    const o = buf(1.0);
    addInto(o, inst.bell(hz('E7'), 0.7, 5), 0, 0.5);
    addInto(o, inst.bell(hz('B7'), 0.55, 6.5), 0.07, 0.32);
    addInto(o, inst.glock(hz('G7'), 0.4, 8), 0.16, 0.2);
    addInto(o, shape(svf(noiseBuf(0.45, rng), 'hp', 8500), (t) => Math.exp(-t * 11)), 0, 0.05);
    return o;
  },
  flower_tap(rng) {
    const o = buf(0.55);
    addInto(o, synth(0.14, { freq: 520, glide: { to: 900, time: 0.06 }, partials: [[1, 1], [2, 0.3]], decay: 20, a: 0.002, r: 0.05 }), 0, 0.7);
    addInto(o, inst.glock(hz('G6'), 0.3, 9), 0.035, 0.32);
    addInto(o, click(rng, 2400, 0.008), 0, 0.35);
    return o;
  },
  pup_catch(rng) {
    const o = buf(0.8);
    addInto(o, click(rng, 1800, 0.016, 1.2), 0, 0.9);
    addInto(o, thump(310, 150, 26, 0.09), 0, 0.5);
    const yip = synth(0.17, { freq: 640, glide: { to: 1050, time: 0.12 }, partials: harm(9, 1), a: 0.006, r: 0.06 });
    addInto(o, formants(yip, [[800, 4, 1.0], [1700, 5, 0.4], [2700, 6, 0.1]]), 0.1, 0.55);
    addInto(o, inst.bell(hz('C7'), 0.35, 8), 0.2, 0.25);
    return o;
  },
  bucket_clank(rng) {
    const o = buf(1.0);
    const clang = (f, d, g, t) => addInto(o, synth(d, { freq: f, partials: [[1, 1, 1], [2.32, 0.7, 1.3], [3.93, 0.5, 2.1], [5.21, 0.3, 3]], decay: 8, a: 0.001, r: 0.06 }), t, g);
    clang(250, 0.5, 0.7, 0);
    clang(280, 0.3, 0.35, 0.17);
    addInto(o, thump(190, 90, 18, 0.15), 0, 0.7);
    addInto(o, click(rng, 2000, 0.012), 0, 0.5);
    addInto(o, click(rng, 2400, 0.01), 0.17, 0.3);
    return o;
  },
  net_swoop(rng) {
    const o = buf(0.9);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.42)), 1.2);
    addInto(o, shape(svf(noiseBuf(0.45, rng), 'bp', (t) => 500 + 4200 * env(t), 1.1), env), 0, 1);
    addInto(o, shape(svf(noiseBuf(0.3, rng), 'hp', 3500), (t) => Math.min(1, t / 0.05) * Math.exp(-t * 11)), 0.28, 0.2);
    return o;
  },
  hop_dodge(rng) {
    const o = buf(0.7);
    addInto(o, synth(0.45, { freq: (t) => 230 * (1 + 0.45 * Math.exp(-4 * t) * Math.sin(TAU * 10 * t)) + 330 * Math.exp(-7 * t), partials: [[1, 1], [2, 0.4], [3, 0.15]], decay: 3.4, a: 0.004, r: 0.1 }), 0, 0.6);
    addInto(o, shape(svf(noiseBuf(0.2, rng), 'bp', (t) => 700 + 2000 * t / 0.2, 1), (t) => Math.sin(Math.PI * Math.min(1, t / 0.2))), 0, 0.22);
    addInto(o, thump(240, 130, 24, 0.1), 0.42, 0.4);
    return o;
  },
  strawberry_plop(rng) {
    const o = buf(0.55);
    addInto(o, synth(0.16, { freq: 620, glide: { to: 260, time: 0.12 }, partials: [[1, 1], [2, 0.2]], decay: 20, a: 0.002, r: 0.05 }), 0, 0.75);
    addInto(o, shape(svf(noiseBuf(0.14, rng), 'lp', 1400), (t) => Math.exp(-t * 28)), 0.01, 0.4);
    addInto(o, thump(190, 100, 24, 0.1), 0.01, 0.35);
    addInto(o, bubble(rng), 0.1, 0.25);
    return o;
  },
  vine_grow(rng) {
    const o = buf(1.5);
    addInto(o, shape(svf(noiseBuf(1.2, rng), 'bp', (t) => 350 + 900 * t, 2.2), (t) => Math.min(1, t / 0.15) * (0.55 + 0.45 * Math.sin(TAU * 19 * t)) * Math.max(0, 1 - t / 1.2)), 0, 0.25);
    addInto(o, synth(1.15, { freq: 260, glide: { to: 780, time: 1.1, ease: 'lin' }, partials: [[1, 1], [2, 0.3], [3, 0.1]], a: 0.06, r: 0.15, trem: { rate: 8, depth: 0.45 } }), 0, 0.22);
    [['E6', 1.05], ['G6', 1.12], ['C7', 1.19]].forEach(([n, t]) => addInto(o, inst.glock(hz(n), 0.5, 5), t, 0.3));
    return o;
  },
  vine_grab(rng) {
    const o = buf(1.0);
    addInto(o, synth(0.22, { freq: 2300, glide: { to: 600, time: 0.2 }, partials: [[1, 1], [2, 0.25]], a: 0.004, r: 0.05 }), 0, 0.22);
    addInto(o, shape(svf(noiseBuf(0.25, rng), 'hp', 2500), (t) => Math.exp(-t * 18)), 0, 0.5);
    addInto(o, click(rng, 2800, 0.01), 0.18, 0.8);
    addInto(o, thump(200, 95, 20, 0.12), 0.18, 0.6);
    addInto(o, shape(svf(noiseBuf(0.35, rng), 'bp', 1500, 1.4), (t) => Math.exp(-t * 9) * (0.5 + 0.5 * Math.sin(TAU * 25 * t))), 0.2, 0.2);
    return o;
  },
  grabble_scurry(rng) {
    const o = buf(1.2);
    let t = 0.02, k = 0;
    while (t < 0.95) {
      const g = (0.5 + rng() * 0.4) * (t > 0.7 ? 1 - (t - 0.7) * 2.5 : 1);
      const f = k % 2 ? 1900 : 2500;
      addInto(o, click(rng, f + rng() * 500, 0.012, 1.4), t, g);
      addInto(o, synth(0.04, { freq: 420 + rng() * 120, partials: [[1, 1], [2.3, 0.3]], decay: 60, a: 0.001, r: 0.015 }), t, g * 0.22);
      t += 0.075 + rng() * 0.02; k++;
    }
    return o;
  },
  grabble_snatch(rng) {
    const o = buf(1.0);
    const env = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.3)), 1.3);
    addInto(o, shape(svf(noiseBuf(0.3, rng), 'bp', (t) => 600 + 3000 * env(t), 1.0), env), 0, 0.85);
    addInto(o, click(rng, 2600, 0.01), 0.28, 0.5);
    addInto(o, inst.glock(hz('G6'), 0.4, 7), 0.3, 0.32);
    addInto(o, inst.glock(hz('C7'), 0.5, 6), 0.4, 0.25);
    addInto(o, inst.bassoon(hz('D3'), 0.1), 0.52, 0.25);
    addInto(o, inst.bassoon(hz('C3'), 0.18), 0.64, 0.25);
    return o;
  },
  loot_spill(rng) {
    const o = buf(1.9);
    addInto(o, shape(svf(noiseBuf(0.35, rng), 'bp', 2200, 0.8), (t) => Math.min(1, t / 0.02) * Math.exp(-t * 9)), 0, 0.3);
    let t = 0.04;
    while (t < 1.5) {
      const g = (0.25 + rng() * 0.55) * Math.max(0.15, 1 - t / 1.7);
      if (rng() > 0.35) {
        const f = 2300 + rng() * 2400;
        addInto(o, synth(0.12, { freq: f, partials: [[1, 1, 1], [2.76, 0.5, 1.5], [5.4, 0.3, 2.5]], decay: 28, a: 0.001, r: 0.03 }), t, g * 0.45);
        addInto(o, click(rng, 3500, 0.005), t, g * 0.25);
      } else {
        addInto(o, inst.glock(pentHz(Math.floor(rng() * 10), 6), 0.35, 9), t, g * 0.4);
      }
      t += 0.012 + rng() * 0.07 * (1 + t * 1.2);
    }
    return o;
  },
  countdown_beep(rng) {
    const o = buf(0.5);
    addInto(o, synth(0.28, { freq: 880, partials: [[1, 1], [3, 0.3], [5, 0.15]], decay: 3, a: 0.004, r: 0.08 }), 0, 0.7);
    addInto(o, synth(0.28, { freq: 1320, partials: [[1, 1]], decay: 3, a: 0.004, r: 0.08 }), 0, 0.12);
    addInto(o, click(rng, 3000, 0.005), 0, 0.2);
    return o;
  },
  mini_win_jingle(rng) {
    const o = buf(2.0);
    [['C5', 0, 0.2], ['E5', 0.17, 0.2], ['G5', 0.34, 0.2], ['C6', 0.51, 0.7]].forEach(([n, t, d]) => {
      addInto(o, inst.glock(hz(n), d + 0.3, 3.6), t, 0.42);
      addInto(o, inst.pluck(hz(n) * 0.5, d, 6), t, 0.2);
    });
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => addInto(o, inst.bell(hz(n), 0.9, 2.8), 0.56 + i * 0.04, 0.28));
    ['C4', 'E4', 'G4'].forEach((n) => addInto(o, inst.pad(hz(n), 0.7, 0.1, 0.4), 0.54, 0.15));
    addInto(o, shape(svf(noiseBuf(0.9, rng), 'hp', 6000), (t) => Math.exp(-t * 4)), 0.55, 0.06);
    return o;
  },
  mini_lose_jingle(rng) {
    const o = buf(1.6);
    [['E5', 0, 0.2], ['D5', 0.22, 0.2], ['C5', 0.44, 0.2], ['A4', 0.66, 0.5]].forEach(([n, t, d], i) => {
      addInto(o, inst.musicBox(hz(n), d + 0.2, 4), t, 0.4);
      addInto(o, inst.pluck(hz(n) * 0.5, d, 6), t, 0.18);
    });
    addInto(o, formants(inst.brass(hz('A3'), 0.4), [[500, 3, 0.9], [900, 3, 0.4]], 0.1), 0.66, 0.16);
    return o;
  },
  marble_roll(rng) {
    const o = buf(2.4);
    const n = noiseBuf(2.2, rng);
    const roll = svf(n, 'lp', (t) => 500 + 450 * Math.sin(TAU * 0.9 * t), 0.9);
    addInto(o, shape(roll, (t) => Math.min(1, t / 0.25) * Math.min(1, (2.2 - t) / 0.35) * (0.55 + 0.45 * Math.sin(TAU * 13 * t))), 0, 0.7);
    addInto(o, shape(svf(noiseBuf(2.2, rng), 'bp', 2600, 1.6), (t) => Math.min(1, t / 0.25) * Math.min(1, (2.2 - t) / 0.35) * (0.3 + 0.7 * Math.max(0, Math.sin(TAU * 6.5 * t)))), 0, 0.12);
    let t = 0.2;
    while (t < 2.0) {
      addInto(o, click(rng, 3000 + rng() * 1500, 0.006), t, 0.15 + rng() * 0.2);
      t += 0.12 + rng() * 0.2;
    }
    return o;
  },
  bucket_tip(rng) {
    const o = buf(1.4);
    addInto(o, shape(svf(noiseBuf(0.4, rng), 'bp', (t) => 300 + 250 * t / 0.4, 3), (t) => Math.min(1, t / 0.08) * (0.6 + 0.4 * Math.sin(TAU * 17 * t)) * Math.max(0, 1 - t / 0.4)), 0, 0.3);
    addInto(o, thump(170, 80, 14, 0.25), 0.4, 0.9);
    addInto(o, synth(0.35, { freq: 240, partials: [[1, 1, 1], [2.32, 0.6, 1.3], [3.9, 0.4, 2]], decay: 9, a: 0.001, r: 0.05 }), 0.4, 0.35);
    let t = 0.5;
    while (t < 1.25) {
      const g = 0.5 * Math.max(0.1, 1 - (t - 0.5) / 0.9);
      addInto(o, synth(0.06, { freq: 1500 + rng() * 1800, partials: [[1, 1], [2.4, 0.4]], decay: 40, a: 0.001, r: 0.02 }), t, g * (0.4 + rng() * 0.6));
      addInto(o, click(rng, 3200, 0.005), t, g * 0.3);
      t += 0.02 + rng() * 0.06;
    }
    return o;
  },
  rope_tug(rng) {
    const o = buf(1.1);
    addInto(o, shape(svf(noiseBuf(0.55, rng), 'bp', (t) => 700 + 700 * t / 0.55, 3), (t) => Math.min(1, t / 0.08) * (0.55 + 0.45 * Math.sin(TAU * 26 * t)) * Math.min(1, (0.55 - t) / 0.08)), 0, 0.45);
    addInto(o, synth(0.55, { freq: 110, glide: { to: 190, time: 0.55, ease: 'lin' }, partials: harm(6, 1), a: 0.05, r: 0.08, trem: { rate: 28, depth: 0.5 } }), 0, 0.1);
    addInto(o, synth(0.5, { freq: 420, glide: { to: 360, time: 0.4 }, partials: [[1, 1], [2.01, 0.5], [3.02, 0.25]], decay: 7, a: 0.002, r: 0.08, vib: { rate: 32, depth: 0.02, delay: 0.01 } }), 0.55, 0.4);
    addInto(o, click(rng, 2000, 0.01), 0.55, 0.4);
    return o;
  },
};

/* ------------------------------------------------------------------ */
/* Music (stereo)                                                      */
/* ------------------------------------------------------------------ */

const CHORDS = {
  C: { root: 36, pad: [60, 64, 67] },
  G: { root: 43, pad: [59, 62, 67] },
  Am: { root: 45, pad: [60, 64, 69] },
  F: { root: 41, pad: [60, 65, 69] },
};
const PROG = ['C', 'G', 'Am', 'F'];

/** parse "E5:1 G5:.5 ... | ..." into [{f, t, d}] in beats; R = rest */
function parsePhrase(str) {
  const ev = [];
  let beat = 0;
  for (const bar of str.split('|')) {
    for (const tok of bar.trim().split(/\s+/)) {
      if (!tok) continue;
      const [n, d] = tok.split(':');
      const dur = parseFloat(d);
      if (n !== 'R') ev.push({ f: hz(n), t: beat, d: dur });
      beat += dur;
    }
  }
  return ev;
}

const PH = {
  // lobby lullaby (slow)
  LA: 'E5:1.5 D5:.5 C5:1 D5:1 | E5:1 G5:1 D5:2 | C5:1.5 E5:.5 A4:1 C5:1 | C5:1 A4:1 G4:2',
  LB: 'G5:1.5 E5:.5 G5:1 A5:1 | G5:1 E5:1 D5:2 | A5:1.5 G5:.5 E5:1 D5:1 | C5:1 A4:1 C5:2',
  // play (bouncy)
  A: 'E5:1 G5:.5 E5:.5 D5:.5 C5:.5 D5:1 | D5:1 G5:1 E5:.5 D5:.5 D5:1 | E5:1 A5:.5 G5:.5 E5:1 C5:1 | A4:1 C5:1 D5:1 C5:1',
  B: 'G5:1 E5:.5 G5:.5 A5:1 G5:1 | G5:1 D5:1 E5:.5 D5:.5 G4:1 | A5:1 G5:.5 E5:.5 C6:1 A5:1 | A5:1 G5:1 E5:1 C5:1',
  C: 'C5:.5 E5:.5 G5:.5 E5:.5 G5:1 A5:1 | G5:.5 E5:.5 D5:.5 E5:.5 G5:2 | A5:.5 C6:.5 A5:.5 G5:.5 E5:1 G5:1 | A5:1 G5:.5 E5:.5 D5:1 C5:1',
};

/** render a music track by schedule function; handles reverb + loop folding */
function musicTrack(totalSec, loopSec, build, rvb) {
  const tail = loopSec ? 3.2 : 0;
  const t = new Track(totalSec + tail, true);
  build(t);
  reverb(t.L, t.R, rvb);
  if (loopSec) {
    const N = Math.round(loopSec * SR);
    for (let i = 0; i < t.n - N; i++) { t.L[i] += t.L[N + i]; t.R[i] += t.R[N + i]; }
    const L = t.L.slice(0, N), R = t.R.slice(0, N);
    const o = new Track(loopSec, true); o.L = L; o.R = R; o.n = N;
    return o;
  }
  return t;
}

function placePhrase(t, phrase, startSec, spb, fn) {
  for (const e of parsePhrase(phrase)) fn(e.f, startSec + e.t * spb, e.d * spb, e);
}

const MUSIC = {
  music_lobby(rng, spec) {
    const bpm = 76, spb = 60 / bpm, bar = 4 * spb;
    const bars = Math.max(8, Math.round(((spec.seconds || 48) / bar) / 4) * 4);
    const total = bars * bar;
    return musicTrack(total, total, (t) => {
      for (let b = 0; b < bars; b++) {
        const c = CHORDS[PROG[b % 4]];
        const t0 = b * bar;
        c.pad.forEach((m, i) => t.add(inst.pad(mtof(m), bar * 0.95, 0.5, 0.9), t0, 0.12, -0.35 + i * 0.35));
        t.add(inst.bass(mtof(c.root + 12), bar * 0.6), t0, 0.22, 0);
        // gentle arpeggio, music box
        const ar = [c.pad[0], c.pad[1], c.pad[2], c.pad[1]];
        for (let i = 0; i < 8; i++) t.add(inst.musicBox(mtof(ar[i % 4] + 12 * (i % 2 === 0 ? 0 : 0)), spb * 1.2, 4.5), t0 + i * spb * 0.5, 0.075, 0.3 * (i % 2 ? 1 : -1));
      }
      const seq = ['LA', 'LB', 'LA', 'LB'];
      for (let p = 0; p < bars / 4; p++) {
        const ph = seq[p % 4];
        placePhrase(t, PH[ph], p * 4 * bar, spb, (f, st, d) => {
          t.add(inst.musicBox(f, d + 0.1, 3.2), st, 0.34, 0.1);
          if (p % 4 >= 2) t.add(inst.musicBox(f * 2, d + 0.1, 5), st + 0.03, 0.1, -0.2);
        });
      }
    }, { mix: 0.28, fb: 0.84, damp: 0.3 });
  },

  music_play(rng, spec) {
    const bpm = 112, spb = 60 / bpm, bar = 4 * spb;
    const bars = Math.max(16, Math.round(((spec.seconds || 64) / bar) / 4) * 4);
    const total = bars * bar;
    return musicTrack(total, total, (t) => {
      for (let b = 0; b < bars; b++) {
        const c = CHORDS[PROG[b % 4]];
        const t0 = b * bar;
        const sec = Math.floor(b / 8); // 0..
        t.add(inst.pluck(mtof(c.root + 12), 0.3, 7), t0, 0.35, -0.1);
        t.add(inst.pluck(mtof(c.root + 19), 0.3, 7), t0 + spb, 0.22, -0.1);
        t.add(inst.pluck(mtof(c.root + 12), 0.3, 7), t0 + 2 * spb, 0.3, -0.1);
        t.add(inst.pluck(mtof(c.root + 19), 0.3, 7), t0 + 3 * spb, 0.22, -0.1);
        [1, 3].forEach((beat) => c.pad.forEach((m, i) => t.add(inst.pluck(mtof(m), 0.22, 11), t0 + beat * spb + (i * 0.008), 0.12, -0.4 + 0.4 * i)));
        t.add(inst.kick(100), t0, 0.28, 0);
        t.add(inst.kick(100), t0 + 2 * spb, 0.2, 0);
        for (let i = 0; i < 8; i++) t.add(inst.shaker(rng), t0 + i * spb * 0.5, i % 2 ? 0.2 : 0.1, 0.3);
        t.add(inst.wood(1000, 0.1), t0 + 3.5 * spb, 0.15, 0.4);
        if (sec >= 1) for (const m of c.pad) t.add(inst.glock(mtof(m + 24), 0.5, 5), t0 + 2.5 * spb, 0.06, 0.4);
      }
      const seq = ['A', 'B', 'C', 'A'];
      for (let p = 0; p < bars / 4; p++) {
        const ph = seq[p % 4];
        const sec = Math.floor(p / 2);
        placePhrase(t, PH[ph], p * 4 * bar, spb, (f, st, d) => {
          if (sec % 2 === 0) t.add(inst.flute(f, d * 0.95, rng), st, 0.3, -0.15);
          else { t.add(inst.glock(f * 2 > 3000 ? f : f * 1, d + 0.2, 4), st, 0.3, 0.2); t.add(inst.flute(f, d * 0.95, rng), st, 0.14, -0.25); }
          if (p % 4 === 3) t.add(inst.glock(f * 2, d, 6), st + 0.01, 0.1, 0.35);
        });
      }
    }, { mix: 0.16, fb: 0.78, damp: 0.35 });
  },

  music_catcher(rng, spec) {
    const hitAt = 16.0;
    const total = hitAt + 3.4;
    const t = new Track(total, true);
    // ticking, accelerating
    let k = 0, tt = 0.3;
    while (tt < hitAt - 0.3) {
      const prog = tt / hitAt;
      t.add(inst.wood(k % 2 ? 900 : 1300, 0.1), tt, 0.14 + 0.38 * prog, k % 2 ? -0.25 : 0.25);
      tt += 0.5 - 0.4 * Math.pow(prog, 1.4); k++;
    }
    // rising pad / drone
    t.add(synth(hitAt, { freq: 130.8, partials: [[1, 1], [1.5, 0.5], [2, 0.2]], a: 3, r: 0.3 }), 0, 0.09, 0);
    t.add(synth(hitAt, { freq: 200, glide: { to: 900, time: hitAt - 1, ease: 'lin' }, partials: [[1, 1], [2, 0.15]], a: 4, r: 0.3, trem: { rate: 6, depth: 0.55 } }), 0, 0.1, 0);
    // pizzicato ascending pentatonic riff
    const bpm = 120, spb = 60 / bpm;
    let step = 0;
    for (let b = 0; b * spb < hitAt - 0.5; b++) {
      const tb = 0.5 + b * spb;
      if (tb > hitAt - 0.6) break;
      const base = Math.floor(b / 4) * 1.5;
      for (let i = 0; i < (b < 12 ? 2 : 4); i++) {
        const idx = Math.floor(base) + [0, 2, 1, 3][(step++) % 4];
        t.add(inst.pluck(pentHz(idx, 4), 0.2, 10), tb + i * spb / (b < 12 ? 2 : 4), 0.14 + 0.18 * (tb / hitAt), (i % 2 ? 0.3 : -0.3));
      }
    }
    // riser noise
    const rn = shape(svf(noiseBuf(hitAt - 6, rng), 'hp', (x) => 500 + 6500 * Math.pow(x / (hitAt - 6), 1.5), 0.9), (x) => Math.pow(x / (hitAt - 6), 2.2));
    t.add(rn, 6, 0.28, 0);
    // quick glitter run into the hit
    for (let i = 0; i < 14; i++) t.add(inst.glock(pentHz(i + 5, 5), 0.3, 8), hitAt - 0.62 + i * 0.044, 0.1 + i * 0.012, -0.5 + i / 14);
    // the big sparkly magical hit
    t.add(synth(1.4, { freq: 95, glide: { to: 45, time: 1.0 }, partials: [[1, 1], [2, 0.3]], decay: 2.2, a: 0.004, r: 0.3 }), hitAt, 0.55, 0);
    ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'].forEach((n, i) => {
      t.add(inst.bell(hz(n), 2.6, 1.4), hitAt + i * 0.012, 0.22, -0.6 + i * 0.2);
      t.add(inst.glock(hz(n), 1.6, 1.8), hitAt + i * 0.012, 0.16, -0.6 + i * 0.2);
    });
    ['C4', 'G4', 'E5'].forEach((n) => t.add(inst.brass(hz(n), 1.2), hitAt, 0.2, 0));
    t.add(shape(svf(noiseBuf(2.8, rng), 'hp', 5200), (x) => Math.exp(-x * 1.8) * Math.min(1, x / 0.01)), hitAt, 0.16, 0);
    for (let i = 0; i < 26; i++) t.add(inst.glock(pentHz(Math.floor(rng() * 10) + 4, 6), 0.4, 6), hitAt + 0.15 + rng() * 2.2, 0.05 + rng() * 0.07, rng() * 2 - 1);
    reverb(t.L, t.R, { mix: 0.22, fb: 0.8, damp: 0.3 });
    return t;
  },

  music_victory(rng, spec) {
    const bpm = 120, spb = 0.5, bar = 2;
    const bars = 12;
    const total = bars * bar;
    const t = new Track(total + 3.5, true);
    const progOf = (b) => (b < 8 ? PROG[b % 4] : ['F', 'G', 'C', 'C'][b - 8]);
    for (let b = 0; b < bars; b++) {
      if (b === bars - 1) continue; // bar 10 holds the final chord through bar 11
      const c = CHORDS[progOf(b)];
      const t0 = b * bar;
      const last = b >= 10;
      t.add(inst.pluck(mtof(c.root + 12), 0.28, 7), t0, 0.38, 0);
      if (!last) {
        t.add(inst.pluck(mtof(c.root + 19), 0.28, 7), t0 + spb, 0.25, 0);
        t.add(inst.pluck(mtof(c.root + 12), 0.28, 7), t0 + 2 * spb, 0.3, 0);
        t.add(inst.pluck(mtof(c.root + 19), 0.28, 7), t0 + 3 * spb, 0.25, 0);
        [1, 3].forEach((beat) => c.pad.forEach((m, i) => t.add(inst.pluck(mtof(m), 0.2, 11), t0 + beat * spb + i * 0.008, 0.11, -0.4 + 0.4 * i)));
        for (let i = 0; i < 8; i++) t.add(inst.shaker(rng), t0 + i * spb * 0.5, i % 2 ? 0.22 : 0.1, 0.3);
        // party clap on 2 and 4
        [1, 3].forEach((beat) => t.add(shape(svf(noiseBuf(0.07, rng), 'bp', 1500, 1), (x) => Math.exp(-x * 45)), t0 + beat * spb, 0.2, 0));
        t.add(inst.kick(100), t0, 0.3, 0);
        t.add(inst.kick(100), t0 + 2 * spb, 0.22, 0);
      }
      c.pad.forEach((m, i) => t.add(inst.choir(mtof(m + 12), (last ? 4 : 2) * 0.97, rng), t0, 0.1, -0.4 + 0.4 * i));
      if (!last || b === 10) c.pad.forEach((m, i) => t.add(inst.pad(mtof(m), last ? 4.4 : 2, 0.3, 0.6), t0, 0.08, -0.3 + 0.3 * i));
    }
    // melody: bells + flute
    const mel = (ph, startBar, octShift, g) => placePhrase(t, PH[ph], startBar * bar, spb, (f, st, d) => {
      t.add(inst.glock(f * octShift, d + 0.25, 3.2), st, g, 0.2);
      t.add(inst.flute(f, d * 0.95, rng), st, g * 0.6, -0.2);
    });
    mel('C', 0, 1, 0.3);
    mel('B', 4, 1, 0.3);
    placePhrase(t, 'A5:1 G5:1 E5:1 C6:1 | D6:1 C6:1 A5:1 G5:1', 8 * bar, spb, (f, st, d) => { t.add(inst.glock(f, d + 0.3, 3), st, 0.32, 0.2); t.add(inst.flute(f, d, rng), st, 0.18, -0.2); });
    // finale
    const fin = 10 * bar;
    ['C6', 'E6', 'G6', 'C7', 'E7', 'G6', 'C7', 'E7', 'G7'].forEach((n, i) => t.add(inst.glock(hz(n), 1.5, 2.2), fin + i * 0.1, 0.3, -0.5 + i / 9));
    ['C5', 'E5', 'G5', 'C6'].forEach((n) => t.add(inst.bell(hz(n), 3.0, 1.2), fin, 0.2, 0));
    ['C4', 'G4', 'E5'].forEach((n) => t.add(inst.brass(hz(n), 1.0), fin, 0.18, 0));
    t.add(shape(svf(noiseBuf(3.2, rng), 'hp', 5000), (x) => Math.exp(-x * 1.4) * Math.min(1, x / 0.01)), fin, 0.15, 0);
    for (let i = 0; i < 20; i++) t.add(inst.glock(pentHz(Math.floor(rng() * 10) + 4, 6), 0.4, 6), fin + 0.5 + rng() * 2.6, 0.05 + rng() * 0.06, rng() * 2 - 1);
    reverb(t.L, t.R, { mix: 0.2, fb: 0.8, damp: 0.3 });
    return t;
  },

  music_sting_grabble(rng, spec) {
    const t = new Track(4.0, true);
    // tip-toe pizzicato steps (chromatic climb)
    [['Eb3', 0], ['E3', 0.3], ['F3', 0.6], ['F#3', 0.9]].forEach(([n, st], i) => {
      t.add(inst.pluck(hz(n), 0.18, 12), st, 0.45, -0.3 + 0.2 * i);
      t.add(inst.pluck(hz(n) * 2, 0.12, 16), st + 0.002, 0.14, -0.1 + 0.2 * i);
    });
    // sneaky bassoon answer
    [['Bb2', 1.3, 0.16], ['Bb2', 1.55, 0.16], ['Eb3', 1.8, 0.5]].forEach(([n, st, d]) => t.add(inst.bassoon(hz(n), d), st, 0.5, 0.1));
    // mischievous closing sting
    ['Eb4', 'Gb4', 'Bb4'].forEach((n, i) => t.add(inst.pluck(hz(n), 0.4, 6), 2.3 + i * 0.012, 0.28, -0.3 + 0.3 * i));
    t.add(inst.bassoon(hz('Eb2'), 0.7), 2.3, 0.55, 0);
    t.add(inst.wood(1000, 0.1), 2.3, 0.2, 0.3);
    reverb(t.L, t.R, { mix: 0.12, fb: 0.7, damp: 0.4 });
    return t;
  },
};

/** spoken-line stand-in: one soft marimba note per word. Only used if TTS is unavailable. */
function voiceStub(text, role, rng) {
  const words = text.split(/\s+/).filter(Boolean);
  const base = { narrator: 0, kyah: 5, ayva: 7, grabble: -12, benny: -5, misssuds: 3 }[role] ?? 0;
  const step = 0.24;
  const o = buf(Math.max(0.7, words.length * step + 0.5));
  words.forEach((w, i) => {
    const idx = (hashStr(w) % 5) + base;
    const f = hz('C5') * Math.pow(2, ((PENT_SEMI[((idx % 5) + 5) % 5] + 12 * Math.floor(idx / 5))) / 12);
    addInto(o, synth(0.2, { freq: f, partials: [[1, 1], [2, 0.2, 2], [3.9, 0.06, 4]], decay: 7, a: 0.004, r: 0.08 }), i * step, 0.5);
  });
  return o;
}
const PENT_SEMI = [0, 2, 4, 7, 9];

/* ------------------------------------------------------------------ */
/* Rendering entry points                                              */
/* ------------------------------------------------------------------ */

/** @returns {{channels: Float32Array[]}} */
export function synthKey(kind, key, spec = {}) {
  const rng = mulberry32(hashStr(kind + ':' + key));
  if (kind === 'sfx') {
    const fn = SFX[key];
    if (!fn) throw new Error('no fallback sfx recipe for ' + key);
    return { channels: [fn(rng)] };
  }
  if (kind === 'music') {
    const fn = MUSIC[key];
    if (!fn) throw new Error('no fallback music recipe for ' + key);
    return { channels: fn(rng, spec).channels() };
  }
  if (kind === 'voice') {
    return { channels: [voiceStub(spec.text || key, spec.role || 'narrator', rng)] };
  }
  throw new Error('unknown kind ' + kind);
}

export const SFX_KEYS = Object.keys(SFX);
export const MUSIC_KEYS = Object.keys(MUSIC);

/* ------------------------------------------------------------------ */
/* ffmpeg post-process                                                 */
/* ------------------------------------------------------------------ */

async function ffmpeg(args, opts = {}) {
  try {
    return await execFileP(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], { maxBuffer: 1 << 28, ...opts });
  } catch (e) {
    throw new Error('ffmpeg failed: ' + String(e.stderr || e.message).split('\n').slice(-8).join('\n'));
  }
}

export async function probeDuration(file) {
  const { stdout } = await execFileP(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(stdout.trim());
}

async function decodeF32(file) {
  const { stdout } = await execFileP(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { encoding: 'buffer', maxBuffer: 1 << 29 });
  const f = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4));
  const n = Math.floor(f.length / 2);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return [L, R];
}

/** 32-bit float WAV: lossless hand-off between stages (no normalisation, no 16-bit quantisation). */
function writeWavF32(file, channels) {
  const n = channels[0].length, nc = channels.length;
  const data = Buffer.alloc(n * nc * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) data.writeFloatLE(channels[c][i], (i * nc + c) * 4);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(nc, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * nc * 4, 28); h.writeUInt16LE(nc * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/* ------------------------------ seamless music loops ------------------------------ */

/** Musical grid of the generated loops. Measured on the cached ElevenLabs tracks: the onset-envelope autocorrelation
 *  peaks at exactly 10.00 / 20.00 / 30.00 / 40.00 s, i.e. a rock-steady 120 BPM, and the accent profile is 4/4 (bar = 2.0 s). */
export const LOOP_GRID = { music_lobby: { bpm: 120, beatsPerBar: 4 }, music_play: { bpm: 120, beatsPerBar: 4 } };
const DEFAULT_GRID = { bpm: 120, beatsPerBar: 4 };

const meanPowerDb = (chs, from, to) => {
  let s = 0, c = 0;
  for (const ch of chs) for (let i = from; i < to; i++) { s += ch[i] * ch[i]; c++; }
  return 10 * Math.log10(Math.max(s / c, 1e-12));
};

/**
 * Build a seamless loop from a raw track: the last `x` seconds are crossfaded (equal power) into the first `x` seconds and the
 * file is cut to the loop length, so the loop's last sample is followed by the raw sample that came next in the original
 * recording (continuous by construction: no fade, no gap, no click). To keep the crossfaded tail and head on the same beat
 * AND bar position the loop length is a whole number of bars (the longest that fits), and the start offset inside the raw
 * (less than one bar of slack) is chosen so the join lands where the 100 ms level before and after it match and the first
 * sample is near zero. 20 ms edge fades are added only if that first/last sample is still not near zero.
 */
function buildLoop([L, R], key, x) {
  const grid = LOOP_GRID[key] || DEFAULT_GRID;
  const barS = Math.round((60 / grid.bpm) * grid.beatsPerBar * SR);
  const xs = Math.round(x * SR), n = L.length;
  const bars = Math.max(1, Math.floor((n - xs) / barS));
  const loopS = bars * barS;
  const slack = n - xs - loopS; // samples of the raw we may skip at the start
  const chs = [L, R];
  const w = Math.round(0.1 * SR), w10 = Math.round(0.01 * SR);
  const gain = (i) => { const p = i / xs; return [Math.sin(p * Math.PI / 2), Math.cos(p * Math.PI / 2)]; };
  // output sample k (< xs) for start offset s: head fades in, tail (what followed the loop end in the raw) fades out
  const outAt = (ch, s, k) => { const [a, b] = gain(k); return ch[s + k] * a + ch[s + loopS + k] * b; };
  const winDb = (s, from, len) => { // level of output window [from, from+len) around the join, from<0 = end of the loop
    let acc = 0, c = 0;
    for (const ch of chs) for (let k = from; k < from + len; k++) { const v = k < 0 ? ch[s + loopS + k] : outAt(ch, s, k); acc += v * v; c++; }
    return 10 * Math.log10(Math.max(acc / c, 1e-12));
  };
  let best = null;
  for (let s = 0; s <= slack; s += w10) {
    const step = winDb(s, 0, w) - winDb(s, -w, w);
    let jump = 0, prev = null;
    for (let k = -5; k < 5; k++) { const d = winDb(s, k * w10, w10); if (prev !== null) jump = Math.max(jump, Math.abs(d - prev)); prev = d; }
    const first = Math.max(Math.abs(outAt(L, s, 0)), Math.abs(outAt(R, s, 0)));
    const cost = Math.abs(step) + 0.25 * jump + 20 * first;
    if (!best || cost < best.cost) best = { s, step, jump, first, cost };
  }
  // refine: within +-10 ms pick the sample where both channels are closest to a zero crossing (quiet, click-free first play)
  let s0 = best.s, bestZ = Infinity;
  for (let s = Math.max(0, best.s - w10); s <= Math.min(slack, best.s + w10); s++) {
    const z = Math.abs(outAt(L, s, 0)) + Math.abs(outAt(R, s, 0));
    if (z < bestZ) { bestZ = z; s0 = s; }
  }
  const out = [L, R].map((ch) => {
    const o = new Float32Array(loopS);
    for (let i = 0; i < loopS; i++) o[i] = ch[s0 + i];
    for (let i = 0; i < xs; i++) o[i] = outAt(ch, s0, i);
    return o;
  });
  const edge = Math.max(...out.map((o) => Math.max(Math.abs(o[0]), Math.abs(o[loopS - 1]))));
  return { channels: out, info: { bars, loopSeconds: loopS / SR, startOffset: s0 / SR, edge, fadeMs: edge > 0.02 ? 20 : 0, step: best.step, jump: best.jump } };
}

/** Loop-join report for a decoded loop file: level of the 100 ms before the end vs the 100 ms after the start (what you get
 *  by concatenating the file with itself), the sample step across the join vs the normal sample-to-sample step. */
export async function loopSeam(file) {
  const [L, R] = await decodeF32(file);
  const n = L.length, w = Math.round(0.1 * SR), w10 = Math.round(0.01 * SR);
  const pre = meanPowerDb([L, R].map((c) => c.subarray(n - w)), 0, w);
  const post = meanPowerDb([L, R].map((c) => c.subarray(0, w)), 0, w);
  const d = (c, i, j) => Math.abs(c[j] - c[i]);
  const joinStep = Math.max(d(L, n - 1, 0), d(R, n - 1, 0));
  const steps = [];
  for (const c of [L, R]) for (let i = 1; i < Math.min(n, SR); i++) steps.push(d(c, i - 1, i));
  steps.sort((a, b) => a - b);
  const p999 = steps[Math.floor(steps.length * 0.999)];
  const around = [];
  for (let k = -5; k < 5; k++) around.push(k < 0 ? meanPowerDb([L, R].map((c) => c.subarray(n + k * w10, n + (k + 1) * w10)), 0, w10) : meanPowerDb([L, R].map((c) => c.subarray(k * w10, (k + 1) * w10)), 0, w10));
  return { seconds: n / SR, preDb: pre, postDb: post, stepDb: post - pre, joinStep, p999Step: p999, clickRatio: joinStep / Math.max(p999, 1e-9), first: Math.max(Math.abs(L[0]), Math.abs(R[0])), last: Math.max(Math.abs(L[n - 1]), Math.abs(R[n - 1])), around };
}

/* ------------------------------ extending a cue by repeating bar-aligned slices ------------------------------ */

/**
 * Re-cut a raw cue as a playlist of slices of itself: `plan` = [[startSec, endSec|null], ...] (null = to the end of the raw).
 * Between consecutive slices the cue "jumps" from raw time e (end of slice i) to raw time s (start of slice i+1); the jump must be a
 * whole number of bars (e - s = k * bar) so the beat and bar position are unchanged. At each jump the music keeps playing past e
 * (the true continuation) while fading out with an equal-power curve, and slice i+1 fades in over `x` seconds, so the join is a
 * crossfade between two bar-aligned passages with no click and no level step.
 */
export const joinTimes = (plan) => { let t = 0; const out = []; for (let i = 0; i < plan.length - 1; i++) { t += plan[i][1] - plan[i][0]; out.push(t); } return out; };

function buildExtended([L, R], plan, x, bar, snap = 0) {
  const xs = Math.round(x * SR), n = L.length, chs = [L, R];
  const w = Math.round(0.1 * SR), w10 = Math.round(0.01 * SR);
  const segs = plan.map(([s, e]) => [Math.round(s * SR), e == null ? n : Math.round(e * SR)]);
  for (let i = 0; i < segs.length - 1; i++) {
    const jump = (segs[i][1] - segs[i + 1][0]) / SR;
    if (Math.abs(jump / bar - Math.round(jump / bar)) > 1e-6) throw new Error(`join ${i + 1} jumps ${jump.toFixed(3)} s, not a whole number of ${bar} s bars`);
  }
  // Slide each join by a common offset d (e and s both move by d, so the jump stays a whole number of bars and the total length is
  // unchanged) to the place where the 100 ms level before and after it match and there is no sudden 10 ms level jump: a tick or kick
  // attack right after the join would read as a level step even though it is the music's own rhythm.
  const blend = (ch, e, s, k) => { const p = (k / xs) * Math.PI / 2; return ch[s + k] * Math.sin(p) + ch[e + k] * Math.cos(p); };
  const winDb = (e, s, from, len) => { let acc = 0, c = 0; for (const ch of chs) for (let k = from; k < from + len; k++) { const v = k < 0 ? ch[e + k] : blend(ch, e, s, k); acc += v * v; c += 1; } return 10 * Math.log10(Math.max(acc / c, 1e-12)); };
  const joins = [];
  for (let i = 0; i < segs.length - 1; i++) {
    let best = { d: 0, cost: Infinity };
    if (snap > 0) {
      for (let d = -Math.round(snap * SR); d <= Math.round(snap * SR); d += w10) {
        const e = segs[i][1] + d, s = segs[i + 1][0] + d;
        if (e - w < segs[i][0] + xs || e + xs > n || s < 0 || segs[i + 1][1] - s < 2 * xs + Math.abs(d)) continue;
        const step = winDb(e, s, 0, w) - winDb(e, s, -w, w);
        let jump = 0, prev = null;
        for (let k = -5; k < 5; k++) { const dv = winDb(e, s, k * w10, w10); if (prev !== null) jump = Math.max(jump, Math.abs(dv - prev)); prev = dv; }
        const cost = Math.abs(step) + 0.25 * jump + 2 * Math.abs(d / SR);
        if (cost < best.cost) best = { d, cost, step, jump };
      }
      if (!Number.isFinite(best.cost)) best = { d: 0, cost: 0 };
    }
    segs[i][1] += best.d; segs[i + 1][0] += best.d;
    joins.push(best);
  }
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i][1] + xs > n || segs[i + 1][1] - segs[i + 1][0] < 2 * xs) throw new Error(`join ${i + 1}: slices too short for a ${x} s crossfade`);
  }
  const total = segs.reduce((a, [s, e]) => a + (e - s), 0);
  const out = chs.map((ch) => {
    const o = new Float32Array(total);
    let wpos = 0;
    segs.forEach(([s, e], i) => {
      for (let k = 0; k < e - s; k++) o[wpos + k] = ch[s + k];
      if (i > 0) for (let k = 0; k < xs; k++) o[wpos + k] = blend(ch, segs[i - 1][1], s, k); // previous slice's continuation fades out, this one fades in
      wpos += e - s;
    });
    return o;
  });
  let t = 0;
  const times = segs.slice(0, -1).map(([s, e]) => (t += (e - s) / SR));
  return { channels: out, info: { seconds: total / SR, joins: times, offsets: joins.map((j) => j.d / SR), plan: segs.map(([s, e]) => [+(s / SR).toFixed(3), +(e / SR).toFixed(3)]) } };
}

/** RMS of the 100 ms before and after time `t` (seconds) in a decoded file (a join, or any point), and the biggest 10 ms level jump within +-50 ms. */
export async function windowSeam(file, t) {
  const ch = await decodeF32(file);
  const i = Math.round(t * SR), w = Math.round(0.1 * SR), w10 = Math.round(0.01 * SR);
  const pre = meanPowerDb(ch.map((c) => c.subarray(i - w, i)), 0, w);
  const post = meanPowerDb(ch.map((c) => c.subarray(i, i + w)), 0, w);
  let jump = 0, prev = null;
  for (let k = -5; k < 5; k++) { const d = meanPowerDb(ch.map((c) => c.subarray(i + k * w10, i + (k + 1) * w10)), 0, w10); if (prev !== null) jump = Math.max(jump, Math.abs(d - prev)); prev = d; }
  return { t, preDb: pre, postDb: post, stepDb: post - pre, jump10ms: jump };
}

/** The loudest 100 ms (hop 10 ms) within the last `lastSec` seconds of a file, plus the level 1 s and 2 s after it (a build-up cue should end on its hit and ring out). */
export async function hitPosition(file, lastSec = 4) {
  const ch = await decodeF32(file);
  const n = ch[0].length, w = Math.round(0.1 * SR), hop = Math.round(0.01 * SR);
  let best = -Infinity, at = 0;
  for (let i = Math.max(0, n - Math.round(lastSec * SR)); i + w <= n; i += hop) { const d = meanPowerDb(ch.map((c) => c.subarray(i, i + w)), 0, w); if (d > best + 1e-9) { best = d; at = i; } }
  const after = (sec) => (at + Math.round(sec * SR) + w <= n ? meanPowerDb(ch.map((c) => c.subarray(at + Math.round(sec * SR), at + Math.round(sec * SR) + w)), 0, w) : -Infinity);
  return { seconds: n / SR, hitAt: at / SR, hitDb: best, fromEnd: n / SR - at / SR, after1s: after(1), after2s: after(2) };
}

/* ------------------------------ loudness measurement + mastering ------------------------------ */

const TP_CEIL = -1.5;            // dBTP ceiling for every clip
const TP_GOAL = TP_CEIL - 0.05;  // masters aim just under it (measurement resolution)
const LU_TOL = 0.2;              // mastering tolerance (the requirement is +-1 LU)
const dbLin = (db) => Math.pow(10, db / 20);
/** BS.1770 integrated loudness needs at least one 400 ms block: shorter clips are zero-padded to exactly 0.4 s (= one
 *  gating block), so their reading is the loudness of that block (max momentary loudness). */
const MIN_BLOCK = 0.4;

function parseEbur(stderr) {
  const s = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(s); return m ? parseFloat(m[1]) : NaN; };
  const I = num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/);
  return { I: Number.isFinite(I) ? I : -70, LRA: num(/LRA:\s+(-?[\d.]+)\s+LU/), TP: num(/Peak:\s+(-?[\d.]+)\s+dBFS/) };
}

/** integrated LUFS / LRA / true peak of `file` after the optional filter chain `pre` (measured with ffmpeg ebur128, peak=true).
 *  ebur128 prints the true peak to 0.1 dB only, so near the ceiling it is re-measured on a 4x oversampled copy (two decimals). */
export async function measureLoudness(file, pre = '') {
  const af = [pre, `apad=whole_dur=${MIN_BLOCK}`, 'ebur128=peak=true:framelog=quiet'].filter(Boolean).join(',');
  const { stderr } = await ffmpeg(['-i', file, '-af', af, '-f', 'null', '-']);
  const r = parseEbur(stderr);
  if (!(r.TP < -2.6)) {
    const { stderr: e2 } = await ffmpeg(['-i', file, '-af', [pre, `aresample=${SR * 4}`, 'astats=metadata=0:reset=0'].filter(Boolean).join(','), '-f', 'null', '-']);
    const pk = [...e2.matchAll(/Peak level dB:\s+(-?[\d.]+|-inf)/g)].map((x) => parseFloat(x[1]));
    if (pk.length && Number.isFinite(pk[pk.length - 1])) r.TP = pk[pk.length - 1];
  }
  return r;
}

/**
 * Master `trimmed` (float wav) into `outFile` (mp3 44.1k/128k) at the kind's LUFS target with true peak <= TP_CEIL.
 *
 * Pass 1 measures integrated loudness and true peak. Pass 2 applies an exact linear gain (what loudnorm's linear mode
 * does, but loudnorm never raises the gain past the true-peak ceiling, so peaky clips stalled 2-6 LU under target) followed
 * by a look-ahead peak limiter at the ceiling, and the gain is closed-loop corrected until the measured loudness is on
 * target. Peaky material first gets a gentle compressor (ratio 2, then 3, then 4) so the limiter only shaves what is left;
 * a recipe is accepted as soon as the target is reachable within its limiter budget. If even the strongest recipe cannot
 * get there (very short taps, snaps) the result is as close as that budget allows. The mp3 is then measured again after
 * encoding and nudged (gain and ceiling) so the delivered file is on target.
 */
async function masterToMp3(trimmed, outFile, kind, tmpBase, stem, tmpFiles) {
  const target = LUFS[kind];
  const lim = (ceil, A = 5, R = 60) => `alimiter=limit=${dbLin(ceil).toFixed(5)}:attack=${A}:release=${R}:level=disabled:latency=true`;
  const comp = (ratio, off) => (m) => `acompressor=threshold=${dbLin(Math.min(0, Math.max(-36, m.I + off))).toFixed(5)}:ratio=${ratio}:attack=4:release=70:makeup=1`;
  // Sub-sonic rumble (some generated sfx are mostly 15-40 Hz, e.g. vine_grab: 99.6% of its energy is below 40 Hz) adds peak but almost no
  // K-weighted loudness, and a limiter would then squash a 20 Hz wave into audible harmonics. For the peak-limited sfx recipes high-pass the
  // clip at 40/80/120 Hz, but only when that cuts the peak-to-loudness ratio by >= 1 dB (take the highest cutoff within 0.5 dB of the best).
  let rumbleMemo = null;
  const rumble = async (m, file) => {
    if (rumbleMemo !== null) return rumbleMemo;
    const cands = [];
    for (const f of [40, 80, 120]) { const r = await measureLoudness(file, `highpass=f=${f}`); cands.push([f, r.TP - r.I]); }
    const best = Math.min(...cands.map((c) => c[1]));
    const cut = m.TP - m.I - best >= 1 ? Math.max(...cands.filter((c) => c[1] <= best + 0.5).map((c) => c[0])) : 0;
    return (rumbleMemo = cut ? `highpass=f=${cut}` : '');
  };
  // [name, compressor builder, max peak reduction the limiter may apply (dB), limiter attack ms, release ms], gentlest first.
  // Peak-dominated sfx (snaps, ticks, thumps) gain almost nothing from a slow limiter, so the last sfx recipe uses a faster one.
  const recipes = kind === 'music'
    ? [['gain', null, 6, 5, 60]]
    : kind === 'voice'
      ? [['gain', null, 2.5, 5, 60], ['comp2', comp(2, 4), 3.5, 5, 60], ['comp3', comp(3, 3), 4.5, 5, 60], ['comp4', comp(4, 1), 6, 5, 60]]
      : [['gain', null, 2.5, 5, 60], ['comp2', comp(2, 4), 3.5, 5, 60], ['comp3', comp(3, 3), 4.5, 5, 60], ['limit6', rumble, 6, 5, 60], ['limit8', rumble, 9, 2, 30]];
  const chainOf = (pre, g, ceil, A = 5, R = 60) => [pre, `volume=${g.toFixed(3)}dB`, lim(ceil, A, R)].filter(Boolean).join(',');
  const CEIL0 = TP_CEIL + 0.05; // limiter sample-peak ceiling to start from (the final loop trims it so the mp3's true peak is just under TP_CEIL)

  const m0 = await measureLoudness(trimmed);
  const plans = [];
  for (const [name, build, cap, atk, rel] of recipes) {
    const pre = build ? await build(m0, trimmed) : '';
    const mp = build ? await measureLoudness(trimmed, pre) : m0;
    if (!(mp.I > -69.9)) continue;
    const ceil = CEIL0;
    const gHi = () => ceil - mp.TP + cap;
    let g = Math.min(target - mp.I, gHi()), gPrev = null, iPrev = null, e = null;
    for (let it = 0; it < 8; it++) {
      e = await measureLoudness(trimmed, chainOf(pre, g, ceil, atk, rel));
      if (Math.abs(e.I - target) <= LU_TOL / 2) break;
      if (g >= gHi() - 1e-6 && e.I < target) break; // out of limiter budget
      const slope = gPrev === null || Math.abs(g - gPrev) < 1e-3 ? 1 : Math.min(1.2, Math.max(0.15, (e.I - iPrev) / (g - gPrev)));
      gPrev = g; iPrev = e.I;
      g = Math.min(g + (target - e.I) / slope, gHi());
    }
    const plan = { name, pre, g, ceil, cap, atk, rel, mp, I: e.I, err: Math.abs(e.I - target), pr: Math.max(0, mp.TP + g - e.TP) };
    plan.reach = plan.err <= LU_TOL;
    if (process.env.AUDIO_DEBUG) console.error(`    [${stem}] ${name}: base I ${mp.I} TP ${mp.TP} -> g ${g.toFixed(2)} I ${e.I} TP ${e.TP} PR ${plan.pr.toFixed(1)} reach ${plan.reach}`);
    plans.push(plan);
    if (plan.reach) break;
  }
  if (!plans.length) { // nothing measurable: peak-limit only
    await ffmpeg(['-i', trimmed, '-af', `alimiter=limit=0.89:level=disabled:latency=true,aresample=${SR}`, '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', outFile]);
    return { recipe: 'fallback', loudness: null };
  }
  // first recipe that reaches the target; otherwise the one that gets closest (a stronger recipe is not always louder)
  const plan = plans.find((p) => p.reach) || plans.reduce((a, b) => (b.err < a.err - 0.3 ? b : a));

  // encode, measure the mp3 itself, nudge ceiling and gain so the delivered file is on target and its true peak sits just under
  // TP_CEIL. The closest result that respects the ceiling is kept (the limiter is non-linear, so the nudging can oscillate).
  const cand = path.join(tmpBase, stem + '.cand.mp3');
  const bestFile = path.join(tmpBase, stem + '.best.mp3');
  tmpFiles.push(cand, bestFile);
  const gMax = () => plan.ceil - plan.mp.TP + plan.cap + 1.25; // the cap picks the recipe; the final trim may exceed it a little (mp3 overshoot lowers the ceiling)
  let best = null;
  const seen = new Set();
  for (let pass = 0; pass < 16; pass++) {
    await ffmpeg(['-i', trimmed, '-af', chainOf(plan.pre, plan.g, plan.ceil, plan.atk, plan.rel), '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', cand]);
    const m = await measureLoudness(cand);
    const errI = m.I - target, over = m.TP - TP_GOAL;
    if (process.env.AUDIO_DEBUG) console.error(`    [${stem}] pass ${pass}: g ${plan.g.toFixed(2)} ceil ${plan.ceil.toFixed(2)} -> I ${m.I} TP ${m.TP}`);
    if (over <= 0 && (!best || Math.abs(errI) < best.err - 0.02)) { fs.copyFileSync(cand, bestFile); best = { err: Math.abs(errI), m, g: plan.g, ceil: plan.ceil }; }
    const atCap = plan.g >= gMax() - 1e-6;
    if (over <= 0 && (Math.abs(errI) <= LU_TOL / 2 || (errI < 0 && atCap && m.TP >= TP_GOAL - 0.25))) break;
    const key = `${plan.g.toFixed(2)}/${plan.ceil.toFixed(2)}`;
    if (seen.has(key) && best) break;
    seen.add(key);
    const engaged = plan.mp.TP + plan.g - m.TP > 0.3; // limiter is doing work: loudness grows slower than the gain
    if (over > 0) { plan.ceil -= over + 0.1; plan.g -= over * 0.5; } // mp3 + inter-sample overshoot: pull the limiter ceiling down
    else {
      if (errI < -LU_TOL / 2 && atCap) plan.ceil = Math.min(plan.ceil + (TP_GOAL - 0.1 - m.TP) * 0.5, -0.3); // out of budget but true-peak headroom left: use some of it
      plan.g = Math.min(plan.g - errI * (engaged ? 1.25 : 1) * (best && best.err > Math.abs(errI) + 0.02 ? 1 : 0.7), gMax());
    }
  }
  if (!best) throw new Error(`mastering ${stem}: could not get the true peak under ${TP_GOAL} dBTP`);
  fs.copyFileSync(bestFile, outFile);
  return { recipe: plan.name, gain: best.g, ceil: best.ceil, peakReduction: plan.pr, reach: plan.reach, loudness: best.m };
}

/**
 * Master `inFile` (any ffmpeg-readable audio) into `outFile` (mp3 44.1k/128k).
 * kind: voice | sfx | music. opts.loop: seamless loop prep. opts.crossfade: seconds of tail->head overlap (API loops).
 * opts.derive: { plan, crossfade, bar } re-cut `inFile` into a longer cue (see buildExtended) before mastering.
 * Returns { recipe, gain, peakReduction, loudness, loop } for reporting.
 */
export async function postProcess(inFile, outFile, { kind, loop = false, crossfade = 0, soften = false, derive = null } = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmpBase = path.join(RAW_DIR, '_tmp');
  fs.mkdirSync(tmpBase, { recursive: true });
  const key = path.basename(outFile, '.mp3');
  const stem = `${kind}_${key}`; // a voice line and an sfx can share a key
  let src = inFile;
  const tmpFiles = [];
  let loopInfo = null;

  if (derive) {
    const built = buildExtended(await decodeF32(inFile), derive.plan, derive.crossfade ?? 0.5, derive.bar ?? 2.0, derive.snap ?? 0);
    loopInfo = built.info;
    src = path.join(tmpBase, stem + '.derive.wav');
    writeWavF32(src, built.channels);
    tmpFiles.push(src);
  } else if (loop) {
    const ch = await decodeF32(inFile);
    if (crossfade > 0) {
      const built = buildLoop(ch, key, crossfade);
      loopInfo = built.info;
      src = path.join(tmpBase, stem + '.xfade.wav');
      writeWavF32(src, built.channels);
      tmpFiles.push(src);
    } else { // procedurally generated loop: periodic by construction
      const n = ch[0].length;
      const edge = Math.max(...ch.map((c) => Math.max(Math.abs(c[0]), Math.abs(c[n - 1]))));
      loopInfo = { edge, fadeMs: edge > 0.02 ? 20 : 0 };
    }
  }

  // silence trim (never for loops: their edges are where the crossfade put them), then micro fades
  const chain = [];
  if (loop) {
    if (loopInfo.fadeMs) chain.push(`afade=t=in:d=${loopInfo.fadeMs / 1000}`, 'areverse', `afade=t=in:d=${loopInfo.fadeMs / 1000}`, 'areverse');
  } else if (kind === 'music') {
    chain.push('silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02', 'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.25', 'afade=t=in:d=0.05', 'areverse', 'afade=t=in:d=0.005');
  } else {
    const thr = kind === 'voice' ? '-45dB' : '-52dB';
    const tailPad = kind === 'voice' ? 0.08 : 0.06;
    chain.push(`silenceremove=start_periods=1:start_threshold=${thr}:start_silence=0.01`, 'areverse', `silenceremove=start_periods=1:start_threshold=${thr}:start_silence=${tailPad}`, 'afade=t=in:d=0.03', 'areverse', 'afade=t=in:d=0.004');
  }
  if (soften) chain.push('lowpass=f=9500');

  const trimmed = path.join(tmpBase, stem + '.trim.wav');
  tmpFiles.push(trimmed);
  await ffmpeg(['-i', src, '-af', chain.length ? chain.join(',') : 'anull', '-ar', String(SR), '-c:a', 'pcm_f32le', trimmed]);
  let res;
  try { res = await masterToMp3(trimmed, outFile, kind, tmpBase, stem, tmpFiles); }
  finally { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } } }
  return { ...res, loop: loopInfo };
}

/** synth -> wav -> mp3. */
export async function renderFallback(kind, key, spec, outFile) {
  fs.mkdirSync(path.join(RAW_DIR, 'synth'), { recursive: true });
  const wav = path.join(RAW_DIR, 'synth', `${kind}_${key}.wav`);
  const { channels } = synthKey(kind, key, spec);
  writeWav(wav, channels, 0.85);
  await postProcess(wav, outFile, { kind, loop: kind === 'music' && !!spec.loop, soften: true });
  return outFile;
}

/* ------------------------------------------------------------------ */
/* manifest helpers (shared with gen-audio.mjs)                        */
/* ------------------------------------------------------------------ */

export function loadSpec() {
  return JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8'));
}
export const relPath = (kind, key) => `audio/${kind}/${key}.mp3`;
export const absPath = (kind, key) => path.join(AUDIO_DIR, kind, `${key}.mp3`);
export const hasFile = (kind, key) => { try { return fs.statSync(absPath(kind, key)).size > 0; } catch { return false; } };

export function allKeys(spec) {
  return [
    ...spec.voice.map((v) => ({ kind: 'voice', key: v.key, spec: v })),
    ...spec.sfx.map((s) => ({ kind: 'sfx', key: s.key, spec: s })),
    ...spec.music.map((m) => ({ kind: 'music', key: m.key, spec: m })),
  ];
}

/** Write public/assets/audio/manifest.json from the spec (only keys whose files exist). */
export function writeAudioManifest(spec) {
  const out = { voice: {}, sfx: {}, music: {} };
  for (const v of spec.voice) if (hasFile('voice', v.key)) out.voice[v.key] = relPath('voice', v.key);
  for (const s of spec.sfx) if (hasFile('sfx', s.key)) out.sfx[s.key] = relPath('sfx', s.key);
  for (const m of spec.music) if (hasFile('music', m.key)) out.music[m.key] = { src: relPath('music', m.key), loop: !!m.loop };
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUDIO_DIR, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const spec = loadSpec();
  const only = val('--keys') ? new Set(val('--keys').split(',')) : null;
  const testDir = val('--test-dir');
  const force = flag('--force');
  let made = 0;
  for (const { kind, key, spec: s } of allKeys(spec)) {
    if (only && !only.has(key)) continue;
    if (kind === 'voice' && !only && !flag('--voice')) continue; // voice stand-ins only on request
    const out = testDir ? path.join(testDir, kind, `${key}.mp3`) : absPath(kind, key);
    if (!testDir && !force && hasFile(kind, key)) continue;
    process.stdout.write(`synth ${kind}/${key} ... `);
    try {
      await renderFallback(kind, key, s, out);
      const d = await probeDuration(out);
      console.log(`${d.toFixed(2)}s`);
      made++;
    } catch (e) {
      console.log('FAILED: ' + e.message);
    }
  }
  console.log(`fallback made ${made} file(s)`);
  if (!testDir) writeAudioManifest(spec);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
