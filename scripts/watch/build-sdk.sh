#!/usr/bin/env bash
# Builds matrix-rust-sdk's matrix-sdk-ffi for the watch app into ios/Watch/MatrixRustSDK/ (the
# XCFramework and the generated Swift sources, both git-ignored), from the tag and commit in
# ios/Watch/sdk/version with ios/Watch/sdk/matrix-rust-sdk.patch applied.
#
#   scripts/watch/build-sdk.sh            build on this Mac (rustup; the xtask runs watchOS targets
#                                         with the nightly toolchain and rust-src), write the zip's
#                                         sha256 to ios/Watch/sdk/checksum
#   scripts/watch/build-sdk.sh --fetch    download the zip from this repository's GitHub release named
#                                         below (no sign-in) and unpack it, refusing a checksum other
#                                         than the recorded one; does nothing when that release is
#                                         there already; Xcode Cloud, fastlane and the Mac build run this
#   scripts/watch/build-sdk.sh --publish  build, then upload the zip to that release (creating it);
#                                         a release step for the coordinator only
#
# The release is watch-sdk-<tag>-<first 12 hex of the patch's sha256>, so a new patch or tag gets
# its own. The checkout lives in ${XDG_CACHE_HOME:-~/.cache}/mindroom-watch-sdk/<commit>.
#
# arm64 only: aws-lc-sys (rustls' crypto) does not compile for arm64_32, the 32-bit pointer
# architecture of Series 6 to 8 and SE watches, so those cannot run the app yet.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT=$PWD
read -r TAG COMMIT < ios/Watch/sdk/version
PATCH=ios/Watch/sdk/matrix-rust-sdk.patch
PATCH_ID=$(shasum -a 256 "$PATCH" | cut -c1-12)
RELEASE="watch-sdk-$TAG-$PATCH_ID"
OUT=ios/Watch/MatrixRustSDK
ZIP_NAME=MatrixSDKFFI.xcframework.zip
# Names the release whose build is in $OUT, so a new patch or tag replaces an older build.
STAMP=$OUT/release
SDK_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mindroom-watch-sdk/$COMMIT"
REPO_SLUG=mindroom-ai/mindroom-chat

unpack() {
  rm -rf "$OUT/MatrixSDKFFI.xcframework" "$OUT/Sources"
  (cd "$OUT" && unzip -q "$1")
}

if [[ "${1:-}" == "--fetch" ]]; then
  if [[ -d "$OUT/MatrixSDKFFI.xcframework" && "$(cat "$STAMP" 2>/dev/null)" == "$RELEASE" ]]; then
    echo "$RELEASE is already in $OUT"
    exit 0
  fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/$ZIP_NAME" "https://github.com/$REPO_SLUG/releases/download/$RELEASE/$ZIP_NAME"
  actual=$(shasum -a 256 "$tmp/$ZIP_NAME" | cut -d' ' -f1)
  expected=$(cat ios/Watch/sdk/checksum)
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $RELEASE: got $actual, ios/Watch/sdk/checksum says $expected" >&2
    exit 1
  fi
  unpack "$tmp/$ZIP_NAME"
  echo "$RELEASE" > "$STAMP"
  echo "Fetched $RELEASE into $OUT"
  exit 0
fi

if [[ ! -d "$SDK_DIR/.git" ]]; then
  rm -rf "$SDK_DIR"
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/matrix-org/matrix-rust-sdk.git "$SDK_DIR"
fi
if [[ "$(git -C "$SDK_DIR" rev-parse HEAD)" != "$COMMIT" ]]; then
  echo "$TAG is $(git -C "$SDK_DIR" rev-parse HEAD), ios/Watch/sdk/version says $COMMIT" >&2
  exit 1
fi
git -C "$SDK_DIR" checkout --quiet -- .
git -C "$SDK_DIR" apply "$REPO_ROOT/$PATCH"

# A host-wide rustc wrapper (sccache and the like) is not needed and breaks the nightly build.
export RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER=
rustup toolchain install nightly --profile minimal --component rust-src >/dev/null
rustup target add --toolchain stable aarch64-apple-watchos aarch64-apple-watchos-sim >/dev/null
python3 "$REPO_ROOT/scripts/watch/check_sdk_licenses.py" "$SDK_DIR" --write "$REPO_ROOT/licenses/watch-sdk.txt"

(
  cd "$SDK_DIR"
  cargo xtask swift build-framework --profile watch-release \
    --target aarch64-apple-watchos --target aarch64-apple-watchos-sim \
    --watchos-deployment-target 10.0 --components-path "$REPO_ROOT/$OUT/build"
)
rm -rf "$OUT/MatrixSDKFFI.xcframework" "$OUT/Sources"
mv "$OUT/build/MatrixSDKFFI.xcframework" "$OUT/build/Sources" "$OUT/"
rm -rf "$OUT/build"
echo "$RELEASE" > "$STAMP"

(cd "$OUT" && rm -f "$ZIP_NAME" && zip -qry -X "$ZIP_NAME" MatrixSDKFFI.xcframework Sources)
shasum -a 256 "$OUT/$ZIP_NAME" | cut -d' ' -f1 > ios/Watch/sdk/checksum
echo "Built $RELEASE into $OUT ($(cat ios/Watch/sdk/checksum))"

if [[ "${1:-}" == "--publish" ]]; then
  gh release view "$RELEASE" --repo "$REPO_SLUG" >/dev/null 2>&1 ||
    gh release create "$RELEASE" --repo "$REPO_SLUG" --prerelease --title "$RELEASE" \
      --notes "matrix-sdk-ffi $TAG ($COMMIT) for watchOS, built by scripts/watch/build-sdk.sh with ios/Watch/sdk/matrix-rust-sdk.patch."
  gh release upload "$RELEASE" "$OUT/$ZIP_NAME" --repo "$REPO_SLUG" --clobber
fi
