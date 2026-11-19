#!/usr/bin/env bash
# Build Mac Catalyst unsigned for PRs, or Developer ID signed and notarized for releases.
set -euo pipefail
# Signing credentials must never appear in shell traces.
set +x

sign=0
if [[ $# -eq 1 && "$1" == --sign ]]; then
  sign=1
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--sign]" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
archive_path="build/macos/MindRoomChat.xcarchive"
version_args=()
if [[ -n "${MARKETING_VERSION:-}" ]]; then
  version_args+=("MARKETING_VERSION=$MARKETING_VERSION")
fi
if [[ -n "${CURRENT_PROJECT_VERSION:-}" ]]; then
  version_args+=("CURRENT_PROJECT_VERSION=$CURRENT_PROJECT_VERSION")
fi

scratch=""
installed_profile=""
cleanup() {
  if [[ -n "$installed_profile" ]]; then rm -f "$installed_profile"; fi
  if [[ -n "$scratch" ]]; then rm -rf "$scratch"; fi
}
trap cleanup EXIT

signing_args=(CODE_SIGNING_ALLOWED=NO)
if [[ "$sign" -eq 1 ]]; then
  for name in CODESIGN_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID MACOS_PROVISIONING_PROFILE_PATH; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required signing environment variable: $name" >&2
      exit 1
    fi
  done
  if [[ "$APPLE_TEAM_ID" != DNA6966LGZ || "$CODESIGN_IDENTITY" != "Developer ID Application: "*" (DNA6966LGZ)" ]]; then
    echo 'Signing requires a Developer ID Application identity for team DNA6966LGZ.' >&2
    exit 1
  fi
  # Xcode script phases may print their environment. Keep notary credentials
  # as unexported shell variables until the notarytool invocation.
  notary_apple_id=$APPLE_ID
  notary_password=$APPLE_APP_SPECIFIC_PASSWORD
  unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD
  test -s "$MACOS_PROVISIONING_PROFILE_PATH"
  scratch=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/mindroom-chat-macos.XXXXXX")
  security cms -D -i "$MACOS_PROVISIONING_PROFILE_PATH" > "$scratch/profile.plist"
  profile_uuid=$(plutil -extract UUID raw -o - "$scratch/profile.plist")
  if [[ ! "$profile_uuid" =~ ^[A-Fa-f0-9-]{36}$ ]]; then
    echo 'Provisioning profile has no valid UUID.' >&2
    exit 1
  fi
  profile_dir="$HOME/Library/MobileDevice/Provisioning Profiles"
  mkdir -p "$profile_dir"
  profile_dest="$profile_dir/$profile_uuid.provisionprofile"
  if [[ -e "$profile_dest" ]]; then
    # Leave an existing profile intact, including when it differs from this download.
    cmp "$MACOS_PROVISIONING_PROFILE_PATH" "$profile_dest"
  else
    installed_profile="$profile_dest"
    (umask 077; cp "$MACOS_PROVISIONING_PROFILE_PATH" "$profile_dest")
  fi
  signing_args=(
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=$CODESIGN_IDENTITY"
    "DEVELOPMENT_TEAM=$APPLE_TEAM_ID"
    # Only App consumes this setting; Pods must never inherit the app's profile.
    'MINDROOM_MACOS_PROVISIONING_PROFILE_SPECIFIER=MindRoom Chat Developer ID'
  )
fi

npm run build:ios
# The Xcode project references the watch app's SDK package, which Xcode resolves on every platform,
# first when `pod install` reads the project.
scripts/watch/build-sdk.sh --fetch
# The updater bundle links Sparkle.
scripts/fetch-sparkle.sh
# Also runs `pod install`.
npx cap sync ios

mkdir -p build/macos
rm -rf "$archive_path"
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$archive_path" \
  ${version_args[@]+"${version_args[@]}"} \
  "${signing_args[@]}"

# MindRoom-Chat.dmg: the app beside an Applications link on a background (scripts/macos-dmg).
pack_dmg() {
  # A fresh environment each build, so it always holds exactly the pinned versions.
  local venv=build/macos/dmgbuild-venv
  rm -rf "$venv"
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --disable-pip-version-check --require-hashes --only-binary :all: -r scripts/macos-dmg/requirements.txt
  "$venv/bin/dmgbuild" -s scripts/macos-dmg/settings.py -D "app=$1" "MindRoom Chat" "$dmg_path"
}
dmg_path="build/macos/MindRoom-Chat.dmg"

if [[ "$sign" -eq 0 ]]; then
  # Packs the unsigned app too, so pull requests check the DMG.
  pack_dmg "$archive_path/Products/Applications/MindRoom.chat.app"
  exit 0
fi

xcodebuild -exportArchive \
  -archivePath "$archive_path" \
  -exportOptionsPlist ios/App/macos-export-options.plist \
  -exportPath "$scratch/export"
app="$scratch/export/MindRoom.chat.app"
test -d "$app"

# Xcode's export should re-sign Sparkle's helpers with the hardened runtime; this proves it did, in
# the updater plug-in too, before Apple is asked.
codesign --verify --deep --strict "$app"
sparkle=Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework/Versions/B
for path in Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/MacOS/MindRoomMacUpdater \
  "$sparkle/Sparkle" "$sparkle/Autoupdate" "$sparkle/Updater.app" \
  "$sparkle/XPCServices/Installer.xpc" "$sparkle/XPCServices/Downloader.xpc"; do
  details=$(codesign -dv --verbose=4 "$app/$path" 2>&1)
  if ! grep -qx 'TeamIdentifier=DNA6966LGZ' <<<"$details" ||
    [[ "$(sed -n 's/.* flags=\([^ ]*\).*/\1/p' <<<"$details")" != *runtime* ]]; then
    echo "$path is not signed by team DNA6966LGZ with the hardened runtime" >&2
    exit 1
  fi
done

notarize() {
  xcrun notarytool submit "$1" \
    --apple-id "$notary_apple_id" \
    --password "$notary_password" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
}
ditto -c -k --keepParent "$app" "$scratch/MindRoom.zip"
notarize "$scratch/MindRoom.zip"
xcrun stapler staple "$app"

pack_dmg "$app"
codesign --sign "$CODESIGN_IDENTITY" --timestamp "$dmg_path"
notarize "$dmg_path"
xcrun stapler staple "$dmg_path"
echo "Signed, notarized DMG: $dmg_path"
