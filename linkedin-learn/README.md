# LinkedIn Learn

Turn your LinkedIn **saved articles** into an interactive learning platform: every
article gets a plain-language summary, key takeaways, flashcards and a short quiz,
wrapped in a browsable site with search, filters, learning paths, progress tracking
and a light/dark theme.

> The site ships with a **starter library** of 9 real, public articles across UX
> research, service design, AI & design, design systems, product, accessibility and
> craft — so it's fully working out of the box. Run the pipeline on your own export
> to replace it with your saved reading.

## Run the site

```bash
cd linkedin-learn
npm run serve        # http://localhost:4178
```

No build step and no dependencies are needed just to view it — you can also open
`site/index.html` directly in a browser (data loads from `site/data/library.js`).

## Load your own LinkedIn saved articles

LinkedIn has no API for saved items, so the import is a two-minute manual export:

1. On LinkedIn, open **Me → Saved posts** (`linkedin.com/my-items/saved-posts/`).
2. Scroll to the very bottom so every item loads.
3. Save the page: **Ctrl/Cmd + S → "Webpage, Complete" (or "Single File")**.
4. Put the saved `.html` file in `linkedin-learn/pipeline/input/`.
5. Run the pipeline:

```bash
npm install          # first time only (adds cheerio for parsing)
npm run pipeline     # ingest -> fetch -> enrich -> build -> check
npm run serve
```

What each step does:

| Step | Script | What it does |
|---|---|---|
| ingest | `parse-saved-html.mjs` | Pulls the saved items (title, URL, snippet) out of the saved page. |
| fetch | `fetch-articles.mjs` | Fetches each public article's text; LinkedIn member posts behind the login wall keep just their snippet. |
| enrich | `enrich.mjs` | Writes the summary, takeaways, flashcards and quiz for each article. Uses the Claude API if `ANTHROPIC_API_KEY` is set; otherwise a lightweight pass marks items `needsReview`. |
| build | `build-library.mjs` | Writes `site/data/library.js` + `library.json` and auto-builds topic paths. |
| check | `check.mjs` | Validates the data (schema, quiz integrity, links). |

Your raw export never leaves your machine and is git-ignored (`pipeline/input/`,
`pipeline/cache/`).

### Better summaries and quizzes

The heuristic enricher is deliberately thin. For full, grounded summaries and
quizzes either set an API key:

```bash
export ANTHROPIC_API_KEY=sk-...        # optional: ANTHROPIC_MODEL=claude-sonnet-4-5
npm run enrich && npm run build
```

…or ask Claude in a session to enrich `pipeline/cache/fetched.json` directly — that
reads each fetched article and writes the summaries/quizzes grounded in the text.

## Project map

```
linkedin-learn/
  site/                 the static web app (no framework)
    index.html
    css/style.css
    js/{store,ui,app}.js
    data/library.js     window.LIBRARY — the content (also library.json)
  pipeline/
    parse-saved-html.mjs  ingest the saved page
    fetch-articles.mjs    fetch public article text
    enrich.mjs            summaries, takeaways, flashcards, quizzes
    build-library.mjs     emit library.js + library.json
    check.mjs             validate the data
    smoke.mjs             headless end-to-end test + screenshots
    serve.mjs             static server
    lib/                  taxonomy + library loader
    input/  cache/        your export + working files (git-ignored)
  docs/
    grader-rubric.md
    grader-reports/       quality reports, round by round
```

## Quality checks

```bash
npm run check        # data validation
node pipeline/smoke.mjs   # drives every view headless, fails on console errors
```

## Notes

- Progress, scores, bookmarks and streak live in your browser's `localStorage` only.
- Every article links back to its original source; the summaries and quizzes are
  study aids, not replacements for the authors' work.
