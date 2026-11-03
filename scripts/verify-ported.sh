#!/usr/bin/env bash
# Usage: scripts/verify-ported.sh [MindRoom Chat checkout]
#
# Recomputes each Lane P import wave from a MindRoom Chat checkout and compares it with that wave's
# import commit: wave 1 is docs/provenance/portable.tsv and holes.tsv, wave 2 portable-wave2.tsv and
# holes-wave2.tsv, and line N of docs/provenance/import.txt ("<import commit> mindroom-chat <source
# commit> ...") names wave N's commits. Files later deleted with a dropped feature
# (docs/provenance/dropped.tsv) are still checked: the comparison reads the import commit, not the
# working tree. Without a path it prints a notice and exits 0, so `just check` works on machines
# that have no checkout.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "verify-ported: skipped (pass a MindRoom Chat checkout path)"
  exit 0
fi

if [ ! -d "$1" ]; then
  echo "verify-ported: $1 is not a directory" >&2
  exit 2
fi

checkout=$(cd "$1" && pwd)
cd "$(dirname "$0")/.."
wave=0
while read -r _import_commit _source source_commit _rest; do
  [ -n "${source_commit:-}" ] || continue
  wave=$((wave + 1))
  echo "verify-ported: wave $wave (mindroom-chat $source_commit)"
  python3 scripts/port_files.py "$checkout" "$source_commit" --wave "$wave" --verify
done < docs/provenance/import.txt

if [ "$wave" -eq 0 ]; then
  echo "verify-ported: docs/provenance/import.txt names no import" >&2
  exit 2
fi
