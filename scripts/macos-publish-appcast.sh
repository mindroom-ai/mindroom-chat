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
fail() {
  echo "::error::$1"
  exit 1
}
calver() { [[ $1 =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]]; }
# Whether the release is published (not a draft or prerelease), then its uploaded assets.
release() {
  gh release view "$1" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets \
    --jq '(if .isDraft or .isPrerelease then "unpublished" else "published" end), (.assets[] | select(.state == "uploaded") | .name)'
}
download() { gh release download "$1" --repo "$GITHUB_REPOSITORY" --pattern appcast.xml --dir "$2"; }
# The <sparkle:version> of the feed's one item; fails on a file that is not such a feed.
version() {
  python3 - "$1" <<'PY'
import sys, xml.etree.ElementTree as ET
(item,) = ET.parse(sys.argv[1]).getroot().findall('channel/item')
print(item.findtext('{http://www.andymatuschak.org/xml-namespaces/sparkle}version') or '')
PY
}
calver "${tag#v}" && [[ $tag == v* ]] || fail "'$tag' is not a release tag vYYYY.M.N"
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
mkdir "$folder/new" "$folder/live"
new=$folder/new/appcast.xml

# The DMG goes up last, after the appcast.xml that signs it: a release that has it is ready. Only
# a published release reaches the apps: a draft's DMG is not public, a prerelease is not stable.
names=$(release "$tag")
if [[ $(head -1 <<<"$names") != published ]]; then
  say "The feed stays: $tag is a draft or prerelease."
  exit 0
fi
if ! grep -Fqx MindRoom-Chat.dmg <<<"$names" || ! grep -Fqx appcast.xml <<<"$names"; then
  say "The feed stays: $tag has no DMG with its appcast."
  exit 0
fi
download "$tag" "$folder/new"
[[ $(version "$new" || true) == "${tag#v}" ]] || fail "The appcast.xml of $tag is not that version's feed."

# A feed that cannot be read is a failure, not an absent feed.
if ! live_names=$(release "$feed" 2> "$folder/error"); then
  grep -q 'release not found' "$folder/error" || fail "$(cat "$folder/error")"
  gh release create "$feed" --repo "$GITHUB_REPOSITORY" --prerelease --title 'Mac app update feed' \
    --notes 'The Mac app reads its updates from appcast.xml here (docs/ios-release.md "Updates"). Not a release of its own.'
  live_names=
fi
publish=yes
if grep -Fqx appcast.xml <<<"$live_names"; then
  download "$feed" "$folder/live"
  live=$(version "$folder/live/appcast.xml" || true)
  calver "$live" || fail "The feed's appcast.xml names no version: replace it by hand, or delete it."
  if cmp -s "$new" "$folder/live/appcast.xml"; then
    publish=
  elif [[ "$(printf '%s\n%s\n' "${tag#v}" "$live" | sort -V | tail -1)" == "$live" ]]; then
    say "The feed stays at $live."
    exit 0
  fi
fi

# --clobber deletes the asset, then uploads: a failed upload can leave the feed missing. An upload
# whose answer was lost may have landed: read it back (into a fresh folder) before trying again,
# and never replace a feed that already is this one. A readback that fails fails the job.
for attempt in 1 2 3; do
  [[ -n $publish ]] || break
  if gh release upload "$feed" "$new" --clobber --repo "$GITHUB_REPOSITORY"; then break; fi
  names=$(release "$feed")
  if grep -Fqx appcast.xml <<<"$names"; then
    check=$(mktemp -d "$folder/check.XXXXXX")
    download "$feed" "$check"
    if cmp -s "$new" "$check/appcast.xml"; then break; fi
  fi
  ((attempt < 3)) || fail 'The update feed could not be published and may be missing. Re-run this job: it needs no rebuild.'
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
fail 'The feed was uploaded, but its URL does not serve it yet.'
