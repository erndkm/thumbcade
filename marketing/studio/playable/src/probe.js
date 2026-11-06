/* Runs inside each game frame before the game's module. Its listeners register before the SDK's, so it
   keeps seeing a gesture after the shell claims it (the SDK swallows the rest of a cancelled sequence). */
(function () {
  var host = null;
  try { host = parent.__tcProbe || null; } catch (e) { host = null; }
  function send(m) {
    if (host) { try { host(window, m); return; } catch (e) { host = null; } }
    parent.postMessage({ tcProbe: m }, "*");
  }
  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (type) {
    addEventListener(type, function (e) {
      // The SDK's own synthetic pointercancel (after input.cancel) must not end the shell's swipe.
      if (!e.isTrusted) return;
      send({ type: type, id: e.pointerId, cx: e.clientX, cy: e.clientY });
    }, { capture: true, passive: true });
  });
  addEventListener("webglcontextlost", function () { send({ type: "fail", why: "webgl context lost" }); }, true);
  addEventListener("error", function (e) { send({ type: "error", why: String(e.message || "error") }); });
})();
