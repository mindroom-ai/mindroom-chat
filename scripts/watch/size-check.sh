#!/usr/bin/env bash
# Fails when a built watch app would install above the budget on any watch architecture.
#
#   scripts/watch/size-check.sh <MindRoomWatch.app> [budget in MB, default 70]
#
# Apple refuses a watch app whose thinned variant installs at 75 MB or more. For each architecture
# of the app's executable, this copies the app, keeps only that architecture in every Mach-O file
# (the app and its extensions), strips their symbols as an archive build does, and sums the bundle.
set -euo pipefail

app=${1:?usage: size-check.sh <MindRoomWatch.app> [budget MB]}
budget_mb=${2:-70}
name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
status=0

for arch in $(lipo -archs "$app/$name"); do
  copy="$tmp/$arch/$(basename "$app")"
  mkdir -p "$tmp/$arch"
  cp -R "$app" "$copy"
  while IFS= read -r -d '' file; do
    if lipo -archs "$file" >/dev/null 2>&1; then
      if [[ $(lipo -archs "$file") == *" "* ]]; then
        lipo "$file" -thin "$arch" -output "$file.thin" && mv "$file.thin" "$file"
      fi
      strip -S -x "$file" 2>/dev/null || true
      [[ -x "$file" ]] && strip "$file" 2>/dev/null || true
    fi
  done < <(find "$copy" -type f -print0)
  size_kb=$(du -sk "$copy" | cut -f1)
  size_mb=$((size_kb / 1024))
  echo "$arch: $size_mb MB (budget $budget_mb MB)"
  if ((size_kb > budget_mb * 1024)); then
    status=1
  fi
done

exit $status
