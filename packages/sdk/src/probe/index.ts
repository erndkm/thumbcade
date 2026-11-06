/**
 * @thumbcade/sdk/probe — runtime instrumentation for dev tools (simulator) and the automated reviewer.
 *
 * Inject PROBE_SOURCE into the game document BEFORE any game script runs (Playwright addInitScript,
 * or the `thumbcade dev` server, which inlines it as the first <script>). It wraps
 * requestAnimationFrame, AudioContext / AudioScheduledSourceNode, HTMLMediaElement and the WebRTC calls that
 * start network traffic, and records long tasks, errors, CSP violations and resource requests. Read it through
 * `window.__tcProbe`.
 *
 * It is a plain JavaScript string (not a serialized function) so transpilers can't inject helpers
 * into it.
 */

export interface ProbeLongTask {
  start: number;
  duration: number;
}

export interface ProbeAudioState {
  contexts: number;
  runningContexts: number;
  activeSources: number;
  mediaPlaying: number;
  /** A running context with a live source node, or an unmuted playing media element. */
  audible: boolean;
}

export interface ProbeSnapshot {
  /** performance.now() inside the game document. */
  now: number;
  /** Distinct animation frames in which the game had a rAF callback. */
  frames: number;
  /** Frames per second over the last second (0 when the loop is stopped). */
  fps: number;
  longTasks: ProbeLongTask[];
  heapBytes: number | null;
  audio: ProbeAudioState;
  errors: string[];
  /** Resource URLs requested from other origins. */
  foreignRequests: string[];
  /** WebRTC calls the game made, e.g. "RTCPeerConnection.setLocalDescription". WebRTC isn't covered by the CSP. */
  webrtc: string[];
  /** The SDK marked that the game read its insets. */
  insetsRead: boolean;
}

/** Pointer/wheel input seen by the probe (registered before any game or SDK listener). */
export interface ProbeInputEvent {
  kind: "down" | "move" | "up" | "cancel" | "wheel";
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  /** CSS px relative to the game viewport. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  altKey: boolean;
  shiftKey: boolean;
  /** True for events the SDK synthesized (pointercancel after input.cancel). */
  synthetic: boolean;
}

export interface Probe {
  snapshot(): ProbeSnapshot;
  /** Subscribes to raw input; returns an unsubscribe function. Used by web hosts to arbitrate feed swipes. */
  onInput(cb: (e: ProbeInputEvent) => void): () => void;
  /** rAF callbacks run after `t` (performance.now() of the game document). */
  callbacksSince(t: number): number;
  longTasksSince(t: number): ProbeLongTask[];
  audio(): ProbeAudioState;
}

export const PROBE_GLOBAL = "__tcProbe";

