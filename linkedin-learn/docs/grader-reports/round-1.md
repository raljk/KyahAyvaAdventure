# Grader report — LinkedIn Learn — Round 1

Date: 2026-10-20 · Grader: independent QA · Library: starter (9 articles, 45 quiz questions, 4 paths)
Automated gates: `node pipeline/check.mjs` → **0 errors / 0 warnings**. `node pipeline/smoke.mjs` → **26/26 checks, 0 console errors**. My own Playwright probe (desktop 1366×900, mobile 390 & 360, reduced-motion, storage-blocked) → **0 console/page/request errors across every route and context**.

## Scores

| # | Area | Weight | Score (1–10) |
|---|------|:------:|:---:|
| 1 | Content quality & accuracy | 25% | 8 |
| 2 | Learning UX | 25% | 7 |
| 3 | Visual design & polish | 20% | 7 |
| 4 | Interactivity & feedback | 15% | 9 |
| 5 | Accessibility & robustness | 15% | 7 |
| | **Weighted overall** | 100% | **7.55** |

Weighted = 8(.25) + 7(.25) + 7(.20) + 9(.15) + 7(.15) = 2.00 + 1.75 + 1.40 + 1.35 + 1.05 = **7.55**.

## Verdict: **FAIL**

The bar is *every area ≥ 8 and overall ≥ 8.5*. Overall is 7.55, and areas 2, 3 and 5 sit at 7. No area is below 7, so there is no hard block — but three areas miss the ≥8 bar and the weighted overall misses 8.5. The product is genuinely strong (see "What already feels great"); the gap to sign-off is a tight, fixable defect list led by one rendering bug that disfigures the main browse surface.

---

## Area 1 — Content quality & accuracy — 8/10

I verified all 45 quiz items by hand: every marked `answer` index is correct for its `options`, and every `explain` matches. The "which is NOT" items (product risks, disability types, service-encounter parts) are all correctly keyed. Takeaway counts are all ≥5 (atomic-design has exactly 5; others 6–7). I HEAD-checked all 9 `url`s: 8 return 200; Punchcut returns 403 (Cloudflare bot-block, the path exists — not a 404). `library.json` and `library.js` are byte-for-byte equal in content (deep-equal verified).

Defects, by impact:
1. **Provenance is asserted but not independently verifiable.** `site/data/library.js` marks all 9 articles `"provenance": "fetched"` and the file header states "Every article below was fetched from its public source and summarised from that text," but `pipeline/cache/` is empty (git-ignored) and this is a hand-authored starter set. The rubric explicitly grades "provenance is honest (`fetched` vs `snippet`)." Fix: either keep a committed, redacted `pipeline/cache/fetched.json` excerpt the summaries were drawn from, or change the header/`provenance` wording for the starter set to "curated from the public source" so the claim matches what can be shown.
2. **Two sources and one statistic can't be confirmed from here and should be spot-checked against the live page.** `prompt-engineering-for-designers` quiz Q4 (`library.js` ~line 237) asserts "McKinsey 2025 survey … 21% redesigned workflows / 27% checked all gen-AI content"; `ai-reshaping-ux-2026` (Punchcut, 403) and `prompt-engineering-for-designers` (Parallel) are 2026 sources I could not fetch. These read as plausible and internally consistent, but a stat quoted this precisely needs to be checked verbatim against the article before it ships as a graded fact. Fix: open each source, confirm the number and the COSTAR/Google-guidance attributions, and correct or soften any that don't appear verbatim.
3. **A few quiz items test the author's broader framework rather than the linked page.** `product-vs-feature-teams` Q3 (four product risks) and Q4 (tech lead owns feasibility) (`library.js` ~lines 102–103) are correct Cagan doctrine but come from his wider body of work, not necessarily the 2019 post at the given `url`. Fix: either confirm they appear in that specific post, or swap for questions grounded in that page's actual content so "grounded in the real source" holds literally.

## Area 2 — Learning UX — 7/10

The functional loop is complete and correct. I confirmed filters compose (ai-design + search "prompt" → 3; ai-design + Intro → 1), the result count updates ("3 articles matching \"prompt\""), both empty states are friendly (no-match and bookmarks-none), sort works (read-asc surfaces the 6-min intro first), article→quiz→result→retake has no dead ends, flashcards flip/next/prev/shuffle/mark-known all work, and progress persists across a hard reload (ring 11%, tiles [1,1,80%,1] unchanged; flashcard "known" survived). Paths group all 9 articles with no orphans and show per-path completion.

