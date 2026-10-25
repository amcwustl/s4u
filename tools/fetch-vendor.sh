#!/bin/bash
# Vendors MediaPipe tasks-audio (JS + wasm) and the YAMNet classifier model into the extension.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
mkdir -p ext/vendor/mediapipe/wasm ext/model
(cd "$TMP" && npm pack @mediapipe/tasks-audio@1.1.1 --silent >/dev/null && tar xzf mediapipe-tasks-audio-1.1.1.tgz)
cp "$TMP/package/audio_bundle.mjs" ext/vendor/mediapipe/
cp "$TMP"/package/wasm/audio_wasm_internal.js "$TMP"/package/wasm/audio_wasm_internal.wasm \
   "$TMP"/package/wasm/audio_wasm_nosimd_internal.js "$TMP"/package/wasm/audio_wasm_nosimd_internal.wasm ext/vendor/mediapipe/wasm/
cp "$TMP/package/LICENSE" ext/vendor/mediapipe/LICENSE 2>/dev/null || true
curl -sfL -o ext/model/yamnet.tflite "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite"
SIZE=$(stat -f%z ext/model/yamnet.tflite)
[ "$SIZE" = "4126810" ] || { echo "unexpected model size $SIZE"; exit 1; }
rm -rf "$TMP"
echo "vendored: $(du -sh ext/vendor ext/model | tr '\n' ' ')"
