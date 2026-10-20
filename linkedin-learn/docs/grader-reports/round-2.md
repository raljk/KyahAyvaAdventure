# Grader report — LinkedIn Learn — Round 2

Date: 2026-10-20 · Grader: independent QA (adversarial) · Library: starter (9 articles, 45 quiz questions, 4 paths)

Automated gates: `node pipeline/check.mjs` → **0 warnings / 0 errors**. `node pipeline/smoke.mjs` → **26/26 checks, 0 console errors**. My own Playwright probe — desktop 1366×900, mobile 390×844 and 360×780, storage-blocked (private-mode), reduced-motion — → **0 console / page / request errors across every route and context**. All 9 source `url`s HEAD-check **200** (including Punchcut, which was a 403 bot-block in round 1). All 45 quiz `answer` indices re-verified by hand against their `options`/`explain`: **all correct**.

## Scores

| # | Area | Weight | Score (1–10) |
|---|------|:------:|:---:|
| 1 | Content quality & accuracy | 25% | 8 |
| 2 | Learning UX | 25% | 8 |
| 3 | Visual design & polish | 20% | 8 |
| 4 | Interactivity & feedback | 15% | 8 |
| 5 | Accessibility & robustness | 15% | 8 |
| | **Weighted overall** | 100% | **8.00** |

Weighted = 8(.25) + 8(.25) + 8(.20) + 8(.15) + 8(.15) = 2.00 + 2.00 + 1.60 + 1.20 + 1.20 = **8.00**.

## Verdict: **FAIL**

The bar is *every area ≥ 8 and overall ≥ 8.5*. Every area now clears **8** (no hard block — nothing is below 7), which is real progress from round 1's 7.55. But the weighted overall is **8.00**, short of the 8.5 sign-off bar.

This is a much stronger build than round 1: **every one of the eight round-1 defects the developer set out to fix is genuinely fixed and verified** (table below). The gap to sign-off is now driven by a **single new, verified rendering bug** — the dashboard "Topic Mastery" bars render at zero width, so they never fill — which lands across Areas 2, 3 and 4 (the rubric names "topic bars" in all three), plus the still-unverifiable `"fetched"` provenance claim on the starter set, plus a few residual sub-AA contrast values. Fix the topic-bar fill (a one-line CSS change) and the two smaller items and this passes comfortably.

---

## Round-1 defects — fixed / not fixed

