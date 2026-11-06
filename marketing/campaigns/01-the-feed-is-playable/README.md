# 01 · The feed is now playable

**Launch hero · broad reach.** Hook: **THE FEED IS NOW PLAYABLE.**

People already open a short-video feed many times a day for something quick. Games give you agency, but they cost a store visit, a download and a tutorial. Thumbcade puts games where the scrolling already happens. One line explains the whole product.

- **Audience:** Broad, 18+. Heavy short-video users. With Advantage+ the creative does the targeting.
- **Platforms:** Meta Reels + Stories + Feed · TikTok In-Feed / Spark Ads · YouTube Shorts (Google App campaigns) · Google display 1.91:1
- **Test:** Red poster against ink 'play it'. The hypothesis is that the solid heat-red block stops more thumbs in a feed where most posts are dark.

## Creatives

- **Teaser video 15 s + 26.5 s (9:16, 16:9)**: The existing teaser in marketing/trailer/out. Its end card reads "Coming soon · iPhone + Android": right for pre-registration and organic posts now. Change sceneEnd in trailer/comp/trailer.js at launch.
- **Poster statics**: 9:16 Stories/Reels · 4:5 Feed · 1:1 · 1.91:1 Google

| File | Format | Size |
|---|---|---|
| `trailer/out/thumbcade-teaser-16x9.mp4` | 16:9 · 1920×1080 · 26.5 s | 26.7 MB |
| `trailer/out/thumbcade-teaser-9x16.mp4` | 9:16 · 1080×1920 · 26.5 s | 32.0 MB |
| `trailer/out/thumbcade-teaser-15s-16x9.mp4` | 16:9 · 1920×1080 · 15.0 s | 16.2 MB |
| `trailer/out/thumbcade-teaser-15s-9x16.mp4` | 9:16 · 1080×1920 · 15.0 s | 20.1 MB |
| `images/01-play-it-9x16.png` | 9:16 · 1080×1920 | 348 KB |
| `images/01-play-it-4x5.png` | 4:5 · 1080×1350 | 338 KB |
| `images/01-play-it-1x1.png` | 1:1 · 1080×1080 | 235 KB |
| `images/01-poster-9x16.png` | 9:16 · 1080×1920 | 265 KB |
| `images/01-poster-4x5.png` | 4:5 · 1080×1350 | 208 KB |
| `images/01-poster-1x1.png` | 1:1 · 1080×1080 | 209 KB |
| `images/01-poster-1200x628.png` | 1.91:1 · 1200×628 | 129 KB |

The video for this campaign is the teaser in `marketing/trailer/out/` (15 s and 26.5 s, 9:16 and 16:9).

## Copy deck

### English

**Primary text (Meta, 125)**

- The feed you already scroll, except every post is a game. Tap to play, swipe up for the next one. _(97)_
- Five seconds or five minutes. Every swipe is a new game, already running when you land on it. _(93)_
- 12 games in one feed. No installs, no menus, no loading bars. Just swipe. _(73)_

**Headline (Meta, 27–40)**

- The feed is now playable _(24)_
- A new game every swipe _(22)_
- Swipe up. Play. _(15)_

**Description (Meta)**

- Free on iPhone + Android _(24)_

**Ad text (TikTok, 100)**

- The feed you scroll, except every post is a game. Swipe up for the next one. _(76)_
- Every swipe is a new game. Tap to play. _(39)_
- No installs. No menus. Just swipe. _(34)_

### Deutsch

**Primary text (Meta, 125)**

- Der Feed, den du sowieso scrollst. Nur ist jeder Post ein Spiel. Tippen zum Spielen, hochwischen fürs nächste. _(110)_
- Fünf Sekunden oder fünf Minuten. Jeder Swipe ist ein neues Spiel, und es läuft schon, wenn du ankommst. _(103)_
- 12 Spiele in einem Feed. Keine Installation, keine Menüs, keine Ladebalken. Einfach wischen. _(92)_

**Headline (Meta, 27–40)**

- Der Feed ist jetzt spielbar _(27)_
- Jeder Swipe ein neues Spiel _(27)_
- Hochwischen. Spielen. _(21)_

**Description (Meta)**

- Gratis für iPhone + Android _(27)_

**Ad text (TikTok, 100)**

- Der Feed, den du scrollst. Nur ist jeder Post ein Spiel. _(56)_
- Jeder Swipe ein neues Spiel. Tippen und los. _(44)_
- Keine Installation. Keine Menüs. Einfach wischen. _(49)_

**CTA button:** Install Now (Meta) · Download (TikTok)

Regenerate this file with `node marketing/studio/build-index.mjs`. The copy lives in `marketing/studio/campaigns.mjs`.
