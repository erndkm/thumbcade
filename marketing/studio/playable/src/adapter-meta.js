/* Meta (Facebook, Instagram, Audience Network): the click goes through FbPlayableAd.onCTAClick(). */
window.TC_NET = {
  name: "meta",
  start: function (go) { go(); },
  cta: function () {
    try { if (window.FbPlayableAd && typeof window.FbPlayableAd.onCTAClick === "function") window.FbPlayableAd.onCTAClick(); } catch (e) { /* no container */ }
  },
  onVisibility: function (cb) { document.addEventListener("visibilitychange", function () { cb(!document.hidden); }); },
};
