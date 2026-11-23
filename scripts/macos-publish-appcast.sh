#!/usr/bin/env bash
# The update feed job (desktop.yml "feed" with --desktop, or legacy Sparkle without it): copies a
# release's feed manifest (latest-mac.yml -> mac-feed, or appcast.xml -> mac-appcast) when that
# release is ready, above what the feed names now, and the feed is not paused (docs/ios-release.md
# "Updates"). One job runs at a time across every release's run; the rule keeps the feed from going
# backwards whatever order runs finish in, and consults no listing of releases. A re-run repairs a
# failed publication from files already up.
#   scripts/macos-publish-appcast.sh [--desktop] <tag>      (GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail

mode=sparkle
if [[ ${1:-} == --desktop ]]; then mode=desktop; shift; fi
say() {
  echo "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}
set_published() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "published=$1" >> "$GITHUB_OUTPUT"; fi
}
fail() { echo "::error::$1"; exit 1; }
[[ $# -eq 1 ]] || fail "Usage: $0 [--desktop] <tag>"
tag=$1
if [[ $mode == desktop ]]; then
  feed=mac-feed; asset=latest-mac.yml; feed_title='Mac desktop update feed'
  feed_notes='The Electron Mac app reads its updates from latest-mac.yml here (docs/ios-release.md "Updates"). Not a release of its own.'
else
  feed=mac-appcast; asset=appcast.xml; feed_title='Mac app update feed'
  feed_notes='The Mac app reads its updates from appcast.xml here (docs/ios-release.md "Updates"). Not a release of its own.'
fi
calver() { [[ $1 =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]]; }
# Whether the release is published (not a draft or prerelease), then its uploaded assets.
release() {
  gh release view "$1" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets \
    --jq '(if .isDraft or .isPrerelease then "unpublished" else "published" end), (.assets[] | select(.state == "uploaded") | .name)'
}
download() { gh release download "$1" --repo "$GITHUB_REPOSITORY" --pattern "$asset" --dir "$2"; }
# Prints the manifest's version; in --desktop mode with an expected version, also verifies both
# arm64 and x64 ZIP URLs point at v<expected> on GITHUB_REPOSITORY.
version() {
  if [[ $mode == desktop ]]; then
    python3 - "$1" "${2:-}" "${GITHUB_REPOSITORY:-}" <<'PY'
import re, sys
unq = lambda s: s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"" else s
top, files, cur, in_files = {}, [], None, False
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.rstrip("\r\n")
    if not line.strip() or line.lstrip().startswith("#"): continue
    if not line[0].isspace():
        in_files, cur = False, None
        m = re.match(r"^([A-Za-z0-9_-]+):(?:\s+(.*))?$", line)
        if not m: sys.exit(1)
        k, v = m.group(1), m.group(2)
        if k == "files" and not v: in_files = True
        elif k != "files" and v is not None: top[k] = unq(v.strip())
        else: sys.exit(1)
    elif in_files and (m := re.match(r"^\s+(?:(-\s+))?([A-Za-z0-9_-]+):\s+(.*)$", line)):
        if m.group(1): cur = {m.group(2): unq(m.group(3).strip())}; files.append(cur)
        elif cur is not None: cur[m.group(2)] = unq(m.group(3).strip())
        else: sys.exit(1)
    else: sys.exit(1)
ver, expected, repo = top.get("version", ""), sys.argv[2], sys.argv[3]
if expected:
    prefix = f"https://github.com/{repo}/releases/download/v{expected}/"
    need = {prefix + "MindRoom-Chat-arm64-mac.zip", prefix + "MindRoom-Chat-x64-mac.zip"}
    urls = [f.get("url", "") for f in files]
    if ver != expected or len(urls) != len(need) or set(urls) != need: sys.exit(1)
print(ver)
PY
  else
    python3 - "$1" <<'PY'
import sys, xml.etree.ElementTree as ET
(item,) = ET.parse(sys.argv[1]).getroot().findall('channel/item')
print(item.findtext('{http://www.andymatuschak.org/xml-namespaces/sparkle}version') or '')
PY
  fi
}
calver "${tag#v}" && [[ $tag == v* ]] || fail "'$tag' is not a release tag vYYYY.M.N"
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
mkdir "$folder/new" "$folder/live"
new=$folder/new/$asset

# Only a published release with all required assets reaches the apps: a draft's assets are not
# public, and a prerelease is not stable.
names=$(release "$tag")
if [[ $(head -1 <<<"$names") != published ]]; then
  say "The feed stays: $tag is a draft or prerelease."
  set_published false
  exit 0
fi
if [[ $mode == desktop ]]; then
  for required in MindRoom-Chat.dmg MindRoom-Chat-arm64-mac.zip MindRoom-Chat-x64-mac.zip \
      MindRoom-Chat-arm64-mac.zip.blockmap MindRoom-Chat-x64-mac.zip.blockmap latest-mac.yml; do
    if ! grep -Fqx "$required" <<<"$names"; then
      say "The feed stays: $tag is missing $required."
      set_published false
      exit 0
    fi
  done
elif ! grep -Eqx 'MindRoom(-Chat)?\.dmg' <<<"$names" || ! grep -Fqx appcast.xml <<<"$names"; then
  # MindRoom.dmg: a release from before the rename.
  say "The feed stays: $tag has no DMG with its appcast."
  set_published false
  exit 0
fi
download "$tag" "$folder/new"
[[ $(version "$new" "${tag#v}" || true) == "${tag#v}" ]] || fail "The $asset of $tag is not that version's feed."

# A feed that cannot be read is a failure, not an absent feed.
if ! live_names=$(release "$feed" 2> "$folder/error"); then
  grep -q 'release not found' "$folder/error" || fail "$(cat "$folder/error")"
  gh release create "$feed" --repo "$GITHUB_REPOSITORY" --prerelease --title "$feed_title" \
    --notes "$feed_notes"
  live_names=
fi
if grep -Fqx PAUSED <<<"$live_names"; then
  say "The feed is paused (PAUSED asset present on $feed); skipping write."
  set_published false
  exit 0
fi
publish=yes
if grep -Fqx "$asset" <<<"$live_names"; then
  download "$feed" "$folder/live"
  live=$(version "$folder/live/$asset" || true)
  calver "$live" || fail "The feed's $asset names no version: replace it by hand, or delete it."
  if cmp -s "$new" "$folder/live/$asset"; then
    publish=
  elif [[ "$(printf '%s\n%s\n' "${tag#v}" "$live" | sort -V | tail -1)" == "$live" ]]; then
    say "The feed stays at $live."
    set_published false
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
  if grep -Fqx "$asset" <<<"$names"; then
    check=$(mktemp -d "$folder/check.XXXXXX")
    download "$feed" "$check"
    if cmp -s "$new" "$check/$asset"; then break; fi
  fi
  ((attempt < 3)) || fail 'The update feed could not be published and may be missing. Re-run this job: it needs no rebuild.'
  sleep 10
done
# Only read from here on: a URL that lags is waited for, never uploaded to again.
for _ in $(seq 24); do
  if curl -fsSL "https://github.com/$GITHUB_REPOSITORY/releases/download/$feed/$asset" | cmp -s - "$new"; then
    if [[ -n $publish ]]; then
      say "The feed is now $tag."
      set_published true
    else
      say "The feed already has $tag."
      set_published false
    fi
    exit 0
  fi
  sleep 5
done
fail 'The feed was uploaded, but its URL does not serve it yet.'
