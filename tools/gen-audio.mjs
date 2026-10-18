#!/usr/bin/env node
// Audio generator for Kyah & Ayva: Starlight Gem Chase.
//
// Reads tools/manifests/audio.json (voice lines, sfx prompts, music prompts), calls the
// ElevenLabs API within a hard character budget, post-processes everything with ffmpeg
// (silence trim, two-pass loudness mastering to -16/-18/-20 LUFS with a -1.5 dBTP ceiling, seamless music loops,
// mp3 128k/44.1k) into public/assets/audio/{voice,sfx,music}/,
// fills anything missing with the procedural fallback (tools/synth-fallback.mjs), and
// writes public/assets/audio/manifest.json (+ sources.json recording where each file came from).
//
// Idempotent: existing outputs are skipped; raw API downloads are cached in tools/_raw/audio so
// re-mastering never costs quota.
//
// Usage:
//   node tools/gen-audio.mjs                      # all phases, API then fallback, manifest, verify
//   node tools/gen-audio.mjs --phase 1,2          # only these phases
//   node tools/gen-audio.mjs --only bell_ding     # only these keys
//   node tools/gen-audio.mjs --no-api             # skip ElevenLabs entirely (fallback only)
//   node tools/gen-audio.mjs --no-fallback        # do not synthesise missing keys
//   node tools/gen-audio.mjs --force              # regenerate even if the output exists (re-masters cached raws)
//   node tools/gen-audio.mjs --force-api          # also ignore cached raw downloads (spends quota!)
//   node tools/gen-audio.mjs --headroom 3000      # characters of quota to always leave unused
//   node tools/gen-audio.mjs --max-spend 9000     # hard cap on characters spent by THIS run
//   node tools/gen-audio.mjs --dry                # print the plan and estimated cost, call nothing
//   node tools/gen-audio.mjs --verify             # only verify + write manifest
//
// Phases: 1 narrator, 2 character lines, 3 catcher sfx, 4 priority music, 5 other sfx, 6 other music.
// (v2 adds Grabble/mini-game narrator + character lines to phases 1-2 and mini-game sfx to phases 3/5.)
// A voice line whose manifest text changed since it was generated (sources.json records a text hash) is
// regenerated automatically; for lines generated before hashes existed, drop the old raw from tools/_raw/audio/voice
// and run with --force --only <keys>.
// Never prints the API key.

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  ROOT, AUDIO_DIR, RAW_DIR, LUFS, allKeys, loadSpec, absPath, relPath, hasFile, postProcess,
  renderFallback, writeAudioManifest, probeDuration, measureLoudness, loopSeam, windowSeam, hitPosition, joinTimes,
} from './synth-fallback.mjs';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const API = 'https://api.elevenlabs.io';
const KEY = process.env.ELEVENLABS_API_KEY || '';
const HEADROOM = parseInt(val('--headroom') || '3000', 10);
const MAX_SPEND = val('--max-spend') ? parseInt(val('--max-spend'), 10) : Infinity;
const DRY = flag('--dry');
const FORCE = flag('--force') || flag('--force-api');
const FORCE_API = flag('--force-api');
const NO_API = flag('--no-api') || !KEY;
const NO_FALLBACK = flag('--no-fallback');
const PHASES = new Set((val('--phase') || '1,2,3,4,5,6').split(',').map((x) => parseInt(x, 10)));
const ONLY = val('--only') ? new Set(val('--only').split(',')) : null;

