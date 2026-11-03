#!/usr/bin/env bash
# Usage: scripts/similarity-audit.sh <corpus dir>...
#
# Compares Lane C code (every tracked src/** file not listed in docs/provenance/portable.tsv)
# against each corpus directory with `jscpd --min-tokens 50`. Only clones that pair a Lane C file
# with a corpus file count; clones inside either side are dropped. Writes, per corpus, the full
# jscpd report and `clones.tsv` (Lane C file, corpus file, lines) under
# docs/provenance/audit/<date>/<corpus name>/, plus `summary.tsv` for the run.
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
  mkdir -p "$dest"
  npx --yes jscpd@4 --min-tokens 50 --reporters json --silent \
    --ignore '**/node_modules/**,**/.git/**' --output "$dest" "$work/lane-c" "$corpus"
  python3 - "$dest/jscpd-report.json" "$work/lane-c" "$corpus" "$dest" "$out/summary.tsv" <<'PY'
import json, os, sys

report, lane_c, corpus, dest, summary = sys.argv[1:]
inside = lambda name, root: os.path.abspath(name).startswith(root + os.sep)
rows = []
for clone in json.load(open(report))["duplicates"]:
    first, second = clone["firstFile"]["name"], clone["secondFile"]["name"]
    for ours, theirs in ((first, second), (second, first)):
        if inside(ours, lane_c) and inside(theirs, corpus):
            rows.append((os.path.relpath(ours, lane_c), os.path.relpath(theirs, corpus), clone["lines"]))
            break
with open(os.path.join(dest, "clones.tsv"), "w") as f:
    f.write("lane_c_file\tcorpus_file\tlines\n")
    f.writelines(f"{a}\t{b}\t{n}\n" for a, b, n in rows)
with open(summary, "a") as f:
    f.write(f"{corpus}\t{len(rows)}\t{sum(n for _, _, n in rows)}\n")
print(f"similarity-audit: {corpus}: {len(rows)} cross clones, {sum(n for _, _, n in rows)} lines")
PY
done
echo "similarity-audit: wrote $out"
