# Progress (Definition of Done, §17)

- [ ] `pnpm install && pnpm dev && pnpm seed` brings everything up; README documents it
- [ ] App runs on iOS and Android; playable < 3 s from cold start; smooth swiping, next game alive on landing
- [x] Swipe Contract state machine + ownership table unit-tested (packages/swipe-contract, 47 tests incl. fuzz)
- [ ] Swipe Contract wired in the app, Maestro flows cover it
- [ ] ≤ 3 WebViews; 100-swipe soak with flat memory
- [ ] Social layer end to end against local Supabase
- [ ] Ranked For You + Following feeds with exploration and diversity
- [ ] Creator loop proven by scripts/e2e-creator-loop.ts
- [ ] Portal: landing with live phone, docs, creator dashboard, admin review, /g and /c pages
- [ ] ≥ 10 polished launch games (target 12), ≥ 3 in 3D, both `vertical` modes, all pass the reviewer
- [ ] Two Design QA passes logged; screenshots in docs/screenshots/
- [ ] typecheck, lint, test green; `npx expo export` for ios + android
- [ ] STORE.md, DECISIONS.md, GAPS.md, PERF.md, THIRD_PARTY.md complete

## Phase 0
- [x] Toolchain: Node 24, pnpm 12, Colima + Docker, Supabase CLI, Xcode 27 (iOS 27 sims), Android SDK + AVD, Maestro, JDK 17
- [x] Monorepo scaffold
- [x] packages/protocol (11 tests) + manifest JSON Schema
- [x] packages/swipe-contract (47 tests)
- [x] packages/design-tokens (5 tests) + fonts + generated CSS/Tailwind theme
- [x] Brand: logo mark, app icon, adaptive icons, splash, favicons, wordmark, lockup, OG card
- [x] supabase/migrations init schema + RLS + RPCs, smoke-tested against local Supabase
- [x] CLAUDE.md, docs/ARCHITECTURE.md
