#!/usr/bin/env bash
# Local structural verification only. Xcode Cloud supplies Store distribution signing/upload.
set -euo pipefail
set +x

if [[ $# -ne 1 || "$1" != --unsigned ]]; then
  echo "usage: $0 --unsigned (requires MARKETING_VERSION and CURRENT_PROJECT_VERSION)" >&2
  exit 2
fi
if [[ ! "${MARKETING_VERSION:-}" =~ ^[1-9][0-9]{3}[.]([1-9]|1[0-2])[.](0|[1-9][0-9]*)$ ]]; then
  echo 'MARKETING_VERSION must be an explicit calendar version YYYY.M.N.' >&2
  exit 1
fi
if [[ ! "${CURRENT_PROJECT_VERSION:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo 'CURRENT_PROJECT_VERSION must be an explicit positive integer build number.' >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -n "$(git status --porcelain --untracked-files=all -- . ':(exclude)ios/App/Podfile.lock')" ]]; then
  echo 'Mac Store verification requires a clean checkout so the source stamp identifies the built code.' >&2
  exit 1
fi
source_commit="$(git rev-parse HEAD)"
archive_path=build/mac-app-store/MindRoomChat.xcarchive
export MINDROOM_BUILD_VERSION="$source_commit"
export MINDROOM_RELEASE_VERSION="v$MARKETING_VERSION"
npm run build:ios
scripts/watch/build-sdk.sh --fetch
npx cap sync ios

mkdir -p build/mac-app-store
rm -rf "$archive_path"
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme AppStoreMac \
  -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$archive_path" \
  -derivedDataPath build/mac-store-derived \
  -jobs 4 \
  CODE_SIGNING_ALLOWED=NO \
  "MARKETING_VERSION=$MARKETING_VERSION" \
  "CURRENT_PROJECT_VERSION=$CURRENT_PROJECT_VERSION"
node scripts/macos-store-preflight.mjs \
  "$archive_path" "$MARKETING_VERSION" "$CURRENT_PROJECT_VERSION" "$source_commit" --structure-only
