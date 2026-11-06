# Video ads

Three paid-social spots, each with a 9:16 master (1080×1920: Reels, Stories, TikTok, Shorts) and a 4:5 version
(1080×1350: Meta Feed). H.264 High, yuv420p, 60 fps, AAC 48 kHz, with captions burned in so they work with the
sound off. `12-swipes` also has a 6 s 9:16 cut, which is the lead-in video for the playable ad.

All gameplay is real footage of the launch games, captured by `marketing/trailer` (attract-mode AI kept on during
a real run, frame by frame under a virtual clock). The feed UI is rebuilt from `@thumbcade/design-tokens`.
The like, comment, save and share counts and the play counts are left off the feed card on purpose: the ads
show no social numbers we can't back up.

| Spot | Campaign | Outputs (in `marketing/campaigns/…/video/`) |
|---|---|---|
| `beat-531` | 03 Beat this | `thumbcade-beat-531-9x16.mp4`, `-4x5.mp4`, `-cover-9x16.png`, `-cover-4x5.png` |
| `12-swipes` | 02 Swipe for the next game | `thumbcade-12-swipes-9x16.mp4`, `-4x5.mp4`, `-6s-9x16.mp4`, covers |
| `zero-installs` | 04 Zero installs | `thumbcade-zero-installs-9x16.mp4`, `-4x5.mp4`, covers |

## Timelines

120 BPM, so one beat is 0.5 s. Cuts and type land on the beat, and the soundtrack is scored to the same clock.

### `beat-531` (13 s)

| Time | Picture | On-screen copy |
|---|---|---|
| 0.0–1.6 | A live Duskrail run, full-bleed. A huge Departure Mono "531" slams in on the first frame. The label sits on an ink plate so it never collides with the game's own HUD. | DUSKRAIL · SCORE TO BEAT / 531 / CAN YOU BEAT IT? |
| 1.8–2.4 | The run continues with a compact tracker at the top left. | TO BEAT 531 |
| 2.4–3.0 | A cut to the end of the same run (score 525), in slow motion, with the music ducking. | (tracker turns orange at 531) |
| 3.0 | The real crash at 531, with shake and impact. | |
| 3.3–5.4 | The result card springs up, the odometer rolls to 531, and a NEW BEST stamp lands at 4.5. | RUN OVER · DUSKRAIL / 531 / DISTANCE 291 M · BOLTS 24 · BEST 531 / NEW BEST |
| 5.5–6.9 | A heat-red poster with ink type. | YOUR MOVE. |
| 6.95–10.0 | The poster is swiped up like a feed card: Stackd, then flicks through Neon Chop, Kingsnare, Flapjack, Heatfall and Snek. | OR ANY OF 12 GAMES. |
| 10.0–13.0 | End card: the button is pressed and the wordmark rises. | thumbcade / SWIPE UP FOR THE NEXT GAME / FREE ON IPHONE + ANDROID |

### `12-swipes` (12.5 s)

| Time | Picture | On-screen copy |
|---|---|---|
| 0.0–1.3 | The feed with Duskrail live, the headline on screen from the first frame | EVERY SWIPE IS A NEW GAME. |
| 1.5–5.75 | One swipe per beat, then quarter-beat flicks, through all 12 games. A GAMES odometer rolls with each swipe. INSTALLS stays at 0 in heat red. | GAMES 01/12 → 12/12 · INSTALLS 0 |
| 6.0–7.05 | The feed lands on Stackd (attract mode). | 12 GAMES. / 0 INSTALLS. |
| 7.4–9.7 | A tap: the tab bar morphs into the Dock, an accent scanline wipes the card, and a real Stackd run builds | TAP TO PLAY. → FIVE SECONDS. OR FIVE MINUTES. |
| 10.0–12.5 | End card | thumbcade / SWIPE UP FOR THE NEXT GAME / FREE ON IPHONE + ANDROID |

