# create-thumbcade-game

```bash
npm create thumbcade-game@latest
```

Asks for a name, a template and how people will play it, then generates a Vite + TypeScript project
with `@thumbcade/sdk` wired in, a valid `thumbcade.json`, a README, a 1024² icon and a 1080×1920
poster drawn from your name and accent color, and a **small but complete game**: attract mode, start
on a tap, score, game over, best score in `tc.storage`, pause handling and insets.

| Template | Sample game |
|---|---|
| Canvas 2D | Two lanes, falling blocks, tap to switch lanes |
| Phaser | Drag to catch falling stars, three misses and it's over |
| PixiJS | Tap the bubbles before they float away |
| Three.js | Tap to hop over cubes sliding toward you |
| Blank HTML | Stop the needle inside a shrinking zone (DOM + CSS only) |

Control styles set `controls` in the manifest: **taps only**, **taps + horizontal drags**, or **any
vertical motion** (`controls.vertical: true`: you own the surface while playing; players leave
through the Dock).

Flags: `[dir] --name "Night Shift" --template canvas|phaser|pixi|three|blank --controls tap|horizontal|vertical --accent "#FF6A1A" --yes --no-install`.

Then:

```bash
cd night-shift
npm run dev        # feed simulator with hot reload
npm run release    # build, validate, upload for review
```

## License

MIT. The bundled fonts used to draw the icon and poster are Mona Sans and Departure Mono (SIL OFL 1.1, license texts in `assets/fonts/`).