Defects, by impact:
1. **The active "All topics" / "All levels" / difficulty / bookmark chips are invisible on the default light theme.** This is the same root cause as Area 3 #1 (`css/style.css:213` sets `color:#fff` on pressed chips, but only topic chips get an inline background in `js/app.js:121`). On first load the Library shows two blank white pills where "All topics" and "All levels" should be (see `round-1/02-library.png` and `round-1/probe-mobile-library-360.png`); selecting Intro/Core/Advanced or ★ Bookmarked makes the chosen chip vanish too. Clicking still works, but the user cannot see the current filter state on the primary browse surface. Fix: see Area 3 #1 (give the pressed state a default background).
2. **The hero's "Continue where you left off" shows for brand-new users.** `js/app.js:54-55,73` — `continueCards` falls back to unread articles, so a first-time user with zero progress still sees a "Continue where you left off" button pointing at an article they've never opened, while the section heading below correctly says "Start here." Fix: only render that CTA when a `reading` article exists (reuse the same condition already used for the section title on line 96), otherwise label it "Start with …".
3. **The quiz's running-score readout lags one question and reads "0/0" on Q1.** `js/app.js:325` renders `Score: correct/i`, where `i` is the current zero-based index, so Q1 always shows "Score: 0/0" even after you answer it correctly, and each later question shows the tally *excluding* the current one (visible in `round-1/probe-quiz-dark-feedback.png`). Fix: track an `answeredCount` and show `correct/answeredCount`, updated when an option is picked, or hide the readout until the first answer.

## Area 3 — Visual design & polish — 7/10

The system is clean and modern — consistent spacing, type scale, cards, hero gradient, progress ring, path cards — and both themes look intentional (`round-1/01-dashboard.png` vs `07-dashboard-dark.png`). The auto default respects the OS, the manual toggle cycles auto→light→dark, there is no horizontal scroll from 360→1440, the sidebar collapses to a drawer with a scrim, and motion is eased and gated by `prefers-reduced-motion`. The defects are concrete rendering/contrast problems, not a weak system.

