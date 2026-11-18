#!/usr/bin/env bash
# Exercise the actual native bundle without opening windows or accessing a Matrix account.
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The native Mac support contract requires macOS and Xcode.' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_directory="$repo_root/build/mac-support-tests"
bundle="$test_directory/MindRoomMacSupport.bundle"
mkdir -p "$bundle/Contents/MacOS"

xcrun swiftc -emit-library -module-name MindRoomMacSupport \
  -target "$(uname -m)-apple-macos13.3" \
  -framework AppKit -framework Carbon -framework CoreGraphics \
  "$repo_root/ios/MacSupport/MindRoomMacSupportProtocol.swift" \
  "$repo_root/ios/MacSupport/MindRoomMacSupport.swift" \
  -o "$bundle/Contents/MacOS/MindRoomMacSupport"
cp "$repo_root/ios/MacSupport/Info.plist" "$bundle/Contents/Info.plist"
plutil -replace CFBundleExecutable -string MindRoomMacSupport "$bundle/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string chat.mindroom.app.mac-support "$bundle/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string 1.0.0 "$bundle/Contents/Info.plist"
plutil -replace CFBundleVersion -string 1 "$bundle/Contents/Info.plist"
xcrun swiftc \
  "$repo_root/ios/MacSupport/MindRoomMacSupportProtocol.swift" \
  "$repo_root/ios/App/App/MacWindowingStore.swift" \
  "$repo_root/ios/MacSupportTests/Contract.swift" \
  -o "$test_directory/contract"
"$test_directory/contract" "$bundle"

# The updater bundle against the pinned Sparkle: it loads through its protocol, and an install with
# nothing staged does nothing. Sparkle is never started.
"$repo_root/scripts/fetch-sparkle.sh"
sparkle="$repo_root/ios/MacUpdater/Sparkle"
updater="$test_directory/MindRoomMacUpdater.bundle"
mkdir -p "$updater/Contents/MacOS"
xcrun swiftc -emit-library -module-name MindRoomMacUpdater \
  -target "$(uname -m)-apple-macos13.3" \
  -F "$sparkle" -framework Sparkle -Xlinker -rpath -Xlinker "$sparkle" \
  "$repo_root/ios/MacUpdater/MindRoomMacUpdaterProtocol.swift" \
  "$repo_root/ios/MacUpdater/MindRoomMacUpdater.swift" \
  -o "$updater/Contents/MacOS/MindRoomMacUpdater"
cp "$repo_root/ios/MacUpdater/Info.plist" "$updater/Contents/Info.plist"
plutil -replace CFBundleExecutable -string MindRoomMacUpdater "$updater/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string chat.mindroom.app.mac-updater "$updater/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string 1.0.0 "$updater/Contents/Info.plist"
plutil -replace CFBundleVersion -string 1 "$updater/Contents/Info.plist"
xcrun swiftc \
  "$repo_root/ios/MacUpdater/MindRoomMacUpdaterProtocol.swift" \
  "$repo_root/ios/MacUpdaterTests/Contract.swift" \
  -o "$test_directory/updater-contract"
"$test_directory/updater-contract" "$updater"
