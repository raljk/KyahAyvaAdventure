/* store.js — progress + preferences in localStorage, all reads/writes guarded.
   Everything degrades gracefully if storage is unavailable (private mode etc). */
(function () {
  "use strict";
  var KEY = "linkedin-learn:v1";
  var mem = null; // in-memory fallback when localStorage throws

  function load() {
    if (mem) return mem;
    var base = { articles: {}, bookmarks: {}, flash: {}, visits: [], theme: null };
    try {
      var raw = localStorage.getItem(KEY);
      mem = raw ? Object.assign(base, JSON.parse(raw)) : base;
    } catch (e) { mem = base; }
    return mem;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* ignore */ }
  }
  function art(id) {
    var s = load();
    if (!s.articles[id]) s.articles[id] = { status: "unread", score: null, quizTaken: 0 };
    return s.articles[id];
  }

  var Store = {
    // --- article status ---
    articleState: function (id) { return Object.assign({ status: "unread", score: null, quizTaken: 0 }, load().articles[id] || {}); },
    markReading: function (id) { var a = art(id); if (a.status === "unread") a.status = "reading"; save(); this.touchDay(); },
    markDone: function (id) { art(id).status = "done"; save(); this.touchDay(); },
    markUnread: function (id) { var a = art(id); a.status = "unread"; save(); },
    setScore: function (id, pct) {
      var a = art(id); a.quizTaken = (a.quizTaken || 0) + 1;
      if (a.score == null || pct > a.score) a.score = pct;
      if (pct >= 70) a.status = "done"; else if (a.status === "unread") a.status = "reading";
      save(); this.touchDay();
    },

    // --- bookmarks ---
    isBookmarked: function (id) { return !!load().bookmarks[id]; },
    toggleBookmark: function (id) { var s = load(); if (s.bookmarks[id]) delete s.bookmarks[id]; else s.bookmarks[id] = Date.now(); save(); return !!s.bookmarks[id]; },

    // --- flashcards ---
    flashKnown: function (id, idx) { var s = load(); return !!(s.flash[id] && s.flash[id][idx]); },
    setFlashKnown: function (id, idx, known) {
      var s = load(); if (!s.flash[id]) s.flash[id] = {};
      if (known) s.flash[id][idx] = 1; else delete s.flash[id][idx];
      save();
    },

    // --- streak ---
    touchDay: function () {
      var s = load(); var today = new Date().toISOString().slice(0, 10);
      if (s.visits[s.visits.length - 1] !== today) { s.visits.push(today); if (s.visits.length > 400) s.visits.shift(); save(); }
    },
    streak: function () {
      var s = load(); if (!s.visits.length) return 0;
      var days = {}; s.visits.forEach(function (d) { days[d] = 1; });
      var n = 0, cur = new Date();
      for (;;) {
        var key = cur.toISOString().slice(0, 10);
        if (days[key]) { n++; cur.setDate(cur.getDate() - 1); }
        else if (n === 0 && key === new Date().toISOString().slice(0, 10)) { cur.setDate(cur.getDate() - 1); }
        else break;
      }
      return n;
    },

    // --- theme ---
    theme: function () { return load().theme; },
    setTheme: function (t) { load().theme = t; save(); },

    // --- aggregate stats across a library ---
    stats: function (library) {
      var arts = library.articles, total = arts.length;
      var done = 0, reading = 0, passed = 0, scoreSum = 0, scoreN = 0, taken = 0;
      arts.forEach(function (a) {
        var st = Store.articleState(a.id);
        if (st.status === "done") done++;
        else if (st.status === "reading") reading++;
        if (st.score != null) { scoreSum += st.score; scoreN++; if (st.score >= 70) passed++; }
        taken += st.quizTaken || 0;
      });
      // topic progress: share of each topic's articles that are done
      var byTopic = {};
      library.topics.forEach(function (t) { byTopic[t.id] = { total: 0, done: 0 }; });
      arts.forEach(function (a) {
        var st = Store.articleState(a.id);
        (a.topics || []).forEach(function (tid) {
          if (!byTopic[tid]) byTopic[tid] = { total: 0, done: 0 };
          byTopic[tid].total++;
          if (st.status === "done") byTopic[tid].done++;
        });
      });
      return {
        total: total, done: done, reading: reading, unread: total - done - reading,
        passed: passed, quizzesTaken: taken,
        avgScore: scoreN ? Math.round(scoreSum / scoreN) : null,
        pctComplete: total ? Math.round((done / total) * 100) : 0,
        byTopic: byTopic, streak: Store.streak(),
        bookmarks: Object.keys(load().bookmarks).length
      };
    },

    reset: function () { mem = { articles: {}, bookmarks: {}, flash: {}, visits: [], theme: load().theme }; save(); }
  };

  window.Store = Store;
})();
