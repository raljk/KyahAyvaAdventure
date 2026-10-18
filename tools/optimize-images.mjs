#!/usr/bin/env node
// Image optimizer for "Kyah & Ayva: Starlight Gem Chase".
//
// Creates downscaled variants next to the originals (the originals are never touched) and writes the two
// runtime manifests the clients load:
//
//   public/assets/images/manifest.json         BOARD  (big screen): _md textures / icons / words / logo / mini-game art, _sm hero faces, full-size hero bodies
//   public/assets/images/manifest-phone.json   PHONE  (small screen): _sm hero faces, _md hero bodies / gem / npc / icons / mini-game art / logo, nothing big
//
//   node tools/optimize-images.mjs             # make missing/stale variants, rewrite both manifests, print the byte report
//   node tools/optimize-images.mjs --force     # re-make every variant
//   node tools/optimize-images.mjs --report    # only print the byte report (no writes)
//
// Variant rules (original -> variant, via the macOS `sips` CLI, exact-size resample, alpha is kept):
//   heroes/<id>_face.png   -> heroes/<id>_face_sm.png   256 x 256
//   heroes/<id>.png        -> heroes/<id>_md.png        512 x 768
//   icons/*.png            -> icons/*_md.png            512 x 512
//   words/*.png            -> words/*_md.png            768 wide (768 x 512)
//   textures/*.png         -> textures/*_md.png         512 x 512
//   ui/logo.png            -> ui/logo_md.png            768 wide (768 x 512)
//   gem/*.png              -> gem/*_md.png              512 x 512
//   npc/*.png              -> npc/*_md.png              512 x 768
//   mini/*.png (phone mini-games) -> mini/*_md.png      square 512 x 512 · portrait 512 x 768 · landscape 768 x 512
//   fly/*.png (Flappy Flight hero flap frames) -> fly/*_md.png   512 x 512  (board + phone manifests both point at the _md)
// (scene/*, ui/button, ui/paper_panel and ui/phone_bg have no variant: they stay as they are.)
//
// Key -> file comes from tools/manifests/images.json. gen-images.mjs calls this script after generating.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_IN = path.join(ROOT, 'tools/manifests/images.json');
const OUT_DIR = path.join(ROOT, 'public/assets/images');

// Which file the BOARD manifest uses for the phone mini-game art ("mini" group: mini_* keys and grabble_caught).
// 'md' = the 512 variant (the board's live panel is small; 'full' would add ~21 MB to the board).
const BOARD_MINI_VARIANT = 'md';

const isMiniKey = (key) => key.startsWith('mini_') || key === 'grabble_caught';

// ---------------------------------------------------------------- variant rules
// Returns { rel, w, h, tag } for the downscaled variant of `file` (relative to images/), or null if none.
// `w`/`h` are the source dimensions (used for the mini/ group, which is sized by aspect ratio).
export function variantFor(file, w, h) {
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file, '.png');
  const mk = (suffix, tw, th) => ({ rel: `${dir}/${base}${suffix}.png`, w: tw, h: th, tag: suffix.slice(1) });
  switch (dir) {
    case 'heroes': return base.endsWith('_face') ? mk('_sm', 256, 256) : mk('_md', 512, 768);
    case 'icons': return mk('_md', 512, 512);
    case 'words': return mk('_md', 768, 512);
    case 'textures': return mk('_md', 512, 512);
    case 'gem': return mk('_md', 512, 512);
    case 'npc': return mk('_md', 512, 768);
    case 'fly': return mk('_md', 512, 512);
    case 'ui': return base === 'logo' ? mk('_md', 768, 512) : null;
    case 'mini': return w === h ? mk('_md', 512, 512) : h > w ? mk('_md', 512, 768) : mk('_md', 768, 512);
    default: return null;
  }
}

// ---------------------------------------------------------------- helpers
function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}
const readInfo = (abs) => { try { return pngInfo(fs.readFileSync(abs)); } catch { return null; } };
const bytes = (rel) => { try { return fs.statSync(path.join(OUT_DIR, rel)).size; } catch { return 0; } };
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
const rel2url = (rel) => `images/${rel}`;

