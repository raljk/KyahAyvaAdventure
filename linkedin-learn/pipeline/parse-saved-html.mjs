/* parse-saved-html.mjs
   Reads a saved LinkedIn "Saved posts" page (My items -> Saved posts, saved via
   Ctrl/Cmd+S as a complete web page, .html or .mhtml) from pipeline/input/ and
   extracts one record per saved item into pipeline/cache/items.json.

   Works with cheerio when installed; falls back to a regex pass otherwise.
   Run: node pipeline/parse-saved-html.mjs [path-to-file]
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, "input");
const CACHE = path.join(__dirname, "cache");

function pickInput() {
  const arg = process.argv[2];
  if (arg) return arg;
  const files = fs.readdirSync(INPUT_DIR).filter(f => /\.(html?|mhtml|txt)$/i.test(f) && f !== ".gitkeep");
  if (!files.length) { console.error("No .html/.mhtml file found in pipeline/input/. Save your LinkedIn 'Saved posts' page there first."); process.exit(1); }
  // newest first
  files.sort((a, b) => fs.statSync(path.join(INPUT_DIR, b)).mtimeMs - fs.statSync(path.join(INPUT_DIR, a)).mtimeMs);
  return path.join(INPUT_DIR, files[0]);
}

function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function canonical(url) {
  try { const u = new URL(url); u.hash = ""; u.search = ""; return u.toString().replace(/\/$/, ""); }
  catch { return url; }
}
const ITEM_RE = /\/(feed\/update|posts|pulse|learning)\//;

async function parseWithCheerio(html) {
  let cheerio;
  try { cheerio = await import("cheerio"); } catch { return null; }
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!ITEM_RE.test(href)) return;
    const url = canonical(href.startsWith("http") ? href : "https://www.linkedin.com" + href);
    const container = $(el).closest("li").length ? $(el).closest("li") : $(el).closest("[data-chameleon-result-urn], .entity-result, .reusable-search__result-container").first();
    const scope = container.length ? container : $(el).parent();
    const text = clean(scope.text());
    const key = url;
    if (seen.has(key)) return; seen.add(key);
    // best-guess author = first person-ish line; title = longest line
    const lines = text.split(/•|·|\n/).map(clean).filter(l => l.length > 2);
    const title = clean($(el).text()) || lines.sort((a, b) => b.length - a.length)[0] || url;
    out.push({ url, title: title.slice(0, 200), author: "", source: url.includes("/pulse/") ? "LinkedIn Article" : "LinkedIn Post", snippet: text.slice(0, 600) });
  });
  return out;
}

function parseWithRegex(html) {
  const out = [];
  const seen = new Set();
  const re = /href="([^"]*(?:feed\/update|posts|pulse|learning)\/[^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].replace(/&amp;/g, "&");
    const url = canonical(href.startsWith("http") ? href : "https://www.linkedin.com" + href);
    if (seen.has(url)) continue; seen.add(url);
    out.push({ url, title: url, author: "", source: url.includes("/pulse/") ? "LinkedIn Article" : "LinkedIn Post", snippet: "" });
  }
  return out;
}

(async function main() {
  const file = pickInput();
  console.log("Parsing", file);
  const html = fs.readFileSync(file, "utf8");
  let items = await parseWithCheerio(html);
  if (!items) { console.log("(cheerio not installed — using regex fallback; run `npm install` for better parsing)"); items = parseWithRegex(html); }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, "items.json"), JSON.stringify(items, null, 2));
  console.log(`Extracted ${items.length} saved item(s) -> pipeline/cache/items.json`);
  if (!items.length) console.log("Nothing matched. Make sure you scrolled to the bottom before saving, and saved the full page.");
})();
