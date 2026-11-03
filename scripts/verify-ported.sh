#!/usr/bin/env bash
# Usage: scripts/verify-ported.sh [MindRoom Chat checkout]
#
# Recomputes the Lane P import from a MindRoom Chat checkout at the recorded commit and compares it
# with the import commit in docs/provenance/import.txt. Without a path it prints a notice and
# exits 0, so `just check` works on machines that have no checkout.
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
exec python3 scripts/port_files.py "$checkout" fc3a5905 --verify
