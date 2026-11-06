#!/bin/bash
# Full-resolution 60 fps captures: 3 s attract, tap, 9 s autopiloted run.
cd "$(dirname "$0")"
F=../frames
cap() { local g=$1; shift; rm -rf $F/$g; node capture.mjs ${g%%@*} $F/$g --attract 3 --play 9 --q 88 "$@"; }
export -f cap 2>/dev/null
( cap duskrail; cap flapjack; cap heatfall ) &
( cap kingsnare; cap kneejerk; cap mines ) &
( cap neon-chop; cap pairs; cap shortwick ) &
( cap snek; cap stackd; cap voltbrick ) &
wait
rm -rf $F/duskrail-end; node capture.mjs duskrail $F/duskrail-end --attract 0.3 --play 24 --autoOff 18 --shotFrom 19.5 --q 88
echo ALL DONE
