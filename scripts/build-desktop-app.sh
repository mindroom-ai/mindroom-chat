#!/usr/bin/env bash
# Build the Electron Mac app unsigned for PRs/local checks, or Developer ID signed, notarized,
# stapled and verified (fail-closed) for releases.
set -euo pipefail
# Signing and notarization credentials must never appear in shell traces.
set +x

die() { echo "$*" >&2; exit 1; }

scratch=""
helper_scratch=""
cleanup() {
  if [[ -n "$scratch" ]]; then rm -rf "$scratch"; fi
  if [[ -n "$helper_scratch" ]]; then rm -rf "$helper_scratch"; fi
}
trap cleanup EXIT

require_files() {
  local f
  for f in "$@"; do
    [[ -s "$f" ]] || die "Missing or empty artifact: $f"
  done
}

verify_codesign_identity() {
  local target="$1" require_runtime="$2" details
  codesign --verify --deep --strict "$target"
  details=$(codesign -dv --verbose=4 "$target" 2>&1)
  grep -Eq '^Authority=Developer ID Application:.*\(DNA6966LGZ\)$' <<<"$details" \
    || die "$target is not signed with a Developer ID Application authority for team DNA6966LGZ"
  grep -qx 'TeamIdentifier=DNA6966LGZ' <<<"$details" \
    || die "$target does not have TeamIdentifier=DNA6966LGZ"
  if [[ "$require_runtime" -eq 1 ]] &&
    [[ "$(sed -n 's/.* flags=\([^ ]*\).*/\1/p' <<<"$details")" != *runtime* ]]; then
    die "$target is not signed with the hardened runtime"
  fi
}

build_screenshot_helper() {
  local helper_src="electron/native/helper.swift"
  local helper_out="build/electron/mindroom-screenshot-helper"
  local arm64_bin x64_bin sdk
  sdk=$(xcrun --sdk macosx --show-sdk-path)
  [[ -n "$sdk" ]] || die "xcrun --sdk macosx --show-sdk-path returned an empty SDK path"
  local flags=(
    -O
    -sdk "$sdk"
    -framework AppKit
    -framework CoreGraphics
    -framework ScreenCaptureKit
    -framework ImageIO
    -framework UniformTypeIdentifiers
  )
  helper_scratch=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/mindroom-helper-build.XXXXXX")
  arm64_bin="$helper_scratch/helper-arm64"
  x64_bin="$helper_scratch/helper-x64"
  xcrun --sdk macosx swiftc "${flags[@]}" -target arm64-apple-macosx13.0 "$helper_src" -o "$arm64_bin"
  xcrun --sdk macosx swiftc "${flags[@]}" -target x86_64-apple-macosx13.0 "$helper_src" -o "$x64_bin"
  mkdir -p "$(dirname "$helper_out")"
  lipo -create "$arm64_bin" "$x64_bin" -output "$helper_out"
  chmod 755 "$helper_out"
  rm -rf "$helper_scratch"
  helper_scratch=""
}

verify_signed_artifacts() {
  local dmg="$1" arm64_zip="$2" x64_zip="$3" pair arch zip unpack_dir app helper
  require_files "$dmg" "$arm64_zip" "$x64_zip"

  verify_codesign_identity "$dmg" 0
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature "$dmg"

  scratch=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/mindroom-desktop-verify.XXXXXX")
  for pair in "arm64:$arm64_zip" "x64:$x64_zip"; do
    arch="${pair%%:*}"
    zip="${pair#*:}"
    unpack_dir="$scratch/$arch"
    mkdir -p "$unpack_dir"
    ditto -x -k "$zip" "$unpack_dir"
    app="$unpack_dir/MindRoom Chat.app"
    [[ -d "$app" ]] || die "Unpacked $arch ZIP does not contain MindRoom Chat.app: $zip"
    helper="$app/Contents/Resources/mindroom-screenshot-helper"
    [[ -s "$helper" ]] || die "Unpacked $arch app is missing screenshot helper: $helper"
    verify_codesign_identity "$app" 1
    verify_codesign_identity "$helper" 1
    xcrun stapler validate "$app"
    spctl --assess --type execute "$app"
  done
}

