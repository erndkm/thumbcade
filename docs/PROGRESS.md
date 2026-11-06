# Progress (Definition of Done, §17)

- [x] `pnpm install && pnpm dev && pnpm seed` brings everything up; README documents it (Quickstart, Checks, Going to production)
- [x] App runs on iOS and Android (Expo Go on the iOS 27 simulator and the Pixel AVD; all 8 Maestro flows pass on both); smooth swiping; the next game is alive on landing (see PERF.md)
- [x] Swipe Contract state machine + ownership table unit-tested (packages/swipe-contract, 47 tests incl. fuzz)
- [x] Swipe Contract wired in the app; Maestro flows cover cold start → PLAYING, a preview swipe, a vertical game left via the Dock
- [x] ≤ 3 WebViews; 100-swipe soak with flat memory (`apps/mobile/maestro/perf/soak.sh`, docs/PERF.md)
- [x] Social layer end to end against local Supabase (likes, saves, follows, comments with live Realtime, shares, challenges, inbox, report/block, account deletion and data export)
- [x] Ranked For You + Following feeds with exploration and diversity (`rank_feed`, infinite recycle, hashtag-scoped feeds)
- [x] Creator loop proven by scripts/e2e-creator-loop.ts (scaffold → publish → 16/16 review checks → approve → in a new guest's feed)
- [x] Portal: landing with live phone, /play, docs, creator dashboard, admin review, /g and /c pages with OG cards
- [x] 12 polished launch games, 3 in 3D (Stackd, Heatfall, Duskrail), both `vertical` modes, all pass the reviewer
- [x] Three Design QA passes logged (docs/DESIGN_QA.md); screenshots in docs/screenshots/{mobile,portal,games,simulator}
- [x] typecheck, lint, test green (30 + 25 + 19 turbo tasks, 329 tests); `npx expo export` for ios + android
- [x] STORE.md, DECISIONS.md, GAPS.md, PERF.md, THIRD_PARTY.md complete

What needs accounts or hardware (store builds, push, Apple/Google sign-in, production hosting, a physical
mid-tier Android phone) is in docs/GAPS.md, with the steps in the README's "Going to production".

## Phase 0 (lead)
- [x] Toolchain: Node 24, pnpm 12, Colima + Docker, Supabase CLI, Xcode 27 (iOS 27 sims), Android SDK + AVD, Maestro, JDK 17
- [x] Monorepo scaffold
- [x] packages/protocol (11 tests) + manifest JSON Schema
- [x] packages/swipe-contract (47 tests)
- [x] packages/design-tokens (6 tests) + fonts + generated CSS/Tailwind theme
- [x] Brand: logo mark, app icon, adaptive icons, splash, favicons, wordmark, lockup, OG card
- [x] supabase/migrations init schema + RLS + RPCs, smoke-tested against local Supabase
- [x] CLAUDE.md, docs/ARCHITECTURE.md

## Phase 1 (parallel)
- [x] Lead: portal (landing, web player, docs, creator dashboard, admin review, CLI device login, share and challenge pages), `pnpm dev`, README, STORE.md
- [x] Creator & Games (B): SDK, CLI, create-thumbcade-game, simulator, publish pipeline, reviewer, 12 launch games (docs/handoff/B.md)
- [x] Player Platform (A): mobile app, feed backend, social layer, game host, seed, Maestro flows (docs/handoff/A.md)

## Phase 2 (lead)
- [x] Integration review of both streams; contract requests A1–A4 and B1–B4 resolved
- [x] Hardening: verified-best challenge scores, events rate cap, signing-secret floor, exact WebView origin check
- [x] Fixes: card stuck in LOADING after a Fast Refresh; caption clipped at accessibility text sizes; paused runs dimmed under the chrome; seeded creator stats consistent with real counters; `pnpm dev` Metro start and shutdown; `create-thumbcade-game --local` under pnpm
- [x] Performance soak, Design QA pass 3, portal and app screenshots, final docs

## Library expansion (2026-10-17)
- [x] 13 new games (2D and 3D): Clearcut and Spindart in the house style; 11 creator games, each creator with a look of their own (docs/DECISIONS.md, docs/handoff/B.md §9)
- [x] House-style games all attributed to Thumbcade Studio; new seed creators softbake and marginalia; library fonts with their OFL texts in every bundle
- [x] Seed comments, release notes and score medians for every game
- [x] Six Seven: a house game on the "6 7" trend with an original kid, two-thumb tapping and a teacher to freeze for (docs/DECISIONS.md)

## Creator bundle safety (2026-10-17)
- [x] Uploads hold web code, data and media only; native executables are refused under any name (CLI, `creator-publish`, reviewer)
- [x] Obfuscated code and WebRTC fail the static scan; the reviewer also catches WebRTC at runtime, including from blank iframes
- [x] Portal pages may only frame the games origin (`frame-src`); the web player stops a game that tries to leave its frame
- [x] Reviewer flash check (WCAG 2.3.1, general and red flashes, area rule) on 60 fps screen captures of attract mode and play