**6 s cut** (`--cut 6`, the playable lead-in): the hook (0–0.85 s), 11 quarter-beat swipes through all 12 games
with the counters (1.0–3.5 s), "12 GAMES. 0 INSTALLS." (3.8–4.45 s), and the end card (4.5–6.0 s). The end card is
faster here (`endCard(…, { fast: true })`), so the full lockup holds for about 0.6 s before the cut ends.

### `zero-installs` (13 s)

| Time | Picture | On-screen copy |
|---|---|---|
| 0.0–1.25 | Two screens side by side. The hook headline sits above them. | WAITING VS. PLAYING. |
| 1.35–7.0 | A running stopwatch. **Left:** a generic game's friction, drawn in our type with no real product shown: download 0→31 % (214 MB), installing, tutorial 1/9, an out-of-energy 29:59 timer. **Right:** the real Thumbcade feed, one swipe every 1.5 beats, nine games. | 00:01.4 → 00:07.0 / EVERY OTHER GAME · STEP 1→4 OF 4 / ■ THUMBCADE · GAME 01→09 / "Swipe left to learn how to swipe left." |
| 7.0–7.6 | The left screen drops out and the feed takes the frame. | |
| 7.4–10.3 | A swipe on each line | NO INSTALLS. / NO MENUS. / NO LOADING BARS. / JUST SWIPE. |
| 10.5–13.0 | End card | thumbcade / SWIPE UP FOR THE NEXT GAME / FREE ON IPHONE + ANDROID |

## Sound

Every spot has its own original score (120 BPM, A minor), synthesized offline. Swipes, slams, the crash, the
odometer, the NEW BEST jingle and the end-card button press all land on the cut. The mixes come in around
−14 LUFS with about 2 dB of peak headroom, so platform loudness normalisation leaves them alone and AAC doesn't
clip. Captions carry every line, so the spots also work with the sound off.

## Safe zones

- **9:16:** headlines, counters and the end card sit between y 270 and y 1248 (Meta Reels/Stories keep the top 14 %
  and the bottom 35 % free) and at least 65 px from the sides. Only footage and the feed card extend beyond that.
- **4:5:** no platform overlay, 60 px margins.

## Render

```bash
cd marketing/studio
npm install                    # playwright + ffmpeg-static (outside the pnpm workspace)
bash ../trailer/prepare.sh     # gameplay footage -> marketing/trailer/frames (once, about 2 min)
bash prepare.sh                # fonts, brand marks, game icons, tokens -> studio/assets
bash video/build.sh            # soundtracks, covers, all seven videos (about 15 min on an M-series Mac)
```

One spot at a time:

```bash
cd marketing/studio/video
node make-sound.mjs beat-531                                   # -> out/beat-531.wav
node render.mjs beat-531 video 1080 1920 ../../campaigns/03-beat-this/video/thumbcade-beat-531-9x16.mp4 --audio out/beat-531.wav
node render.mjs beat-531 stills 1080 1350 /tmp/stills 0.5,3.6,10.8   # check moments without encoding
node make-sound.mjs 12-swipes 6 && node render.mjs 12-swipes video 1080 1920 out.mp4 --audio out/12-swipes-6.wav --cut 6
```

## Where things live

| File | What |
|---|---|
| `comp/kit.js` | Shared compositor: springs, the feed card, touches, callouts, odometer, result card, end card. |
| `comp/spot-*.js` | One timeline per spot, each a pure function of `t`. The copy lives here. |
| `comp/sound.js` | Synth instruments copied from the trailer, plus one arrangement per spot, cued to the timelines. |
| `render.mjs` | Stills, a cover PNG, or video piped into ffmpeg (x264 medium, CRF 18, with 6× sub-frame motion blur on swipes). |
| `make-sound.mjs` | Renders a soundtrack with Chromium's OfflineAudioContext. |
| `build.sh` | Builds everything, two renders at a time. With more in parallel, Chromium is starved of CPU and screenshots time out. |

The end card says "Free on iPhone + Android" because these ads run at launch. Change `freeLine` in `kit.js`
(`endCard`) if that changes.
