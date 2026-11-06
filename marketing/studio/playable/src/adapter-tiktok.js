/* TikTok (Smart+ App Promotion): the click goes through the playable SDK's window.openAppStore(). */
window.TC_NET = {
  name: "tiktok",
  start: function (go) { go(); },
  cta: function () {
    try { if (typeof window.openAppStore === "function") window.openAppStore(); } catch (e) { /* no container */ }
  },
  onVisibility: function (cb) { document.addEventListener("visibilitychange", function () { cb(!document.hidden); }); },
};
