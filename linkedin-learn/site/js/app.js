/* app.js — router and views for LinkedIn Learn. Vanilla, no build step. */
(function () {
  "use strict";
  var LIB = window.LIBRARY || { meta: {}, topics: [], paths: [], articles: [] };
  var view = document.getElementById("view");

  // ---- indexes ----
  var topicById = {}; LIB.topics.forEach(function (t) { topicById[t.id] = t; });
  var artById = {}; LIB.articles.forEach(function (a) { artById[a.id] = a; });
  function topicColor(id) { return (topicById[id] && topicById[id].color) || "var(--brand)"; }
  function topicLabel(id) { return (topicById[id] && topicById[id].label) || id; }

  var esc = UI.esc;
  var filterState = { q: "", topic: "all", diff: "all", sort: "relevance", onlyBookmarks: false };

  // ---------------------------------------------------------------- helpers
  function statusMeta(id) {
    var st = Store.articleState(id);
    if (st.score != null && st.score >= 70) return { cls: "done", label: "Quiz " + st.score + "%" };
    if (st.status === "done") return { cls: "done", label: "Done" };
    if (st.score != null) return { cls: "quiz", label: "Quiz " + st.score + "%" };
    if (st.status === "reading") return { cls: "reading", label: "Reading" };
    return { cls: "", label: "" };
  }
  function tagHtml(topics) {
    return (topics || []).map(function (tid) {
      return '<span class="tag" style="background:' + topicColor(tid) + '">' + esc(topicLabel(tid)) + "</span>";
    }).join("");
  }
  function cardHtml(a) {
    var sm = statusMeta(a.id);
    var booked = Store.isBookmarked(a.id);
    return '' +
      '<article class="card" tabindex="0" role="link" aria-label="Open: ' + esc(a.title) + '" data-go="#/article/' + a.id + '" style="--topic-color:' + topicColor(a.topics[0]) + '">' +
        '<div class="card-top"><div class="card-topics">' + tagHtml(a.topics) + '</div>' +
          '<button class="bookmark" type="button" data-bookmark="' + a.id + '" aria-pressed="' + booked + '" aria-label="' + (booked ? "Remove bookmark" : "Bookmark") + '">' + (booked ? "★" : "☆") + '</button>' +
        '</div>' +
        '<h3>' + esc(a.title) + '</h3>' +
        '<div class="byline">' + esc(a.author) + ' · ' + esc(a.source) + '</div>' +
        '<p class="summary">' + esc(a.summary) + '</p>' +
        '<div class="card-foot"><span class="difficulty">' + esc(a.difficulty) + '</span><span>·</span><span>' + a.readingTimeMin + ' min</span><span>·</span><span>' + a.quiz.length + ' Q</span>' +
          (sm.label ? '<span class="status ' + sm.cls + '">' + sm.label + '</span>' : '<span class="status"></span>') +
        '</div>' +
      '</article>';
  }

  // ---------------------------------------------------------------- dashboard
  function renderDashboard() {
    var s = Store.stats(LIB);
    var owner = LIB.meta.owner ? (", " + LIB.meta.owner) : "";
    var C = 2 * Math.PI * 52;
    var off = C * (1 - s.pctComplete / 100);

    var continueCards = LIB.articles.filter(function (a) { return Store.articleState(a.id).status === "reading"; });
    if (!continueCards.length) continueCards = LIB.articles.filter(function (a) { return Store.articleState(a.id).status === "unread"; });
    continueCards = continueCards.slice(0, 3);

    var topicBars = LIB.topics.map(function (t) {
      var bt = s.byTopic[t.id] || { total: 0, done: 0 };
      var pct = bt.total ? Math.round((bt.done / bt.total) * 100) : 0;
      return '<div class="topic-bar">' +
        '<span class="name"><span class="dot" style="background:' + t.color + '"></span>' + esc(t.label) + '</span>' +
        '<span class="track"><span class="meter" data-w="' + pct + '" style="background:' + t.color + '"></span></span>' +
        '<span class="pct">' + bt.done + '/' + bt.total + '</span></div>';
    }).join("");

    view.innerHTML = '' +
      '<div class="hero">' +
        '<div><h1>Welcome back' + esc(owner) + ' 👋</h1>' +
          '<p>Your saved reading, turned into a course. ' + s.total + ' articles, ' + totalQuizzes() + ' quiz questions, and flashcards to make it stick.</p>' +
          '<div class="hero-cta">' +
            '<a class="btn btn-primary" href="#/library">Browse the library</a>' +
            (continueCards[0] ? '<a class="btn btn-ghost" href="#/article/' + continueCards[0].id + '">Continue where you left off</a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ring-wrap">' +
          '<svg class="ring" width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="' + s.pctComplete + '% of the library completed">' +
            '<defs><linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5bf5"/><stop offset="1" stop-color="#27b5a8"/></linearGradient></defs>' +
            '<circle class="ring-track" cx="70" cy="70" r="52" fill="none" stroke-width="13"/>' +
            '<circle class="ring-fill" cx="70" cy="70" r="52" fill="none" stroke-width="13" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" data-off="' + off + '"/>' +
          '</svg>' +
          '<div><div class="ring-num" id="ringNum">0%</div><div class="ring-label">complete</div></div>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        statTile("📚", s.done, "articles finished") +
        statTile("✅", s.passed, "quizzes passed") +
        statTile("🎯", s.avgScore == null ? "—" : s.avgScore, "avg quiz score", s.avgScore == null ? "" : "%") +
        statTile("🔥", s.streak, s.streak === 1 ? "day streak" : "day streak") +
      '</div>' +

      '<h2 class="section-title">Topic mastery</h2>' +
      '<div class="topic-bars">' + topicBars + '</div>' +

      '<h2 class="section-title">' + (continueCards.length && Store.articleState(continueCards[0].id).status === "reading" ? "Continue learning" : "Start here") + '</h2>' +
      '<div class="grid">' + continueCards.map(cardHtml).join("") + '</div>';

    // animate ring + bars + numbers
    requestAnimationFrame(function () {
      var fill = view.querySelector(".ring-fill");
      if (fill) fill.style.strokeDashoffset = fill.getAttribute("data-off");
      UI.tween(document.getElementById("ringNum"), s.pctComplete, "%");
      view.querySelectorAll(".meter").forEach(function (m) { m.style.width = m.getAttribute("data-w") + "%"; });
      view.querySelectorAll(".stat .n[data-to]").forEach(function (n) { UI.tween(n, +n.getAttribute("data-to"), n.getAttribute("data-suffix") || ""); });
    });
  }
  function statTile(ico, n, label, suffix) {
    var isNum = typeof n === "number";
    return '<div class="stat"><span class="ico" aria-hidden="true">' + ico + '</span>' +
      '<div class="n"' + (isNum ? ' data-to="' + n + '" data-suffix="' + (suffix || "") + '"' : "") + '>' + (isNum ? "0" + (suffix || "") : esc(n)) + '</div>' +
      '<div class="l">' + esc(label) + '</div></div>';
  }
  function totalQuizzes() { return LIB.articles.reduce(function (n, a) { return n + a.quiz.length; }, 0); }

  // ---------------------------------------------------------------- library
  function renderLibrary() {
    var topicChips = '<button class="chip" data-topic="all" aria-pressed="' + (filterState.topic === "all") + '">All topics</button>' +
      LIB.topics.map(function (t) {
        var on = filterState.topic === t.id;
        return '<button class="chip" data-topic="' + t.id + '" aria-pressed="' + on + '" style="' + (on ? "background:" + t.color : "") + '">' + esc(t.label) + '</button>';
      }).join("");

    view.innerHTML = '' +
      '<div class="page-head"><h1>Library</h1><p>Every saved article, summarised and quizzable. Filter by topic, search, or sort to find your next read.</p></div>' +
      '<div class="toolbar"><div class="chips">' + topicChips + '</div></div>' +
      '<div class="toolbar">' +
        '<div class="chips">' +
          '<button class="chip" data-diff="all" aria-pressed="' + (filterState.diff === "all") + '">All levels</button>' +
          '<button class="chip" data-diff="intro" aria-pressed="' + (filterState.diff === "intro") + '">Intro</button>' +
          '<button class="chip" data-diff="core" aria-pressed="' + (filterState.diff === "core") + '">Core</button>' +
          '<button class="chip" data-diff="advanced" aria-pressed="' + (filterState.diff === "advanced") + '">Advanced</button>' +
          '<button class="chip" data-bookmarks aria-pressed="' + filterState.onlyBookmarks + '">★ Bookmarked</button>' +
        '</div>' +
        '<span class="spacer"></span>' +
        '<label class="muted" style="font-size:13px">Sort ' +
          '<select class="control" id="sortSel">' +
            opt("relevance", "Relevance") + opt("title", "Title A–Z") + opt("read-asc", "Shortest first") +
            opt("read-desc", "Longest first") + opt("difficulty", "Difficulty") + opt("progress", "Least progress") +
          '</select></label>' +
      '</div>' +
      '<div class="result-count" id="resultCount"></div>' +
      '<div class="grid" id="libGrid"></div>';

    view.querySelector("#sortSel").value = filterState.sort;
    applyLibrary();
  }
  function opt(v, l) { return '<option value="' + v + '">' + l + '</option>'; }

  function applyLibrary() {
    var q = filterState.q.trim().toLowerCase();
    var list = LIB.articles.filter(function (a) {
      if (filterState.topic !== "all" && a.topics.indexOf(filterState.topic) < 0) return false;
      if (filterState.diff !== "all" && a.difficulty !== filterState.diff) return false;
      if (filterState.onlyBookmarks && !Store.isBookmarked(a.id)) return false;
      if (q) {
        var hay = (a.title + " " + a.author + " " + a.source + " " + a.summary + " " + a.topics.map(topicLabel).join(" ") + " " + a.keyTakeaways.join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var diffRank = { intro: 0, core: 1, advanced: 2 };
    list.sort(function (a, b) {
      switch (filterState.sort) {
        case "title": return a.title.localeCompare(b.title);
        case "read-asc": return a.readingTimeMin - b.readingTimeMin;
        case "read-desc": return b.readingTimeMin - a.readingTimeMin;
        case "difficulty": return diffRank[a.difficulty] - diffRank[b.difficulty];
        case "progress": return progressScore(a.id) - progressScore(b.id);
        default: return 0;
      }
    });
    var grid = document.getElementById("libGrid");
    var count = document.getElementById("resultCount");
    if (count) count.textContent = list.length + (list.length === 1 ? " article" : " articles") + (q ? ' matching "' + filterState.q + '"' : "");
    if (!grid) return;
    grid.innerHTML = list.length ? list.map(cardHtml).join("") :
      '<div class="empty" style="grid-column:1/-1"><div class="big">🔍</div><p>No articles match. Try clearing a filter or your search.</p></div>';
  }
  function progressScore(id) {
    var st = Store.articleState(id);
    if (st.status === "done" || (st.score != null && st.score >= 70)) return 2;
    if (st.status === "reading" || st.score != null) return 1;
    return 0;
  }

  // ---------------------------------------------------------------- article
  function renderArticle(id) {
    var a = artById[id];
    if (!a) return renderNotFound();
    Store.markReading(id);
    var st = Store.articleState(id);
    var booked = Store.isBookmarked(id);

    view.innerHTML = '' +
      '<div class="article">' +
        '<button class="back-link" data-back>← Back</button>' +
        '<div class="card-topics" style="margin-bottom:10px">' + tagHtml(a.topics) + '</div>' +
        '<h1>' + esc(a.title) + '</h1>' +
        '<div class="article-meta">' +
          '<span>✍️ ' + esc(a.author) + '</span><span>·</span>' +
          '<span>' + esc(a.source) + '</span><span>·</span>' +
          '<span>' + a.readingTimeMin + ' min read</span><span>·</span>' +
          '<span class="difficulty">' + esc(a.difficulty) + '</span>' +
          (a.publishedAt ? '<span>·</span><span>' + esc(a.publishedAt) + '</span>' : '') +
        '</div>' +

        '<div class="callout"><h2>Summary</h2><p>' + esc(a.summary) + '</p></div>' +

        '<h2 class="section-title">Key takeaways</h2>' +
        '<ul class="takeaways">' + a.keyTakeaways.map(function (k, i) {
          return '<li><span class="k">' + (i + 1) + '</span><span>' + esc(k) + '</span></li>';
        }).join("") + '</ul>' +

        '<div class="article-actions">' +
          '<a class="btn btn-primary" href="#/quiz/' + a.id + '">Take the quiz · ' + a.quiz.length + ' questions</a>' +
          '<a class="btn btn-ghost" href="#/flashcards/' + a.id + '">Flashcards · ' + a.flashcards.length + '</a>' +
          '<button class="btn btn-ghost" data-toggle-done="' + a.id + '">' + (st.status === "done" ? "✓ Completed" : "Mark complete") + '</button>' +
          '<button class="btn btn-ghost" data-bookmark="' + a.id + '" aria-pressed="' + booked + '">' + (booked ? "★ Saved" : "☆ Save") + '</button>' +
        '</div>' +

        '<h2 class="section-title">Quick flashcards</h2>' +
        flashDeckHtml(a, false) +

        '<p class="muted" style="margin-top:26px;font-size:13.5px">Source: <a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">Read the original on ' + esc(a.source) + ' ↗</a></p>' +
      '</div>';

    wireFlashDeck(a);
  }

  // ---------------------------------------------------------------- flashcards (shared)
  function flashDeckHtml(a, showKnown) {
    return '<div class="flash-deck" data-deck="' + a.id + '">' +
      '<button class="flashcard" type="button" aria-label="Flashcard, click to flip">' +
        '<div class="flashcard-inner">' +
          '<div class="flash-face flash-front"><div class="q"></div><div class="flash-hint">click or press space to flip</div></div>' +
          '<div class="flash-face flash-back"><div class="a"></div><div class="flash-hint">click to flip back</div></div>' +
        '</div>' +
      '</button>' +
      '<div class="flash-controls">' +
        '<button class="btn btn-ghost" data-flash="prev" aria-label="Previous card">‹ Prev</button>' +
        '<span class="flash-progress"></span>' +
        '<button class="btn btn-ghost" data-flash="next" aria-label="Next card">Next ›</button>' +
        (showKnown ? '<button class="btn btn-ghost" data-flash="known">Mark known</button><button class="btn btn-ghost" data-flash="shuffle">⤮ Shuffle</button>' : '') +
      '</div>' +
    '</div>';
  }
  function wireFlashDeck(a, pool) {
    var cards = pool || a.flashcards.map(function (c, i) { return { c: c, aid: a.id, idx: i }; });
    var deck = view.querySelector(".flash-deck");
    if (!deck) return;
    var i = 0;
    var cardBtn = deck.querySelector(".flashcard");
    var qEl = deck.querySelector(".q"), aEl = deck.querySelector(".a"), prog = deck.querySelector(".flash-progress");
    var knownBtn = deck.querySelector('[data-flash="known"]');
    function show() {
      cardBtn.classList.remove("flipped");
      var item = cards[i];
      qEl.textContent = item.c.front; aEl.textContent = item.c.back;
      prog.textContent = (i + 1) + " / " + cards.length;
      if (knownBtn) {
        var known = Store.flashKnown(item.aid, item.idx);
        knownBtn.textContent = known ? "✓ Known" : "Mark known";
        knownBtn.setAttribute("aria-pressed", known);
      }
    }
    function flip() { cardBtn.classList.toggle("flipped"); }
    cardBtn.addEventListener("click", flip);
    deck.addEventListener("click", function (e) {
      var b = e.target.closest("[data-flash]"); if (!b) return;
      var act = b.getAttribute("data-flash");
      if (act === "next") { i = (i + 1) % cards.length; show(); }
      else if (act === "prev") { i = (i - 1 + cards.length) % cards.length; show(); }
      else if (act === "shuffle") { for (var j = cards.length - 1; j > 0; j--) { var k = (Math.random() * (j + 1)) | 0; var t = cards[j]; cards[j] = cards[k]; cards[k] = t; } i = 0; show(); }
      else if (act === "known") { var it = cards[i]; var nv = !Store.flashKnown(it.aid, it.idx); Store.setFlashKnown(it.aid, it.idx, nv); show(); }
    });
    deck.addEventListener("keydown", function (e) {
      if (e.target === cardBtn && (e.key === " " || e.key === "Enter")) { e.preventDefault(); flip(); }
      if (e.key === "ArrowRight") { i = (i + 1) % cards.length; show(); }
      if (e.key === "ArrowLeft") { i = (i - 1 + cards.length) % cards.length; show(); }
    });
    show();
  }

  function renderFlashcards(id) {
    var pool, title, sub;
    if (id && artById[id]) {
      var a = artById[id];
      pool = a.flashcards.map(function (c, i) { return { c: c, aid: a.id, idx: i }; });
      title = "Flashcards"; sub = "From “" + a.title + "”.";
    } else {
      pool = [];
      LIB.articles.forEach(function (a) { a.flashcards.forEach(function (c, i) { pool.push({ c: c, aid: a.id, idx: i }); }); });
      title = "All flashcards"; sub = pool.length + " cards across every saved article. Flip, shuffle, and mark the ones you know.";
    }
    var knownCount = pool.filter(function (p) { return Store.flashKnown(p.aid, p.idx); }).length;
    view.innerHTML = '' +
      '<div class="page-head"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      '<p class="result-count">' + knownCount + ' of ' + pool.length + ' marked known</p>' +
      flashDeckHtml({ id: id || "all", flashcards: pool.map(function (p) { return p.c; }) }, true);
    wireFlashDeck({ id: id || "all" }, pool);
  }

  // ---------------------------------------------------------------- quiz
  function renderQuiz(id) {
    var a = artById[id];
    if (!a) return renderNotFound();
    var i = 0, correct = 0, answered = false, picks = [];

    function draw() {
      var q = a.quiz[i];
      var pct = Math.round((i / a.quiz.length) * 100);
      view.innerHTML = '' +
        '<div class="quiz">' +
          '<button class="back-link" data-go="#/article/' + a.id + '">← ' + esc(a.title) + '</button>' +
          '<div class="quiz-progress"><span style="width:' + pct + '%"></span></div>' +
          '<div class="q-counter">Question ' + (i + 1) + ' of ' + a.quiz.length + '</div>' +
          '<div class="q-text">' + esc(q.q) + '</div>' +
          '<div class="options" role="group" aria-label="Answer choices">' +
            q.options.map(function (o, k) {
              return '<button class="option" data-opt="' + k + '"><span class="key">' + "ABCD".charAt(k) + '</span><span>' + esc(o) + '</span></button>';
            }).join("") +
          '</div>' +
          '<div id="explainSlot"></div>' +
          '<div class="quiz-foot"><span class="muted" style="font-size:13px">Score: ' + correct + '/' + i + '</span><button class="btn btn-primary" id="nextБtn" data-next disabled>' + (i === a.quiz.length - 1 ? "See results" : "Next question") + '</button></div>' +
        '</div>';

      var optionBtns = view.querySelectorAll(".option");
      answered = false;
      optionBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (answered) return;
          answered = true;
          var k = +btn.getAttribute("data-opt");
          picks[i] = k;
          var right = q.answer;
          optionBtns.forEach(function (b2, k2) {
            b2.setAttribute("disabled", "");
            if (k2 === right) b2.classList.add("correct");
            if (k2 === k && k !== right) b2.classList.add("wrong");
          });
          if (k === right) correct++;
          var ok = k === right;
          document.getElementById("explainSlot").innerHTML =
            '<div class="explain ' + (ok ? "ok" : "no") + '">' + (ok ? "✅ Correct. " : "❌ Not quite. ") + esc(q.explain) + '</div>';
          var nb = view.querySelector("[data-next]"); nb.removeAttribute("disabled"); nb.focus();
        });
      });
      // number-key shortcuts
      view.querySelector(".quiz").addEventListener("keydown", function (e) {
        if (/^[1-4]$/.test(e.key) && !answered) { var idx = +e.key - 1; if (optionBtns[idx]) optionBtns[idx].click(); }
      });
      view.querySelector("[data-next]").addEventListener("click", function () {
        if (!answered) return;
        if (i === a.quiz.length - 1) finish();
        else { i++; draw(); window.scrollTo(0, 0); }
      });
    }

    function finish() {
      var pct = Math.round((correct / a.quiz.length) * 100);
      Store.setScore(a.id, pct);
      var pass = pct >= 70;
      view.innerHTML = '' +
        '<div class="score-card">' +
          '<div class="score-num ' + (pass ? "pass" : "fail") + '">' + pct + '%</div>' +
          '<div class="score-sub">' + correct + ' of ' + a.quiz.length + ' correct' + (pass ? " — nicely done." : " — worth another read.") + '</div>' +
          '<div style="font-size:42px;margin-bottom:14px">' + (pass ? "🎉" : "📖") + '</div>' +
          '<div class="hero-cta" style="justify-content:center">' +
            '<button class="btn btn-primary" data-retake>Retake quiz</button>' +
            '<a class="btn btn-ghost" href="#/article/' + a.id + '">Back to article</a>' +
            '<a class="btn btn-ghost" href="#/library">Library</a>' +
          '</div>' +
        '</div>';
      if (pass) UI.confetti();
      view.querySelector("[data-retake]").addEventListener("click", function () { i = 0; correct = 0; picks = []; draw(); });
    }
    draw();
  }

  // ---------------------------------------------------------------- paths
  function renderPaths() {
    var html = '<div class="page-head"><h1>Learning paths</h1><p>Curated sequences through the library. Finish a path to lock in a theme.</p></div>';
    html += LIB.paths.map(function (p) {
      var items = p.articleIds.map(function (id) { return artById[id]; }).filter(Boolean);
      var doneN = items.filter(function (a) { return progressScore(a.id) >= 2; }).length;
      var pct = items.length ? Math.round((doneN / items.length) * 100) : 0;
      return '<section class="path">' +
        '<div class="path-head"><div class="path-icon" aria-hidden="true">' + (p.icon || "📘") + '</div>' +
          '<div><h2 style="margin:0">' + esc(p.title) + '</h2><p class="muted" style="margin:2px 0 0;font-size:14px">' + esc(p.blurb) + '</p></div>' +
          '<span class="spacer"></span><span class="pill">' + doneN + '/' + items.length + ' done</span></div>' +
        '<div class="path-track"><span style="width:' + pct + '%"></span></div>' +
        '<div class="path-steps">' + items.map(function (a, idx) {
          var done = progressScore(a.id) >= 2;
          return '<div class="path-step ' + (done ? "done" : "") + '" tabindex="0" role="link" data-go="#/article/' + a.id + '">' +
            '<span class="num">' + (done ? "✓" : idx + 1) + '</span>' +
            '<span class="t">' + esc(a.title) + '</span>' +
            '<span class="meta">' + a.readingTimeMin + ' min · ' + esc(a.difficulty) + '</span></div>';
        }).join("") + '</div>' +
      '</section>';
    }).join("");
    view.innerHTML = html;
    requestAnimationFrame(function () { view.querySelectorAll(".path-track span").forEach(function (s) { var w = s.style.width; s.style.width = "0"; requestAnimationFrame(function () { s.style.width = w; }); }); });
  }

  // ---------------------------------------------------------------- about
  function renderAbout() {
    var m = LIB.meta;
    view.innerHTML = '' +
      '<div class="page-head"><h1>About this platform</h1></div>' +
      '<div class="prose">' +
        '<p>This is your LinkedIn saved reading, reorganised into something you can actually learn from: every article gets a plain-language summary, the key takeaways, a set of flashcards, and a short quiz that checks you understood it. Your progress, scores, bookmarks and streak are saved in this browser only.</p>' +
        '<p>This library is currently the <strong>' + esc(m.source === "linkedin" ? "your LinkedIn saved items" : "starter set") + '</strong>' +
          (m.source === "linkedin" ? "" : " — a grounded sample of real public articles across your topics, so the platform is fully working before your own export is loaded") + '. It holds <strong>' + LIB.articles.length + ' articles</strong> and <strong>' + totalQuizzes() + ' quiz questions</strong>.</p>' +
        '<h2 class="section-title">Load your own saved articles</h2>' +
        '<ol class="steps">' +
          '<li>On LinkedIn, open <code>My items → Saved posts</code>, scroll to the bottom so everything loads, then save the page (Ctrl/Cmd+S) as a complete web page.</li>' +
          '<li>Drop that file into <code>linkedin-learn/pipeline/input/</code> and run <code>npm run pipeline</code>.</li>' +
          '<li>The pipeline parses the saved items, fetches each public article, writes summaries, takeaways and quizzes, and rebuilds this library. Refresh and your own reading appears here.</li>' +
        '</ol>' +
        '<p class="muted" style="font-size:13.5px">Every article links back to its original source. Summaries and quizzes are study aids, not replacements for the authors\' work.</p>' +
      '</div>';
  }

  function renderNotFound() {
    view.innerHTML = '<div class="empty"><div class="big">🧭</div><h2>Nothing here</h2><p>That page doesn\'t exist. <a href="#/">Go to the dashboard</a>.</p></div>';
  }

  // ---------------------------------------------------------------- router
  function parseHash() {
    var h = (location.hash || "#/").replace(/^#/, "");
    var parts = h.split("/").filter(Boolean); // e.g. ["article","id"]
    return { seg: parts[0] || "", id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  function setActiveNav(seg) {
    var map = { "": "dashboard", "library": "library", "article": "library", "quiz": "library", "paths": "paths", "flashcards": "flashcards", "about": "about" };
    var want = map[seg] || "dashboard";
    document.querySelectorAll(".nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-nav") === want); });
  }
  function route() {
    var r = parseHash();
    setActiveNav(r.seg);
    switch (r.seg) {
      case "": renderDashboard(); break;
      case "library": renderLibrary(); break;
      case "article": renderArticle(r.id); break;
      case "quiz": renderQuiz(r.id); break;
      case "flashcards": renderFlashcards(r.id); break;
      case "paths": renderPaths(); break;
      case "about": renderAbout(); break;
      default: renderNotFound();
    }
    closeMenu();
    view.focus();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- global wiring
  function closeMenu() { document.querySelector(".app").classList.remove("menu-open"); var s = document.getElementById("scrim"); if (s) s.hidden = true; var mb = document.getElementById("menuBtn"); if (mb) mb.setAttribute("aria-expanded", "false"); }
  function openMenu() { document.querySelector(".app").classList.add("menu-open"); var s = document.getElementById("scrim"); if (s) s.hidden = false; var mb = document.getElementById("menuBtn"); if (mb) mb.setAttribute("aria-expanded", "true"); }

  function init() {
    // theme
    UI.applyTheme(Store.theme());
    Store.touchDay();
    // source badge
    var badge = document.getElementById("sourceBadge");
    if (badge) { badge.textContent = LIB.meta.source === "linkedin" ? "your library" : "starter"; if (LIB.meta.source === "linkedin") badge.classList.add("linkedin"); }

    document.getElementById("themeToggle").addEventListener("click", UI.cycleTheme);
    document.getElementById("resetProgress").addEventListener("click", function () {
      if (confirm("Reset all progress, scores and bookmarks? This can't be undone.")) { Store.reset(); UI.toast("Progress reset"); route(); }
    });
    var menuBtn = document.getElementById("menuBtn");
    if (menuBtn) menuBtn.addEventListener("click", function () { document.querySelector(".app").classList.contains("menu-open") ? closeMenu() : openMenu(); });
    var scrim = document.getElementById("scrim");
    if (scrim) scrim.addEventListener("click", closeMenu);

    // global search -> library
    var search = document.getElementById("globalSearch");
    var deb;
    search.addEventListener("input", function () {
      filterState.q = search.value;
      clearTimeout(deb);
      deb = setTimeout(function () {
        if (parseHash().seg !== "library") { location.hash = "#/library"; }
        else applyLibrary();
      }, 180);
    });

    // event delegation for clicks across views
    document.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go && !e.target.closest("[data-bookmark]")) { location.hash = go.getAttribute("data-go"); return; }
      var back = e.target.closest("[data-back]");
      if (back) { if (history.length > 1) history.back(); else location.hash = "#/library"; return; }
      var bm = e.target.closest("[data-bookmark]");
      if (bm) {
        e.stopPropagation();
        var on = Store.toggleBookmark(bm.getAttribute("data-bookmark"));
        bm.setAttribute("aria-pressed", on);
        if (bm.classList.contains("bookmark")) { bm.textContent = on ? "★" : "☆"; bm.setAttribute("aria-label", on ? "Remove bookmark" : "Bookmark"); }
        else { bm.textContent = on ? "★ Saved" : "☆ Save"; }
        UI.toast(on ? "Bookmarked" : "Bookmark removed");
        return;
      }
      var td = e.target.closest("[data-toggle-done]");
      if (td) {
        var id = td.getAttribute("data-toggle-done");
        var st = Store.articleState(id);
        if (st.status === "done") { Store.markUnread(id); td.textContent = "Mark complete"; UI.toast("Marked as not done"); }
        else { Store.markDone(id); td.textContent = "✓ Completed"; UI.toast("Nice — marked complete"); UI.confetti(); }
        return;
      }
      // library filter chips
      var tc = e.target.closest("[data-topic]");
      if (tc) { filterState.topic = tc.getAttribute("data-topic"); renderLibrary(); return; }
      var dc = e.target.closest("[data-diff]");
      if (dc) { filterState.diff = dc.getAttribute("data-diff"); renderLibrary(); return; }
      var bc = e.target.closest("[data-bookmarks]");
      if (bc) { filterState.onlyBookmarks = !filterState.onlyBookmarks; renderLibrary(); return; }
    });
    document.addEventListener("change", function (e) {
      if (e.target.id === "sortSel") { filterState.sort = e.target.value; applyLibrary(); }
    });
    // keyboard "enter/space" on card role=link
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-go][role=link]")) {
        e.preventDefault(); location.hash = e.target.getAttribute("data-go");
      }
    });

    window.addEventListener("hashchange", route);
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
