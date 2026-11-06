// Deterministic clock for frame-by-frame capture. Installed before any page script runs.
(() => {
  if (window.__vt) return;
  let seed = 0x2f6b1d3 ^ (Number(new URLSearchParams(location.search).get("seed")) || 7);
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let now = 1000;
  const dateBase = Date.now() - now;
  const raf = new Map();
  const timers = new Map();
  let ids = 0;
  performance.now = () => now;
  Date.now = () => dateBase + now;
  window.requestAnimationFrame = (cb) => { const id = ++ids; raf.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { raf.delete(id); };
  const add = (fn, ms, args, every) => {
    const id = ++ids;
    const d = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + d, fn, args, every: every ? Math.max(1, d) : 0 });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  function runTimersUntil(target) {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) return;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      try { typeof t.fn === "function" ? t.fn(...t.args) : null; } catch (e) { console.error(e); }
    }
  }
  window.__vt = {
    get now() { return now; },
    step(dt) {
      const target = now + dt;
      runTimersUntil(target);
      now = target;
      const cbs = [...raf.values()];
      raf.clear();
      for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } }
    },
  };
})();