// ---------------------------------------------------------------- main
export function optimize({ force = false, reportOnly = false } = {}) {
  const entries = JSON.parse(fs.readFileSync(MANIFEST_IN, 'utf8'));
  const rows = []; // { key, file, variant? }
  const made = [];
  for (const e of entries) {
    const abs = path.join(OUT_DIR, e.file);
    if (!fs.existsSync(abs)) continue;
    const info = readInfo(abs);
    const v = info ? variantFor(e.file, info.width, info.height) : null;
    const row = { key: e.key, file: e.file, variant: v };
    rows.push(row);
    if (!v || reportOnly) continue;
    const vAbs = path.join(OUT_DIR, v.rel);
    const stale = !fs.existsSync(vAbs) || fs.statSync(vAbs).mtimeMs < fs.statSync(abs).mtimeMs;
    if (force || stale) {
      execFileSync('sips', ['-z', String(v.h), String(v.w), abs, '--out', vAbs], { stdio: 'ignore' });
      const vi = readInfo(vAbs);
      if (!vi || vi.width !== v.w || vi.height !== v.h) throw new Error(`sips produced the wrong size for ${v.rel}`);
      made.push(v.rel);
    }
  }

  // ---- pick the file each manifest points at
  const board = {};
  const phone = {};
  for (const r of rows) {
    const full = r.file;
    const md = r.variant ? r.variant.rel : full;
    const k = r.key;
    // BOARD: keep every key. Textures / icons / SFX words / logo / fly_* flap frames -> _md; heroes (incl. faces) stay full 1024.
    if (/^(icon_|sfx_word_|tex_|fly_)/.test(k) || k === 'logo_title') board[k] = md;
    else if (/^hero_.+_face$/.test(k)) board[k] = md; // HUD avatars are ~48 px: the 256 _sm file is plenty
    else if (isMiniKey(k) && BOARD_MINI_VARIANT === 'md') board[k] = md;
    else board[k] = full;
    // PHONE: hero faces (_sm), hero bodies / gems / npc / icons / fly_* flap frames / mini-game art (_md), nothing else.
    if (/^(hero_|gem_|npc_|icon_|fly_)/.test(k) || isMiniKey(k) || k === 'logo_title') phone[k] = md;
  }

  const asManifest = (m) => Object.fromEntries(Object.entries(m).map(([k, rel]) => [k, rel2url(rel)]));
  if (!reportOnly) {
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(asManifest(board), null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'manifest-phone.json'), JSON.stringify(asManifest(phone), null, 2) + '\n');
  }

  // ---- byte report: "before" = the originals of the same keys, "after" = what the manifest points at
  const fileOf = new Map(rows.map((r) => [r.key, r.file]));
  const sum = (m, pick) => Object.entries(m).reduce((s, [k, rel]) => s + bytes(pick(k, rel)), 0);
  const allOriginals = rows.reduce((s, r) => s + bytes(r.file), 0);
  const report = {
    keys: rows.length,
    allOriginalsBytes: allOriginals,
    board: { keys: Object.keys(board).length, beforeBytes: sum(board, (k) => fileOf.get(k)), afterBytes: sum(board, (k, rel) => rel) },
    phone: { keys: Object.keys(phone).length, beforeBytes: sum(phone, (k) => fileOf.get(k)), afterBytes: sum(phone, (k, rel) => rel) },
    variantsMade: made.length,
  };
  console.log(`variants made: ${made.length}${reportOnly ? ' (report only)' : ''}`);
  console.log(`manifest.json       (board, ${report.board.keys} keys): ${mb(report.board.beforeBytes)} -> ${mb(report.board.afterBytes)}`);
  console.log(`manifest-phone.json (phone, ${report.phone.keys} keys): ${mb(report.phone.beforeBytes)} -> ${mb(report.phone.afterBytes)}   (old phone fetch of the full manifest.json: ${mb(allOriginals)})`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  optimize({ force: process.argv.includes('--force'), reportOnly: process.argv.includes('--report') });
}
