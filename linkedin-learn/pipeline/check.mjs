/* check.mjs — validate the library data. Exits non-zero on any error.
   Run: node pipeline/check.mjs */
import { loadLibraryFromJs } from "./lib/load-library.mjs";

const errors = [];
const warns = [];
function err(m) { errors.push(m); }
function warn(m) { warns.push(m); }

let lib;
try { lib = loadLibraryFromJs(); } catch (e) { console.error("FATAL: could not load library.js —", e.message); process.exit(2); }

const DIFF = ["intro", "core", "advanced"];
const topicIds = new Set((lib.topics || []).map(t => t.id));

if (!Array.isArray(lib.topics) || !lib.topics.length) err("topics[] is empty");
lib.topics.forEach((t, i) => {
  if (!t.id) err(`topic[${i}] missing id`);
  if (!t.label) err(`topic ${t.id}: missing label`);
  if (!/^#|rgb|var/.test(t.color || "")) err(`topic ${t.id}: missing/odd color`);
});

const ids = new Set();
if (!Array.isArray(lib.articles) || !lib.articles.length) err("articles[] is empty");
lib.articles.forEach((a, i) => {
  const where = `article[${i}] ${a.id || "(no id)"}`;
  if (!a.id) err(`${where}: missing id`);
  if (ids.has(a.id)) err(`${where}: duplicate id`); ids.add(a.id);
  ["title", "author", "source", "url", "summary"].forEach(k => { if (!a[k]) err(`${where}: missing ${k}`); });
  if (!/^https?:\/\//.test(a.url || "")) err(`${where}: url is not absolute`);
  if (DIFF.indexOf(a.difficulty) < 0) err(`${where}: difficulty "${a.difficulty}" not in ${DIFF}`);
  if (!Number.isFinite(a.readingTimeMin) || a.readingTimeMin <= 0) err(`${where}: bad readingTimeMin`);
  if (!Array.isArray(a.topics) || !a.topics.length) err(`${where}: no topics`);
  (a.topics || []).forEach(tid => { if (!topicIds.has(tid)) err(`${where}: unknown topic "${tid}"`); });
  if (!Array.isArray(a.keyTakeaways) || a.keyTakeaways.length < 3) warn(`${where}: fewer than 3 key takeaways`);
  if (!Array.isArray(a.flashcards) || a.flashcards.length < 2) warn(`${where}: fewer than 2 flashcards`);
  (a.flashcards || []).forEach((f, k) => { if (!f.front || !f.back) err(`${where}: flashcard[${k}] missing front/back`); });
  if (!Array.isArray(a.quiz) || a.quiz.length < 3) err(`${where}: quiz has < 3 questions`);
  (a.quiz || []).forEach((q, k) => {
    const qw = `${where} quiz[${k}]`;
    if (!q.q) err(`${qw}: missing question text`);
    if (!Array.isArray(q.options) || q.options.length < 2) err(`${qw}: needs >=2 options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) err(`${qw}: answer index out of range`);
    if (new Set(q.options).size !== (q.options || []).length) warn(`${qw}: duplicate option text`);
    if (!q.explain) warn(`${qw}: missing explanation`);
  });
});

(lib.paths || []).forEach((p, i) => {
  if (!p.id || !p.title) err(`path[${i}]: missing id/title`);
  (p.articleIds || []).forEach(id => { if (!ids.has(id)) err(`path ${p.id}: references unknown article "${id}"`); });
});

const n = lib.articles.length;
const totalQ = lib.articles.reduce((s, a) => s + (a.quiz ? a.quiz.length : 0), 0);
console.log(`\nLinkedIn Learn — data check`);
console.log(`  source: ${lib.meta?.source}   articles: ${n}   topics: ${lib.topics.length}   quiz questions: ${totalQ}   paths: ${(lib.paths||[]).length}`);
warns.forEach(w => console.log("  ⚠ " + w));
if (errors.length) { console.log("\n✗ FAIL\n" + errors.map(e => "  • " + e).join("\n") + "\n"); process.exit(1); }
console.log(`\n✓ PASS — ${warns.length} warning(s), 0 errors\n`);
