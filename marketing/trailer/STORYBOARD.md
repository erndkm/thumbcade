# Thumbcade teaser: storyboard

26.5 s, 120 BPM (one beat = 0.5 s), A minor. Two masters cut from one timeline:
9:16 (1080×1920) for TikTok, Reels and Shorts, and 16:9 (1920×1080) for YouTube, X and LinkedIn.
60 fps, with 8× sub-frame motion blur on every fast move. A 15 s cut follows the main table.

**Idea:** the feed you already scroll, except every card is a game. The edit runs on the product's own
gestures (press, swipe, tap) and the music lands on them.

| # | Time | Beat | Picture | Copy | Sound |
|---|---|---|---|---|---|
| 1 | 0.0–1.0 | Hook | The red arcade button (the logo) springs onto ink with "PRESS START" blinking under it. It gets pressed on beat 1, a shockwave fires, and the camera dives into the cap until the frame is solid heat red. | PRESS START | Coin-in blips, button click, sub boom, a zoom whoosh |
| 2 | 1.0–3.0 | Promise | A poster stack in ink on red. Each line slams in on the beat. PLAYABLE resolves out of chunky pixels, like the logo's lower ridges. A thumb swipes the whole card up. | THE / FEED / IS NOW / PLAYABLE. | Four impacts with chord stabs, then a pixel blip cascade and a riser |
| 3 | 3.0–8.0 | The feed | The real feed UI (tabs, action rail, spinning cartridge, caption, accent hashtags, tab bar) with live attract-mode games. One swipe per beat, then quarter-beat flicks: Duskrail → Neon Chop → Flapjack → Snek → Voltbrick → Heatfall → Kingsnare → Shortwick → Pairs → Mines → Stackd. | NO INSTALLS. / NO MENUS. / NO LOADING BARS. / JUST SWIPE. | The groove drops. Each swipe gets a whoosh, and the flicks climb the scale. |
| 4 | 8.0–10.0 | Tap to play | The feed stops on Stackd. A tap ripple fires, the chrome recedes, the tab bar morphs into the Dock and an accent scanline wipes the card. Then a real run with live score. | TAP TO PLAY. | The filter closes, a "start" arpeggio plays on the tap, and a snare roll builds |
| 5 | 10.0–14.0 | Verbs | One beat per game on a full-bleed accent background covered in the verb. Each transition acts out its verb: DODGE whips sideways, SLICE cuts the card diagonally, FLIP turns it in 3D, MERGE slides two halves together, BREAK shatters it into bricks, DROP falls in with a bounce, CHECKMATE scans in. | STACK DODGE SLICE FLIP MERGE BREAK DROP CHECKMATE | The drop. An 8-note hook (one note per verb) with a matching SFX on every transition |
| 6 | 14.0–16.0 | Scale | The Kingsnare card shrinks into a wall of all 12 games. The columns scroll in opposite directions, like feeds. The camera dives into Duskrail. | A NEW GAME EVERY SWIPE. | Lifted chords, a riser into the dive |
| 7 | 16.0–18.0 | Stakes | A real Duskrail run crashes at 531. The result card springs up, the odometer rolls, and a NEW BEST stamp slams in. | BEAT YOUR BEST. | Crash hit, odometer ticks, a level-up jingle |
| 8 | 18.0–20.0 | Social | "Challenge a friend" is tapped. A sheet rises with the challenge link, the friend replies, and a heart tapback bursts in heat red with pixel hearts. | THEN DARE YOUR FRIENDS. | Send, typing and reply blips, a sparkle on the heart |
| 9 | 20.0–22.0 | Creators | A terminal whips in: `npm create thumbcade-game`, `thumbcade publish`, upload bar, review passed, ● LIVE IN THE FEED. | ANYONE CAN SHIP A GAME. | Filtered breakdown, real typing clicks, an upload sweep |
| 10 | 22.0–26.5 | Sign-off | The red ● of LIVE grows into the button. It is pressed again (bookending the open) and the wordmark rises. | thumbcade / SWIPE UP FOR THE NEXT GAME / COMING SOON · IPHONE + ANDROID / thumbcade.com | Final press, logo sting, an Fmaj9 tail |

## 15 s cut

For pre-roll, Stories and paid placements. The same scenes are retimed in the compositor (`?cut=15`) and the score is
re-edited on the bar (`PLAN` in `comp/music.js`), so every cut still lands on the beat.

| # | Time | Picture | Copy |
|---|---|---|---|
| 1 | 0.0–1.0 | The button is pressed and the camera dives into it. | PRESS START |
| 2 | 1.0–2.6 | The poster stack. | THE / FEED / IS NOW / PLAYABLE. |
| 3 | 2.6–3.9 | Swipe up into Duskrail. | NO INSTALLS. |
| 4 | 3.9–5.9 | Swipe to Snek, then quarter-beat flicks through six games to Stackd. | JUST SWIPE. |
| 5 | 5.9–8.0 | The tap on Stackd, the Dock morph, a real run. The filter closes on the tap and the snare roll builds. | TAP TO PLAY. / FIVE SECONDS. OR FIVE MINUTES. |
| 6 | 8.0–10.9 | The drop: six verbs with their transitions. | STACK DODGE SLICE FLIP MERGE BREAK |
| 7 | 10.9–11.5 | An iris closes on the BREAK card and carries it onto the button cap, which turns heat red. The music drops out under a riser. | |
| 8 | 11.5–15.0 | The press and the lockup, as in the long cut. | thumbcade / SWIPE UP FOR THE NEXT GAME / COMING SOON · IPHONE + ANDROID / thumbcade.com |

## Craft notes

- All gameplay is real. The launch games were built privately with their attract-mode AI left on during a run,
  then captured frame by frame under a virtual clock. Nothing is mocked except the social data.
- The UI is rebuilt from `@thumbcade/design-tokens`: the real icon paths, pixel avatars, palette, Mona Sans and
  Departure Mono, and the app's spring constants (snap, pop, sheet, morph) for every spatial move.
- §12 rules hold: no gradients on type, no glow, no emoji, heat red for one accent per region, games bring the color.
- Safe zones: the vertical cut keeps headlines between y 120 and 1500 and away from the right-hand rail
  that TikTok and Reels overlay.
