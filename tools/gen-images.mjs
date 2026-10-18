#!/usr/bin/env node
// Image asset generator for "Kyah & Ayva: Starlight Gem Chase".
//
//   node tools/gen-images.mjs                  # generate every missing image, then rewrite manifest.json
//   node tools/gen-images.mjs --only hero_kyah,icon_*   # only these keys (trailing * = prefix match)
//   node tools/gen-images.mjs --only hero_kyah --force  # regenerate even if the file exists
//   node tools/gen-images.mjs --model gpt-image-1       # model override (default gpt-image-1)
//   node tools/gen-images.mjs --concurrency 3
//   node tools/gen-images.mjs --manifest-only           # just rebuild the _sm/_md variants + manifest.json / manifest-phone.json from disk
//   node tools/gen-images.mjs --verify                  # check dimensions / alpha / seams / variants of what exists
//   node tools/gen-images.mjs --dry-run                 # list what would run
//   node tools/gen-images.mjs --sheet hero_*,icon_* [--cell 320] [--cols 4] [--bg c8c0d8]  # contact sheet -> tools/_raw/sheet.png
//                                                        (transparent images composited over a checkerboard; for eyeballing)
//
// Reads tools/manifests/images.json: [{ key, file, size, quality, background, prompt, refs:[...],
// fidelity?, seamless? }]. `refs` entries are either "ref:<name>" (a crop of the source book, built on demand
// into tools/_raw/ref_<name>.png) or "key:<other_key>" (an already generated asset). `holeCenter: true` makes --verify
// require a transparent middle (wreath rings); `allowCrop: ["top"]` lets --verify ignore a border side a sprite deliberately enters from. Entries with refs use the
// /images/edits endpoint (character consistency); the rest use /images/generations. Existing files are skipped,
// so re-runs only fill gaps. OPENAI_API_KEY is read from .env (never printed).

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { optimize, variantFor } from './optimize-images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const MANIFEST_IN = path.join(ROOT, 'tools/manifests/images.json');
const OUT_DIR = path.join(ROOT, 'public/assets/images');
const ASSETS_DIR = path.join(ROOT, 'public/assets');
const RAW_DIR = path.join(ROOT, 'tools/_raw');
const LEDGER = path.join(RAW_DIR, 'spend.jsonl');
const BOOK_PDF = process.env.BOOK_PDF || path.join(os.homedir(), 'Desktop/Kyah-and-Ayva-and-the-Starlight-Gem.pdf');

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const MODEL = val('model', 'gpt-image-1');
const CONCURRENCY = Number(val('concurrency', 3));
const FORCE = has('force');
const ONLY = (val('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const matchesOnly = (key) => !ONLY.length || ONLY.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p));

// ---------------------------------------------------------------- book reference crops
// [pdfPage, x, y, w, h] in pixels of the page rendered at 200 dpi (1500 x 2000).
const REF_CROPS = {
  kyah: [1, 0, 364, 764, 855],            // cover, Kyah flying with blue flowers
  ayva: [1, 836, 436, 655, 873],          // cover, Ayva flying with music notes
  kyah_walk: [2, 20, 520, 330, 520],      // page 1, Kyah walking (full body)
  ayva_walk: [2, 320, 570, 300, 500],     // page 1, Ayva walking (full body)
  pup: [6, 240, 1560, 270, 270],          // pet wash, Pup
  poodle: [6, 470, 1440, 290, 380],       // pet wash, Poodle
  grabble_net: [5, 36, 345, 582, 655],    // Grabble with butterfly net
  grabble_run: [5, 309, 1400, 436, 509],  // Grabble running with the gem
  grabble_mop2: [9, 870, 1260, 300, 590], // reformed Grabble with mop
  misssuds: [9, 764, 1127, 364, 636],     // Miss Suds (half body)
  cover_title: [1, 0, 0, 1500, 510],      // cover title lettering
  cover_castle: [1, 0, 945, 1500, 690],   // cover village, castle, waterfall, bridge
  cover_gem: [1, 640, 690, 300, 330],     // the gem
  words_ref: [8, 764, 91, 727, 218],      // BLOOM! DING! WHOOSH! lettering
};

async function ensureRef(name) {
  const out = path.join(RAW_DIR, `ref_${name}.png`);
  if (fssync.existsSync(out)) return out;
  const def = REF_CROPS[name];
  if (!def) throw new Error(`unknown ref "${name}"`);
  const [page, x, y, w, h] = def;
  await fs.mkdir(RAW_DIR, { recursive: true });
  const hi = path.join(RAW_DIR, `hi-${String(page).padStart(2, '0')}.png`);
  if (!fssync.existsSync(hi)) {
    execFileSync('pdftoppm', ['-png', '-r', '200', '-f', String(page), '-l', String(page), BOOK_PDF, path.join(RAW_DIR, 'hi')]);
  }
  execFileSync('sips', ['--cropToHeightWidth', String(h), String(w), '--cropOffset', String(y), String(x), hi, '--out', out], { stdio: 'ignore' });
  return out;
}

// ---------------------------------------------------------------- PNG helpers
function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}
const hasAlphaChannel = (info) => info && (info.colorType === 6 || info.colorType === 4);

let _pngjs;
async function pngjs() {
  if (_pngjs === undefined) { try { _pngjs = (await import('pngjs')).PNG; } catch { _pngjs = null; } }
  return _pngjs;
}

// Fraction of fully-transparent pixels along the image border (transparent-background sanity check).
// `skip` lists border sides to ignore ('top' | 'bottom' | 'left' | 'right'), for sprites that deliberately enter from an edge.
async function borderTransparency(buf, skip = []) {
  const PNG = await pngjs();
  if (!PNG) return null;
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  let n = 0, t = 0;
  const probe = (x, y) => { n++; if (data[(y * w + x) * 4 + 3] < 8) t++; };
  for (let x = 0; x < w; x += 4) { if (!skip.includes('top')) probe(x, 0); if (!skip.includes('bottom')) probe(x, h - 1); }
  for (let y = 0; y < h; y += 4) { if (!skip.includes('left')) probe(0, y); if (!skip.includes('right')) probe(w - 1, y); }
  return t / n;
}

// Fraction of fully-transparent pixels in the central 30% x 30% box (wreath rings must have an open middle).
async function centerTransparency(buf) {
  const PNG = await pngjs();
  if (!PNG) return null;
  const { width: w, height: h, data } = PNG.sync.read(buf);
  let n = 0, t = 0;
  for (let y = Math.floor(h * 0.35); y < Math.floor(h * 0.65); y += 3) for (let x = Math.floor(w * 0.35); x < Math.floor(w * 0.65); x += 3) { n++; if (data[(y * w + x) * 4 + 3] < 8) t++; }
  return t / n;
}

// Mean abs colour difference across the wrap-around seam vs across ordinary neighbouring columns/rows.
async function seamScore(buf) {
  const PNG = await pngjs();
  if (!PNG) return null;
  const { width: w, height: h, data } = PNG.sync.read(buf);
  const diff = (i, j) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
  const colDiff = (x1, x2) => { let s = 0; for (let y = 0; y < h; y++) s += diff((y * w + x1) * 4, (y * w + x2) * 4); return s / h / 3; };
  const rowDiff = (y1, y2) => { let s = 0; for (let x = 0; x < w; x++) s += diff((y1 * w + x) * 4, (y2 * w + x) * 4); return s / w / 3; };
  let inner = 0, k = 0;
  for (let x = 8; x < w - 8; x += 16) { inner += colDiff(x, x + 1); k++; }
  for (let y = 8; y < h - 8; y += 16) { inner += rowDiff(y, y + 1); k++; }
  inner /= k;
  const seam = (colDiff(w - 1, 0) + rowDiff(h - 1, 0)) / 2;
  return { seam: +seam.toFixed(2), inner: +inner.toFixed(2), ratio: +(seam / Math.max(inner, 0.01)).toFixed(2) };
}

// Make a texture seamless by cross-blending it with a half-shifted copy of itself near the borders.
async function makeSeamless(buf, band = 0.22) {
  const PNG = await pngjs();
  if (!PNG) return buf;
  const src = PNG.sync.read(buf);
  const { width: w, height: h, data } = src;
  const out = new PNG({ width: w, height: h });
  const ss = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  for (let y = 0; y < h; y++) {
    const ay = ss(Math.min(y, h - 1 - y) / (h * band));
    for (let x = 0; x < w; x++) {
      const ax = ss(Math.min(x, w - 1 - x) / (w * band));
      const a = ax * ay;
      const i = (y * w + x) * 4;
      const j = (((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)) * 4;
      for (let c = 0; c < 4; c++) out.data[i + c] = Math.round(data[i + c] * a + data[j + c] * (1 - a));
    }
  }
  return PNG.sync.write(out);
}

// ---------------------------------------------------------------- API
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// gpt-image-1 list prices per 1M tokens: text in $5, image in $10, image out $40.
function estimateCost(usage) {
  if (!usage) return 0;
  const d = usage.input_tokens_details || {};
  const textIn = d.text_tokens ?? usage.input_tokens ?? 0;
  const imgIn = d.image_tokens ?? 0;
  return (textIn * 5 + imgIn * 10 + (usage.output_tokens || 0) * 40) / 1e6;
}

async function requestImage(entry, refPaths) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY missing in .env'), { fatal: true });
  const fields = { model: MODEL, prompt: entry.prompt, size: entry.size, quality: entry.quality, background: entry.background, output_format: 'png', n: 1 };
  let res;
  if (refPaths.length) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    if (entry.fidelity && MODEL === 'gpt-image-1') fd.append('input_fidelity', entry.fidelity);
    for (const p of refPaths) fd.append('image[]', new Blob([await fs.readFile(p)], { type: 'image/png' }), path.basename(p));
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(420000) });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(420000),
    });
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(json?.error?.message || text).slice(0, 300)}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    // Out of credits / quota is not transient: retrying only burns time, so abort the whole run instead.
    if (res.status === 429 && /no credits|insufficient_quota|exceeded your current quota|billing/i.test(err.message)) { err.fatal = true; err.quota = true; }
    throw err;
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('response had no b64_json');
  return { buf: Buffer.from(b64, 'base64'), usage: json.usage };
}

