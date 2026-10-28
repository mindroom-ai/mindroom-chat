#!/usr/bin/env bash
# Build MindRoom Chat for Mac Catalyst as an unsigned archive.
# Set MARKETING_VERSION and CURRENT_PROJECT_VERSION to stamp a release build.
set -euo pipefail

if [[ $# -gt 0 ]]; then
  echo "usage: $0" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

archive_path="build/macos/MindRoomChat.xcarchive"
version_settings=()
if [[ -n "${MARKETING_VERSION:-}" ]]; then
  version_settings+=("MARKETING_VERSION=$MARKETING_VERSION")
fi
if [[ -n "${CURRENT_PROJECT_VERSION:-}" ]]; then
  version_settings+=("CURRENT_PROJECT_VERSION=$CURRENT_PROJECT_VERSION")
fi

npm run build:ios
# Also runs `pod install`.
npx cap sync ios

rm -rf "$archive_path"
# The ${array[@]+...} form keeps an empty array safe under `set -u` in macOS's bash 3.2.
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$archive_path" \
  CODE_SIGNING_ALLOWED=NO \
  ${version_settings[@]+"${version_settings[@]}"}
