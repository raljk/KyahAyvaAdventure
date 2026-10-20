/* fetch-articles.mjs
   For each item in cache/items.json, fetch the public page and extract readable
   text. LinkedIn member posts usually sit behind an authwall; those keep only the
   snippet captured from the saved page. Public articles (Pulse, external links)
   get their full text. Output: cache/fetched.json
   Run: node pipeline/fetch-articles.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, "cache");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function metaTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og) return og[1];
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? t[1].trim() : "";
}
function isAuthwall(url, status, html) {
  if (status === 401 || status === 403 || status === 999) return true;
  if (/\/authwall|\/login|\/uas\/login|session_redirect/.test(url)) return true;
  if (/Sign in to view|Join LinkedIn|authwall/i.test(html.slice(0, 4000))) return true;
  return false;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async function main() {
  const itemsPath = path.join(CACHE, "items.json");
  if (!fs.existsSync(itemsPath)) { console.error("Run parse-saved-html.mjs first (no cache/items.json)."); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let status = 0, text = "", title = it.title, authwalled = false, finalUrl = it.url;
    try {
      const res = await fetch(it.url, { headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml" }, redirect: "follow" });
      status = res.status; finalUrl = res.url || it.url;
      const html = await res.text();
      authwalled = isAuthwall(finalUrl, status, html);
      if (!authwalled) { const t = metaTitle(html); if (t) title = t; text = stripHtml(html).slice(0, 12000); }
    } catch (e) { status = -1; text = ""; }
    const words = text ? text.split(/\s+/).length : 0;
    out.push({ ...it, title, finalUrl, httpStatus: status, authwalled, readingTimeMin: Math.max(1, Math.round(words / 220)) || 3, text });
    process.stdout.write(`\r  fetched ${i + 1}/${items.length} (${authwalled ? "authwall" : status})      `);
    await sleep(400);
  }
  process.stdout.write("\n");
  fs.writeFileSync(path.join(CACHE, "fetched.json"), JSON.stringify(out, null, 2));
  const open = out.filter(o => !o.authwalled && o.text).length;
  console.log(`Fetched ${out.length} item(s); ${open} returned readable public text, ${out.length - open} are authwalled/empty (snippet only).`);
})();
