/* Local preview (the overview page embeds this one): the click shows a toast instead of leaving. */
window.TC_NET = {
  name: "preview",
  start: function (go) { go(); },
  cta: function () {
    window.__tcCtaCount = (window.__tcCtaCount || 0) + 1;
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = "CTA tapped. In an ad this opens the store.";
    t.classList.add("on");
    clearTimeout(window.__tcToast);
    window.__tcToast = setTimeout(function () { t.classList.remove("on"); }, 1800);
  },
  onVisibility: function (cb) { document.addEventListener("visibilitychange", function () { cb(!document.hidden); }); },
};
