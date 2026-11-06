# Thumbcade paid launch: platform and creative strategy

October 2026. The product is pre-launch: store listings aren't live yet, and the portal's download section says "Coming soon". Specs and benchmarks were checked on 17 Oct 2026; the sources are listed at the end.

## The short answer

1. **Yes, Meta should be the main scale channel.** Use an Advantage+ app campaign with the App Installs objective. It's the only large network that takes every format we need in one campaign: 9:16 video (Reels and Stories), a playable, a carousel and statics, up to 50 creatives. Advantage+ targets only by country, OS and language, so **the creative is the targeting**. That's why this folder holds six distinct concepts and not one ad in many sizes.
2. **TikTok is the closest fit for the product** ("TikTok for minigames", the same swipe). Use it for video-led growth and Spark Ads on our own organic posts. TikTok playables are now available for app installs through Smart+.
3. **Apple Ads and the Google Play pre-registration campaign can run without any change to the app.** Apple counts installs in its own dashboard (App Store verified). Pre-registration needs no SDK and can start before launch.
4. **The format to win with is the playable.** Our games are HTML5, so the playable ad is the real product, not a staged mock-up. In a category known for misleading ads, that's the clearest way to stand out.

### Blocking decision: install measurement

Meta says Advantage+ app campaigns are measured "with the Meta SDK or a Mobile Measurement Partner (MMP)". On iOS, SKAdNetwork/AEM needs the app to call `updatePostbackConversionValue`, which the SDK or MMP does. TikTok's install optimisation has the same dependency. The app currently has **no ad SDK, no IDFA and no tracking**: that's in the App Privacy table, and the CLAUDE.md rule keeps the app running in Expo Go, which rules out custom native modules.

| Option | What it unlocks | Cost |
|---|---|---|
| **A. One MMP SDK** (Adjust, AppsFlyer, Branch or Singular) in the EAS store build, with SKAN/AdAttributionKit only on iOS (no ATT prompt, no IDFA) and consent-gated on Android in the EU | Install and event optimisation on Meta, TikTok and Google, SKAN conversion values, one source of truth | The app can't run in Expo Go any more (development moves to a dev build). Privacy labels change. §25 TDDDG/GDPR consent design is needed. |
| B. Meta SDK and TikTok SDK directly | The same, per network | Two SDKs, more data shared, same Expo Go issue |
| C. No SDK | Apple Ads (dashboard installs), Google Play pre-registration, and Meta/TikTok optimised only for link clicks to the store | Meta and TikTok can't optimise for installs, so CPI will be noticeably worse |

**Recommendation: A.** One MMP, no ATT prompt (SKAN only), consent-first in the EU. Until it ships, run option C: Apple Ads, Google pre-registration, organic video, and the creator campaign. Record the decision in `docs/DECISIONS.md`.

## Platform analysis

| Platform | Why it fits | Formats we use | Role | Suggested share of launch budget |
|---|---|---|---|---|
| **Meta** (Reels, Stories, Feed, Audience Network) | The largest reach. All four app-install formats are in one campaign, and the playable is supported. Advantage+ runs on the creative. | Video 9:16 + 4:5, playable (with a lead-in video), 10-card carousel, statics | Scale engine | 40% |
| **TikTok** | The product's own interaction model. Spark Ads use organic posts. Playables (ZIP, at most 5 MB) and carousel are available for app promotion. | Video 9:16, playable ZIP, Spark Ads of the teaser cuts | Creative-led growth and organic halo | 30% |
| **Apple Ads** | High intent ("games", "arcade", "puzzle"). Privacy-native attribution. Today tab and custom product pages. | Custom product page per campaign: the 03 Beat this screens and the 04 icon grid | iOS intent and brand defence | 15% |
| **Google App campaigns** | Android pre-registration now (no SDK). At launch: YouTube Shorts, Play and AdMob, plus HTML5 playable assets. | 5 headlines and 5 descriptions, 1:1 / 4:5 / 1.91:1 images, the YouTube video cuts, HTML5 ZIP | Android volume | 10% |
| **Reddit and X** | Developers, who make up the supply side, gather there and respond to honest, technical ads | Terminal statics, 5-card carousel, Reddit-native titles | Creator acquisition (06) | 5% |

