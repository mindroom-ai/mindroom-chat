#!/usr/bin/env bash
# Render background.html into the DMG window background at 1x and 2x (needs Google Chrome on a Mac,
# for the system font Finder shows next to it).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for scale in 1 2; do
  out=background.png
  if [[ $scale == 2 ]]; then out=background@2x.png; fi
  "$chrome" --headless --hide-scrollbars --window-size=660,400 \
    --force-device-scale-factor="$scale" --screenshot="$PWD/$out" "file://$PWD/background.html"
done
