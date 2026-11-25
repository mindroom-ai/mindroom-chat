#!/usr/bin/env bash
# Build the universal macOS N-API addon that observes AppKit trackpad scroll phases.
set -euo pipefail
set +x

die() { echo "$*" >&2; exit 1; }

scratch=""
cleanup() {
  if [[ -n "$scratch" ]]; then rm -rf "$scratch"; fi
}
trap cleanup EXIT

cd "$(dirname "${BASH_SOURCE[0]}")/.."

addon_src="electron/native/trackpad_swipe.mm"
addon_out="build/electron/mindroom-trackpad-swipe.node"
napi_include="node_modules/node-api-headers/include"
[[ -f "$napi_include/node_api.h" ]] || die "Missing node-api-headers at $napi_include: run npm ci"

xcrun_bin=$(command -v xcrun)
if [[ "$xcrun_bin" == /nix/store/* && -x /usr/bin/xcrun ]]; then
  xcrun_bin="/usr/bin/xcrun"
fi
env_clean=()
if [[ "${DEVELOPER_DIR:-}" == /nix/store/* ]]; then env_clean+=(-u DEVELOPER_DIR); fi
if [[ "${SDKROOT:-}" == /nix/store/* ]]; then env_clean+=(-u SDKROOT); fi

sdk=$(env ${env_clean[@]+"${env_clean[@]}"} "$xcrun_bin" --sdk macosx --show-sdk-path)
[[ -n "$sdk" ]] || die "xcrun --sdk macosx --show-sdk-path returned an empty SDK path"

flags=(
  -std=c++17
  -ObjC++
  -fobjc-arc
  -O2
  -Wall
  -Wextra
  -bundle
  -undefined dynamic_lookup
  -DNAPI_VERSION=8
  -isysroot "$sdk"
  -I "$napi_include"
  -framework AppKit
  -framework Foundation
  -framework CoreGraphics
)

scratch=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/mindroom-trackpad-swipe-build.XXXXXX")
arm64_bundle="$scratch/trackpad-swipe-arm64.node"
x64_bundle="$scratch/trackpad-swipe-x64.node"

env ${env_clean[@]+"${env_clean[@]}"} "$xcrun_bin" --sdk macosx clang++ "${flags[@]}" \
  -target arm64-apple-macosx13.0 "$addon_src" -o "$arm64_bundle"
env ${env_clean[@]+"${env_clean[@]}"} "$xcrun_bin" --sdk macosx clang++ "${flags[@]}" \
  -target x86_64-apple-macosx13.0 "$addon_src" -o "$x64_bundle"

mkdir -p "$(dirname "$addon_out")"
lipo -create "$arm64_bundle" "$x64_bundle" -output "$addon_out"
codesign --force --sign - "$addon_out"