const spec = loadSpec();
const SOURCES_FILE = path.join(AUDIO_DIR, 'sources.json');
const sources = fs.existsSync(SOURCES_FILE) ? JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) : {};
/** sources.json is keyed `kind/key` because a voice line and an sfx can share a key (v2: grabble_snatch). */
const sk = (kind, key) => `${kind}/${key}`;
for (const k of Object.keys(sources)) { if (!k.includes('/')) { sources[sk(sources[k].kind, k)] = sources[k]; delete sources[k]; } } // migrate v1 flat keys
const textHash = (t) => crypto.createHash('sha1').update(String(t)).digest('hex').slice(0, 10);
/** voice line whose manifest text differs from the text it was generated from */
const textChanged = (kind, item) => kind === 'voice' && !!sources[sk(kind, item.key)]?.th && sources[sk(kind, item.key)].th !== textHash(item.text);
const saveSources = () => { if (DRY) return; fs.mkdirSync(AUDIO_DIR, { recursive: true }); fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2) + '\n'); };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawPath = (kind, key) => path.join(RAW_DIR, kind, `${key}.mp3`);
const hasRaw = (kind, key) => { try { return fs.statSync(rawPath(kind, key)).size > 0; } catch { return false; } };

/* ------------------------------ quota ------------------------------ */

let quota = null; // { count, limit }
async function refreshQuota(wait = 0) {
  if (!KEY) return null;
  if (wait) await sleep(wait);
  quota = await refreshQuotaRaw();
  ledgerInit(quota);
  if (startCount == null) startCount = quota.count;
  return quota;
}
/** The subscription counter lags the real spend by several seconds, so each call's exact
 *  `character-cost` response header is added to quota.count, and this reconciles with the server. */
async function reconcileQuota(maxWaitMs = 30000) {
  if (!KEY) return;
  const expected = quota.count;
  const t0 = Date.now();
  let server = null;
  while (Date.now() - t0 < maxWaitMs) {
    const q = await refreshQuotaRaw();
    server = q.count;
    if (server >= expected) break;
    await sleep(3000);
  }
  if (server !== null && server !== expected) log(`  (quota reconcile: tracked ${expected}, server reports ${server})`);
  quota.count = Math.max(expected, server ?? 0);
}
async function refreshQuotaRaw() {
  const r = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`subscription check failed: HTTP ${r.status}`);
  const j = await r.json();
  return { count: j.character_count, limit: j.character_limit, tier: j.tier, reset: j.next_character_count_reset_unix };
}

/* Local ledger of characters this tool has spent in the current billing cycle. The server counter lags by
 * several seconds, so a fresh run that starts right after another would otherwise under-count. */
const LEDGER_FILE = path.join(RAW_DIR, 'ledger.json');
let ledger = null;
function ledgerInit(q) {
  let l = null;
  try { l = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); } catch { /* none */ }
  if (!l || l.reset !== q.reset) l = { reset: q.reset, baseline: q.count, spent: 0 };
  ledger = l;
  saveLedger();
  q.count = Math.max(q.count, l.baseline + l.spent);
}
function saveLedger() { fs.mkdirSync(RAW_DIR, { recursive: true }); fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger) + '\n'); }
function ledgerAdd(n) { if (ledger) { ledger.spent += n; saveLedger(); } }
const quotaStr = () => (quota ? `${quota.count}/${quota.limit} used, ${quota.limit - quota.count} left (headroom ${HEADROOM})` : 'n/a');
let startCount = null; // quota.count when this run started (for --max-spend)
const canSpend = (est, reserve = 0) => !!quota && quota.count + est + reserve <= quota.limit - HEADROOM && (startCount == null || quota.count - startCount + est <= MAX_SPEND);

/* measured cost rates (characters per unit) */
const rate = { sfxPerSec: 10, musicPerSec: null }; // measured: sound-generation bills ~10 chars per second of output
const disabled = { all: false, music: false, sfx: false, voice: false };

/* ------------------------------ API ------------------------------ */

class ApiError extends Error {
  constructor(status, body) { super(`HTTP ${status}: ${String(body).slice(0, 300)}`); this.status = status; this.body = String(body); }
}

