#!/usr/bin/env bash
# Renders every ad spot: soundtracks, 9:16 + 4:5 masters, the 6 s lead-in cut and the cover PNGs.
# Needs the trailer footage (bash ../../trailer/prepare.sh) and studio assets (bash ../prepare.sh).
set -euo pipefail
cd "$(dirname "$0")"
C=../../campaigns
B=$C/03-beat-this/video
S=$C/02-swipe-for-the-next-game/video
Z=$C/04-zero-installs/video
mkdir -p "$B" "$S" "$Z" out

node make-sound.mjs beat-531 & node make-sound.mjs 12-swipes & node make-sound.mjs 12-swipes 6 & node make-sound.mjs zero-installs & wait

# Covers (thumbnail frames)
node render.mjs beat-531 cover 1080 1920 "$B/thumbcade-beat-531-cover-9x16.png" 1.0
node render.mjs beat-531 cover 1080 1350 "$B/thumbcade-beat-531-cover-4x5.png" 1.0
node render.mjs 12-swipes cover 1080 1920 "$S/thumbcade-12-swipes-cover-9x16.png" 0.6
node render.mjs 12-swipes cover 1080 1350 "$S/thumbcade-12-swipes-cover-4x5.png" 0.6
node render.mjs zero-installs cover 1080 1920 "$Z/thumbcade-zero-installs-cover-9x16.png" 0.8
node render.mjs zero-installs cover 1080 1350 "$Z/thumbcade-zero-installs-cover-4x5.png" 0.8

# Videos, two at a time (more starves Chromium of CPU and screenshots time out)
node render.mjs beat-531 video 1080 1920 "$B/thumbcade-beat-531-9x16.mp4" --audio out/beat-531.wav &
node render.mjs 12-swipes video 1080 1920 "$S/thumbcade-12-swipes-9x16.mp4" --audio out/12-swipes.wav &
wait
node render.mjs zero-installs video 1080 1920 "$Z/thumbcade-zero-installs-9x16.mp4" --audio out/zero-installs.wav &
node render.mjs 12-swipes video 1080 1920 "$S/thumbcade-12-swipes-6s-9x16.mp4" --audio out/12-swipes-6.wav --cut 6 &
wait
node render.mjs beat-531 video 1080 1350 "$B/thumbcade-beat-531-4x5.mp4" --audio out/beat-531.wav &
node render.mjs 12-swipes video 1080 1350 "$S/thumbcade-12-swipes-4x5.mp4" --audio out/12-swipes.wav &
wait
node render.mjs zero-installs video 1080 1350 "$Z/thumbcade-zero-installs-4x5.mp4" --audio out/zero-installs.wav
echo ALL DONE
