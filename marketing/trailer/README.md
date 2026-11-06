# Thumbcade teaser trailer

A 26.5 s teaser and a 15 s cut, each in two masters, 9:16 (1080×1920) and 16:9 (1920×1080), at 60 fps
with an original soundtrack. The shot-by-shot plan is in [STORYBOARD.md](STORYBOARD.md).

Everything is generated from code. The gameplay is real footage of the launch games: each game is
built privately with its attract-mode AI left on during a run, then captured frame by frame under a
virtual clock. The UI is rebuilt from `@thumbcade/design-tokens`, and the music is synthesized with
Web Audio.

## Render

```bash
cd marketing/trailer
npm install                       # playwright + a static ffmpeg build (outside the pnpm workspace)
bash prepare.sh                   # build game copies, capture footage (~2 min), copy brand assets
node make-music.mjs               # -> out/music.wav
node render.mjs video 1080 1920 out/thumbcade-teaser-9x16.mp4 --audio out/music.wav
node render.mjs video 1920 1080 out/thumbcade-teaser-16x9.mp4 --audio out/music.wav

# The 15 s cut: same scenes, retimed by ?cut=15 in the compositor and an edit plan in the score.
node make-music.mjs 15            # -> out/music-15.wav
node render.mjs video 1080 1920 out/thumbcade-teaser-15s-9x16.mp4 --audio out/music-15.wav --cut 15
node render.mjs video 1920 1080 out/thumbcade-teaser-15s-16x9.mp4 --audio out/music-15.wav --cut 15
```

Each render takes about 6 minutes (about 4 for the 15 s cut). To check a moment without rendering video:
`node render.mjs stills 1080 1920 out/stills 3.5,12.6,17.8` (add `--cut 15` for the short cut).

## Where things live

| File | What |
|---|---|
| `comp/trailer.js` | The timeline. Every scene is a pure function of `t`. Copy is in `CALLS`, `TITLE`, `MONT`, `TL`, `TAG`. |
| `comp/music.js` | The soundtrack (120 BPM, A minor). Cue times match the timeline; `PLAN` re-edits it for the 15 s cut. |
| `capture/patches.mjs` | Build-time patches that let each game's AI pilot keep playing during a run. Repo sources are never modified. |
| `capture/capture.mjs` | Virtual-clock frame capture with scripted taps. |
| `render.mjs` | Stills, or video piped into ffmpeg (x264, CRF 15) with 8× sub-frame motion blur on fast moves. |

The end card reads "Coming soon · iPhone + Android" and "thumbcade.com". Change those lines in
`sceneEnd` once the store links are live.
