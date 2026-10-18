// Tiny synthesized UI sounds for the phone controller (WebAudio, no files).
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('kaa.muted') === '1'; } catch { /* ignore */ }

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('kaa.muted', muted ? '1' : '0'); } catch { /* ignore */ }
}

// Must be called from a user gesture at least once (iOS / Chrome autoplay rules).
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* ignore */ }
}

export function ready() { return !muted && ctx && ctx.state === 'running'; }

export function tone({ f = 440, t = 0, d = 0.15, type = 'sine', g = 0.2, to = null, a = 0.01 }) {
  if (!ready()) return;
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(g, t0 + a);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(gn); gn.connect(master);
  o.start(t0); o.stop(t0 + d + 0.05);
}

let noiseBuf = null;
export function noise({ t = 0, d = 0.1, g = 0.15, f = 1800, to = null, q = 1.2 }) {
  if (!ready()) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = q;
  bp.frequency.setValueAtTime(f, t0);
  if (to) bp.frequency.exponentialRampToValueAtTime(to, t0 + d);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(g, t0 + 0.015);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  src.connect(bp); bp.connect(gn); gn.connect(master);
  src.start(t0); src.stop(t0 + d + 0.05);
}

const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

export const sfx = {
  tap() { tone({ f: 520, to: 760, d: 0.09, type: 'sine', g: 0.18 }); },
  pick() { tone({ f: 600, to: 980, d: 0.12, type: 'triangle', g: 0.22 }); },
  error() { tone({ f: 260, d: 0.12, type: 'square', g: 0.08 }); tone({ f: 200, t: 0.13, d: 0.18, type: 'square', g: 0.08 }); },
  join() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone({ f, t: i * 0.09, d: 0.3, type: 'triangle', g: 0.2 })); },
  myTurn() {
    [N.G5, N.C6, N.E6].forEach((f, i) => {
      tone({ f, t: i * 0.13, d: 0.7, type: 'triangle', g: 0.22 });
      tone({ f: f * 2, t: i * 0.13, d: 0.35, type: 'sine', g: 0.06 });
    });
  },
  roll() {
    for (let i = 0; i < 7; i++) {
      noise({ t: i * 0.07, d: 0.06, g: 0.2, f: 900 + Math.random() * 2400, q: 3 });
      tone({ f: 180 + Math.random() * 140, t: i * 0.07, d: 0.05, type: 'square', g: 0.04 });
    }
  },
  shard() {
    tone({ f: N.G6, d: 0.5, type: 'sine', g: 0.22 });
    tone({ f: N.C7, t: 0.07, d: 0.55, type: 'sine', g: 0.18 });
    tone({ f: N.C7 * 1.5, t: 0.14, d: 0.4, type: 'sine', g: 0.08 });
  },
  lose() {
    tone({ f: 420, to: 190, d: 0.4, type: 'sawtooth', g: 0.07 });
    noise({ d: 0.3, g: 0.08, f: 2200, to: 500 });
  },
  whoosh() { noise({ d: 0.5, g: 0.2, f: 400, to: 3200, q: 0.8 }); },
  bell() {
    [1, 2.76, 5.4].forEach((m, i) => tone({ f: 880 * m, d: 1.1 / (i + 1), type: 'sine', g: 0.22 / (i + 1) }));
  },
  tick() { tone({ f: 900, d: 0.05, type: 'square', g: 0.06 }); },
  fanfare() {
    [[N.C5, 0], [N.E5, 0.14], [N.G5, 0.28], [N.C6, 0.42], [N.G5, 0.62], [N.C6, 0.76], [N.E6, 0.9], [N.G6, 1.1]]
      .forEach(([f, t]) => {
        tone({ f, t, d: 0.5, type: 'triangle', g: 0.24 });
        tone({ f: f / 2, t, d: 0.5, type: 'square', g: 0.04 });
      });
    [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => tone({ f, t: 1.3 + i * 0.02, d: 1.2, type: 'sine', g: 0.1 }));
  },
  star() { tone({ f: 1200, to: 1800, d: 0.15, type: 'sine', g: 0.15 }); },
  sad() { tone({ f: 392, to: 370, d: 0.38, type: 'triangle', g: 0.16 }); tone({ f: 349, to: 330, t: 0.4, d: 0.38, type: 'triangle', g: 0.16 }); tone({ f: 311, to: 262, t: 0.8, d: 0.9, type: 'triangle', g: 0.16 }); },
  // --- mini-game sounds
  flap() { noise({ d: 0.12, g: 0.12, f: 900, to: 2400, q: 0.9 }); tone({ f: 660, to: 880, d: 0.08, type: 'sine', g: 0.07 }); },
  ring() { tone({ f: N.E6, d: 0.35, type: 'sine', g: 0.18 }); tone({ f: N.G6, t: 0.06, d: 0.4, type: 'sine', g: 0.14 }); tone({ f: N.C7, t: 0.12, d: 0.45, type: 'sine', g: 0.09 }); },
  bonk() { tone({ f: 220, to: 90, d: 0.25, type: 'triangle', g: 0.25 }); noise({ d: 0.12, g: 0.15, f: 600, q: 1.5 }); },
  boing() { tone({ f: 180, to: 520, d: 0.22, type: 'triangle', g: 0.16 }); },
  puff() { noise({ d: 0.22, g: 0.1, f: 1400, to: 500, q: 0.8 }); },
  boop() { tone({ f: 330, to: 280, d: 0.12, type: 'sine', g: 0.12 }); },
  pop() { tone({ f: 500, to: 1100, d: 0.09, type: 'sine', g: 0.2 }); },
  plop() { tone({ f: 700, to: 240, d: 0.16, type: 'sine', g: 0.18 }); },
  twinkle() { [N.C7, N.G6, N.E6].forEach((f, i) => tone({ f, t: i * 0.05, d: 0.18, type: 'sine', g: 0.07 })); },
  swoop() { noise({ d: 0.55, g: 0.18, f: 300, to: 2600, q: 0.7 }); },
  alert() { tone({ f: N.A5, d: 0.1, type: 'square', g: 0.06 }); tone({ f: N.A5, t: 0.14, d: 0.1, type: 'square', g: 0.06 }); },
  hop() { tone({ f: 300, to: 900, d: 0.18, type: 'triangle', g: 0.2 }); },
  caught() { noise({ d: 0.3, g: 0.16, f: 2400, to: 700 }); tone({ f: 300, to: 150, d: 0.4, type: 'sawtooth', g: 0.06 }); },
  go() { tone({ f: N.C6, d: 0.12, type: 'triangle', g: 0.2 }); tone({ f: N.G6, t: 0.12, d: 0.3, type: 'triangle', g: 0.22 }); },
  ready() { tone({ f: N.G5, d: 0.12, type: 'triangle', g: 0.16 }); },
  win() { [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => tone({ f, t: i * 0.08, d: 0.4, type: 'triangle', g: 0.18 })); },
  meh() { tone({ f: N.E5, d: 0.2, type: 'triangle', g: 0.15 }); tone({ f: N.C5, t: 0.18, d: 0.35, type: 'triangle', g: 0.15 }); },
  bloom() { [N.C6, N.D5 * 2, N.E6, N.G6].forEach((f, i) => tone({ f, t: i * 0.06, d: 0.5, type: 'sine', g: 0.12 })); noise({ d: 0.4, g: 0.06, f: 3000, q: 2 }); },
};

// A rising tone that keeps going until stop() is called (vine growth). Returns stop().
export function sweep({ f = 300, to = 1200, d = 2, type = 'triangle', g = 0.08 } = {}) {
  if (!ready()) return () => {};
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator(); const gn = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(to, t0 + d);
  gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(g, t0 + 0.05);
  o.connect(gn); gn.connect(master); o.start(t0); o.stop(t0 + d + 0.6);
  let done = false;
  return () => {
    if (done) return; done = true;
    try { const t = ctx.currentTime; gn.gain.cancelScheduledValues(t); gn.gain.setValueAtTime(gn.gain.value, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); o.stop(t + 0.1); } catch { /* ignore */ }
  };
}
