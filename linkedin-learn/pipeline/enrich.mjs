/* enrich.mjs
   Turns cache/fetched.json into fully enriched article objects (summary, key
   takeaways, flashcards, quiz, topics, difficulty) in cache/enriched.json.

   Two modes:
   - If ANTHROPIC_API_KEY is set, each article is summarised by the Claude API
     (model via ANTHROPIC_MODEL, default below). Grounded strictly in fetched text.
   - Otherwise a lightweight heuristic fills summary/takeaways from the text and
     marks needsReview=true, so you (or Claude in a session) can finish the few
     that need a human read.
   Run: node pipeline/enrich.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./lib/taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, "cache");
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const BASE = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");

function slug(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || ("item-" + Math.random().toString(36).slice(2, 7)); }
function sentences(t) { return (t || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(s => s.length > 30); }
function difficultyFromWords(w) { return w > 2200 ? "advanced" : w > 1100 ? "core" : "intro"; }

function heuristic(it) {
  const body = it.text || it.snippet || "";
  const sent = sentences(body);
  const summary = sent.slice(0, 3).join(" ") || `Saved from ${it.source}. Open the original to read it in full.`;
  const takeaways = sent.slice(0, 6).map(s => s.slice(0, 140));
  return {
    id: slug(it.title) || slug(it.url),
    title: it.title || it.url, author: it.author || it.source || "Unknown", source: it.source || "LinkedIn",
    url: it.finalUrl || it.url, publishedAt: "", readingTimeMin: it.readingTimeMin || 4,
    difficulty: difficultyFromWords((body.split(/\s+/).length) || 0),
    topics: classify(it.title + " " + body),
    provenance: it.authwalled ? "snippet" : "fetched",
    needsReview: true,
    summary,
    keyTakeaways: takeaways.length ? takeaways : ["Open the original article to capture its key points."],
    flashcards: [{ front: "What is this article about?", back: summary.slice(0, 180) }],
    quiz: [{ q: "This saved item still needs a quiz. Open it to generate one.", options: ["Got it", "Skip for now"], answer: 0, explain: "Run enrichment with an API key, or ask Claude to write questions from the fetched text." }]
  };
}

async function viaClaude(it) {
  const body = (it.text || it.snippet || "").slice(0, 9000);
  if (!body || body.length < 200) return heuristic(it);
  const prompt = `From the article text below, return ONLY compact JSON with keys: summary (3 neutral sentences), keyTakeaways (5-7 short strings), flashcards (3 x {front,back}), quiz (5 x {q,options[4],answer 0-3 int,explain 1 sentence}), difficulty ("intro"|"core"|"advanced"). Ground everything strictly in the text; do not invent facts.\n\nTITLE: ${it.title}\n\nTEXT:\n${body}`;
  try {
    const res = await fetch(BASE + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1600, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    const txt = (data.content && data.content[0] && data.content[0].text) || "";
    const json = JSON.parse(txt.replace(/^```json?|```$/g, "").trim());
    return {
      id: slug(it.title) || slug(it.url),
      title: it.title || it.url, author: it.author || it.source || "Unknown", source: it.source || "LinkedIn",
      url: it.finalUrl || it.url, publishedAt: "", readingTimeMin: it.readingTimeMin || 5,
      difficulty: json.difficulty || "core", topics: classify(it.title + " " + body),
      provenance: "fetched", summary: json.summary, keyTakeaways: json.keyTakeaways,
      flashcards: json.flashcards, quiz: json.quiz
    };
  } catch (e) { const h = heuristic(it); h.enrichError = String(e).slice(0, 120); return h; }
}

(async function main() {
  const fp = path.join(CACHE, "fetched.json");
  if (!fs.existsSync(fp)) { console.error("Run fetch-articles.mjs first (no cache/fetched.json)."); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(fp, "utf8"));
  const out = [];
  const ids = new Set();
  for (let i = 0; i < items.length; i++) {
    const art = API_KEY ? await viaClaude(items[i]) : heuristic(items[i]);
    while (ids.has(art.id)) art.id += "-" + (i + 1); ids.add(art.id);
    out.push(art);
    process.stdout.write(`\r  enriched ${i + 1}/${items.length}${API_KEY ? " (Claude)" : " (heuristic)"}      `);
  }
  process.stdout.write("\n");
  fs.writeFileSync(path.join(CACHE, "enriched.json"), JSON.stringify(out, null, 2));
  const need = out.filter(o => o.needsReview).length;
  console.log(`Enriched ${out.length} article(s) -> pipeline/cache/enriched.json`);
  if (!API_KEY) console.log("No ANTHROPIC_API_KEY set: used the heuristic. Set the key and re-run for full summaries/quizzes, or ask Claude to enrich cache/fetched.json in a session.");
  if (need) console.log(`${need} article(s) marked needsReview.`);
})();