export const PROBE_SOURCE = String.raw`(function (w) {
  if (!w || w.__tcProbe) return;
  var perf = w.performance;
  var cbTimes = [];
  var frameTimes = [];
  var frames = 0;
  var lastFrameTs = -1;
  var longTasks = [];
  var errors = [];
  var foreign = [];
  var ctxs = [];
  var sources = [];
  var media = [];
  var push = function (list, v, max) { list.push(v); if (list.length > max) list.shift(); };
  var inputSubs = [];
  var KINDS = { pointerdown: "down", pointermove: "move", pointerup: "up", pointercancel: "cancel", wheel: "wheel" };
  Object.keys(KINDS).forEach(function (type) {
    w.addEventListener(type, function (e) {
      if (!inputSubs.length) return;
      var ev = {
        kind: KINDS[type],
        pointerId: e.pointerId == null ? 1 : e.pointerId,
        pointerType: e.pointerType || "mouse",
        isPrimary: e.isPrimary == null ? true : e.isPrimary,
        x: e.clientX, y: e.clientY,
        dx: type === "wheel" ? e.deltaX : 0, dy: type === "wheel" ? e.deltaY : 0,
        altKey: !!e.altKey, shiftKey: !!e.shiftKey,
        synthetic: e.isTrusted === false
      };
      inputSubs.slice().forEach(function (cb) { try { cb(ev); } catch (x) {} });
    }, { capture: true, passive: true });
  });

  var raf = w.requestAnimationFrame;
  if (raf) {
    w.requestAnimationFrame = function (cb) {
      return raf.call(w, function (ts) {
        var n = perf.now();
        push(cbTimes, n, 2000);
        if (ts !== lastFrameTs) { lastFrameTs = ts; frames++; push(frameTimes, n, 240); }
        return cb(ts);
      });
    };
  }

  ["AudioContext", "webkitAudioContext"].forEach(function (name) {
    var C = w[name];
    if (typeof C !== "function") return;
    var Wrapped = function () {
      var c = Reflect.construct(C, arguments, new.target || Wrapped);
      ctxs.push(c);
      return c;
    };
    Wrapped.prototype = C.prototype;
    Object.setPrototypeOf(Wrapped, C);
    w[name] = Wrapped;
  });
  var S = w.AudioScheduledSourceNode && w.AudioScheduledSourceNode.prototype;
  if (S && S.start) {
    var start = S.start;
    S.start = function () {
      var node = this;
      if (sources.indexOf(node) < 0) sources.push(node);
      try { node.addEventListener("ended", function () { var i = sources.indexOf(node); if (i >= 0) sources.splice(i, 1); }); } catch (e) {}
      return start.apply(node, arguments);
    };
  }
  // WebRTC traffic (STUN/TURN, data channels) isn't a fetch, so the CSP can't stop it: record the calls that start it.
  // Hooked on the prototype, so a game can't dodge it by reaching for the original constructor. Same-origin child
  // frames (an about:blank iframe has its own RTCPeerConnection) report to the outermost game probe.
  var webrtc = [];
  var noteWebrtc = function (what) {
    var host = w;
    try { while (host.parent && host.parent !== host && host.parent.__tcProbe) host = host.parent; } catch (e) {}
    if (host !== w && host.__tcProbe.noteWebrtc) host.__tcProbe.noteWebrtc(what);
    else push(webrtc, what, 20);
  };
  ["RTCPeerConnection", "webkitRTCPeerConnection"].forEach(function (name) {
    var P = typeof w[name] === "function" && w[name].prototype;
    if (!P) return;
    ["createOffer", "createAnswer", "setLocalDescription", "createDataChannel"].forEach(function (m) {
      var orig = P[m];
      if (typeof orig !== "function" || orig.__tcProbe) return;
      var hooked = function () { noteWebrtc("RTCPeerConnection." + m); return orig.apply(this, arguments); };
      hooked.__tcProbe = true;
      P[m] = hooked;
    });
  });
  var M = w.HTMLMediaElement && w.HTMLMediaElement.prototype;
  if (M && M.play) {
    var play = M.play;
    M.play = function () { if (media.indexOf(this) < 0) media.push(this); return play.apply(this, arguments); };
  }

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { push(longTasks, { start: e.startTime, duration: e.duration }, 200); });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        try { if (new URL(e.name, w.location.href).origin !== w.location.origin) push(foreign, e.name, 50); } catch (x) {}
      });
    }).observe({ type: "resource", buffered: true });
  } catch (e) {}

  w.addEventListener("error", function (e) {
    push(errors, (e && e.message) || "Script error", 50);
  });
  w.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    push(errors, "Unhandled rejection: " + (r && r.message ? r.message : String(r)), 50);
  });
  w.addEventListener("securitypolicyviolation", function (e) {
    push(errors, "CSP blocked " + (e.blockedURI || "inline") + " (" + e.violatedDirective + ")", 50);
  });

  var audio = function () {
    var running = ctxs.filter(function (c) { return c.state === "running"; });
    var active = sources.filter(function (s) { return running.indexOf(s.context) >= 0; });
    var playing = media.filter(function (m) { return !m.paused && !m.ended && !m.muted && m.volume > 0; });
    return {
      contexts: ctxs.length,
      runningContexts: running.length,
      activeSources: active.length,
      mediaPlaying: playing.length,
      audible: active.length > 0 || playing.length > 0
    };
  };

  w.__tcProbe = {
    snapshot: function () {
      var now = perf.now();
      var fps = frameTimes.filter(function (t) { return now - t <= 1000; }).length;
      var mem = perf.memory;
      return {
        now: now,
        frames: frames,
        fps: fps,
        longTasks: longTasks.slice(),
        heapBytes: mem ? mem.usedJSHeapSize : null,
        audio: audio(),
        errors: errors.slice(),
        foreignRequests: foreign.slice(),
        webrtc: webrtc.slice(),
        insetsRead: !!(w.document && w.document.documentElement && w.document.documentElement.hasAttribute("data-tc-insets-read"))
      };
    },
    callbacksSince: function (t) { return cbTimes.filter(function (x) { return x > t; }).length; },
    longTasksSince: function (t) { return longTasks.filter(function (x) { return x.start + x.duration > t; }); },
    audio: audio,
    noteWebrtc: function (what) { push(webrtc, what, 20); },
    onInput: function (cb) {
      inputSubs.push(cb);
      return function () { var i = inputSubs.indexOf(cb); if (i >= 0) inputSubs.splice(i, 1); };
    }
  };
})(typeof window !== "undefined" ? window : undefined);`;

/** Reads the probe of a same-origin window (simulator). Null when absent or cross-origin. */
export function readProbe(win: Window | null | undefined): Probe | null {
  try {
    const p = (win as unknown as Record<string, unknown> | null | undefined)?.[PROBE_GLOBAL];
    return (p as Probe | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Inserts the probe as the first script of an HTML document (dev servers). */
export function injectProbe(html: string): string {
  const tag = `<script data-thumbcade-probe>${PROBE_SOURCE}</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
}
