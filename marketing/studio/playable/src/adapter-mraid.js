/* MRAID 2.0/3.0 (AppLovin, Unity, ironSource, Mintegral, Liftoff): wait for `ready` and for the ad to be
   on screen before starting, open the store with mraid.open(), and go quiet whenever the ad is hidden. */
window.TC_NET = (function () {
  var m = function () { return window.mraid || null; };
  var storeUrl = function () {
    return /android/i.test(navigator.userAgent) ? window.TC_STORE.android : window.TC_STORE.ios;
  };
  return {
    name: "mraid",
    start: function (go) {
      var api = m();
      if (!api) return go();
      var started = false;
      var begin = function () { if (!started) { started = true; go(); } };
      var whenViewable = function () {
        var viewable = typeof api.isViewable === "function" ? api.isViewable() : true;
        if (viewable) return begin();
        var onView = function (v) { if (v) { api.removeEventListener("viewableChange", onView); begin(); } };
        api.addEventListener("viewableChange", onView);
      };
      if (api.getState() === "loading") api.addEventListener("ready", whenViewable);
      else whenViewable();
    },
    cta: function () {
      var api = m();
      if (api && typeof api.open === "function") api.open(storeUrl());
      else window.open(storeUrl(), "_blank");
    },
    onVisibility: function (cb) {
      var api = m();
      if (api) {
        api.addEventListener("viewableChange", function (v) { cb(!!v); });
        try { api.addEventListener("exposureChange", function (pct) { cb(pct > 0); }); } catch (e) { /* MRAID 2.0 */ }
      }
      document.addEventListener("visibilitychange", function () { cb(!document.hidden); });
    },
  };
})();
