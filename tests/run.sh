#!/bin/bash
# Автопроверка приложения: bash tests/run.sh  (нужны ffmpeg, node, playwright с Chromium)
cd "$(dirname "$0")/.."
[ -f tests/sample.webm ] || ffmpeg -v error -y -f lavfi -i "testsrc2=s=1280x720:r=30:d=8" -f lavfi -i "sine=f=440:d=8" -c:v libvpx-vp9 -b:v 600k -g 15 -c:a libopus tests/sample.webm
curl -s -o /dev/null http://127.0.0.1:8765/app/ || { python3 tests/serve.py 8765 & sleep 1; }
NODE_PATH=$(npm root -g) node tests/e2e.mjs
