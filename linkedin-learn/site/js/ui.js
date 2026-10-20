/* ui.js — small helpers: escaping, theme, toast, confetti, number tween. */
(function () {
  "use strict";
  var UI = {};

  UI.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  UI.reducedMotion = function () {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  };

  // ---- theme ----
  UI.applyTheme = function (t) {
    // t: "light" | "dark" | null(auto)
    var html = document.documentElement;
    if (t === "light" || t === "dark") html.setAttribute("data-theme", t);
    else html.setAttribute("data-theme", "auto");
    var btn = document.getElementById("themeToggle");
    if (btn) {
      var ico = btn.querySelector(".theme-ico");
      var lab = btn.querySelector(".theme-label");
      var eff = t || "auto";
      if (ico) ico.textContent = eff === "dark" ? "☀" : eff === "light" ? "☾" : "◐";
      if (lab) lab.textContent = eff === "auto" ? "Auto theme" : eff === "dark" ? "Dark" : "Light";
      var nextName = eff === "auto" ? "light" : eff === "light" ? "dark" : "auto";
      btn.setAttribute("aria-label", "Colour theme: " + (eff === "auto" ? "auto" : eff) + ". Activate to switch to " + nextName + ".");
    }
  };
  UI.cycleTheme = function () {
    var order = [null, "light", "dark"];
    var cur = window.Store.theme();
    var next = order[(order.indexOf(cur) + 1) % order.length];
    window.Store.setTheme(next);
    UI.applyTheme(next);
  };

  // ---- toast ----
  var toastTimer;
  UI.toast = function (msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg; el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); setTimeout(function () { el.hidden = true; }, 300); }, 2200);
  };

  // ---- number tween ----
  UI.tween = function (el, to, suffix) {
    suffix = suffix || "";
    if (UI.reducedMotion()) { el.textContent = to + suffix; return; }
    var from = 0, start = null, dur = 900;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  // ---- confetti ----
  UI.confetti = function () {
    var canvas = document.getElementById("confetti");
    if (!canvas || UI.reducedMotion()) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    var colors = ["#6d5bf5", "#8b5cf6", "#27b5a8", "#f59e0b", "#ef6f6c", "#22a06b", "#ec4899"];
    var parts = [];
    for (var i = 0; i < 160; i++) {
      parts.push({
        x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight / 2.4,
        vx: (Math.random() - 0.5) * 11, vy: Math.random() * -13 - 5,
        g: 0.32 + Math.random() * 0.12, s: 5 + Math.random() * 7,
        c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
        life: 0
      });
    }
    var t0 = performance.now();
    function frame(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      parts.forEach(function (p) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life = now - t0;
        if (p.y < innerHeight + 30 && p.life < 2600) alive = true;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - p.life / 2600);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(frame);
  };

  window.UI = UI;
})();
