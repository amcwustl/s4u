#!/bin/bash
# Turns a tab recording into compact fixture files for the offline fixture player:
#   <out>/video-320.webm  320x180 @ 2 fps (vision input)
#   <out>/audio-16k.wav   16 kHz mono (audio input)
#   <out>/montage.jpg     one frame every 10 s, for locating breaks by eye
set -euo pipefail
IN="$1"; OUT="${2:-$(dirname "$1")}"
mkdir -p "$OUT"
ffmpeg -v error -y -i "$IN" -an -vf "fps=2,scale=320:180" -c:v libvpx -b:v 400k -deadline realtime "$OUT/video-320.webm"
ffmpeg -v error -y -i "$IN" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/audio-16k.wav"
ffmpeg -v error -y -i "$IN" -vf "fps=1/10,scale=240:-1,drawtext=text='%{pts\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=6x9" -frames:v 1 "$OUT/montage.jpg"
ls -la "$OUT"
