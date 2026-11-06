/* Google App campaigns (HTML5): the click goes through ExitApi.exit() to the ad's final URL. */
window.TC_NET = {
  name: "google",
  start: function (go) { go(); },
  cta: function () {
    try { if (window.ExitApi && typeof window.ExitApi.exit === "function") window.ExitApi.exit(); } catch (e) { /* no container */ }
  },
  onVisibility: function (cb) { document.addEventListener("visibilitychange", function () { cb(!document.hidden); }); },
};
