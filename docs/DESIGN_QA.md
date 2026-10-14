# Design QA log

Every surface was screenshotted and checked against `THUMBCADE_BUILD_PROMPT.md` §12. Checked each time:
hierarchy, type scale, spacing rhythm, contrast (≥ 4.5:1 for readable text), hit targets (≥ 44 pt), motion
(and its reduced-motion variant), empty/loading/error states, Dynamic Type at accessibility XL, and the
"would a design-literate person think a template made this" test.

Screenshots:

| Surface | Folder | How to re-shoot |
|---|---|---|
| App (iOS, iPhone 18 Pro, Expo Go) | `docs/screenshots/mobile/ios/` | `maestro test -e APP_ID=host.exp.Exponent maestro/tour/tour.yaml` (in `apps/mobile`) |
| App (Android, Pixel AVD) | `docs/screenshots/mobile/android/` | the Maestro flows on Android (`bash maestro/run.sh android`) |
| Portal (1440 px and 390 px) | `docs/screenshots/portal/` | `node scripts/shoot.mjs <url> <out.png> <width> <height>` |
| Launch games (attract and play) | `docs/screenshots/games/` | the reviewer's screenshots (`services/reviewer`) |
| Feed simulator | `docs/screenshots/simulator/` | `node scripts/shoot.mjs http://localhost:5173 …` |

The blue gear in the app screenshots is Expo Go's developer button. It is not part of the app and doesn't
exist in store builds.

## Portal (lead)

**Pass 1, then fixes**
- Landing hero at 390 px: the phone frame's unscaled 414 px width widened the page (horizontal scroll). The
  device is now absolutely positioned inside an aspect-ratio box, and the grids use `minmax(0, 1fr)`.
- Creator dashboard chart: x-axis date labels collided at 30 days. Labels are now thinned to fit, and the
  series colors were validated for color-vision deficiency (`#7EA40E` dark, `#4A6400` light).
- Game stats: "Likes · shares" wrapped mid-label. It is now two stats.
- The verified badge used three different treatments across pages. It is now one (`bg-volt`, ink check).
- Lifecycle diagram in the docs: state labels overlapped the arrows. Respaced.
- Full-page screenshots hid sections that animate in on scroll. The capture tool now uses reduced motion,
  which the page honors by showing everything.

**Pass 2:** no overflow at 390 px on any route (landing, /play, /g, /c, docs, login, creator, admin); every
state has a designed empty or loading view; OG cards render for games and challenges.

## App: pass 1 and pass 2 (Player Platform)

**Pass 1, then fixes**
- The caption was taller than the 148 pt preview inset that games are told about. The description now
  collapses to one line, tags don't wrap, and the caption's Dynamic Type is capped at 1.12×.
- The result card covered the action rail. It now ends where the rail begins; its meta line became a labeled
  stat row (Best / Today / Rank); a first-ever run no longer gets a "NEW BEST" stamp.
- Disabled buttons rendered as a muddy 45 % volt. They are now a neutral raised key with a muted label.
- Secondary text (`paperMute`) measured 3.4–4.0:1. Every readable string moved to `textDim` (≥ 7.2:1); mute
  is only for placeholders, disabled states and decorative glyphs.
- Sheets had no visible close control, and a scrim-only dismiss is invisible to VoiceOver. Every sheet header
  has a close key now, and navigating away closes sheets.
- Tab bar items stayed in the accessibility tree while hidden behind the Dock (and the reverse). Hidden items
  are now removed from it.
- Hardcoded rgba/hex values had crept into overlays. All are now derived from tokens.
- Guests saw a "Saved" tab they can't use. It is hidden for guests.

**Pass 2:** feed (preview, playing with the Dock, paused, result, failed), like burst, comments, share sheet and
share card, more sheet, game page and leaderboards, discover, hashtag, search, inbox, own/creator/guest profiles,
create, settings, auth sheet, onboarding, empty Following, scoped feed, developer card with bridge log, and
Dynamic Type at accessibility XL (feed, game page, settings).

## App: pass 3 (lead review)

Reviewed all 30 iOS and 7 Android screenshots, then drove the app on the simulator.

- **Caption at accessibility XL lost its meta line.** The max height that kept the caption inside the preview
  inset clipped the last row ("1.5M plays · best 2,643 · Tap") behind the tab bar. Fix: the caption keeps its
  natural height and grows upward; rows tighten once Dynamic Type is up. It now runs a few points over the
  inset at the largest sizes instead of losing content.
- **PAUSED: the game's HUD fought the returning chrome.** The spec brings the overlay and tab bar back when
  a run pauses, and the game's own progress bar sat directly under "Following / For You". Fix: a paused run
  is dimmed to 55 % ink under the chrome and the pause pill, fading with the overlay (a quick fade with
  reduced motion).
- One hardcoded `#000` in the pager replaced with the `bg` token.
- Checked and fine: like burst, comments and live comments, share card, game page, discover rows, search,
  inbox, profiles, settings, auth, onboarding, DEV card, and the 12 games' posters and attract modes in the feed.

## Launch games and simulator (Creator & Games)

All 12 games share the kit's typography, but each has its own palette, so the feed reads as one product without
looking like one template. Attract screens show the game name, a three-word control hint and "Tap to play", and
keep important content out of the preview insets (the reviewer checks this and hatches the overlay areas in
its screenshots). The simulator mirrors the phone chrome exactly and adds the contract and performance panels
beside it.
