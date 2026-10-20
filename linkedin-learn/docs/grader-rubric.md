# Grading rubric — "a learning platform you'd actually use"

Each area is scored 1–10. The bar is **every area ≥ 8 and overall ≥ 8.5**. Any area below 7 blocks sign-off. The grader must give concrete, file-level fixes for every point lost, and save screenshots under `docs/grader-reports/round-N/`.

## 1. Content quality & accuracy — weight 25%
- Every article has a clear plain-language summary, 5+ key takeaways, flashcards and a quiz.
- Summaries and quiz answers are **grounded in the real source** (no invented facts); each article links back to its original (`url`), and provenance is honest (`fetched` vs `snippet`).
- Quiz questions test understanding, not trivia; the marked answer is correct; explanations are right.
- Topics are sensible; difficulty and reading time are plausible.
- `node pipeline/check.mjs` passes with 0 errors.

## 2. Learning UX — weight 25%
- Library: search, topic filter, difficulty filter, bookmark filter and sort all work and compose; result count updates; empty state is friendly.
- Article → quiz → result → retake is a complete loop with no dead ends; flashcards flip and navigate; "mark complete" and bookmarks work.
- Progress is visible and persists across reloads (dashboard ring, stat tiles, topic bars, streak, path progress).
- Paths group articles into sensible sequences and show completion.
- A newcomer understands what to do within seconds; wording is friendly and short.

## 3. Visual design & polish — weight 20%
- Clean, consistent, modern visual system: spacing, type scale, colour, cards, chips.
- Light **and** dark themes both look intentional; the manual toggle works and the auto default respects the OS.
- Responsive from 360px to 1440px+: no horizontal scroll, nothing clipped or overlapping; sidebar collapses to a drawer on mobile.
- Motion is smooth and eased (ring, bars, flip, confetti) and respects `prefers-reduced-motion`.
- No placeholder text, broken images, or developer leftovers on screen.

## 4. Interactivity & feedback — weight 15%
- Quiz gives immediate right/wrong feedback with explanation; score computed correctly; pass triggers celebration.
- Progress ring, topic bars and counters animate on the dashboard; flashcard 3D flip; toasts confirm actions.
- State (status, best score, bookmarks, flashcard "known", streak, theme) survives reload and is stored safely (guarded localStorage; works in private mode).

## 5. Accessibility & robustness — weight 15%
- Keyboard: skip link, focus-visible, cards/options/flashcards operable by keyboard; quiz options reachable; number-key shortcuts a bonus.
- Semantics: one `<h1>` per view, labelled controls, `aria-pressed` on toggles, live region for the view.
- Colour contrast is adequate in both themes; nothing conveyed by colour alone.
- No console errors or failed requests on any route (`pipeline/smoke.mjs` is clean); opening `index.html` directly from disk still works (data loads via `library.js`).

## Report format
`docs/grader-reports/round-N.md` with: a scores table (area, weight, score), weighted overall, **PASS/FAIL** against the bar, then for each area a list of **specific defects** (file + what + how to fix, ordered by impact), plus a short "what already feels great" list. Put screenshots in `docs/grader-reports/round-N/`.
