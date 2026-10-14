/*
 * Minimal Thumbcade bridge client used by the dev fixtures. It speaks the protocol directly
 * (packages/protocol/src/bridge.ts) so the shell can be tested before @thumbcade/sdk lands.
 * Copied into each fixture as bridge.js by build-assets.ts — edit this file, then rebuild.
 *
 * Transports: React Native WebView (ReactNativeWebView.postMessage out, MessageEvent in),
 * iframe (parent.postMessage, source-checked), standalone (in-page mock host).
 */
(function () {
  "use strict";
  var CH = "tc";
  var V = 1;
  var seq = 0;
  var pending = {};
  var handlers = {};
  var rn = !!window.ReactNativeWebView;
  var framed = !rn && window.parent !== window;
  var standalone = !rn && !framed;

  function nextId() {
    seq = (seq + 1) % 1000000;
    return "g" + Date.now().toString(36) + seq.toString(36);
  }

  function emit(type, payload) {
    var list = handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](payload || {});
  }

  function deliver(env) {
    if (!env || env.ch !== CH || env.v !== V) return;
    if (env.type === "reply" && env.replyTo && pending[env.replyTo]) {
      var p = pending[env.replyTo];
      delete pending[env.replyTo];
      var r = env.payload || {};
      if (r.ok) p.resolve(r.result);
      else p.reject(new Error((r.error && r.error.code) || "error"));
      return;
    }
    emit(env.type, env.payload);
  }

  // --- standalone mock host -------------------------------------------------------------
  var mockStore = {};
  function mockHost(env) {
    var reply = function (result) {
      setTimeout(function () {
        deliver({ ch: CH, v: V, id: nextId(), type: "reply", replyTo: env.id, payload: { ok: true, result: result } });
      }, 0);
    };
    var none = { top: 0, right: 0, bottom: 0, left: 0 };
    switch (env.type) {
      case "hello":
        return reply({
          sdkVersion: "1.0.0",
          gameId: "standalone",
          versionId: "standalone",
          player: null,
          locale: navigator.language || "en",
          reducedMotion: !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
          audio: { muted: false },
          insets: { preview: none, play: none, current: "preview" },
          launchReason: "dev",
          seed: Math.floor(Math.random() * 2147483647),
          dailySeed: 1,
          best: null,
          host: "standalone",
        });
      case "storage.get":
        return reply({ value: Object.prototype.hasOwnProperty.call(mockStore, env.payload.key) ? mockStore[env.payload.key] : null });
      case "storage.set":
        mockStore[env.payload.key] = env.payload.value;
        return reply({ ok: true });
      case "leaderboard.top":
        return reply({ entries: [] });
      case "leaderboard.me":
        return reply({ best: null, rank: null, percentile: null });
      case "share.challenge":
        return reply({ shared: false });
      default:
        return undefined;
    }
  }

  function post(env) {
    if (rn) window.ReactNativeWebView.postMessage(JSON.stringify(env));
    else if (framed) window.parent.postMessage(env, "*");
    else mockHost(env);
  }

  function send(type, payload) {
    var env = { ch: CH, v: V, id: nextId(), type: type };
    if (payload !== undefined) env.payload = payload;
    post(env);
    return env.id;
  }

  function request(type, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = send(type, payload);
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error("timeout"));
        }
      }, timeoutMs || 8000);
    });
  }

  window.addEventListener("message", function (e) {
    if (framed && e.source !== window.parent) return;
    var d = e.data;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch (_) {
        return;
      }
    }
    deliver(d);
  });

  window.TC = {
    host: rn ? "rn" : framed ? "iframe" : "standalone",
    standalone: standalone,
    hello: function (manifestId) {
      return request("hello", { sdkVersion: "1.0.0", manifestId: manifestId }, 15000);
    },
    ready: function () {
      send("ready", {});
    },
    start: function (trigger) {
      send("gameplay.start", { trigger: trigger || "tap" });
    },
    end: function (score, outcome) {
      send("gameplay.end", { score: score, outcome: outcome || "lose" });
    },
    feedback: function (kind) {
      send("feedback", { kind: kind });
    },
    storageGet: function (key) {
      return request("storage.get", { key: key }).then(function (r) {
        return r ? r.value : null;
      });
    },
    storageSet: function (key, value) {
      return request("storage.set", { key: key, value: value });
    },
    track: function (name, props) {
      send("analytics.track", props ? { name: name, props: props } : { name: name });
    },
    on: function (type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
  };
})();
