# Store submission kit

Everything needed to submit Thumbcade to the App Store and Google Play. Fill the bracketed values before submitting.

## Listing copy

**App name:** Thumbcade
**Subtitle (iOS, 30):** Swipe up for the next game
**Short description (Play, 80):** An endless feed of games you play with one thumb. Swipe for the next one.

**Promotional text (iOS, 170):**
New games land in your feed every day — runners, puzzles, 3D stackers, chess tactics. Play for five seconds or five minutes, then swipe.

**Description:**

Thumbcade is an endless feed of games you play with one thumb.

Open the app and a game is already running. Tap to play. Swipe up and the next one is there — no installs, no menus, no loading bars.

• A feed that learns what you like: arcade, puzzles, 3D, brain teasers, chill games, reflex tests
• Every game has a creator, a profile and hashtags — follow the people who make the ones you love
• Like, comment, save, and share — or send a challenge link with your score on it
• Daily and all-time leaderboards for every game
• Built so a swipe never means two things: games that need swipes get the whole screen, and the Dock at the bottom always takes you to the next one

Thumbcade games are made by independent creators with the Thumbcade SDK and reviewed by our team before they reach the feed.

**Keywords (iOS, 100):** minigames,arcade,puzzle,casual,feed,swipe,one thumb,quick games,leaderboard,challenge

**Category:** Games › Casual (secondary: Games › Arcade / Puzzle)
**Support URL:** https://thumbcade.com/docs · **Marketing URL:** https://thumbcade.com · **Privacy URL:** https://thumbcade.com/legal/privacy

## Age rating

Target **12+ (iOS) / Teen (IARC)**. Games declare their own rating (4+ / 9+ / 12+ / 17+); the catalog launches with 4+ and 9+ games only, and players see only games at or below their age band.

| Questionnaire item | Answer |
|---|---|
| Cartoon or fantasy violence | Infrequent/Mild (arcade games: obstacles, "lives") |
| Realistic violence | None |
| Sexual content / nudity | None |
| Profanity or crude humor | None in games; user comments are filtered and moderated |
| Alcohol, tobacco, drugs | None |
| Simulated gambling | None |
| Horror/fear themes | None |
| Medical/treatment information | None |
| Unrestricted web access | No — games load only from Thumbcade's own game origins |
| User-generated content | Yes: comments and creator-made games. Report, block, word filter, human moderation, one-click takedown |
| Contests | No |
| In-app purchases | No (v1) |

## App Privacy (iOS) / Data safety (Play)

| Data | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes (only when signing in with email) | Yes | No | Account |
| Name / handle / avatar | Yes | Yes | No | App functionality (profiles) |
| User content (comments, game saves) | Yes | Yes | No | App functionality |
| Gameplay content (scores) | Yes | Yes | No | App functionality (leaderboards) |
| Product interaction (impressions, plays, skips, likes) | Yes | Yes | No | App functionality (feed ranking), Analytics (aggregate creator stats) |
| Device ID / advertising ID | **No** | — | — | — |
| Location, contacts, photos, health, financial | **No** | — | — | — |
| Push token | Yes (opt-in) | Yes | No | App functionality (notifications) |

No third-party SDKs that collect data. No ads. No tracking (no ATT prompt needed). Account deletion: Settings → Delete account (deletes profile, comments, likes, saves, scores, game storage, activity; guests: Settings → Delete my data), also on the web at https://thumbcade.com/account. Data export: Settings → Download my data (server-side `account-export`, includes usage events). Imprint: Settings → Imprint and https://thumbcade.com/legal/imprint. The App Store and Play listings also need the trader details (EU DSA trader status) that match `@thumbcade/legal` `OPERATOR`.

## Notes for App Review (iOS)

> Thumbcade hosts HTML5 mini games made by independent developers, in accordance with App Review Guideline 4.7.
>
> - Every game is HTML5/JavaScript, loaded at runtime into a WKWebView from Thumbcade's own game origins (`<game>.thumbcade.gg`). No native code is downloaded. Games are sandboxed: a strict content security policy blocks network access outside their own origin, and they receive no native platform APIs — only Thumbcade's own services (score submission, small save files, pause/resume). Haptics are triggered by the Thumbcade shell, never by game code directly.
> - We maintain an index of every game with its metadata (name, creator, description, hashtags, age rating, controls) — see the Discover tab and each game's page.
> - Every version is reviewed before it reaches the feed: automated checks (performance budgets, SDK lifecycle, no remote code) and a human reviewer. Games carry an age rating; players only see games at or below the age they declared at first launch (Declared Age Range API where available).
> - Users can report any game, comment or person from the ··· menu; reports go to a moderation queue with one-click takedown. Users can block other users. Comments are filtered.
> - Sign in with Apple is offered alongside Google and email. Accounts can be deleted in the app.
>
> **How to test:** launch the app — a game starts in the feed without signing in. Tap to play, swipe up for the next game. To try the social features, sign in with the demo account below (email code is printed in the review notes).
> Demo account: `[review@thumbcade.com]` · code `[provided on request]`

## Google Play policy notes

- Device and Network Abuse: games are JavaScript executed in a WebView with indirect access to Android APIs only through the Thumbcade bridge (allowed). No dynamic native code.
- User Generated Content: in-app reporting, blocking, moderation, published terms (https://thumbcade.com/legal/terms).
- Families: not designed for children under 13; the age screen routes under-13 players to the 4+/9+ catalog with social features off.

## Assets checklist

- [x] App icon 1024 (iOS) — `packages/design-tokens/brand/app-icon.png`
- [x] Adaptive icon foreground/background/monochrome (Android) — same folder
- [x] Feature graphic / OG card 1200×630 — `og-default-1200.png`
- [ ] Screenshots 6.9″ and 6.5″ (iOS), phone (Play) — take from `docs/screenshots/mobile/` after the Design QA pass
- [ ] App preview video (optional)