mode="unsigned"
if [[ $# -eq 0 ]]; then
  mode="unsigned"
elif [[ $# -eq 1 && "$1" == "--sign" ]]; then
  mode="sign"
elif [[ $# -eq 4 && "$1" == "--verify-only" ]]; then
  verify_signed_artifacts "$2" "$3" "$4"
  exit 0
else
  echo "usage: $0 [--sign | --verify-only <dmg> <arm64-zip> <x64-zip>]" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
out_dir="build/desktop-dist"
dmg_path="$out_dir/MindRoom-Chat.dmg"
arm64_zip="$out_dir/MindRoom-Chat-arm64-mac.zip"
x64_zip="$out_dir/MindRoom-Chat-x64-mac.zip"
expected_outputs=(
  "$dmg_path" "$arm64_zip" "$x64_zip"
  "${arm64_zip}.blockmap" "${x64_zip}.blockmap"
)

if [[ "$mode" == "unsigned" ]]; then
  rm -rf "$out_dir"
  npm run build:desktop
  build_screenshot_helper
  CSC_IDENTITY_AUTO_DISCOVERY=false MINDROOM_DESKTOP_SIGN=0 \
    npx electron-builder --mac --config electron/builder.config.cjs --publish never
  require_files "${expected_outputs[@]}"
  echo "Unsigned desktop artifacts: $out_dir"
  exit 0
fi

for name in CODESIGN_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID MARKETING_VERSION; do
  [[ -n "${!name:-}" ]] || die "Missing required signing environment variable: $name"
done
[[ "$APPLE_TEAM_ID" == "DNA6966LGZ" && "$CODESIGN_IDENTITY" == "Developer ID Application: "*" (DNA6966LGZ)" ]] \
  || die "Signing requires a Developer ID Application identity for team DNA6966LGZ."
[[ "$MARKETING_VERSION" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]] \
  || die "Invalid MARKETING_VERSION '$MARKETING_VERSION': expected YYYY.M.N without leading 'v'."

# Keep notary credentials out of the web/esbuild environment; pass them only to
# electron-builder and xcrun notarytool.
notary_apple_id=$APPLE_ID
notary_password=$APPLE_APP_SPECIFIC_PASSWORD
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD

rm -rf "$out_dir"
npm run build:desktop
build_screenshot_helper

# electron-builder 26.18.0 rejects CSC_NAME values that begin with
# "Developer ID Application:", so pass the identity suffix after that prefix.
csc_name="${CODESIGN_IDENTITY#Developer ID Application: }"

APPLE_ID="$notary_apple_id" \
APPLE_APP_SPECIFIC_PASSWORD="$notary_password" \
APPLE_TEAM_ID="$APPLE_TEAM_ID" \
MINDROOM_DESKTOP_SIGN=1 \
CSC_NAME="$csc_name" \
  npx electron-builder --mac --config electron/builder.config.cjs --publish never

require_files "${expected_outputs[@]}"

codesign --force --sign "$CODESIGN_IDENTITY" --timestamp "$dmg_path"
xcrun notarytool submit "$dmg_path" \
  --apple-id "$notary_apple_id" \
  --password "$notary_password" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$dmg_path"

verify_signed_artifacts "$dmg_path" "$arm64_zip" "$x64_zip"

latest_yml="$out_dir/latest-mac.yml"
node scripts/desktop-latest-yml.mjs \
  --version "$MARKETING_VERSION" \
  --repo "${GITHUB_REPOSITORY:-mindroom-ai/mindroom-chat}" \
  --arm64 "$arm64_zip" \
  --x64 "$x64_zip" \
  --out "$latest_yml"
require_files "$latest_yml"
echo "Signed, notarized, and verified desktop release artifacts: $out_dir"
