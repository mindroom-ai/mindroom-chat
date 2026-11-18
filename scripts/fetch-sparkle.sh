#!/usr/bin/env bash
# Downloads the pinned Sparkle release into ios/MacUpdater/Sparkle/ (git-ignored): the framework the
# Mac app's updater bundle links and embeds, the bin/ tools that sign each release's appcast.xml,
# and its LICENSE. Refuses a tarball whose sha256 is not the pinned one; does nothing when that
# version is there already.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=2.10.1
SHA256=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27
OUT=ios/MacUpdater/Sparkle

if [[ "$(cat "$OUT/.version" 2>/dev/null)" == "$VERSION" ]]; then
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/sparkle.tar.xz" \
  "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz"
actual=$(shasum -a 256 "$tmp/sparkle.tar.xz" | cut -d' ' -f1)
if [[ "$actual" != "$SHA256" ]]; then
  echo "Sparkle $VERSION checksum mismatch: got $actual, expected $SHA256" >&2
  exit 1
fi
rm -rf "$OUT"
mkdir -p "$OUT"
tar -xJf "$tmp/sparkle.tar.xz" -C "$OUT" ./Sparkle.framework ./bin ./LICENSE
echo "$VERSION" > "$OUT/.version"
echo "Fetched Sparkle $VERSION into $OUT"
