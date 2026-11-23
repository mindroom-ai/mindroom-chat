#!/usr/bin/env bash
# Build the Electron Mac app unsigned for PRs/local checks, or Developer ID signed, notarized,
# stapled and verified (fail-closed) for releases.
set -euo pipefail
# Signing and notarization credentials must never appear in shell traces.
set +x

usage() {
  echo "usage: $0 [--sign | --verify-only <dmg> <arm64-zip> <x64-zip>]" >&2
  exit 2
}

scratch=""
cleanup() {
  if [[ -n "$scratch" ]]; then
    rm -rf "$scratch"
  fi
}
trap cleanup EXIT

verify_codesign_identity() {
  local target="$1"
  local require_runtime="$2"
  local details

  codesign --verify --deep --strict "$target"
  details=$(codesign -dv --verbose=4 "$target" 2>&1)

  if ! grep -Eq '^Authority=Developer ID Application:.*\(DNA6966LGZ\)$' <<<"$details"; then
    echo "$target is not signed with a Developer ID Application authority for team DNA6966LGZ" >&2
    return 1
  fi
  if ! grep -qx 'TeamIdentifier=DNA6966LGZ' <<<"$details"; then
    echo "$target does not have TeamIdentifier=DNA6966LGZ" >&2
    return 1
  fi
  if [[ "$require_runtime" -eq 1 ]] &&
    [[ "$(sed -n 's/.* flags=\([^ ]*\).*/\1/p' <<<"$details")" != *runtime* ]]; then
    echo "$target is not signed with the hardened runtime" >&2
    return 1
  fi
}

verify_signed_artifacts() {
  local dmg="$1"
  local arm64_zip="$2"
  local x64_zip="$3"
  local arch zip unpack_dir app

  for artifact in "$dmg" "$arm64_zip" "$x64_zip"; do
    if [[ ! -s "$artifact" ]]; then
      echo "Missing or empty artifact: $artifact" >&2
      return 1
    fi
  done

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
    if [[ ! -d "$app" ]]; then
      echo "Unpacked $arch ZIP does not contain MindRoom Chat.app: $zip" >&2
      return 1
    fi
    verify_codesign_identity "$app" 1
    xcrun stapler validate "$app"
    spctl --assess --type execute "$app"
  done
}

verify_expected_outputs() {
  local out_dir="$1"
  local expected=(
    "$out_dir/MindRoom-Chat.dmg"
    "$out_dir/MindRoom-Chat-arm64-mac.zip"
    "$out_dir/MindRoom-Chat-x64-mac.zip"
    "$out_dir/MindRoom-Chat-arm64-mac.zip.blockmap"
    "$out_dir/MindRoom-Chat-x64-mac.zip.blockmap"
  )
  for file in "${expected[@]}"; do
    if [[ ! -s "$file" ]]; then
      echo "Expected build artifact is missing or empty: $file" >&2
      return 1
    fi
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
  usage
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
out_dir="build/desktop-dist"
dmg_path="$out_dir/MindRoom-Chat.dmg"
arm64_zip="$out_dir/MindRoom-Chat-arm64-mac.zip"
x64_zip="$out_dir/MindRoom-Chat-x64-mac.zip"
latest_yml="$out_dir/latest-mac.yml"

if [[ "$mode" == "unsigned" ]]; then
  rm -rf "$out_dir"
  npm run build:desktop
  CSC_IDENTITY_AUTO_DISCOVERY=false MINDROOM_DESKTOP_SIGN=0 \
    npx electron-builder --mac --config electron/builder.config.cjs --publish never
  verify_expected_outputs "$out_dir"
  echo "Unsigned desktop artifacts: $out_dir"
  exit 0
fi

for name in CODESIGN_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID MARKETING_VERSION; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required signing environment variable: $name" >&2
    exit 1
  fi
done

if [[ "$APPLE_TEAM_ID" != "DNA6966LGZ" || "$CODESIGN_IDENTITY" != "Developer ID Application: "*" (DNA6966LGZ)" ]]; then
  echo 'Signing requires a Developer ID Application identity for team DNA6966LGZ.' >&2
  exit 1
fi

if [[ ! "$MARKETING_VERSION" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]]; then
  echo "Invalid MARKETING_VERSION '$MARKETING_VERSION': expected YYYY.M.N without leading 'v'." >&2
  exit 1
fi

# Keep notary credentials out of the web/esbuild environment; pass them only to
# electron-builder and xcrun notarytool.
notary_apple_id=$APPLE_ID
notary_password=$APPLE_APP_SPECIFIC_PASSWORD
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD

rm -rf "$out_dir"
npm run build:desktop

# electron-builder 26.18.0 rejects CSC_NAME values that begin with
# "Developer ID Application:", so pass the identity suffix after that prefix.
csc_name="${CODESIGN_IDENTITY#Developer ID Application: }"

APPLE_ID="$notary_apple_id" \
APPLE_APP_SPECIFIC_PASSWORD="$notary_password" \
APPLE_TEAM_ID="$APPLE_TEAM_ID" \
MINDROOM_DESKTOP_SIGN=1 \
CSC_NAME="$csc_name" \
  npx electron-builder --mac --config electron/builder.config.cjs --publish never

verify_expected_outputs "$out_dir"

codesign --force --sign "$CODESIGN_IDENTITY" --timestamp "$dmg_path"
xcrun notarytool submit "$dmg_path" \
  --apple-id "$notary_apple_id" \
  --password "$notary_password" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$dmg_path"

verify_signed_artifacts "$dmg_path" "$arm64_zip" "$x64_zip"

node scripts/desktop-latest-yml.mjs \
  --version "$MARKETING_VERSION" \
  --repo "${GITHUB_REPOSITORY:-mindroom-ai/mindroom-chat}" \
  --arm64 "$arm64_zip" \
  --x64 "$x64_zip" \
  --out "$latest_yml"

test -s "$latest_yml"
echo "Signed, notarized, and verified desktop release artifacts: $out_dir"
