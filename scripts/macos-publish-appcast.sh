#!/usr/bin/env bash
# The update feed job (macos.yml "feed"): copies a release's appcast.xml to the prerelease
# mac-appcast, the feed the Mac app reads, when that release is ready and above what the feed names
# now (docs/ios-release.md "Updates"). One job runs at a time across every release's run; the rule
# keeps the feed from going backwards whatever order runs finish in, and consults no listing of
# releases. A re-run repairs a failed publication from files already up.
#   scripts/macos-publish-appcast.sh <tag>      (GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail

tag=$1
feed=mac-appcast
say() {
  echo "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}
assets() {
  gh release view "$1" --repo "$GITHUB_REPOSITORY" --json assets \
    --jq '.assets[] | select(.state == "uploaded") | .name'
}
download() { gh release download "$1" --repo "$GITHUB_REPOSITORY" --pattern appcast.xml --dir "$2"; }
version() { sed -n 's|.*<sparkle:version>\([^<]*\)</sparkle:version>.*|\1|p' "$1" | head -1; }
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
mkdir "$folder/new" "$folder/live"
new=$folder/new/appcast.xml

# The DMG goes up last, after the appcast.xml that signs it: a release that has it is ready.
names=$(assets "$tag")
if ! grep -qx MindRoom.dmg <<<"$names" || ! grep -qx appcast.xml <<<"$names"; then
  say "The feed stays: $tag has no DMG with its appcast."
  exit 0
fi
download "$tag" "$folder/new"

# A feed that cannot be read is a failure, not an absent feed.
if ! live_names=$(assets "$feed" 2> "$folder/error"); then
  if ! grep -q 'release not found' "$folder/error"; then
    echo "::error::$(cat "$folder/error")"
    exit 1
  fi
  gh release create "$feed" --repo "$GITHUB_REPOSITORY" --prerelease --title 'Mac app update feed' \
    --notes 'The Mac app reads its updates from appcast.xml here (docs/ios-release.md "Updates"). Not a release of its own.'
  live_names=
fi
if grep -qx appcast.xml <<<"$live_names"; then
  download "$feed" "$folder/live"
  if cmp -s "$new" "$folder/live/appcast.xml"; then
    say "The feed already is $tag."
    exit 0
  fi
  live=$(version "$folder/live/appcast.xml")
  if [[ "$(printf '%s\n%s\n' "$(version "$new")" "$live" | sort -V | tail -1)" == "$live" ]]; then
    say "The feed stays at $live."
    exit 0
  fi
fi

# --clobber deletes the asset, then uploads: a failed upload can leave the feed missing.
for attempt in 1 2 3; do
  if gh release upload "$feed" "$new" --clobber --repo "$GITHUB_REPOSITORY"; then break; fi
  if [[ $attempt == 3 ]]; then
    echo '::error::The update feed could not be published and may be missing. Re-run this job: it needs no rebuild.'
    exit 1
  fi
  sleep 10
done
# Only read from here on: a URL that lags is waited for, never uploaded to again.
for _ in $(seq 24); do
  if curl -fsSL "https://github.com/$GITHUB_REPOSITORY/releases/download/$feed/appcast.xml" | cmp -s - "$new"; then
    say "The feed is now $tag."
    exit 0
  fi
  sleep 5
done
echo '::error::The feed was uploaded, but its URL does not serve it yet.'
exit 1