async function generateOne(entry, outPath) {
  const refPaths = [];
  for (const r of entry.refs || []) {
    if (r.startsWith('ref:')) refPaths.push(await ensureRef(r.slice(4)));
    else if (r.startsWith('key:')) {
      const dep = ENTRIES.find((e) => e.key === r.slice(4));
      const p = dep && path.join(OUT_DIR, dep.file);
      if (p && fssync.existsSync(p)) refPaths.push(p);
      else log(`  ! ${entry.key}: reference ${r} not available, continuing without it`);
    } else refPaths.push(path.resolve(ROOT, r));
  }
  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    try {
      const t0 = Date.now();
      let { buf, usage } = await requestImage(entry, refPaths);
      const info = pngInfo(buf);
      if (!info) throw new Error('response was not a PNG');
      if (entry.seamless) {
        await fs.mkdir(path.join(RAW_DIR, 'orig'), { recursive: true });
        await fs.writeFile(path.join(RAW_DIR, 'orig', path.basename(entry.file)), buf);
        buf = await makeSeamless(buf);
      }
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buf);
      const cost = estimateCost(usage);
      await fs.appendFile(LEDGER, JSON.stringify({ t: new Date().toISOString(), key: entry.key, model: MODEL, quality: entry.quality, size: entry.size, refs: refPaths.length, usage, estUSD: +cost.toFixed(4) }) + '\n');
      log(`OK   ${entry.key} -> ${entry.file} (${info.width}x${info.height}, ${((Date.now() - t0) / 1000).toFixed(0)}s, ~$${cost.toFixed(3)})`);
      return { ok: true, cost };
    } catch (e) {
      const retryable = !e.fatal && (e.status === 429 || e.status >= 500 || !e.status);
      if (!retryable || attempt >= MAX_RETRIES) { log(`FAIL ${entry.key}: ${e.message}`); return { ok: false, error: e.message, quota: !!e.quota }; }
      const wait = Math.max(e.retryAfter * 1000, 5000 * 3 ** attempt) + Math.random() * 2000;
      log(`retry ${entry.key} (${attempt + 1}/${MAX_RETRIES}) in ${(wait / 1000).toFixed(0)}s: ${e.message}`);
      await sleep(wait);
    }
  }
}

