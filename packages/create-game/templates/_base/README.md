# __NAME__

A Thumbcade game, made with the __TEMPLATE_LABEL__ template.

```bash
npm run dev        # the feed simulator with hot reload (thumbcade dev)
npm run device     # play it on your phone through the app's developer menu (thumbcade dev --device)
npm run validate   # build + manifest, budgets and static rules
npm run release    # build, validate, upload for review (run `npx thumbcade login` once first)
```

## How it fits the feed

Your game runs full screen in a vertical feed, next to other games. The player can swipe away at any
moment, so the SDK tells you what's going on:

- `await tc.init()` gives you the launch context: player, audio state, **insets**, a seed, the best score.
- `tc.ready()` once your first frame is drawn. The feed crossfades from your poster to your game.
- **Attract mode**: before a run, keep something alive on screen (a demo, an idle animation) with your
  title and a "tap to play" prompt **inside `ctx.insets.preview`**. The feed's overlay covers the top
  tabs, the action rail on the right and the caption at the bottom.
- `tc.gameplay.start()` on the **tap** that starts a run (on release, never on a swipe).
- `tc.gameplay.end({ score })` within 1 s of game over. The feed shows its result card over your game.
- `tc.on("pause")`: stop everything. `tc.loop` stops itself; `src/sound.ts` suspends audio for you.
- `tc.on("replay")`: the player tapped "Play again" on the result card. Start a new run.
- Best scores live in `tc.storage` (synced per player).

`controls.vertical` in `thumbcade.json` decides who owns vertical swipes while playing: set it to
`true` if your game uses **any** vertical motion (swipes, drags, joysticks). Then players leave
through the Dock under your game instead of swiping on it.

## Files

- `thumbcade.json`: name, description, hashtags, accent color, controls, score rules.
- `public/assets/icon.png` (1024×1024) and `public/assets/poster.png` (1080×1920): generated from your
  name and accent. Replace them with your own art whenever you like.
- `src/main.ts`: the game.

Docs: https://thumbcade.com/docs