async function apiAudio(pathname, body, query = {}) {
  const qs = new URLSearchParams({ output_format: 'mp3_44100_128', ...query }).toString();
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}${pathname}?${qs}`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const c = parseInt(r.headers.get('character-cost') ?? '', 10);
      return { audio: Buffer.from(await r.arrayBuffer()), cost: Number.isFinite(c) ? c : null };
    }
    const text = await r.text();
    lastErr = new ApiError(r.status, text);
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
    throw lastErr;
  }
  throw lastErr;
}

const costOfVoice = (v) => v.text.length * (spec.tts.model_id.includes('turbo') || spec.tts.model_id.includes('flash') ? 0.5 : 1);
const costOfSfx = (s) => Math.ceil(s.seconds * rate.sfxPerSec);
const costOfMusic = (m) => Math.ceil(m.seconds * (rate.musicPerSec ?? 0) * 1.25);

/* ------------------------------ produce one asset ------------------------------ */

const tally = { elevenlabs: [], fallback: [], failed: [], skipped: [], deferred: [] };

async function master(kind, key, item, raw) {
  const out = absPath(kind, key);
  return postProcess(raw, out, { kind, loop: kind === 'music' && !!item.loop, crossfade: kind === 'music' && item.loop ? 1.5 : 0, derive: item.derive || null });
}
/** compact mastering record for sources.json / the log */
const masterNote = (r) => (r && r.loudness ? { recipe: r.recipe, lufs: r.loudness.I, tp: r.loudness.TP, ...(r.peakReduction > 0.5 ? { limiter_db: +r.peakReduction.toFixed(1) } : {}), ...(r.loop && r.loop.bars ? { loop: { seconds: +r.loop.loopSeconds.toFixed(3), bars: r.loop.bars, start_offset: +r.loop.startOffset.toFixed(3) } } : {}), ...(r.loop && r.loop.joins ? { derived: { assembled_seconds: +r.loop.seconds.toFixed(3), joins: r.loop.joins.map((t) => +t.toFixed(3)), plan: r.loop.plan } } : {}) } : undefined);
const masterStr = (r) => (r && r.loudness ? ` ${r.loudness.I.toFixed(1)} LUFS ${r.loudness.TP.toFixed(1)} dBTP (${r.recipe}${r.peakReduction > 0.5 ? `, limiter ${r.peakReduction.toFixed(1)} dB` : ''})` : '');

async function callApi(kind, item) {
  if (kind === 'voice') {
    const v = spec.voices[item.role];
    if (!v) throw new Error('unknown voice role ' + item.role);
    return apiAudio(`/v1/text-to-speech/${v.voice_id}`, { text: item.text, model_id: spec.tts.model_id, voice_settings: v.settings }, { output_format: spec.tts.output_format });
  }
  if (kind === 'sfx') {
    return apiAudio('/v1/sound-generation', { text: item.prompt, duration_seconds: item.seconds, prompt_influence: item.prompt_influence ?? 0.4 });
  }
  const body = { prompt: item.prompt, music_length_ms: Math.round(item.seconds * 1000), force_instrumental: true };
  if (spec.music_model) body.model_id = spec.music_model;
  return apiAudio('/v1/music', body);
}

/** Music responses report `character-cost: 0` even though ~30 chars/s are billed, so measure by the server counter. */
async function callMusicMeasured(item) {
  await reconcileQuota();
  const before = quota.count;
  const { audio, cost } = await callApi('music', item);
  let spent = cost > 0 ? cost : null;
  if (spent == null) {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await sleep(4000);
      const q = await refreshQuotaRaw();
      if (q.count > before) { await sleep(5000); spent = (await refreshQuotaRaw()).count - before; break; }
    }
    if (spent == null) spent = Math.ceil(item.seconds * (rate.musicPerSec ?? 30)); // counter never moved: assume the known rate
  }
  quota.count = before + spent; ledgerAdd(spent);
  return { audio, spent };
}

/** returns 'ok' | 'skip' | 'deferred' | 'failed' */
async function produce(kind, item, reserve = 0) {
  const key = item.key;
  const stale = textChanged(kind, item);
  if (stale) log(`  [text changed] ${kind}/${key}: regenerating`);
  if (!FORCE && !stale && hasFile(kind, key)) {
    const e = sources[sk(kind, key)];
    if (kind === 'voice' && e && !e.th) e.th = textHash(item.text); // adopt the current text as the generated one (v1 entries had no hash)
    tally.skipped.push(key); return 'skip';
  }

  // 1) cached raw -> just re-master (unless the line's text changed since the raw was fetched).
  //    A derived key (item.derive) is re-cut from another key's cached raw and never spends quota.
  const rawKey = item.derive ? item.derive.from : key;
  if (hasRaw(kind, rawKey) && !FORCE_API && !stale) {
    try {
      const r = await master(kind, key, item, rawPath(kind, rawKey));
      sources[sk(kind, key)] = { kind, source: item.derive ? 'derived' : 'elevenlabs', ...(item.derive ? { from: item.derive.from } : {}), ...(sources[sk(kind, key)]?.chars ? { chars: sources[sk(kind, key)].chars } : {}), ...(kind === 'voice' ? { th: sources[sk(kind, key)]?.th ?? textHash(item.text) } : {}), note: 'cached raw', ...(masterNote(r) ? { master: masterNote(r) } : {}) };
      tally.elevenlabs.push(key);
      log(`  [cached ] ${kind}/${key}${masterStr(r)}`);
      return 'ok';
    } catch (e) { log(`  [master failed] ${key}: ${e.message}`); }
  }

  // 2) API
  if (item.derive) { log(`  [derive ] ${kind}/${key}: source raw ${item.derive.from} missing, not generated`); tally.deferred.push(key); return 'deferred'; }
  if (NO_API || disabled.all || disabled[kind]) { tally.deferred.push(key); return 'deferred'; }
  const est = kind === 'voice' ? costOfVoice(item) : kind === 'sfx' ? costOfSfx(item) : costOfMusic(item);
  if (kind === 'music' && rate.musicPerSec == null) { log(`  [defer  ] ${key}: music cost not measured yet`); tally.deferred.push(key); return 'deferred'; }
  if (!canSpend(est, reserve)) { log(`  [budget ] ${key}: est ${est} chars would breach the limit, deferring to fallback`); tally.deferred.push(key); return 'deferred'; }
  if (DRY) { log(`  [dry    ] ${kind}/${key} est ${est}`); return 'deferred'; }

  let audio, cost, measured = null;
  try {
    if (kind === 'music') ({ audio, spent: measured } = await callMusicMeasured(item));
    else ({ audio, cost } = await callApi(kind, item));
  } catch (e) {
    const msg = e.message || String(e);
    log(`  [api err] ${kind}/${key}: ${msg}`);
    if (e.status === 401 || /quota_exceeded|payment|subscription|upgrade|not available|only available|paid/i.test(msg)) {
      if (kind === 'voice' || kind === 'sfx' || kind === 'music') { disabled[kind] = true; log(`  -> disabling API for ${kind} (${e.status})`); }
      if (e.status === 401 && /quota/i.test(msg)) disabled.all = true;
    }
    tally.failed.push(`${key} (${msg.slice(0, 80)})`);
    return 'failed';
  }
  fs.mkdirSync(path.dirname(rawPath(kind, key)), { recursive: true });
  fs.writeFileSync(rawPath(kind, key), audio);
  const spent = measured ?? cost ?? est; // exact cost from the character-cost header (music: measured via the server counter)
  if (measured == null) { quota.count += spent; ledgerAdd(spent); }
  if (kind === 'sfx' && spent > 0) rate.sfxPerSec = spent / item.seconds;
  if (kind === 'music' && spent > 0) rate.musicPerSec = spent / item.seconds;
  let mastered;
  try {
    mastered = await master(kind, key, item, rawPath(kind, key));
  } catch (e) {
    log(`  [master failed] ${key}: ${e.message}`);
    tally.failed.push(`${key} (master: ${e.message.slice(0, 60)})`);
    return 'failed';
  }
  sources[sk(kind, key)] = { kind, source: 'elevenlabs', chars: spent, ...(kind === 'voice' ? { th: textHash(item.text) } : {}), ...(masterNote(mastered) ? { master: masterNote(mastered) } : {}) };
  tally.elevenlabs.push(key);
  log(`  [api    ] ${kind}/${key} cost ${spent} chars (est ${est}) -> quota ${quota.count}/${quota.limit}`);
  return 'ok';
}

/* ------------------------------ phases ------------------------------ */

const phaseItems = (phase) => {
  const out = [];
  for (const v of spec.voice) if (v.phase === phase) out.push(['voice', v]);
  for (const s of spec.sfx) if (s.phase === phase) out.push(['sfx', s]);
  for (const m of [...spec.music].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) if (m.phase === phase) out.push(['music', m]);
  return out.filter(([, it]) => !ONLY || ONLY.has(it.key));
};

const PHASE_NAMES = { 1: 'narrator', 2: 'character lines', 3: 'catcher sfx', 4: 'priority music', 5: 'other sfx', 6: 'other music' };

async function runPhases() {
  await refreshQuota();
  log(`quota start: ${quotaStr()}${MAX_SPEND < Infinity ? ` | max spend this run ${MAX_SPEND}` : ''}`);
  for (const m of spec.music) { const c = sources[sk('music', m.key)]?.chars; if (c > 0 && rate.musicPerSec == null) rate.musicPerSec = c / m.seconds; }
  for (let ph = 1; ph <= 6; ph++) {
    if (!PHASES.has(ph)) continue;
    const items = phaseItems(ph);
    if (!items.length) continue;
    log(`\n== phase ${ph}: ${PHASE_NAMES[ph]} (${items.length} items) ==`);
    const before = quota ? quota.count : 0;

    // before the priority-music phase, measure the music API cost with the cheapest (3 s) track
    if (ph === 4 && !NO_API && !DRY && !disabled.all && rate.musicPerSec == null) {
      const probe = [...spec.music].sort((a, b) => a.seconds - b.seconds)[0];
      if (probe && (!ONLY || ONLY.has(probe.key)) && !hasFile('music', probe.key) && !hasRaw('music', probe.key)) {
        log(`  probing music API cost with ${probe.key} (${probe.seconds}s)`);
        if (canSpend(probe.seconds * 120)) {
          try {
            const { audio, spent } = await callMusicMeasured(probe);
            fs.mkdirSync(path.dirname(rawPath('music', probe.key)), { recursive: true });
            fs.writeFileSync(rawPath('music', probe.key), audio);
            rate.musicPerSec = spent / probe.seconds;
            sources[sk('music', probe.key)] = { kind: 'music', source: 'elevenlabs', chars: spent, pending: true };
            saveSources();
            log(`  music probe cost ${spent} chars for ${probe.seconds}s => ${rate.musicPerSec.toFixed(1)} chars/s`);
          } catch (e) {
            log(`  [api err] music probe: ${e.message}`);
            disabled.music = true;
          }
        } else log('  not enough budget to probe music');
      }
    }

    for (const [kind, item] of items) {
      if (kind === 'music' && hasRaw('music', item.key) && rate.musicPerSec == null) {
        // measured on the probe already
        const spent = sources[sk('music', item.key)]?.chars;
        if (spent) rate.musicPerSec = spent / item.seconds;
      }
      // keep enough budget for the cheap sfx behind the priority music
      let reserve = 0;
      if (ph === 4) reserve = spec.sfx.filter((s) => s.phase === 5 && !hasFile('sfx', s.key) && !hasRaw('sfx', s.key)).reduce((a, s) => a + costOfSfx(s), 0);
      await produce(kind, item, reserve);
      saveSources();
    }
    await reconcileQuota();
    log(`== phase ${ph} done: spent ${quota.count - before} chars | ${quotaStr()}`);
  }
}

/* ------------------------------ fallback ------------------------------ */

async function runFallback() {
  if (NO_FALLBACK) return;
  log('\n== fallback: procedural synth for anything missing ==');
  for (const { kind, key, spec: s } of allKeys(spec)) {
    if (ONLY && !ONLY.has(key)) continue;
    if (hasFile(kind, key)) continue;
    process.stdout.write(`  synth ${kind}/${key} ... `);
    try {
      await renderFallback(kind, key, s, absPath(kind, key));
      sources[sk(kind, key)] = { kind, source: 'fallback' };
      tally.fallback.push(key);
      console.log('ok');
    } catch (e) {
      console.log('FAILED ' + e.message);
      tally.failed.push(`${key} (fallback: ${e.message.slice(0, 80)})`);
    }
    saveSources();
  }
}

/* ------------------------------ verify ------------------------------ */

const RANGE = { voice: [0.5, 12], sfx: [0.3, 4], music: [2.5, 120] };
const LU_LIMIT = 1.0;  // delivered loudness must be within +-1 LU of the kind's target
const TP_LIMIT = -1.5;  // ...and the true peak at or under -1.5 dBTP

async function verify() {
  log('\n== verify ==');
  let missing = 0, odd = 0, loud = 0;
  const rows = [], loudFlags = [], seams = [], derived = [];
  for (const { kind, key } of allKeys(spec)) {
    const f = absPath(kind, key);
    let size = 0;
    try { size = fs.statSync(f).size; } catch { /* missing */ }
    if (!size) { missing++; rows.push(`MISSING ${kind}/${key}`); continue; }
    const d = await probeDuration(f);
    let [lo, hi] = RANGE[kind];
    if (kind === 'voice') { const t = spec.voice.find((v) => v.key === key)?.text || ''; if (t.split(/\s+/).length <= 2) lo = 0.3; } // one-word lines are naturally short
    if (kind === 'sfx') { const sec = spec.sfx.find((s) => s.key === key)?.seconds || 1; lo = Math.min(lo, sec * 0.25); } // tiny blips/plops (0.5-0.8 s requested) legitimately trim to 0.15-0.3 s
    const flags = [];
    if (d < lo || d > hi) { flags.push('DURATION OUT OF RANGE'); odd++; }
    // loudness: ebur128 integrated LUFS + true peak of the delivered mp3 (clips under 400 ms are zero-padded to one 400 ms block)
    const m = await measureLoudness(f);
    const dev = m.I - LUFS[kind];
    if (Math.abs(dev) > LU_LIMIT || m.TP > TP_LIMIT) { flags.push(`LOUDNESS ${dev >= 0 ? '+' : ''}${dev.toFixed(1)} LU / ${m.TP.toFixed(1)} dBTP`); loud++; loudFlags.push(`${kind}/${key} ${m.I.toFixed(1)} LUFS (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}) ${m.TP.toFixed(1)} dBTP${sources[sk(kind, key)]?.master?.limiter_db ? ` limiter ${sources[sk(kind, key)].master.limiter_db} dB` : ''}`); }
    rows.push(`${kind.padEnd(5)} ${key.padEnd(22)} ${d.toFixed(2).padStart(6)}s ${String(Math.round(size / 1024)).padStart(5)}KB ${(sources[sk(kind, key)]?.source || '?').padEnd(10)} ${m.I.toFixed(1).padStart(6)} LUFS ${m.TP.toFixed(2).padStart(6)} dBTP${d < 0.4 ? ' (padded to 0.4 s)' : ''}${flags.length ? '  <-- ' + flags.join(', ') : ''}`);
    if (kind === 'music' && spec.music.find((x) => x.key === key)?.loop) seams.push([key, await loopSeam(f)]);
    const dv = kind === 'music' ? spec.music.find((x) => x.key === key)?.derive : null;
    if (dv) derived.push([key, dv, d]);
  }
  rows.forEach((r) => log('  ' + r));
  if (seams.length) {
    log('\nloop seams (file concatenated with itself; RMS of the 100 ms before / after the join):');
    for (const [key, z] of seams) {
      const ok = Math.abs(z.stepDb) <= 3 && z.clickRatio < 1 && z.preDb > -60 && z.postDb > -60;
      log(`  ${key.padEnd(18)} ${z.seconds.toFixed(3)} s  before ${z.preDb.toFixed(2)} dBFS  after ${z.postDb.toFixed(2)} dBFS  step ${z.stepDb >= 0 ? '+' : ''}${z.stepDb.toFixed(2)} dB  join step/p99.9 ${z.clickRatio.toFixed(2)}  first |x| ${z.first.toFixed(4)} last |x| ${z.last.toFixed(4)}${ok ? '' : '  <-- SEAM'}`);
      if (!ok) odd++;
    }
  }
  for (const [key, dv, d] of derived) {
    log(`\nderived cue ${key} (re-cut of ${dv.from}, ${d.toFixed(2)} s): RMS of the 100 ms before / after each join`);
    for (const t of (sources[sk('music', key)]?.master?.derived?.joins || joinTimes(dv.plan))) {
      const z = await windowSeam(absPath('music', key), t);
      const ok = Math.abs(z.stepDb) <= 3 && z.jump10ms <= 6;
      log(`  join at ${t.toFixed(2)} s  before ${z.preDb.toFixed(2)} dBFS  after ${z.postDb.toFixed(2)} dBFS  step ${z.stepDb >= 0 ? '+' : ''}${z.stepDb.toFixed(2)} dB  max 10 ms jump ${z.jump10ms.toFixed(1)} dB${ok ? '' : '  <-- JOIN'}`);
      if (!ok) odd++;
    }
    const h = await hitPosition(absPath('music', key));
    const hitOk = h.fromEnd <= 3.05 && h.after1s < h.hitDb - 6;
    log(`  final hit: loudest 100 ms of the last 4 s at ${h.hitAt.toFixed(2)} s of ${h.seconds.toFixed(2)} s = ${h.fromEnd.toFixed(2)} s from the end, ${h.hitDb.toFixed(1)} dBFS, then ${h.after1s.toFixed(1)} / ${h.after2s.toFixed(1)} dBFS 1 s / 2 s later${hitOk ? '' : '  <-- HIT NOT IN LAST 3 s'}`);
    if (!hitOk) odd++;
  }
  const man = writeAudioManifest(spec);
  const total = spec.voice.length + spec.sfx.length + spec.music.length;
  const have = Object.keys(man.voice).length + Object.keys(man.sfx).length + Object.keys(man.music).length;
  log(`\nmanifest.json: ${have}/${total} keys (${Object.keys(man.voice).length} voice, ${Object.keys(man.sfx).length} sfx, ${Object.keys(man.music).length} music); missing ${missing}; duration/seam out-of-range ${odd}; loudness out-of-range ${loud}`);
  if (loudFlags.length) { log('loudness exceptions (peak-limited best effort):'); loudFlags.forEach((r) => log('  ' + r)); }
  return missing === 0;
}

/* ------------------------------ main ------------------------------ */

async function main() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  if (flag('--verify')) { process.exit((await verify()) ? 0 : 1); }
  if (NO_API) { log(KEY ? 'API disabled (--no-api)' : 'no ELEVENLABS_API_KEY found; API disabled'); }
  if (!NO_API) await runPhases();
  else for (let ph = 1; ph <= 6; ph++) if (PHASES.has(ph)) for (const [kind, item] of phaseItems(ph)) await produce(kind, item);
  await runFallback();
  saveSources();
  const ok = await verify();
  if (!NO_API) {
    await reconcileQuota();
    log(`quota end: ${quotaStr()}`);
  }
  log(`\nsummary: elevenlabs ${tally.elevenlabs.length}, fallback ${tally.fallback.length}, skipped(existing) ${tally.skipped.length}, failed ${tally.failed.length}`);
  if (tally.fallback.length) log('  fallback keys: ' + tally.fallback.join(', '));
  if (tally.failed.length) log('  failures: ' + tally.failed.join(' | '));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('gen-audio failed:', e.message); process.exit(1); });
