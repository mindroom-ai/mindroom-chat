#!/usr/bin/env bash
# The update feed job (desktop.yml "feed" / "feed-linux"): copies a release's update manifest(s)
# to mac-feed or linux-feed when that release is ready, above what the feed names now, and the feed
# is not paused (docs/ios-release.md "Updates"). One job runs at a time per feed across every
# release's run; the rule keeps the feed from going backwards whatever order runs finish in, and
# consults no listing of releases. A re-run repairs a failed publication from files already up.
#   scripts/macos-publish-appcast.sh [--desktop|--linux] <tag>  (GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail

platform=mac
if [[ ${1:-} == --desktop ]]; then shift
elif [[ ${1:-} == --linux ]]; then platform=linux; shift; fi
say() {
  echo "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}
set_published() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "published=$1" >> "$GITHUB_OUTPUT"; fi
}
fail() { echo "::error::$1"; exit 1; }
[[ $# -eq 1 ]] || fail "Usage: $0 [--desktop|--linux] <tag>"
tag=$1
if [[ $platform == linux ]]; then
  feed=linux-feed
  feed_title='Linux desktop update feed'
  feed_notes='The Electron Linux AppImage reads its updates from latest-linux.yml and latest-linux-arm64.yml here (docs/ios-release.md "Updates"). Not a release of its own.'
  required_assets=(
    MindRoom-Chat-x86_64.AppImage MindRoom-Chat-amd64.deb
    MindRoom-Chat-arm64.AppImage MindRoom-Chat-arm64.deb
    latest-linux.yml latest-linux-arm64.yml
  )
  feed_assets=(latest-linux.yml latest-linux-arm64.yml)
else
  feed=mac-feed
  feed_title='Mac desktop update feed'
  feed_notes='The Electron Mac app reads its updates from latest-mac.yml here (docs/ios-release.md "Updates"). Not a release of its own.'
  required_assets=(
    MindRoom-Chat.dmg MindRoom-Chat-arm64-mac.zip MindRoom-Chat-x64-mac.zip
    MindRoom-Chat-arm64-mac.zip.blockmap MindRoom-Chat-x64-mac.zip.blockmap latest-mac.yml
  )
  feed_assets=(latest-mac.yml)
fi
calver() { [[ $1 =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]]; }
# Whether the release is published (not a draft or prerelease), then its uploaded assets.
release() {
  gh release view "$1" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets \
    --jq '(if .isDraft or .isPrerelease then "unpublished" else "published" end), (.assets[] | select(.state == "uploaded") | .name)'
}
download() { gh release download "$1" --repo "$GITHUB_REPOSITORY" --pattern "$2" --dir "$3"; }
# Prints the manifest's version; with an expected version and filenames, also verifies the URLs
# point at v<expected> on GITHUB_REPOSITORY.
version() {
  local file="$1" expected="${2:-}"
  shift
  if [[ $# -gt 0 ]]; then shift; fi
  python3 - "$file" "$expected" "${GITHUB_REPOSITORY:-}" ${@+"$@"} <<'PY'
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
ver, expected, repo, expected_files = top.get("version", ""), sys.argv[2], sys.argv[3], sys.argv[4:]
if expected:
    prefix = f"https://github.com/{repo}/releases/download/v{expected}/"
    need = {prefix + name for name in expected_files}
    urls = [f.get("url", "") for f in files]
    if ver != expected or not need or len(urls) != len(need) or set(urls) != need or top.get("path", "") not in need:
        sys.exit(1)
    if all(name.endswith(".AppImage") for name in expected_files):
        if any(not re.fullmatch(r"[1-9][0-9]*", str(f.get("blockMapSize", ""))) for f in files):
            sys.exit(1)
print(ver)
PY
}
if [[ $tag != v* ]] || ! calver "${tag#v}"; then fail "'$tag' is not a release tag vYYYY.M.N"; fi
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
mkdir "$folder/new" "$folder/live"

# Only a published release with all required assets reaches the apps: a draft's assets are not
# public, and a prerelease is not stable.
names=$(release "$tag")
if [[ $(head -1 <<<"$names") != published ]]; then
  say "The feed stays: $tag is a draft or prerelease."
  set_published false
  exit 0
fi
for required in "${required_assets[@]}"; do
  if ! grep -Fqx "$required" <<<"$names"; then
    say "The feed stays: $tag is missing $required."
    set_published false
    exit 0
  fi
done
for asset in "${feed_assets[@]}"; do
  download "$tag" "$asset" "$folder/new"
  case "$asset" in
    latest-mac.yml) expected_files=(MindRoom-Chat-arm64-mac.zip MindRoom-Chat-x64-mac.zip) ;;
    latest-linux.yml) expected_files=(MindRoom-Chat-x86_64.AppImage) ;;
    latest-linux-arm64.yml) expected_files=(MindRoom-Chat-arm64.AppImage) ;;
    *) fail "Unexpected feed asset: $asset" ;;
  esac
  [[ $(version "$folder/new/$asset" "${tag#v}" "${expected_files[@]}" || true) == "${tag#v}" ]] \
    || fail "The $asset of $tag is not that version's feed."
