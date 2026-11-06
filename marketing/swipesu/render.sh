#!/usr/bin/env bash
# Renders the swipesu version of every marketing video into marketing/swipesu/video/: the same timelines, footage
# and soundtracks as the Thumbcade masters, with the brand swapped (render.mjs --brand swipesu).
# Needs what the Thumbcade renders need (marketing/README.md: footage, studio assets) plus their soundtracks in
# trailer/out/ (node make-music.mjs [15]) and studio/video/out/ (node make-sound.mjs <spot> [6]).
# Runs two renders at a time, like studio/video/build.sh. Takes about 40 minutes on an M-series Mac.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
node brand.mjs

V="$HERE/video"
T="$V/teaser"
B="$V/03-beat-this"
S="$V/02-swipe-for-the-next-game"
Z="$V/04-zero-installs"
mkdir -p "$T" "$B" "$S" "$Z"
TM="$HERE/../trailer/out"
AM="$HERE/../studio/video/out"

trailer() { (cd ../trailer && node render.mjs "$@" --brand swipesu); }
ad() { (cd ../studio/video && node render.mjs "$@" --brand swipesu); }
# Two renders in parallel; fails if either fails.
both() { eval "$1" & local a=$!; eval "$2" & local b=$!; wait "$a"; wait "$b"; }

# Covers. The trailer's title covers carry no brand, so they are the Thumbcade ones.
cp "$TM/cover-9x16-title.png" "$T/cover-9x16-title.png"
cp "$TM/thumbnail-16x9-title.png" "$T/thumbnail-16x9-title.png"
trailer stills 1080 1920 "$T/.stills-9x16" 24.8 && mv "$T/.stills-9x16/t024.80.png" "$T/cover-9x16-logo.png" && rmdir "$T/.stills-9x16"
trailer stills 1920 1080 "$T/.stills-16x9" 24.8 && mv "$T/.stills-16x9/t024.80.png" "$T/thumbnail-16x9-logo.png" && rmdir "$T/.stills-16x9"
ad beat-531 cover 1080 1920 "$B/swipesu-beat-531-cover-9x16.png" 1.0
ad beat-531 cover 1080 1350 "$B/swipesu-beat-531-cover-4x5.png" 1.0
ad 12-swipes cover 1080 1920 "$S/swipesu-12-swipes-cover-9x16.png" 0.6
ad 12-swipes cover 1080 1350 "$S/swipesu-12-swipes-cover-4x5.png" 0.6
ad zero-installs cover 1080 1920 "$Z/swipesu-zero-installs-cover-9x16.png" 0.8
ad zero-installs cover 1080 1350 "$Z/swipesu-zero-installs-cover-4x5.png" 0.8

# The teaser and its 15 s cut.
both "trailer video 1080 1920 '$T/swipesu-teaser-9x16.mp4' --audio '$TM/music.wav'" \
     "trailer video 1920 1080 '$T/swipesu-teaser-16x9.mp4' --audio '$TM/music.wav'"
both "trailer video 1080 1920 '$T/swipesu-teaser-15s-9x16.mp4' --audio '$TM/music-15.wav' --cut 15" \
     "trailer video 1920 1080 '$T/swipesu-teaser-15s-16x9.mp4' --audio '$TM/music-15.wav' --cut 15"

# The ad spots.
both "ad beat-531 video 1080 1920 '$B/swipesu-beat-531-9x16.mp4' --audio '$AM/beat-531.wav'" \
     "ad 12-swipes video 1080 1920 '$S/swipesu-12-swipes-9x16.mp4' --audio '$AM/12-swipes.wav'"
both "ad zero-installs video 1080 1920 '$Z/swipesu-zero-installs-9x16.mp4' --audio '$AM/zero-installs.wav'" \
     "ad 12-swipes video 1080 1920 '$S/swipesu-12-swipes-6s-9x16.mp4' --audio '$AM/12-swipes-6.wav' --cut 6"
both "ad beat-531 video 1080 1350 '$B/swipesu-beat-531-4x5.mp4' --audio '$AM/beat-531.wav'" \
     "ad 12-swipes video 1080 1350 '$S/swipesu-12-swipes-4x5.mp4' --audio '$AM/12-swipes.wav'"
ad zero-installs video 1080 1350 "$Z/swipesu-zero-installs-4x5.mp4" --audio "$AM/zero-installs.wav"
echo ALL DONE