// ---------------------------------------------------------------- manifest / verify
// The runtime manifests (images/manifest.json for the board, images/manifest-phone.json for the phone) point at downscaled
// variants, so they are built by tools/optimize-images.mjs (it also makes the _sm / _md files). Originals stay on disk.
async function writeManifest() {
  const missing = ENTRIES.filter((e) => !fssync.existsSync(path.join(OUT_DIR, e.file))).map((e) => e.key);
  optimize();
  log(`manifests: ${ENTRIES.length - missing.length}/${ENTRIES.length} keys${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
  return missing;
}

async function verify() {
  let bad = 0;
  for (const e of ENTRIES) {
    const p = path.join(OUT_DIR, e.file);
    if (!fssync.existsSync(p)) { console.log(`MISSING ${e.key}`); bad++; continue; }
    const buf = await fs.readFile(p);
    const info = pngInfo(buf);
    const [w, h] = e.size.split('x').map(Number);
    const notes = [];
    if (!info) notes.push('not a PNG');
    else {
      if (info.width !== w || info.height !== h) notes.push(`size ${info.width}x${info.height} != ${e.size}`);
      if (e.background === 'transparent') {
        if (!hasAlphaChannel(info)) notes.push('no alpha channel');
        else { const f = await borderTransparency(buf, e.allowCrop || []); if (f !== null && f < 0.9) notes.push(`border only ${(f * 100).toFixed(0)}% transparent`); }
      }
      if (e.holeCenter) { const f = await centerTransparency(buf); if (f !== null && f < 0.9) notes.push(`centre only ${(f * 100).toFixed(0)}% transparent (ring hole is filled)`); }
      if (e.key.startsWith('tex_')) { const s = await seamScore(buf); if (s) notes.push(`seam ratio ${s.ratio} (seam ${s.seam}, inner ${s.inner})`); }
      // downscaled variant (_sm / _md) used by the manifests: must exist, have the expected size and keep its alpha channel
      const v = variantFor(e.file, info.width, info.height);
      if (v) {
        const vp = path.join(OUT_DIR, v.rel);
        const vinfo = fssync.existsSync(vp) ? pngInfo(await fs.readFile(vp)) : null;
        if (!vinfo) notes.push(`variant ${v.rel} missing (run node tools/optimize-images.mjs)`);
        else {
          if (vinfo.width !== v.w || vinfo.height !== v.h) notes.push(`variant ${v.rel} is ${vinfo.width}x${vinfo.height}, expected ${v.w}x${v.h}`);
          if (e.background === 'transparent' && !hasAlphaChannel(vinfo)) notes.push(`variant ${v.rel} lost its alpha channel`);
        }
      }
    }
    const flag = notes.some((n) => !n.startsWith('seam')) ? 'WARN' : 'ok  ';
    if (flag === 'WARN') bad++;
    console.log(`${flag} ${e.key} ${notes.join('; ')}`);
  }
  console.log(bad ? `${bad} problem(s)` : 'all good');
}


// Contact sheet for visual review: transparent images are composited over a checkerboard.
async function contactSheet(keys, { cell = 320, cols = 4 }) {
  const PNG = await pngjs();
  if (!PNG) throw new Error('pngjs not available');
  const items = ENTRIES.filter((e) => keys.some((p) => (p.endsWith('*') ? e.key.startsWith(p.slice(0, -1)) : e.key === p)) && fssync.existsSync(path.join(OUT_DIR, e.file)));
  const rows = Math.ceil(items.length / cols);
  const sheet = new PNG({ width: cols * cell, height: rows * cell });
  sheet.data.fill(255);
  items.forEach((e, n) => {
    const src = PNG.sync.read(fssync.readFileSync(path.join(OUT_DIR, e.file)));
    const scale = Math.max(src.width, src.height) / (cell - 8);
    const w = Math.floor(src.width / scale), h = Math.floor(src.height / scale);
    const ox = (n % cols) * cell + ((cell - w) >> 1), oy = Math.floor(n / cols) * cell + ((cell - h) >> 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, k = 0;
      const x0 = Math.floor(x * scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale)), y0 = Math.floor(y * scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      for (let yy = y0; yy < y1 && yy < src.height; yy += 2) for (let xx = x0; xx < x1 && xx < src.width; xx += 2) {
        const i = (yy * src.width + xx) * 4; const al = src.data[i + 3];
        r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al; a += al; k++;
      }
      const al = a / (k * 255);
      const chk = (((x >> 3) + (y >> 3)) & 1) ? 205 : 235; // checkerboard under transparency
      const o = ((oy + y) * sheet.width + ox + x) * 4;
      const inv = a ? 1 / a : 0;
      sheet.data[o] = Math.round((r * inv) * al + chk * (1 - al));
      sheet.data[o + 1] = Math.round((g * inv) * al + chk * (1 - al));
      sheet.data[o + 2] = Math.round((b * inv) * al + chk * (1 - al));
      sheet.data[o + 3] = 255;
    }
  });
  const out = path.join(RAW_DIR, val('out', 'sheet.png'));
  await fs.writeFile(out, PNG.sync.write(sheet));
  console.log(`${items.length} images -> ${out} (${sheet.width}x${sheet.height}): ${items.map((e) => e.key).join(', ')}`);
}

// ---------------------------------------------------------------- main
const ENTRIES = JSON.parse(await fs.readFile(MANIFEST_IN, 'utf8'));

if (has('verify')) { await verify(); process.exit(0); }
if (has('sheet')) { await contactSheet(val('sheet', '*').split(','), { cell: Number(val('cell', 320)), cols: Number(val('cols', 4)) }); process.exit(0); }
if (has('manifest-only')) { await writeManifest(); process.exit(0); }

const wanted = ENTRIES.filter((e) => matchesOnly(e.key));
const todo = wanted.filter((e) => FORCE || !fssync.existsSync(path.join(OUT_DIR, e.file)));
log(`${ENTRIES.length} entries, ${wanted.length} selected, ${todo.length} to generate (model ${MODEL}, concurrency ${CONCURRENCY})`);
if (has('dry-run')) { for (const e of todo) console.log(`  ${e.key}  ${e.size} ${e.quality} ${e.background} refs=${(e.refs || []).length}`); process.exit(0); }

const failed = [];
let spent = 0;
if (todo.length) {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const pending = [...todo];
  const doneKeys = new Set();
  const depsOf = (e) => (e.refs || []).filter((r) => r.startsWith('key:')).map((r) => r.slice(4)).filter((k) => todo.some((t) => t.key === k));
  let abort = false;
  const worker = async () => {
    while (pending.length && !abort) {
      const i = pending.findIndex((e) => depsOf(e).every((k) => doneKeys.has(k)));
      if (i < 0) { await sleep(2000); if (!pending.length) break; continue; } // waiting on a dependency that is still running
      const [entry] = pending.splice(i, 1);
      const r = await generateOne(entry, path.join(OUT_DIR, entry.file));
      doneKeys.add(entry.key);
      if (r.ok) spent += r.cost; else failed.push(entry.key);
      if (r.quota && !abort) { abort = true; log('!! OpenAI account is out of credits: stopping. Top up billing, then re-run this script to fill the gaps.'); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
}
const skipped = todo.filter((e) => !fssync.existsSync(path.join(OUT_DIR, e.file))).map((e) => e.key).filter((k) => !failed.includes(k));
if (skipped.length) log(`not attempted (run aborted): ${skipped.join(', ')}`);
await writeManifest();
log(`done. generated ${todo.length - failed.length - skipped.length}/${todo.length}; estimated spend this run ~$${spent.toFixed(2)}${failed.length ? `; FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
