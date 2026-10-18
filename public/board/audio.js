// WebAudio manager: sfx one-shots, voice lines (awaitable), looping music with crossfade and ducking.
export class AudioManager {
  constructor() { this.ctx = null; this.buffers = new Map(); this.manifest = { voice: {}, sfx: {}, music: {} }; this.music = null; this.musicKey = null; this.musicGain = null; this.master = null; this.enabled = true; this.loading = new Map(); }
  async init(manifest) {
    this.manifest = manifest || this.manifest;
    const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 1; this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.55; this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.voiceGain = this.ctx.createGain(); this.voiceGain.gain.value = 1; this.voiceGain.connect(this.master);
    // preload the most used clips, lazily load the rest
    const pre = [...Object.keys(this.manifest.sfx || {}).map(k => ['sfx', k]), ...Object.keys(this.manifest.music || {}).map(k => ['music', k])];
    await Promise.all(pre.map(([g, k]) => this.load(g, k).catch(() => {})));
    Object.keys(this.manifest.voice || {}).forEach(k => this.load('voice', k).catch(() => {}));
  }
  async unlock() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  pathFor(group, key) { const e = this.manifest[group]?.[key]; if (!e) return null; const p = typeof e === 'string' ? e : e.src; return p.startsWith('/') ? p : '/assets/' + p; }
  async load(group, key) {
    const id = group + ':' + key; if (this.buffers.has(id)) return this.buffers.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    const url = this.pathFor(group, key); if (!url) return null;
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then(ab => this.ctx.decodeAudioData(ab)).then(buf => { this.buffers.set(id, buf); this.loading.delete(id); return buf; }).catch(err => { this.loading.delete(id); console.warn('[audio] missing', id); return null; });
    this.loading.set(id, p); return p;
  }
  async sfx(key, { volume = 1, rate = 1, detune = 0 } = {}) {
    if (!this.ctx || !this.enabled) return; const buf = (await this.load('sfx', key)) || (await this.load('music', key)); if (!buf) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate; if (detune) src.detune.value = detune;
    const g = this.ctx.createGain(); g.gain.value = volume; src.connect(g); g.connect(this.sfxGain); src.start(); return src;
  }
  // Voice lines play one at a time (a queue) so narration never overlaps; music ducks while any line plays.
  // Two voice channels: 'narrator' (queued, ducks the music) and 'character' (short exclamations that may play over the narrator).
  // A line that cannot start within maxWait ms is dropped so nothing plays stale. onStart fires when the clip really begins.
  voice(key, { duck = true, priority = false, channel = 'narrator', maxWait = 3500, onStart } = {}) {
    if (!this.ctx || !this.enabled) return Promise.resolve(false);
    this.channels = this.channels || { narrator: { queue: [], busy: false, current: null }, character: { queue: [], busy: false, current: null } };
    const ch = this.channels[channel] || this.channels.narrator;
    return new Promise(resolve => { const job = { key, duck, resolve, onStart, maxWait, t0: performance.now() }; if (priority) ch.queue.unshift(job); else ch.queue.push(job); this.pumpVoice(ch); });
  }
  async pumpVoice(ch) {
    if (ch.busy) return; const job = ch.queue.shift(); if (!job) return;
    if (performance.now() - job.t0 > job.maxWait) { job.resolve(false); return this.pumpVoice(ch); }
    ch.busy = true;
    try {
      const buf = await this.load('voice', job.key);
      if (!buf || performance.now() - job.t0 > job.maxWait + 1500) { job.resolve(false); }
      else {
        const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.voiceGain);
        if (job.duck) this.duck(true); try { job.onStart?.(buf.duration); } catch {}
        await new Promise(res => { src.onended = res; src.start(); ch.current = src; });
        if (job.duck) this.duck(false); job.resolve(true);
      }
    } catch (e) { job.resolve(false); }
    ch.current = null; ch.busy = false; this.pumpVoice(ch);
  }
  stopVoices() { if (!this.channels) return; for (const ch of Object.values(this.channels)) { ch.queue.forEach(j => j.resolve(false)); ch.queue = []; try { ch.current?.stop(); } catch {} } }
  duck(on) { this.duckCount = Math.max(0, (this.duckCount || 0) + (on ? 1 : -1)); if (!this.musicGain) return; const target = this.duckCount > 0 ? 0.22 : 0.55; this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime); this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, on ? 0.08 : 0.4); }
  voiceDuration(key) { const b = this.buffers.get('voice:' + key); return b ? b.duration : 0; }
  async playMusic(key, { fade = 1.2, loop, then = null } = {}) {
    if (!this.ctx || key === this.musicKey) return; const buf = await this.load('music', key); if (!buf) return;
    const entry = this.manifest.music?.[key]; const shouldLoop = loop ?? (typeof entry === 'object' ? !!entry.loop : true);
    const old = this.music; const oldGain = this.musicTrackGain;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = shouldLoop;
    const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.musicGain); src.start();
    g.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fade);
    if (old && oldGain) { oldGain.gain.cancelScheduledValues(this.ctx.currentTime); oldGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade); setTimeout(() => { try { old.stop(); } catch {} }, fade * 1000 + 50); }
    this.music = src; this.musicTrackGain = g; this.musicKey = key;
    if (!shouldLoop) src.onended = () => { if (this.music === src) { this.music = null; this.musicKey = null; if (then) this.playMusic(then, { fade: 1.5 }); } };
  }
  stopMusic(fade = 0.8) { if (!this.music) return; const old = this.music, g = this.musicTrackGain; g.gain.cancelScheduledValues(this.ctx.currentTime); g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade); setTimeout(() => { try { old.stop(); } catch {} }, fade * 1000 + 50); this.music = null; this.musicKey = null; }
}
