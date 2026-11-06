/* Thumbcade playable shell: a three-game mini feed.
   The shell is a small Thumbcade host. It speaks the SDK's iframe protocol (hello -> LaunchContext,
   ready, gameplay.start/end, storage, pause/resume, mute, insets, input.cancel, replay), so the launch
   games run exactly as they ship. At most two game frames are alive at once: the current card and the
   next one, preloaded and paused. */
(function () {
  "use strict";
  var D = window.TC_PLAYABLE;
  var NET = window.TC_NET;
  var CH = "tc";
  var PV = 1;
  var FEED = D.feed;
  var LAST = FEED.length - 1;
  var END = FEED.length; // the end card is the card after the last game
  var NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var stage = $("stage");
  var track = $("track");
  var endEl = $("end");
  var reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var now = function () { return performance.now(); };

  // ---------------------------------------------------------------- fonts and icons
  try {
    [["TC Display", D.fonts.display, { weight: "900" }], ["TC Mono", D.fonts.mono, {}], ["Mona Sans", D.fonts.ui, { weight: "500 700" }]].forEach(function (f) {
      var face = new FontFace(f[0], "url(" + f[1] + ")", f[2]);
      document.fonts.add(face);
      face.load().catch(function () { /* system fallback */ });
    });
  } catch (e) { /* FontFace unsupported: system fonts */ }

  var ICON = {
    soundOn: "M3.8 9.4 H7.4 L12 5.4 V18.6 L7.4 14.6 H3.8 Z M15.4 9 C16.7 10.4 16.7 13.6 15.4 15 M18 6.4 C20.9 9.3 20.9 14.7 18 17.6",
    soundOff: "M3.8 9.4 H7.4 L12 5.4 V18.6 L7.4 14.6 H3.8 Z M15.6 9.6 L20.4 14.4 M20.4 9.6 L15.6 14.4",
    swipeUp: "M12 20 V5 M6.8 10 L12 4.8 L17.2 10",
    replay: "M5 12 A7 7 0 1 0 7.1 7 M7.1 3.6 V7.2 H3.5",
    check: "M4.8 12.6 L9.8 17.4 L19.2 7",
  };
  var svg = function (name, stroke) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[name] + '" fill="none" stroke="currentColor" stroke-width="' +
      (stroke || 1.75) + '" stroke-linecap="square" stroke-linejoin="miter"></path></svg>';
  };
  Array.prototype.forEach.call(document.querySelectorAll(".arrow"), function (e) { e.innerHTML = svg("swipeUp", 2); });
  document.querySelector(".badge").innerHTML = svg("check", 3);
  $("res-again").innerHTML = svg("replay", 2) + "<span>Play again</span>";
  $("res-next").innerHTML = svg("swipeUp", 2) + "<span>Next game</span>";
  $("replay").innerHTML = svg("replay", 2) + "<span>Play the feed again</span>";

  // ---------------------------------------------------------------- state
  var slides = []; // index -> slide | undefined
  var cur = 0;
  var target = 1; // the card a swipe up reveals
  var muted = false;
  var hidden = false;
  var onEnd = false;
  var animating = false;
  var touchedAt = 0; // first interaction (the ad's clock starts here)
  var played = {};
  var best = {};
  var store = {};
  var ctaCount = 0;
  var hostSeq = 0;
  var resultTimer = 0;

  // ---------------------------------------------------------------- the host protocol
  function envelope(type, payload, replyTo) {
    var env = { ch: CH, v: PV, id: "h" + (++hostSeq), type: type };
    if (payload !== undefined) env.payload = payload;
    if (replyTo) env.replyTo = replyTo;
    return env;
  }
  function post(s, type, payload) {
    if (s && s.win) { try { s.win.postMessage(envelope(type, payload), "*"); } catch (e) { /* frame gone */ } }
  }
  function reply(s, req, result) {
    if (s && s.win) { try { s.win.postMessage(envelope("reply", { ok: true, result: result }, req.id), "*"); } catch (e) { /* frame gone */ } }
  }
  function insetsFor(s) {
    var top = $("top").offsetHeight;
    var cap = $("caption");
    var bottom = Math.round(cap.offsetHeight + 24);
    return {
      preview: { top: top, right: 0, bottom: bottom, left: 0 },
      play: { top: top, right: 0, bottom: $("dock").offsetHeight, left: 0 },
      current: s.phase === "playing" ? "play" : "preview",
    };
  }
  function hash32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  /** Sound stays off until the first touch (ad network rule), while hidden, and when the player mutes. */
  function silent() { return muted || hidden || !touchedAt; }
  function better(meta, a, b) { return b == null || (meta.order === "asc" ? a < b : a > b); }

  function handle(s, env) {
    var p = env.payload || {};
    switch (env.type) {
      case "hello":
        reply(s, env, {
          sdkVersion: String(p.sdkVersion || ""),
          gameId: s.meta.slug,
          versionId: "playable",
          player: { id: "playable-" + s.meta.slug, name: "You", avatarUrl: null, guest: true },
          locale: navigator.language || "en-US",
          reducedMotion: reduced,
          audio: { muted: silent() },
          insets: insetsFor(s),
          launchReason: "feed",
          seed: (Math.random() * 2147483647) | 0,
          dailySeed: hash32(new Date().toISOString().slice(0, 10)),
          best: best[s.meta.slug] == null ? null : best[s.meta.slug],
          host: "web",
        });
        if (s.i !== cur || hidden) post(s, "pause", { reason: s.i !== cur ? "offscreen" : "background" });
        return;
      case "ready":
        s.ready = true;
        clearTimeout(s.watchdog);
        s.el.classList.add("live");
        if (s.i === cur) schedulePreload();
        return;
      case "gameplay.start":
        s.phase = "playing";
        played[s.meta.slug] = true;
        post(s, "insets", insetsFor(s));
        if (s.i === cur) { hideResult(); syncChrome(); }
        return;
      case "gameplay.end": {
        var score = Number(p.score);
        s.phase = "over";
        s.last = score;
        s.newBest = false;
        if (isFinite(score) && better(s.meta, score, best[s.meta.slug])) { best[s.meta.slug] = score; s.newBest = true; }
        post(s, "insets", insetsFor(s));
        if (s.i === cur) {
          syncChrome();
          clearTimeout(resultTimer);
          resultTimer = setTimeout(function () { if (s.i === cur && s.phase === "over" && !onEnd) showResult(s); }, 420);
        }
        return;
      }
      case "storage.get":
        reply(s, env, { value: Object.prototype.hasOwnProperty.call(store, s.meta.slug + ":" + p.key) ? store[s.meta.slug + ":" + p.key] : null });
        return;
      case "storage.set":
        store[s.meta.slug + ":" + p.key] = p.value;
        reply(s, env, { ok: true });
        return;
      case "leaderboard.top": {
        var b = best[s.meta.slug];
        reply(s, env, { entries: b == null ? [] : [{ rank: 1, name: "You", avatarUrl: null, score: b, isMe: true }] });
        return;
      }
      case "leaderboard.me": {
        var mine = best[s.meta.slug];
        reply(s, env, { best: mine == null ? null : mine, rank: mine == null ? null : 1, percentile: null });
        return;
      }
      case "share.challenge":
        reply(s, env, { shared: false });
        return;
      default:
        return; // feedback, analytics.track, log: nothing to do in an ad
    }
  }

  addEventListener("message", function (e) {
    var s = slideFor(e.source);
    if (!s) return;
    var d = e.data;
    if (d && d.tcProbe) return probe(s, d.tcProbe);
    if (!d || d.ch !== CH || d.v !== PV || typeof d.type !== "string" || typeof d.id !== "string") return;
    handle(s, d);
  });
  function slideFor(win) {
    for (var i = 0; i < slides.length; i++) if (slides[i] && slides[i].win === win) return slides[i];
    return null;
  }

  // ---------------------------------------------------------------- cards
  function gameDoc(i) {
    var m = FEED[i];
    var code = document.getElementById("tc-game-" + m.slug).textContent;
    var fonts = JSON.stringify({ display: D.fonts.display, mono: D.fonts.mono });
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">' +
      "<title>" + m.name + "</title><style>" + m.headStyle + m.css + "</style>" +
      "<script>window.__TCF=" + fonts + ";" + window.TC_PROBE + "<\/script></head><body>" + (m.body || "") +
      '<script type="module">' + code + "<\/script></body></html>";
  }

  function mount(i) {
    if (i > LAST || slides[i]) return slides[i];
    var m = FEED[i];
    var el = document.createElement("div");
    el.className = "slide";
    el.style.background = m.bg;
    var frame = document.createElement("iframe");
    frame.title = m.name + ", a Thumbcade game";
    frame.setAttribute("allow", "autoplay");
    frame.setAttribute("scrolling", "no");
    var curtain = document.createElement("div");
    curtain.className = "curtain";
    curtain.style.background = m.bg;
    el.appendChild(frame);
    el.appendChild(curtain);
    track.appendChild(el);
    var s = { i: i, meta: m, el: el, frame: frame, win: frame.contentWindow, phase: "attract", ready: false, failed: false };
    slides[i] = s;
    frame.srcdoc = gameDoc(i);
    s.win = frame.contentWindow;
    // A card that never comes alive (no WebGL, a crash) is skipped rather than shown broken.
    s.watchdog = setTimeout(function () { if (!s.ready) fail(s, "no ready signal"); }, 7000);
    layout(0);
    return s;
  }
  function unmount(i) {
    var s = slides[i];
    if (!s) return;
    clearTimeout(s.watchdog);
    s.win = null;
    s.frame.srcdoc = "";
    s.el.remove();
    slides[i] = undefined;
  }
  function fail(s, why) {
    if (s.failed) return;
    s.failed = true;
    if (window.console) console.warn("[playable] skipping " + s.meta.slug + ": " + why);
    if (s.i === cur) { if (!animating) go(nextIndex(cur), 0); }
    else unmount(s.i);
  }
  function nextIndex(i) {
    var n = i + 1;
    while (n <= LAST && slides[n] && slides[n].failed) n++;
    return n > LAST ? END : n;
  }
  var preloadTimer = 0;
  function schedulePreload() {
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(function () {
      target = nextIndex(cur);
      if (target !== END) mount(target);
    }, 700);
  }

  // ---------------------------------------------------------------- layout and motion
  function stageH() { return stage.clientHeight || innerHeight; }
  /** Places the current card at the drag offset and the target card right below it. */
  function layout(drag) {
    for (var i = 0; i < slides.length; i++) {
      var s = slides[i];
      if (!s) continue;
      if (i === cur) { s.el.style.visibility = "visible"; s.el.style.transform = "translate3d(0," + drag + "px,0)"; }
      else if (i === target) { s.el.style.visibility = "visible"; s.el.style.transform = "translate3d(0," + (stageH() + drag) + "px,0)"; }
      else s.el.style.visibility = "hidden";
    }
    if (target === END && !onEnd) {
      endEl.classList.toggle("on", drag < 0);
      var appH = $("app").clientHeight || innerHeight;
      endEl.style.transform = "translate3d(0," + (appH + drag * (appH / stageH())) + "px,0)";
    }
  }
  /** Step response of a damped spring (0 -> 1); the app's card snap: damping 26, stiffness 260, mass 1. */
  function spring(t) {
    var w0 = Math.sqrt(260), z = 26 / (2 * Math.sqrt(260)), wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  function animate(from, to, done) {
    animating = true;
    var t0 = now();
    var dur = reduced ? 0.12 : 0.62;
    (function step() {
      var t = (now() - t0) / 1000;
      var k = reduced ? Math.min(1, t / dur) : spring(t);
      layout(from + (to - from) * k);
      if (t < dur) requestAnimationFrame(step);
      else { layout(to); animating = false; done(); }
    })();
  }

  /** Moves to card `to` (a game index or END), starting from the current drag offset. */
  function go(to, fromDrag) {
    if (animating || onEnd) return;
    hideResult();
    target = to;
    var s = slides[cur];
    var n = to === END ? null : mount(to);
    if (n) { post(n, "resume"); if (!silent()) post(n, "unmute"); }
    if (s) post(s, "pause", { reason: "offscreen" });
    animate(fromDrag || 0, -stageH(), function () {
      var prev = cur;
      if (to === END) {
        showEnd();
        unmount(prev);
        return;
      }
      cur = to;
      target = nextIndex(cur);
      unmount(prev);
      layout(0);
      syncChrome();
      if (n && n.ready) schedulePreload();
    });
  }
  function settleBack(fromDrag) {
    var n = slides[target];
    animate(fromDrag, 0, function () {
      if (n) post(n, "pause", { reason: "offscreen" });
      if (target === END) endEl.classList.remove("on");
    });
  }

  // ---------------------------------------------------------------- gestures
  var G = null;
  var swipedAt = 0;
  function touch() {
    if (touchedAt) return;
    touchedAt = now();
    body.classList.add("touched");
    if (!silent()) slides.forEach(function (s) { if (s) post(s, "unmute"); });
  }
  function gesture(type, id, x, y, src) {
    var t = now();
    if (type === "pointerdown") {
      if (G || animating || onEnd) return;
      touch();
      G = { id: id, x0: x, y0: y, claimed: false, src: src, pts: [[t, y]] };
      return;
    }
    if (!G || id !== G.id) return;
    var dy = y - G.y0;
    var dx = x - (G.x0);
    if (type === "pointermove") {
      G.pts.push([t, y]);
      if (G.pts.length > 6) G.pts.shift();
      if (!G.claimed && dy < -16 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        G.claimed = true;
        // The feed owns vertical swipes (all three games declare controls.vertical: false).
        if (G.src) post(G.src, "input.cancel");
        hideResult();
        target = nextIndex(cur);
        var n = target === END ? null : mount(target);
        if (n) { post(n, "resume"); if (!silent()) post(n, "unmute"); }
      }
      if (G.claimed) layout(Math.min(0, dy));
      return;
    }
    // pointerup / pointercancel
    if (G.claimed) {
      var first = G.pts[0];
      var v = (y - first[1]) / Math.max(16, t - first[0]); // px per ms, negative = up
      swipedAt = t;
      if (dy < -stageH() * 0.16 || v < -0.45) go(target, Math.min(0, dy));
      else settleBack(Math.min(0, dy));
    }
    G = null;
  }
  // Pointers on the shell itself (caption, result card, chrome).
  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (type) {
    stage.addEventListener(type, function (e) { gesture(type, e.pointerId, e.clientX, e.clientY, null); }, { passive: true });
  });
  // Pointers inside a game frame arrive from the probe (direct call when same-origin, else postMessage).
  window.__tcProbe = function (win, m) { var s = slideFor(win); if (s) probe(s, m); };
  function probe(s, m) {
    if (m.type === "fail" || m.type === "error") { if (!s.ready || m.type === "fail") fail(s, m.why); return; }
    if (s.i !== cur) return;
    var r = s.frame.getBoundingClientRect();
    gesture(m.type, "f" + m.id, r.left + m.cx, r.top + m.cy, s);
  }
  // A click right after a swipe belongs to the swipe.
  var guard = function (fn) { return function (e) { if (now() - swipedAt < 350) return; touch(); fn(e); }; };

  // ---------------------------------------------------------------- chrome
  function syncChrome() {
    var s = slides[cur];
    var m = FEED[cur];
    stage.style.setProperty("--accent", m.accent);
    body.style.setProperty("--accent", m.accent);
    $("counter").textContent = pad(cur + 1) + " / " + pad(FEED.length);
    $("cap-name").textContent = m.name;
    $("cap-desc").textContent = m.description;
    $("cap-tags").innerHTML = m.tags.map(function (t) { return "<span>#" + t + "</span>"; }).join("");
    var phase = s ? s.phase : "attract";
    body.classList.toggle("playing", phase === "playing");
    body.classList.toggle("over", phase === "over");
    body.classList.toggle("idle", phase !== "playing");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function showResult(s) {
    var m = s.meta;
    $("res-title").textContent = "Run over · " + m.name;
    $("res-count").textContent = pad(s.i + 1) + " / " + pad(FEED.length);
    $("res-score").textContent = String(s.last);
    $("res-best").innerHTML = s.newBest ? "<b>New best</b>" : "Best " + best[m.slug];
    $("res-next").lastChild.textContent = s.i === LAST ? "Finish" : "Next game";
    body.classList.add("result");
  }
  function hideResult() {
    clearTimeout(resultTimer);
    body.classList.remove("result");
  }
  function setSound(next) {
    muted = next;
    $("sound").innerHTML = svg(muted ? "soundOff" : "soundOn");
    $("sound").setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    slides.forEach(function (s) { if (s) post(s, silent() ? "mute" : "unmute"); });
  }

  // ---------------------------------------------------------------- end card
  function showEnd() {
    onEnd = true;
    hideResult();
    var count = 0;
    for (var k in played) if (played[k]) count++;
    $("end-head").textContent = count === 0 ? "Three games. Zero installs." : count === 1 ? "That was one game." : "That was " + NUM[count] + " games.";
    var left = D.all.length - count;
    var cap = NUM[left].charAt(0).toUpperCase() + NUM[left].slice(1);
    $("end-sub").textContent = (count === 0 ? "All " + NUM[D.all.length] + " are" : cap + " more " + (left === 1 ? "is" : "are")) +
      " one swipe away. No installs, no menus, no loading bars.";
    $("end-count").textContent = count + " of " + D.all.length + " played";
    $("end-icons").innerHTML = D.all.map(function (g) {
      return '<span class="' + (played[g] ? "played" : "next") + '"><img alt="" src="' + D.icons[g] + '"></span>';
    }).join("");
    endEl.classList.add("on");
    endEl.style.transform = "translate3d(0,0,0)";
    body.classList.remove("playing", "over", "idle");
    body.classList.add("ended");
  }
  function replayFeed() {
    for (var i = 0; i <= LAST; i++) unmount(i);
    onEnd = false;
    cur = 0;
    target = 1;
    touchedAt = now();
    body.classList.remove("ended");
    endEl.classList.remove("on");
    endEl.style.transform = "";
    mount(0);
    syncChrome();
  }

  // ---------------------------------------------------------------- the ad's clock (starts at the first touch)
  setInterval(function () {
    if (!touchedAt || onEnd || animating || hidden) return;
    var t = (now() - touchedAt) / 1000;
    var s = slides[cur];
    var busy = s && s.phase === "playing";
    if (t > 60 || (t > 45 && !busy && !G)) go(END, 0);
  }, 500);

  // ---------------------------------------------------------------- wiring
  function cta() { ctaCount++; window.__tcCta = ctaCount; NET.cta(); }
  ["cta-top", "cta-side", "cta-end"].forEach(function (id) { $(id).addEventListener("click", guard(cta)); });
  $("sound").addEventListener("click", guard(function () { setSound(!muted); }));
  $("res-again").addEventListener("click", guard(function () { var s = slides[cur]; hideResult(); if (s) post(s, "replay"); }));
  $("res-next").addEventListener("click", guard(function () { go(nextIndex(cur), 0); }));
  $("replay").addEventListener("click", guard(replayFeed));
  addEventListener("resize", function () {
    layout(0);
    slides.forEach(function (s) { if (s) post(s, "insets", insetsFor(s)); });
  });
  NET.onVisibility(function (visible) {
    hidden = !visible;
    var s = slides[cur];
    if (!s) return;
    if (hidden) { post(s, "pause", { reason: "background" }); post(s, "mute"); }
    else { post(s, "resume"); if (!silent()) post(s, "unmute"); }
  });
  window.__tcState = function () {
    var s = slides[cur];
    return { cur: cur, phase: s ? s.phase : null, ready: !!(s && s.ready), onEnd: onEnd, cta: ctaCount, played: Object.keys(played), alive: slides.filter(Boolean).length };
  };

  setSound(false);
  syncChrome();
  NET.start(function () { mount(0); });
})();
