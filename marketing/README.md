# Marketing

Everything for Thumbcade's paid and organic launch lives in this folder. Start with **`index.html`**: open it in a browser for the overview, with the strategy summary, every campaign's brief, the copy deck (EN/DE, with copy buttons and character counts), all creatives and the playable ad.

| Path | What |
|---|---|
| `index.html` | The overview page. Generated, so don't edit it by hand. |
| `STRATEGY.md` | Platform analysis, the measurement decision, audiences, test plan, compliance checklist and sources |
| `campaigns/01-the-feed-is-playable/` | Launch hero: poster statics. The video is the teaser in `trailer/out/`. |
| `campaigns/02-swipe-for-the-next-game/` | 10-card carousel, mid-swipe statics, the 12-swipes video (and its 6 s cut, the playable's lead-in) |
| `campaigns/03-beat-this/` | Challenge ads: real scores from real runs. Statics and the beat-531 video. |
| `campaigns/04-zero-installs/` | Icon grid and "the usual way" statics, the zero-installs video, Google App campaign text |
| `campaigns/05-the-ad-is-the-game/` | The playable ad: three real launch games in a mini feed. Builds for Meta, TikTok, Google and MRAID. |
| `campaigns/06-ship-to-the-feed/` | Creator acquisition (Reddit, X, Meta): terminal statics and a 5-card carousel |
| `studio/` | The generators. `statics/` renders the images, `video/` the video ads and `playable/` the playable. `campaigns.mjs` holds all copy, and `build-index.mjs` writes `index.html` and the campaign READMEs. |
| `trailer/` | The teaser trailer and the real-gameplay capture pipeline that the video ads reuse |
| `swipesu/` | Name candidate: a swipesu logo and every video re-rendered under that name (`--brand swipesu`). Nothing else uses it yet. |
| `swuple/` | Name candidate (swipe + up + -le) with three logos: the button (`--brand swuple`) and the swipe (`swuple/swipe/`, `--brand swuple/swipe`), each with every video re-rendered, and the script (`swuple/script/`, the name written across the icon; no videos yet). Nothing else uses it yet. |

Every campaign folder has a README with the brief, the file list and the full copy deck. For 05 the brief is `BRIEF.md`, and its `README.md` covers the playable's upload notes.

## Rules the creatives follow

- **Real gameplay only.** Footage and scores are captured from the launch games under a virtual clock (`trailer/capture`). The playable runs the real game code.
- **No fabricated social proof.** No like or play counts, ratings, reviews or user numbers.
- **Brand:** `THUMBCADE_BUILD_PROMPT.md` §12. Ink, warm paper, one heat-red accent per region, Mona Sans and Departure Mono. All of it comes from `@thumbcade/design-tokens`.
- **Safe zones:** in 9:16, text stays between y ≈ 270 and 1250 (Reels and TikTok overlays).

## Regenerate

```bash
cd marketing/trailer && npm install && bash prepare.sh     # build game copies, capture 60 fps gameplay (~2 min)
cd ../studio && npm install && bash prepare.sh              # fonts, brand marks, game icons, tokens
node statics/render.mjs                                     # all statics + carousel cards (or: node statics/render.mjs 03-)
# video ads: see studio/video/README.md
node playable/build.mjs && node playable/verify.mjs         # the playable ad builds + checks
node build-index.mjs                                        # index.html + campaign READMEs
```

Change copy in `studio/campaigns.mjs` and layouts in `studio/statics/creatives.js`, then re-run the two commands above.

## Before anything goes live

Store links aren't set yet: end cards say "Free on iPhone + Android", and the playable's store URLs are placeholders. Install measurement on Meta and TikTok needs an SDK or MMP decision first (see `STRATEGY.md`). The videos are large, so use Git LFS or keep them out of git if the repo needs to stay small.
