// Creates a challenge as the seeded demo member (share codes are members-only) and exposes
// output.code / output.gameName / output.gameSlug for the flow. Uses Maestro's built-in `http` and `json`.
// A challenge can only carry a score the member actually reached, so it uses the demo member's best.
var base = "http://127.0.0.1:54321";
var anon = ANON_KEY;
var login = json(
  http.post(base + "/auth/v1/token?grant_type=password", {
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@thumbcade.dev", password: "thumbcade-demo" }),
  }).body,
);
var auth = { apikey: anon, Authorization: "Bearer " + login.access_token };
var bests = json(
  http.get(base + "/rest/v1/best_scores?select=best_score,games(id,slug,name,status)&user_id=eq." + login.user.id + "&limit=50", {
    headers: auth,
  }).body,
);
var pick = null;
for (var i = 0; i < bests.length; i++) {
  if (bests[i].games && bests[i].games.status === "live") {
    pick = bests[i];
    break;
  }
}
if (!pick) throw new Error("the demo member has no best score on a live game (run pnpm seed)");
var share = json(
  http.post(base + "/functions/v1/share-create", {
    headers: { apikey: anon, Authorization: auth.Authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: pick.games.id, channel: "challenge", score: pick.best_score }),
  }).body,
);
if (!share.code) throw new Error("share-create failed: " + JSON.stringify(share));
output.code = share.code;
output.gameName = pick.games.name;
output.gameSlug = pick.games.slug;