done

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

# Inspect every live feed asset before uploading any so a corrupt asset fails closed with zero
# writes and a partial prior publish heals on re-run without downgrading newer assets.
actions=()
newer_live=""
all_skipped=yes
for ((i = 0; i < ${#feed_assets[@]}; i++)); do
  asset="${feed_assets[$i]}"
  action=upload
  if grep -Fqx "$asset" <<<"$live_names"; then
    download "$feed" "$asset" "$folder/live"
    live=$(version "$folder/live/$asset" || true)
    calver "$live" || fail "The feed's $asset names no version: replace it by hand, or delete it."
    if cmp -s "$folder/new/$asset" "$folder/live/$asset"; then
      action=verify
    elif [[ "$(printf '%s\n%s\n' "${tag#v}" "$live" | sort -V | tail -1)" == "$live" ]]; then
      action=skip
      if [[ -z "$newer_live" ]] || [[ "$(printf '%s\n%s\n' "$newer_live" "$live" | sort -V | tail -1)" == "$live" ]]; then
        newer_live="$live"
      fi
    fi
  fi
  actions[$i]="$action"
  if [[ "$action" != skip ]]; then all_skipped=""; fi
done
if [[ -n "$all_skipped" ]]; then
  say "The feed stays at $newer_live."
  set_published false
  exit 0
fi

# --clobber deletes the asset, then uploads: a failed upload can leave the feed missing. An upload
# whose answer was lost may have landed: read it back (into a fresh folder) before trying again,
# and never replace a feed that already is this one. A readback that fails fails the job.
uploaded_any=""
for ((i = 0; i < ${#feed_assets[@]}; i++)); do
  if [[ "${actions[$i]}" != upload ]]; then continue; fi
  asset="${feed_assets[$i]}"
  new="$folder/new/$asset"
  for attempt in 1 2 3; do
    if gh release upload "$feed" "$new" --clobber --repo "$GITHUB_REPOSITORY"; then break; fi
    names=$(release "$feed")
    if grep -Fqx "$asset" <<<"$names"; then
      check=$(mktemp -d "$folder/check.XXXXXX")
      download "$feed" "$asset" "$check"
      if cmp -s "$new" "$check/$asset"; then break; fi
    fi
    ((attempt < 3)) || fail 'The update feed could not be published and may be missing. Re-run this job: it needs no rebuild.'
    sleep 10
  done
  uploaded_any=yes
done
# Only read from here on: a URL that lags is waited for, never uploaded to again.
for ((i = 0; i < ${#feed_assets[@]}; i++)); do
  if [[ "${actions[$i]}" == skip ]]; then continue; fi
  asset="${feed_assets[$i]}"
  new="$folder/new/$asset"
  served=""
  for _ in $(seq 24); do
    if curl -fsSL "https://github.com/$GITHUB_REPOSITORY/releases/download/$feed/$asset" | cmp -s - "$new"; then
      served=yes
      break
    fi
    sleep 5
  done
  [[ -n "$served" ]] || fail 'The feed was uploaded, but its URL does not serve it yet.'
done
if [[ -n "$uploaded_any" ]]; then
  say "The feed is now $tag."
  set_published true
else
  say "The feed already has $tag."
  set_published false
fi