**Not now.** AppLovin, Unity, ironSource and Mintegral are where hypercasual UA happens, and the MRAID build of our playable is ready for them. They pay off once retention is proven and an MMP is in place, so treat them as phase 2. Snapchat has less EU reach for this audience, and Lens Games competes in the chat drawer.

## Where we stand out

- **The category's ads are loud, samey and often fake.** The UK ASA has ruled against several game advertisers for showing gameplay that isn't in the app (Playrix, AppQuantum, Top Games). In Nexters' 2023 survey of 5,212 players, 91% said they recognise misleading ads. **Every frame and score in our creatives is real gameplay captured from the launch games**, and the playable *is* the games.
- **Restraint is the pattern interrupt.** In a feed of saturated chaos, ink black, warm paper and a single arcade-button red with editorial type look unlike any other game ad. The games bring the colour.
- **The ad looks like the product.** The feed card in our creatives is the real app chrome, rebuilt from `@thumbcade/design-tokens`. In Reels and TikTok it reads as native content, and that's the pitch: the feed you already scroll, made playable.
- **The competition.** None of these are named in ads.
  - TikTok retired HTML5 mini games on 9 Sep 2026; only native runtimes are accepted now.
  - YouTube Playables lives inside YouTube.
  - Poki and CrazyGames are web portals with menus.
  - Minit Games (Hamburg) is building an HTML5 game feed, in invite-only alpha.
  - Meta Pocket (AI-generated games) soft-launched in June 2026.
  - Thumbcade's position: a native app, a real feed with no menus, games reviewed before they go live, and a creator platform.

## Audiences and the six campaigns

With Advantage+, each concept speaks to a different motivation and the algorithm finds who responds.

| # | Campaign | Motivation | Lead format | Hook |
|---|---|---|---|---|
| 01 | The feed is now playable | "I scroll anyway" | Teaser video, red poster | THE FEED IS NOW PLAYABLE. |
| 02 | Swipe for the next game | Curiosity, variety | 10-card carousel, 12-swipes video | EVERY SWIPE IS A NEW GAME. |
| 03 | Beat this | Ego, competition | beat-531 video, score statics | BEAT 531. |
| 04 | Zero installs | Fatigue with casual-game friction | Icon grid, zero-installs video | 12 GAMES. 0 INSTALLS. |
| 05 | The ad is the game | Proof | Playable plus a 6 s lead-in | THIS AD IS A GAME. |
| 06 | Ship to the feed | Developers want players | Terminal statics, carousel | YOUR GAME IN THIS FEED BY FRIDAY. |

**Targeting basics.** Target **18+**: the DSA (Art. 28) bans profiling-based ads to minors, and the app is rated 12+. Start in **DACH** (where the operator is) with German primary text, plus **UK, NL and the Nordics** in English. Add lower-CPI EU markets for volume once day-1 retention holds.

## Testing plan (first four weeks after launch)

1. **Week 0–1: concept test.** Run one Advantage+ app campaign per OS with all six player concepts loaded (01–05; 06 runs separately as Traffic), about 20 creatives. Don't judge a creative before about 50 installs. At a casual-game CPI of about €1–3.50 (Admiral Media 2025 ranges), that's roughly €75–175 per creative.
2. **What to read, per creative, in this order:**
   - Hook rate (3 s views ÷ impressions): target over 30%.
   - Hold rate (ThruPlays ÷ 3 s views): over 25%.
   - Link CTR: at least 1.0% on Meta Feed and 1.5% on TikTok. Vendor benchmarks are Meta Feed 0.5–1.5% and TikTok in-feed 0.8–2.5%.
   - IPM (installs per 1,000 impressions): above the gaming average of about 8.6 (Adjust 2026).
   - Day-1 retention: the real verdict.
