#!/usr/bin/env bash
# Usage: scripts/similarity-audit.sh <corpus dir>...
#
# Compares Lane C code (every tracked src/** file not listed in docs/provenance/portable.tsv)
# against each corpus directory with `jscpd --min-tokens 50`. Only clones that pair a Lane C file
# with a corpus file count; clones inside either side are dropped. Writes, per corpus,
# `clones.tsv` (file and line range on each side, clone length) under
# docs/provenance/audit/<date>/<n>-<corpus name>/, plus `summary.tsv` for the run. Only paths and
# line numbers reach that tracked directory: jscpd's own report embeds the duplicated code, so it
# stays in a scratch directory that is deleted on exit.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/similarity-audit.sh <corpus dir>..." >&2
  exit 2
fi

for corpus in "$@"; do
  if [ ! -d "$corpus" ]; then
    echo "similarity-audit: $corpus is not a directory" >&2
    exit 2
  fi
done

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
out="docs/provenance/audit/$(date +%F)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Lane C snapshot: tracked src files that are not ported.
mkdir -p "$work/lane-c"
comm -23 <(git ls-files src | sort) <(cut -f1 docs/provenance/portable.tsv | sort) > "$work/lane-c.txt"
while IFS= read -r file; do
  mkdir -p "$work/lane-c/$(dirname "$file")"
  cp "$file" "$work/lane-c/$file"
done < "$work/lane-c.txt"
lane_c_count=$(wc -l < "$work/lane-c.txt")
if [ "$lane_c_count" -eq 0 ]; then
  echo "similarity-audit: no Lane C files under src, nothing to compare"
  exit 0
fi
echo "similarity-audit: $lane_c_count Lane C files"

mkdir -p "$out"
printf 'corpus\tclones\tduplicated_lines\n' > "$out/summary.tsv"
index=0
for corpus in "$@"; do
  index=$((index + 1))
  corpus=$(cd "$corpus" && pwd)
  dest="$out/$index-$(basename "$corpus")"
  rm -rf "$dest"
  mkdir -p "$dest" "$work/report-$index"
  npx --yes jscpd@4 --min-tokens 50 --reporters json --silent \
    --ignore '**/node_modules/**,**/.git/**' --output "$work/report-$index" "$work/lane-c" "$corpus"
  python3 - "$work/report-$index/jscpd-report.json" "$work/lane-c" "$corpus" "$dest" "$out/summary.tsv" <<'PY'
import json, os, sys

report, lane_c, corpus, dest, summary = sys.argv[1:]
inside = lambda name, root: os.path.abspath(name).startswith(root + os.sep)
rows = []
for clone in json.load(open(report))["duplicates"]:
    first, second = clone["firstFile"], clone["secondFile"]
    for ours, theirs in ((first, second), (second, first)):
        if inside(ours["name"], lane_c) and inside(theirs["name"], corpus):
            rows.append((
                os.path.relpath(ours["name"], lane_c), f"{ours['startLoc']['line']}-{ours['endLoc']['line']}",
                os.path.relpath(theirs["name"], corpus), f"{theirs['startLoc']['line']}-{theirs['endLoc']['line']}",
                clone["lines"],
            ))
            break
with open(os.path.join(dest, "clones.tsv"), "w") as f:
    f.write("lane_c_file\tlane_c_lines\tcorpus_file\tcorpus_lines\tlines\n")
    f.writelines("\t".join(map(str, row)) + "\n" for row in rows)
total = sum(row[4] for row in rows)
with open(summary, "a") as f:
    f.write(f"{corpus}\t{len(rows)}\t{total}\n")
print(f"similarity-audit: {corpus}: {len(rows)} cross clones, {total} lines")
PY
done
echo "similarity-audit: wrote $out"
