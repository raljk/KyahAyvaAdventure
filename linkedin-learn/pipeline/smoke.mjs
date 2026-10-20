/* smoke.mjs — drive the real site headless: exercise every view, play a full
   quiz, capture desktop + mobile screenshots, and fail on any console/page error.
   Usage: node pipeline/smoke.mjs [outDir]
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, "..", "docs", "grader-reports", "_smoke");
const PORT = 4100 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn("node", [path.join(__dirname, "serve.mjs"), String(PORT)], { stdio: "ignore" });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const errors = [];
let shotN = 0;
async function shot(page, name) { const f = path.join(OUT, `${String(++shotN).padStart(2, "0")}-${name}.png`); await page.screenshot({ path: f }); return path.basename(f); }

(async function run() {
  await sleep(700);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => errors.push("reqfail: " + r.url() + " " + (r.failure() && r.failure().errorText)));

  const checks = [];
  function ok(name, cond, note) { checks.push({ name, pass: !!cond, note: note || "" }); }

  // Dashboard
  await page.goto(BASE + "/#/", { waitUntil: "networkidle" });
  await sleep(900);
  ok("dashboard h1", await page.locator(".hero h1").count() > 0);
  ok("progress ring", await page.locator(".ring-fill").count() > 0);
  ok("stat tiles = 4", await page.locator(".stat").count() === 4);
  ok("topic bars", await page.locator(".topic-bar").count() >= 8);
  await shot(page, "dashboard");

  // Library + filter + search
  await page.goto(BASE + "/#/library", { waitUntil: "networkidle" });
  await sleep(300);
  const cardCount = await page.locator(".card").count();
  ok("library cards", cardCount === 9, `${cardCount} cards`);
  await page.locator('[data-topic="ai-design"]').click(); await sleep(200);
  const aiCards = await page.locator(".card").count();
  ok("topic filter narrows", aiCards > 0 && aiCards < 9, `${aiCards} ai cards`);
  await page.locator('[data-topic="all"]').click(); await sleep(150);
  await page.fill("#globalSearch", "service"); await sleep(400);
  ok("search works", await page.locator(".card").count() > 0 && await page.locator(".card").count() < 9);
  await page.fill("#globalSearch", ""); await sleep(300);
  await shot(page, "library");

  // Article
  await page.goto(BASE + "/#/article/designing-with-ai", { waitUntil: "networkidle" });
  await sleep(300);
  ok("article h1", (await page.locator(".article h1").innerText()).length > 5);
  ok("summary callout", await page.locator(".callout").count() === 1);
  ok("takeaways", await page.locator(".takeaways li").count() >= 5);
  ok("flashcard present", await page.locator(".flashcard").count() > 0);
  await page.locator(".flashcard").first().click(); await sleep(400);
  ok("flashcard flips", await page.locator(".flashcard.flipped").count() > 0);
  await shot(page, "article");

  // Quiz — answer every question
  await page.goto(BASE + "/#/quiz/designing-with-ai", { waitUntil: "networkidle" });
  await sleep(300);
  let guard = 0;
  while (await page.locator(".options").count() && guard++ < 12) {
    await page.locator(".option").first().click();
    await sleep(150);
    ok("explanation shows", await page.locator(".explain").count() > 0);
    const next = page.locator("[data-next]");
    await next.click(); await sleep(250);
    if (await page.locator(".score-card").count()) break;
  }
  ok("quiz reaches score", await page.locator(".score-card").count() > 0);
  await shot(page, "quiz-result");

  // Flashcards + Paths + About
  await page.goto(BASE + "/#/flashcards", { waitUntil: "networkidle" }); await sleep(300);
  ok("all flashcards deck", await page.locator(".flash-deck").count() > 0);
  await shot(page, "flashcards");
  await page.goto(BASE + "/#/paths", { waitUntil: "networkidle" }); await sleep(400);
  ok("paths render", await page.locator(".path").count() >= 3);
  await shot(page, "paths");
  await page.goto(BASE + "/#/about", { waitUntil: "networkidle" }); await sleep(200);
  ok("about render", await page.locator(".steps li").count() >= 3);

  // Accessibility basics
  ok("skip link", await page.locator(".skip-link").count() === 1);
  ok("single h1 on view", (await page.locator("#view h1").count()) >= 1);
  const unlabeled = await page.locator("button:not([aria-label]):empty").count();
  ok("no empty unlabeled buttons", unlabeled === 0, `${unlabeled} found`);

  // Dark theme + mobile
  await page.goto(BASE + "/#/", { waitUntil: "networkidle" });
  await page.locator("#themeToggle").click(); await page.locator("#themeToggle").click(); await sleep(300); // auto->light->dark
  ok("dark theme applies", (await page.getAttribute("html", "data-theme")) === "dark");
  await shot(page, "dashboard-dark");
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mob.newPage();
  await mp.goto(BASE + "/#/library", { waitUntil: "networkidle" }); await sleep(500);
  const bodyScroll = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok("no horizontal scroll (mobile)", bodyScroll);
  await mp.screenshot({ path: path.join(OUT, "99-mobile-library.png") });

  await browser.close();
  server.kill();

  const failed = checks.filter(c => !c.pass);
  const report = { when: new Date().toISOString(), base: BASE, consoleErrors: errors, checks, passed: checks.length - failed.length, failed: failed.length };
  fs.writeFileSync(path.join(OUT, "smoke.json"), JSON.stringify(report, null, 2));
  console.log(`\nSmoke: ${report.passed}/${checks.length} checks passed, ${errors.length} console/page error(s).`);
  checks.forEach(c => console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.note ? " — " + c.note : ""}`));
  if (errors.length) { console.log("\nConsole/page errors:"); errors.forEach(e => console.log("  • " + e)); }
  console.log("Screenshots in", OUT);
  process.exit(errors.length || failed.length ? 1 : 0);
})().catch((e) => { console.error(e); server.kill(); process.exit(2); });
