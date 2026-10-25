#!/bin/bash
# Vendors MediaPipe tasks-audio (JS + wasm) and the YAMNet classifier model into the extension.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
mkdir -p ext/vendor/mediapipe/wasm ext/model
(cd "$TMP" && npm pack @mediapipe/tasks-audio@0.10.14 --silent >/dev/null && tar xzf mediapipe-tasks-audio-0.10.14.tgz)
cp "$TMP/package/audio_bundle.mjs" ext/vendor/mediapipe/
cp "$TMP"/package/wasm/audio_wasm_internal.js "$TMP"/package/wasm/audio_wasm_internal.wasm \
   "$TMP"/package/wasm/audio_wasm_nosimd_internal.js "$TMP"/package/wasm/audio_wasm_nosimd_internal.wasm ext/vendor/mediapipe/wasm/
cp "$TMP/package/LICENSE" ext/vendor/mediapipe/LICENSE 2>/dev/null || true
curl -sfL -o ext/model/yamnet.tflite "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite"
SIZE=$(stat -f%z ext/model/yamnet.tflite)
[ "$SIZE" = "4126810" ] || { echo "unexpected model size $SIZE"; exit 1; }
# YAMNet embedding model (1024-d) for the MediaPipe AudioEmbedder; used for game/ad sound similarity.
curl -sfL -o ext/model/yamnet_embedding.tflite "https://storage.googleapis.com/mediapipe-assets/yamnet_embedding_metadata.tflite"
ESIZE=$(stat -f%z ext/model/yamnet_embedding.tflite)
[ "$ESIZE" = "12900058" ] || { echo "unexpected embedding model size $ESIZE"; exit 1; }
rm -rf "$TMP"
echo "vendored: $(du -sh ext/vendor ext/model | tr '\n' ' ')"