Defects, by impact:
1. **White-on-white chips = blank pills on the main surface (the single most damaging visual bug).** `css/style.css:213` `.chip[aria-pressed="true"] { color:#fff; border-color:transparent; }` assumes every pressed chip has a dark background, but only topic chips set one (`js/app.js:121`). The "All topics", "All levels", difficulty and "★ Bookmarked" chips have no background, so their white text lands on `var(--surface)` (#fff) at 1:1 contrast — fully invisible in light mode (fine in dark, which is why it's easy to miss). Fix: add a default fill to the pressed rule, e.g. `.chip[aria-pressed="true"]{ background:var(--brand); color:#fff; border-color:transparent; }` — topic chips already override `background` inline, so they keep their colour.
2. **Topic tag text fails contrast on several colours.** `css/style.css:234` `.tag` is white 11px bold on the raw topic colour. Measured white-on-colour ratios: Design Systems `#F59E0B` ≈ **2.15:1**, UX Research `#6C8EF5` ≈ 3.08:1, Leadership `#0EA5E9` and Service Design `#27B5A8` similar — all below the 4.5:1 AA minimum for this small text (worst case the amber tag, visible on the Atomic Design card in `02-library.png`). Fix: render tags as the topic colour on a tinted background (as the active nav item does with `color-mix`), or darken the tag palette in `library.js:24-31` to ~4.5:1 against white.
3. **The "STARTER" badge overlaps the search field on narrow screens.** `round-1/probe-mobile-library-360.png` and `probe-mobile-drawer.png` show the badge sitting on top of the search placeholder ("…aut**STARTER**"). `css/style.css:119-140` — the topbar row doesn't reserve space for `.topbar-right`/`.badge`, and `.search` (max-width 560, flex 1) crowds it at ≤~400px. Fix: hide the badge below ~480px (`.badge{ display:none }` in the mobile query) or give `.topbar-right` `flex:none` and let the search shrink further.
4. **`--text-3` secondary text fails AA in light mode.** `css/style.css:15` `--text-3:#868ca2` ≈ **3.1–3.3:1** on the light background/surface, and it's used for genuinely small text: `.result-count`, `.card-foot`, `.section-title`, `.q-counter`, `.flash-hint`, `.badge`. Fix: darken the light-mode token to roughly `#6b7186` (≈4.6:1) — the dark-mode value (`#7c8299`, ≈4.5:1) is already borderline fine.
5. **Developer leftover in source: a Cyrillic character in an element id.** `js/app.js:325` writes `id="nextБtn"` (the "Б" is U+0411, not ASCII "B"). It's unreferenced (the code uses `[data-next]`) so nothing breaks, but it's exactly the kind of leftover the rubric flags and will trip strict lint/CI. Fix: rename to `id="nextBtn"` or drop the id.

## Area 4 — Interactivity & feedback — 9/10

Strongest area. The quiz gives immediate right/wrong feedback with the correct option highlighted and the explanation shown (verified a deliberate wrong answer: the chosen option got `.wrong`, the real answer `.correct`, explanation correct); the score is computed correctly (1 wrong of 5 → 80%; 2 of 5 → 40%); a pass (≥70%) fires confetti and a 🎉 card, a fail shows 📖 and "worth another read." The dashboard ring, topic bars and stat counters animate on load; the flashcard does a real 3D flip; toasts confirm bookmark/complete/reset. State (status, best score, bookmarks, flashcard "known", streak, theme) survives reload, and — importantly — I blocked `localStorage` entirely (private-mode simulation) and the app still rendered and the quiz was still answerable with zero errors, confirming the guarded store and in-memory fallback work.

Defects, by impact:
1. **Minor: the in-quiz score readout is confusing (duplicated from Area 2 #3).** `js/app.js:325` shows "Score: 0/0" on Q1 and trails one question behind. Low severity because the final score card is correct; still worth fixing for the feedback this area grades.

## Area 5 — Accessibility & robustness — 7/10

Keyboard support is good: a skip link, a visible `:focus-visible` ring (3px brand outline), cards operable by Enter/Space (verified Enter on a focused card navigates), quiz options and flashcards reachable, plus number-key 1–4 shortcuts (bonus). Robustness is excellent: zero console/page/request errors on any route in any viewport, works with storage blocked, and `index.html` opens from disk because `library.js` assigns `window.LIBRARY` via a plain (non-module) script. Semantics and contrast are where it loses ground.

Defects, by impact:
1. **Missing `<h1>` on the quiz, results and not-found views (rubric bullet: "one `<h1>` per view").** Confirmed by probe: `#/quiz/*` → **h1=0** (the question is a `.q-text` div), the score card → no h1, and `#/nope-missing` → h1=0 with an h2 instead. `js/app.js` `renderQuiz` draw()/finish() (~lines 313–374) and `renderNotFound` (~line 426). Fix: add a visually-styled `<h1>` to the quiz (e.g. the article title or "Quiz: {title}"), give the results card an `<h1>`, and make not-found's heading an `<h1>`.
2. **The theme toggle's state is hidden from assistive tech.** `index.html` `#themeToggle` has a static `aria-label="Switch colour theme"`, which overrides the inner label text — so although `ui.js:applyTheme` updates the visible label to Auto/Light/Dark, a screen reader only ever hears "Switch colour theme, button" and never the current mode. There is also no `aria-pressed` (acceptable for a 3-state control, but then the name must carry the state). Fix: drop the static `aria-label` so the "Auto theme / Light / Dark" span becomes the accessible name, or make the `aria-label` dynamic in `applyTheme` (e.g. "Theme: dark. Activate to switch.").
3. **`aria-live="polite"` is on the entire view container.** `index.html` `<main id="view" aria-live="polite">` — every route re-writes `innerHTML`, so the whole page's text is announced on every navigation (an over-broad live-region anti-pattern), and it's redundant with the `view.focus()` already done on route change (`app.js:454`). Fix: remove `aria-live` from `#view` and announce just the view name via a small visually-hidden `aria-live` status element, or scope the live region to a short status line.
4. **Contrast failures (shared with Area 3 #2 and #4) also land here.** `--text-3` small text and white-on-colour tags fall below AA in light mode. Positive note: nothing is conveyed by colour alone — quiz feedback pairs colour with ✅/❌ and text, and card status uses a text label — so only the raw contrast ratios need raising.

---

## What already feels great
- **Zero console/page/request errors** on every route, both themes, mobile, reduced-motion, and with `localStorage` thrown — real robustness, not just a passing smoke test.
- **The quiz loop**: instant, correct feedback; honest scoring; confetti on pass; clean retake; and all 45 answers/explanations are factually right.
- **Dark theme** is genuinely designed, not an afterthought — see the quiz-with-feedback and dashboard dark shots; the OS-auto default plus manual cycle is a nice touch.
- **Progress model**: ring, stat tiles, topic-mastery bars, streak and path completion all animate, agree with each other, and persist across reloads.
- **Flashcards**: smooth 3D flip, prev/next/shuffle, and per-card "known" state that survives reload; the "All flashcards" deck (27 cards) is a lovely study surface.
- **Responsive drawer**: clean ☰ → slide-in sidebar with scrim and correct `aria-expanded`, and no horizontal scroll down to 360px.
- **Content writing**: summaries are plain-language and accurate, takeaways are substantive, and every article links back to a real source.

## Screenshots
All in `docs/grader-reports/round-1/`: `01-dashboard.png`, `02-library.png` (blank chips visible), `03-article.png`, `04-quiz-result.png`, `05-flashcards.png`, `06-paths.png`, `07-dashboard-dark.png`, `99-mobile-library.png`, plus probe shots `probe-dashboard-dark.png`, `probe-quiz-dark-feedback.png`, `probe-mobile-drawer.png`, `probe-mobile-library-360.png`, and `probe-log.txt` / `smoke.json`.