3. **Kill or keep:** after 5,000 impressions, pause anything with a CTR under 0.6% or a hook rate under 20%. Duplicate the winning hook onto the other games (03 is built for this: same layout, swap the game).
4. **Week 2–4: iterate.** Make new versions of the top two concepts (new opening game, new score, DE/EN copy). Refresh creatives every 2–3 weeks. Advantage+ fatigues quickly at small budgets.
5. **Always on:** Apple Ads exact-match brand and category keywords, and a custom product page that mirrors the best Meta concept.

## Compliance checklist (read before uploading)

- [ ] Store listings are live and the end-card line "Free on iPhone + Android" is true. Store URLs are filled in the playable config.
- [ ] Gameplay is real. The playable runs the same game code as the app.
- [ ] Claims hold. "12 games" is the launch library; update it when the library changes. "Free": v1 has no in-app purchases. "No account needed": the app has guest mode. "By Friday" in 06 promises a review turnaround: confirm the review SLA before running it.
- [ ] No fabricated social proof. The rail in our feed cards has no like or play counts, and there are no ratings, reviews or user numbers.
- [ ] No fake system UI or fake buttons (Meta policy). The friction in 04 is drawn in our own design language and doesn't imitate iOS or Android dialogs.
- [ ] Photosensitivity: the games route flashes through the kit's Photosafe, and the videos avoid full-screen flashes.
- [ ] Game names passed a trademark screening. A formal clearance is still open (`docs/GAPS.md`).
- [ ] Age 18+ targeting in the EU (DSA Art. 28).

## Sources

- Meta Advantage+ app campaigns: facebook.com/business/help/1153577308409919 · Measurement needs the SDK or an MMP: facebook.com/business/ads/meta-advantage-plus/app-campaigns · SKAN/AEM: developers.facebook.com/docs/app-ads/SKAdNetwork-aem-and-limitations/
- Meta Ads Guide: Reels and Stories safe zones are top 14%, bottom 35%, sides 6%; Feed is 4:5; carousel is 2–10 cards at 1:1. facebook.com/business/ads-guide/update/…
- Meta playable ads: one HTML file under 2 MB, `FbPlayableAd.onCTAClick()`, no HTTP requests, no mraid.js, lead-in video required. en-gb.facebook.com/business/help/412951382532338
- TikTok playables (ZIP, at most 5 MB, `window.openAppStore()`, Smart+): ads.tiktok.com/help/article/playable-ads · TikTok in-feed specs: ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads
- Apple Ads placements and attribution: ads.apple.com/app-store/help/ad-placements/0081-ad-placement-options · ads.apple.com/app-store/help/attribution/0028-measuring-ad-performance
- Google App campaign assets and HTML5 (ExitApi): support.google.com/google-ads/answer/9948381 · support.google.com/google-ads/answer/9981650 · Pre-registration: support.google.com/google-ads/answer/9441344
- Benchmarks are vendor and secondary sources, not official:
  - Admiral Media 2025, CPI and CTR ranges: admiral.media/mobile-game-marketing-benchmarks/
  - Adjust Gaming App Insights 2026 (IPM), via segwise.ai
  - Sensor Tower State of Gaming 2026 (playables were 13.3% of game ad impressions), via segwise.ai
- UK ASA game-ad rulings: asa.org.uk/rulings/plr-worldwide-sales-ltd-g20-1061644-plr-worldwide-sales-ltd.html · Nexters player survey 2023
- Competitors:
  - TikTok HTML mini-game retirement: developers.tiktok.com/docs/en/migrate-from-html-to-native-runtime
  - Minit Games: mobilegamer.biz/new-tiktok-for-games-firm-minit-lands-2m/
  - YouTube Playables: developers.google.com/youtube/gaming/playables
