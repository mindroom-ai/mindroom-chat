#!/usr/bin/env bash
# Build MindRoom Chat for Mac Catalyst as an unsigned archive.
set -euo pipefail

if [[ $# -gt 0 ]]; then
  echo "usage: $0" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

archive_path="build/macos/MindRoomChat.xcarchive"

npm run build:ios
# Also runs `pod install`.
npx cap sync ios

rm -rf "$archive_path"
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$archive_path" \
  CODE_SIGNING_ALLOWED=NO