| # | Round-1 defect | Status | Evidence |
|---|----------------|:------:|----------|
| 1 | Blank/invisible pressed filter chips (white-on-white in light mode) | **FIXED** | `css/style.css:217` now `.chip[aria-pressed="true"]{ background:var(--brand); color:#fff; border-color:transparent }`. Probe: "All topics"/"All levels" compute `bg=rgb(109,91,245)` (not transparent) on desktop **and** at 390/360. See `probe-library-desktop.png`, `probe-mobile-360-library.png`. |
| 2 | Topic chips needed dark ink on their colour | **FIXED** | `js/app.js:120` sets `color:#15171f` inline. Probe: selected Design Systems chip computes `bg=rgb(245,158,11) color=rgb(21,23,31)`. `probe-library-topic-selected.png`. |
| 3 | Missing `<h1>` on quiz / results / not-found | **FIXED** | `#view h1` count = **exactly 1** on all 9 routes (dashboard, library, article, quiz, results, flashcards ×2, paths, about, not-found). Quiz/results use `sr-only` h1 (`app.js:315,367`); not-found has a visible h1 (`app.js:428`). |
| 4 | Tag + small-text (`--text-3`) contrast below AA | **FIXED** (one marginal) | Tags now dark ink `#15171f` (`style.css:238`): 7/8 topic colours pass AA (5.07–8.33:1); AI&Design purple is marginal at **4.22:1**. `--text-3` darkened to `#6b7085` (light) → 4.51–4.90:1 AA; dark `#7c8299` → 4.58–5.01:1 AA. |
| 5 | Theme-toggle aria state hidden from AT | **FIXED** | `ui.js:30` sets a dynamic `aria-label`. Probe cycle: "Colour theme: auto/light/dark. Activate to switch to …", tracking `data-theme` each click. |
| 6 | Over-broad `aria-live` on `#view` | **FIXED** | `index.html:50` `<main id="view">` no longer carries `aria-live`. (Note: no scoped view-name live region replaces it — see Area 5 #3.) |
| 7 | Mobile STARTER-badge overlapping the search | **FIXED** | `style.css:362-364` `@media (max-width:560px){ .topbar .badge{ display:none } }`. Probe at 360 & 390: badge `display=none`; `search.right=336 < topbarRight.left=344`, no overlap, no horizontal scroll. `probe-mobile-360-library.png`. |
| 8 | Quiz running-score "0/0" on Q1 and one-question lag | **FIXED** | `app.js:325` renders the scoreline only when `i>0`; `app.js:343` updates to `correct/(i+1)` on answer. Probe: Q1 initial = `""`, after a wrong pick = `Score: 0/1`, then `1/2 → 2/3 → 3/4 → 4/5`. `probe-quiz-feedback.png`. |

Bonus (not on the fix list but also verified fixed): the Cyrillic `id="nextБtn"` leftover is now ASCII `id="nextBtn"` (`app.js:325`), and the hero "Continue where you left off" CTA is now gated on an in-progress article (`app.js:72`) so new users no longer see it.

---

## Area 1 — Content quality & accuracy — 8/10

Re-verified all 45 quiz items by hand: every marked `answer` is correct for its `options` and every `explain` matches, including all four "which is NOT" items (product risks → scalability; disability types → culinary; service-encounter parts → budgets; and the atomic-design/Google-guidance keys). Takeaway counts all ≥ 5 (atomic-design = 5; others 6–7). All 9 `url`s now return **200** (Punchcut resolved since round 1). `check.mjs` passes with 0 errors; topics, difficulty and reading-time all plausible. The writing is plain-language and accurate.

Defects, by impact:
1. **Provenance is asserted but still not independently verifiable.** `site/data/library.js` header states "Every article below was fetched from its public source and summarised from that text," and all 9 items carry `"provenance":"fetched"`, but `pipeline/cache/` holds only `.gitkeep` (git-ignored) and this is a hand-authored starter set. The rubric explicitly grades "provenance is honest (`fetched` vs `snippet`)." Fix: commit a redacted `pipeline/cache/` excerpt the summaries were drawn from, **or** soften the header + set `provenance` to `"curated"`/`"snippet"` for the starter set so the claim matches what can be shown. (Carried over unchanged from round 1.)
2. **Two 2026 sources and one precise statistic can't be confirmed from here.** `prompt-engineering-for-designers` Q4 (`library.js:237`) asserts a "McKinsey 2025 survey … 21% redesigned workflows / 27% checked all gen-AI content"; `ai-reshaping-ux-2026` (Punchcut) and the Parallel piece are 2026 articles. All read as plausible and internally consistent, but a number quoted this exactly should be checked verbatim against the live page before it ships as a graded fact. Fix: open each source and confirm the figure and the COSTAR / Google-guidance attributions, correcting any that aren't verbatim.
3. **A couple of quiz items test the author's wider framework, not strictly the linked page.** `product-vs-feature-teams` Q3 (four product risks) and Q4 (tech lead owns feasibility) (`library.js:102-103`) are correct Cagan doctrine but come from his broader body of work rather than guaranteed-verbatim from the 2019 post at that `url`. Fix: confirm they appear in that specific post or swap for questions grounded in its actual content.

## Area 2 — Learning UX — 8/10

The functional loop is complete and correct, and all three round-1 UX defects are resolved. Verified: filters compose (ai-design + "prompt" → 3; + Intro → 1) with a live, correctly-pluralised count ("1 article matching \"prompt\""); both empty states are friendly; every sort works (title A–Z surfaces "Atomic Design…" first; shortest-first → 6/7/8 min); article → quiz → result → retake has no dead ends; flashcards flip / next / prev / shuffle / mark-known all work; and progress persists across a hard reload (ring 22%, tiles [2,1,80%,1], flashcard "known" survived). Paths group all 9 articles with no orphans and show per-path completion.

Defects, by impact:
1. **Dashboard "Topic Mastery" bars never fill, so topic progress isn't visible as bars.** `css/style.css:206` `.topic-bar .meter` is a `<span>` (`js/app.js:62`) left at `display:inline`, so its `width:…%`/`height:100%` are ignored and it renders at **0 px** — I measured `rectW:0` for bars whose computed width was 33 %, 50 %, 67 % and even 100 % (Design Systems 1/1). The sibling bars `.quiz-progress span` (`:289`) and `.path-track span` (`:328`) both set `display:block` and render fine. The numeric `done/total` beside each bar is still correct and visible, so no information is lost, but the rubric's "progress is visible … topic bars" is only half-met. See `probe-dashboard-progress.png` (bars flat despite 2/3, 1/1). **Fix: add `display:block` (or `inline-block`) to `.topic-bar .meter`.** One line.
2. **Minor: no "in-progress/reading" surfacing once an article is both opened and quizzed.** Marking an article done (or passing its quiz) flips it straight out of "reading," so the dashboard "Continue learning" heading only appears in the narrow window between opening an article and finishing it. Not a defect so much as a thin state; acceptable.

## Area 3 — Visual design & polish — 8/10

All five round-1 visual defects are fixed: pressed chips have a real fill, tags use dark ink and read clearly, the STARTER badge is hidden below 560 px, `--text-3` passes AA, and the Cyrillic id leftover is gone. The system is clean and modern — consistent spacing, type scale, cards, hero gradient, progress ring, path cards — and both themes look intentional (`probe-dashboard-dark.png`, `probe-library-dark.png`). No horizontal scroll 360→1440; the sidebar collapses to a drawer with a scrim (`probe-mobile-360-drawer.png`); motion is eased and `prefers-reduced-motion` is honoured (`style.css:371`).

Defects, by impact:
1. **The Topic Mastery bars render empty on the flagship screen** (root cause and fix in Area 2 #1, `css/style.css:206`). As a *polish* issue this is the most visible one: eight bars that look like empty grey tracks on the dashboard, including a 100 %-complete topic. High-impact-to-fix ratio — one property.
2. **Dark-mode pressed chip: white on light-purple fails AA.** `css/style.css:217` pressed chips use `background:var(--brand)`, which in dark theme is `#8b7bff`; white 13 px bold on it measures **3.29:1** (probe-confirmed `bg=rgb(139,123,255) color=white` for the active "Intro" chip, `probe-library-dark.png`). Fine in light (4.70:1). Fix: in dark mode give the pressed chip a darker brand fill or dark ink, e.g. `:root[data-theme="dark"] .chip[aria-pressed="true"]{ color:#15171f }`.
3. **A few small/decorative labels sit just below AA in light mode.** Card status words `good`/`warn` ≈ 3.30 / 3.19:1 (`style.css:246-247`, 12.5 px bold); the "STARTER" badge ≈ 2.20:1 (`style.css:142`, but decorative and hidden on mobile); active-nav brand-on-tint ≈ 3.92:1 (`style.css:111`). None conveys meaning by colour alone, so these are polish rather than blockers. Fix: nudge `--good`/`--warn` darker for small text, deepen the badge ink.

## Area 4 — Interactivity & feedback — 8/10

Still the strongest feel, and the round-1 "0/0" blemish is gone. The quiz gives immediate right/wrong feedback with the chosen option marked `.wrong`, the real answer `.correct`, and the explanation shown (verified a deliberate wrong pick on Q1: opt0 → `.wrong`, opt2 → `.correct`, "❌ Not quite…", `probe-quiz-feedback.png`); the running score tracks correctly (0/1 → 4/5) and the final card is right (80 %, "4 of 5 correct — nicely done", confetti, `probe-quiz-results.png`); retake resets to Q1. Dashboard ring animates and counters tween; the flashcard does a true 3-D flip; toasts confirm bookmark/complete/reset. State (status, best score, bookmarks, flashcard "known", streak, theme) survives reload, and with `localStorage` blocked entirely the app still renders and the quiz is still answerable (in-memory fallback, 0 errors).

Defects, by impact:
1. **One of the three dashboard-animated elements the rubric names does not animate.** "Progress ring, topic bars **and counters** animate on the dashboard" — ring ✓, counters ✓, but the **topic bars** never move because they render at 0 width (Area 2 #1 / Area 3 #1, `css/style.css:206`). This is the sole reason this area drops from round 1's 9. Same one-line fix.

## Area 5 — Accessibility & robustness — 8/10

Three of four round-1 a11y defects are fully fixed (h1 per view, dynamic theme-toggle name, over-broad live region removed) and contrast is largely fixed. Keyboard support is good: skip link, a visible 3 px `:focus-visible` ring (probe-confirmed on first Tab), cards operable by Enter (verified Enter on a focused card navigates), quiz options and flashcards reachable, number-key 1–4 shortcuts. Robustness is excellent: **zero console / page / request errors on every route in every viewport**, works with storage blocked, and `index.html` opens from disk because `library.js` assigns `window.LIBRARY` via a plain script.

Defects, by impact:
1. **Residual contrast: the dark-mode active chip (3.29:1) and a few small light-mode labels (~3.2:1).** Shared with Area 3 #2/#3. The dark pressed chip is the one that matters most, since it's an interactive control's own label. Fix as in Area 3.
2. **Marginal tag colour.** AI&Design tags are dark-ink on `#8B5CF6` at **4.22:1** (`library.js:26` / `style.css:238`), just under the 4.5:1 AA floor for 11 px bold (the other seven topics pass, 5.07–8.33:1). Fix: darken that one topic colour slightly (e.g. toward `#7c4ddb`) or bump tag font-size/weight to the large-text threshold.
3. **The per-view live region was removed but not replaced.** `index.html` dropped `aria-live` from `#view` (good — the old behaviour announced the whole page on every route change), but nothing announces the new view name now, so the rubric bullet "live region for the view" is unmet. Fix: add a small visually-hidden `aria-live="polite"` status node and write just the view title into it on each route.

---

## What already feels great
- **Every round-1 defect is genuinely fixed** — chips, h1s, tag/text contrast, theme aria, aria-live scope, mobile badge, quiz score — verified concretely, not just claimed.
- **Zero console / page / request errors** across desktop, mobile 390/360, storage-blocked and reduced-motion — real robustness, and the app still works with `localStorage` thrown.
- **The quiz loop**: instant, correct feedback with explanations; honest scoring; confetti on pass; clean retake — and all 45 answers/explanations are factually right.
- **Both themes are designed, not toggled** — the dark dashboard, library and quiz all look intentional, and the auto-default + 3-state cycle now carries its state to screen readers.
- **Filters, search, sort, empty states and persistence** all compose and survive reload; paths group the library with no orphans.
- **Flashcards**: smooth 3-D flip, prev/next/shuffle, per-card "known" that persists; the 27-card "All flashcards" deck is a lovely study surface.
- **Responsive drawer**: clean ☰ → slide-in with scrim and correct `aria-expanded`; no horizontal scroll down to 360 px; the STARTER badge now steps out of the way.

## Screenshots
In `docs/grader-reports/round-2/`: smoke set `01-dashboard.png`…`99-mobile-library.png`, plus probe shots `probe-library-desktop.png`, `probe-library-topic-selected.png`, `probe-library-dark.png`, `probe-quiz-feedback.png`, `probe-quiz-results.png`, `probe-dashboard-progress.png` (topic bars flat despite 2/3 & 1/1), `probe-dashboard-dark.png`, `probe-mobile-360-library.png`, `probe-mobile-360-drawer.png`, `probe-mobile-390-library.png`, `probe-mobile-390-drawer.png`, and `probe-log.txt`.
```
Single blocking item to re-cross 8.5: add `display:block` to `.topic-bar .meter` (css/style.css:206).
```
