// Single source for the campaign briefs and copy decks. build-index.mjs turns this into
// marketing/index.html and marketing/campaigns/<id>/README.md. Character limits are checked at build time.

// Recommended lengths (Meta Ads Guide, TikTok, Google App campaigns; see STRATEGY.md for sources).
export const LIMITS = {
  primary: 125, // Meta primary text: shown before "See more" in Feed/Stories (Reels shows ~44)
  headline: 40, // Meta headline (27 recommended for Feed)
  description: 30,
  carouselHeadline: 32, // Meta carousel card headline (20 recommended in the Feed guide)
  tiktok: 100, // TikTok ad text
  googleHeadline: 30, // Google App campaigns: up to 5
  googleDescription: 90, // Google App campaigns: up to 5
};

export const campaigns = [
  {
    id: "01-the-feed-is-playable",
    short: "Hero",
    name: "The feed is now playable",
    role: "Launch hero · broad reach",
    insight:
      "People already open a short-video feed many times a day for something quick. Games give you agency, but they cost a store visit, a download and a tutorial. Thumbcade puts games where the scrolling already happens. One line explains the whole product.",
    audience: "Broad, 18+. Heavy short-video users. With Advantage+ the creative does the targeting.",
    platforms: ["Meta Reels + Stories + Feed", "TikTok In-Feed / Spark Ads", "YouTube Shorts (Google App campaigns)", "Google display 1.91:1"],
    hook: "THE FEED IS NOW PLAYABLE.",
    test: "Red poster against ink 'play it'. The hypothesis is that the solid heat-red block stops more thumbs in a feed where most posts are dark.",
    formats: [
      { label: "Teaser video 15 s + 26.5 s (9:16, 16:9)", path: "../trailer/out", note: "The existing teaser in marketing/trailer/out. Its end card reads \"Coming soon · iPhone + Android\": right for pre-registration and organic posts now. Change sceneEnd in trailer/comp/trailer.js at launch." },
      { label: "Poster statics", note: "9:16 Stories/Reels · 4:5 Feed · 1:1 · 1.91:1 Google" },
    ],
    copy: {
      en: {
        primary: [
          "The feed you already scroll, except every post is a game. Tap to play, swipe up for the next one.",
          "Five seconds or five minutes. Every swipe is a new game, already running when you land on it.",
          "12 games in one feed. No installs, no menus, no loading bars. Just swipe.",
        ],
        headline: ["The feed is now playable", "A new game every swipe", "Swipe up. Play."],
        description: ["Free on iPhone + Android"],
        tiktok: ["The feed you scroll, except every post is a game. Swipe up for the next one.", "Every swipe is a new game. Tap to play.", "No installs. No menus. Just swipe."],
      },
      de: {
        primary: [
          "Der Feed, den du sowieso scrollst. Nur ist jeder Post ein Spiel. Tippen zum Spielen, hochwischen fürs nächste.",
          "Fünf Sekunden oder fünf Minuten. Jeder Swipe ist ein neues Spiel, und es läuft schon, wenn du ankommst.",
          "12 Spiele in einem Feed. Keine Installation, keine Menüs, keine Ladebalken. Einfach wischen.",
        ],
        headline: ["Der Feed ist jetzt spielbar", "Jeder Swipe ein neues Spiel", "Hochwischen. Spielen."],
        description: ["Gratis für iPhone + Android"],
        tiktok: ["Der Feed, den du scrollst. Nur ist jeder Post ein Spiel.", "Jeder Swipe ein neues Spiel. Tippen und los.", "Keine Installation. Keine Menüs. Einfach wischen."],
      },
      cta: "Install Now (Meta) · Download (TikTok)",
    },
  },
  {
    id: "02-swipe-for-the-next-game",
    short: "Swipe",
    name: "Swipe for the next game",
    role: "The mechanic · carousel + video",
    insight:
      "The swipe is the product. In a carousel the viewer already swipes, so every card is a game and the swipe they make in the ad is the swipe they make in the app. The video shows 12 real games in 12 swipes, with an install counter that stays at 0.",
    audience: "Broad, 18+. Casual players, people who play the built-in games in other apps.",
    platforms: ["Meta Feed carousel (Facebook + Instagram)", "Meta Reels / Stories (video)", "TikTok In-Feed (video)"],
    hook: "EVERY SWIPE IS A NEW GAME.",
    test: "Carousel against the 12-swipes video in Feed. Track the carousel's swipe-through rate and CTR per card to find the best opening game.",
    formats: [
      { label: "10-card carousel 1:1", note: "One continuous strip: hook, 8 games, end card" },
      { label: "12-swipes video", note: "9:16 + 4:5, plus a 6 s cut that is the playable's lead-in" },
      { label: "Mid-swipe statics", note: "9:16 + 4:5" },
    ],
    carouselCards: [
      ["Swipe for the next game", "12 games · 0 installs"],
      ["Stackd · tap to play", "Build it tall"],
      ["Duskrail · swipe", "Three lanes, zero chill"],
      ["Kingsnare · tap", "90 s of checkmates"],
      ["Neon Chop · drag", "Never cut the static"],
      ["Flapjack · tap", "A pancake with ambition"],
      ["Shortwick · swipe", "Keep the fuse lit"],
      ["Heatfall · drag", "Melt through"],
      ["Snek · swipe", "Don't eat yourself"],
      ["12 games. 0 installs.", "Free on iOS + Android"],
    ],
    copy: {
      en: {
        primary: [
          "Swipe through this carousel. Then swipe through the real thing: one feed, 12 games, zero installs.",
          "Every swipe is a new game, already running. Stack, dodge, slice, merge, checkmate.",
          "Bored of this game? Swipe up. The next one is already loaded.",
        ],
        headline: ["Swipe for the next game", "12 games. 0 installs.", "Every swipe is a new game"],
        description: ["Free on iPhone + Android"],
        tiktok: ["12 games. 12 swipes. 0 installs.", "Every swipe is a new game. This one's yours.", "Bored of this game? Swipe up. The next one is already running."],
      },
      de: {
        primary: [
          "Wisch durch dieses Karussell. Dann durch das echte: ein Feed, 12 Spiele, null Installationen.",
          "Jeder Swipe ist ein neues Spiel, das schon läuft. Stapeln, ausweichen, schneiden, mergen, Schachmatt.",
          "Keine Lust mehr auf das Spiel? Hochwischen. Das nächste ist schon geladen.",
        ],
        headline: ["Wisch zum nächsten Spiel", "12 Spiele. 0 Installationen.", "Jeder Swipe ein neues Spiel"],
        description: ["Gratis für iPhone + Android"],
        tiktok: ["12 Spiele. 12 Swipes. 0 Installationen.", "Jeder Swipe ein neues Spiel.", "Keine Lust mehr? Hochwischen. Das nächste Spiel läuft schon."],
      },
      cta: "Install Now",
    },
  },
  {
    id: "03-beat-this",
    short: "Beat this",
    name: "Beat this",
    role: "Challenge · highest-intent hook",
    insight:
      "A number is a dare. Each ad shows a real score from a real run, and the headline is that score. This matches the product too: scores turn into challenge links you send to friends.",
    audience: "Competitive casual players, 18–34. Arcade, runner and puzzle interest clusters (or broad in Advantage+).",
    platforms: ["Meta Reels + Stories + Feed", "TikTok In-Feed", "Apple Ads Today tab (custom product page)"],
    hook: "BEAT 531.",
    test: "Score size: a low, doable-looking number against a high one. Game: runner against chess against snake. Use the same layout so only the game changes.",
    formats: [
      { label: "beat-531 video", note: "9:16 + 4:5. A real Duskrail run that crashes at 531, then the result card and 'Your move.'" },
      { label: "Score statics", note: "Duskrail 531, Snek 450, Kingsnare 375 · 9:16 + 4:5 (+1:1)" },
    ],
    copy: {
      en: {
        primary: [
          "531 on Duskrail. A real run, one thumb. Your move.",
          "Think you can beat 450 on Snek? Free, nothing to install per game, starts in a second.",
          "Every game has a leaderboard. Every score is a dare you can send to a friend.",
        ],
        headline: ["Beat 531", "Your move", "Beat it, then dare a friend"],
        description: ["Free on iPhone + Android"],
        tiktok: ["531. Real run. Your move.", "Beat 450 on Snek. Go.", "Every score is a dare. Send yours."],
      },
      de: {
        primary: [
          "531 in Duskrail. Ein echter Run, ein Daumen. Du bist dran.",
          "Schaffst du mehr als 450 in Snek? Gratis, nichts zu installieren, startet in einer Sekunde.",
          "Jedes Spiel hat eine Bestenliste. Jeder Score ist eine Herausforderung für deine Freunde.",
        ],
        headline: ["Schlag die 531", "Du bist dran", "Schlag sie, fordere Freunde"],
        description: ["Gratis für iPhone + Android"],
        tiktok: ["531. Echter Run. Du bist dran.", "Schlag die 450 in Snek. Los.", "Jeder Score ist eine Herausforderung."],
      },
      cta: "Play Game (Meta) · Play Now (TikTok)",
    },
  },
  {
    id: "04-zero-installs",
    short: "Zero installs",
    name: "Zero installs",
    role: "Anti-friction · casual-game fatigue",
    insight:
      "A casual player trying a new game goes to the store, downloads, waits, sits through an intro, does a tutorial and makes an account before the first real move, then deletes it by Friday. Thumbcade cuts all of that down to one swipe. The ads put the two side by side.",
    audience: "Casual mobile gamers, 18+. Lookalikes of puzzle and arcade players where interest targeting is still available.",
    platforms: ["Meta Feed + Stories", "Google App campaigns (images + YouTube)", "TikTok In-Feed (video)"],
    hook: "12 GAMES. 0 INSTALLS.",
    test: "The icon grid (breadth) against 'the usual way' (friction). Expect the grid to win on CTR and 'the usual way' to win on install rate. Check both.",
    formats: [
      { label: "zero-installs video", note: "9:16 + 4:5. The usual friction against a swipe" },
      { label: "Icon grid statics", note: "All 12 real game icons · 9:16 · 4:5 · 1:1 · 1.91:1" },
      { label: "'The usual way' statics", note: "Seven crossed-out steps against one: SWIPE · 9:16 + 4:5" },
    ],
    copy: {
      en: {
        primary: [
          "Stop installing games you'll delete by Friday. 12 games, one app, zero installs.",
          "No store page. No download. No tutorial. The game is already running. Swipe up for the next one.",
          "One app, 12 games, and the feed keeps going. Play right away, no account needed.",
        ],
        headline: ["12 games. 0 installs.", "Skip straight to playing", "One app. Every game."],
        description: ["Free on iPhone + Android"],
        tiktok: ["Stop installing games you'll delete by Friday.", "12 games. 0 installs. 1 app.", "No download. No tutorial. Just swipe."],
      },
      de: {
        primary: [
          "Schluss mit Spielen, die du freitags wieder löschst. 12 Spiele, eine App, null Installationen.",
          "Kein Store. Kein Download. Kein Tutorial. Das Spiel läuft schon. Hochwischen fürs nächste.",
          "Eine App, 12 Spiele, und der Feed geht weiter. Sofort spielen, ohne Konto.",
        ],
        headline: ["12 Spiele. 0 Installationen.", "Direkt losspielen", "Eine App. Jedes Spiel."],
        description: ["Gratis für iPhone + Android"],
        tiktok: ["Schluss mit Spielen, die du freitags löschst.", "12 Spiele. 0 Installationen. 1 App.", "Kein Download. Kein Tutorial. Einfach wischen."],
      },
      google: {
        headline: ["12 games. 0 installs.", "Swipe up for the next game", "The feed is now playable", "Play right away", "One app. Every game."],
        description: [
          "An endless feed of games you play with one thumb. Swipe up for the next one.",
          "Runners, puzzles, 3D stackers and chess tactics. No installs, no menus.",
          "Every game is already running when you land on it. Tap to play.",
          "Beat a friend's score from a link. Every game has a leaderboard.",
          "Free on Android. Play without an account.",
        ],
      },
      cta: "Install Now",
    },
  },
  {
    id: "05-the-ad-is-the-game",
    short: "Playable",
    name: "The ad is the game",
    role: "Playable · proof",
    insight:
      "Mobile game ads are known for showing gameplay the app doesn't have (the UK ASA has ruled against several). Thumbcade's games are HTML5, so the playable ad is the real product in miniature: three real launch games in a mini feed, and you swipe between them. The ad doesn't promise anything the app doesn't do.",
    audience: "Broad. Playables do the qualifying: people who finish one install with intent.",
    platforms: ["Meta playable (Facebook Feed/Stories, Audience Network)", "TikTok Smart+ playable", "Google App campaigns HTML5", "AppLovin · Unity · ironSource · Mintegral (MRAID, phase 2)"],
    hook: "THIS AD IS A GAME. TAP TO PLAY.",
    test: "Playable against the 12-swipes video for the same audience. Compare IPM and day-1 retention, not CTR: playables usually trade clicks for better installs.",
    formats: [
      { label: "Meta playable (single HTML, under 2 MB)", note: "Needs the 6 s 12-swipes lead-in video" },
      { label: "TikTok ZIP · Google ZIP · MRAID HTML", note: "One source, a network adapter per build" },
    ],
    copy: {
      en: {
        primary: [
          "Don't take our word for it. Play three real games right here, then swipe for the rest.",
          "This ad is a real Thumbcade game. Tap to play, swipe up for the next one.",
          "What you play here is what you get: real games from the app, nothing staged.",
        ],
        headline: ["Play it right here", "This ad is a game", "Try 3 games in this ad"],
        description: ["Free on iPhone + Android"],
        tiktok: ["This ad is a game. Tap to play.", "Play 3 real games right here.", "Swipe up inside the ad. Yes, really."],
      },
      de: {
        primary: [
          "Glaub uns nicht einfach. Spiel hier drei echte Spiele, dann wisch zum Rest.",
          "Diese Anzeige ist ein echtes Thumbcade-Spiel. Tippen zum Spielen, hochwischen fürs nächste.",
          "Was du hier spielst, bekommst du auch: echte Spiele aus der App, nichts gestellt.",
        ],
        headline: ["Spiel es direkt hier", "Diese Anzeige ist ein Spiel", "3 Spiele in einer Anzeige"],
        description: ["Gratis für iPhone + Android"],
        tiktok: ["Diese Anzeige ist ein Spiel. Tippen.", "Spiel hier 3 echte Spiele.", "Wisch in der Anzeige hoch. Wirklich."],
      },
      cta: "Install Now / Play Game",
    },
  },
  {
    id: "06-ship-to-the-feed",
    short: "Creators",
    name: "Ship to the feed",
    role: "Creator acquisition · supply side",
    insight:
      "The library grows only if web developers publish to it. They don't respond to hype. They respond to a working command, honest budgets and a short path to real players. The ads lead with the CLI.",
    audience: "Web and indie game developers: Canvas/Phaser/PixiJS/Three.js users, game-jam participants, frontend developers.",
    platforms: ["Reddit (r/gamedev, r/webdev, r/javascript, r/threejs, r/phaser)", "X (developer audiences)", "Meta Feed (interest: web development, game development)", "YouTube in-stream on dev channels"],
    hook: "YOUR GAME IN THIS FEED BY FRIDAY.",
    test: "'By Friday' (speed) against 'Any engine. 8 KB SDK.' (craft). Optimise for landing-page views on thumbcade.com/docs, and track scaffolds via npm downloads of create-thumbcade-game.",
    formats: [
      { label: "Terminal statics", note: "1:1 · 4:5 · 1.91:1 (Reddit/X/Google)" },
      { label: "5-card carousel", note: "Hook, Scaffold, Play it in the feed, Ship, Budgets + docs" },
    ],
    copy: {
      en: {
        primary: [
          "If you can build it for the web, you can ship it here. Canvas, Phaser, PixiJS, Three.js. npm create thumbcade-game.",
          "Your HTML5 game in a vertical feed of players. 8 KB SDK, a simulator that behaves like the phone, automated review.",
          "Scaffold, test in the real feed chrome, publish. Approved games go live with no app update.",
        ],
        headline: ["Ship web games to a feed", "npm create thumbcade-game", "Any engine. 8 KB SDK."],
        description: ["thumbcade.com/docs"],
        tiktok: ["Your web game, in a feed of players. npm create thumbcade-game", "Any engine. 8 KB SDK. Live with no app update.", "Ship your HTML5 game to a vertical feed."],
        reddit: [
          "We built a TikTok-style feed for HTML5 games. Here's the SDK (8 KB, any engine).",
          "Made a Phaser/PixiJS/Three.js game? It can run in a vertical feed of players. npm create thumbcade-game",
        ],
      },
      de: null,
      cta: "Learn More → thumbcade.com/docs",
    },
  },
];
