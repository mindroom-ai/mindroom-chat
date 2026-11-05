#!/usr/bin/env bash
# Usage: scripts/similarity-audit.sh <corpus>...
#
# Compares Lane C code against each corpus with `jscpd --min-tokens 50`. A corpus is a directory,
# or a Git repository given as <dir>@<commit>; a Git checkout given without a commit means
# <dir>@HEAD. A repository is compared as the files tracked at that commit (`git archive`), so
# its untracked files, build output and nested worktrees never count.
# Lane P is every path in docs/provenance/portable.tsv and portable-wave2.tsv, where
# docs/provenance/moves.tsv says it is now, minus the paths in docs/provenance/dropped.tsv. Lane C is every other file under src/, scripts/ and e2e/, plus the
# root config files, tracked or untracked but not ignored by Git, that exists in the working tree.
# Only clones that pair a Lane C file with a corpus file count; clones inside either side are
# dropped. Writes, per corpus, `clones.tsv` (file and line range on each side, clone length) under
# docs/provenance/audit/<date>/<n>-<corpus name>/, plus `summary.tsv` for the run. Only paths and
# line numbers reach that tracked directory: jscpd's own report embeds the duplicated code, so it
# stays in a scratch directory that is deleted on exit.
set -euo pipefail
export LC_ALL=C

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/similarity-audit.sh <corpus dir or git repository[@commit]>..." >&2
  exit 2
fi

# Each corpus as "<dir><TAB><commit>": the commit is empty for a plain directory.
corpora=()
for spec in "$@"; do
  dir=$spec rev=
  case "$spec" in *@*) dir=${spec%@*} rev=${spec##*@} ;; esac
  if [ ! -d "$dir" ]; then
    echo "similarity-audit: $dir is not a directory" >&2
    exit 2
  fi
  if [ "$(git -C "$dir" rev-parse --is-bare-repository 2>/dev/null)" = true ] ||
    [ "$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$dir" && pwd -P)" ]; then
    commit=$(git -C "$dir" rev-parse --verify --quiet "${rev:-HEAD}^{commit}") || {
      echo "similarity-audit: no commit ${rev:-HEAD} in $dir" >&2
      exit 2
    }
    rev=$commit
  elif [ -n "$rev" ]; then
    echo "similarity-audit: $dir is not a Git repository, so it takes no @commit" >&2
    exit 2
  fi
  corpora+=("$dir"$'\t'"$rev")
done

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
prov=docs/provenance
out="$prov/audit/$(date +%F)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Lane P: both import waves at their current paths (docs/provenance/moves.tsv), without the files
# deleted with a dropped feature.
node scripts/provenance-paths.cjs lane-p portable.tsv portable-wave2.tsv | sort -u > "$work/imported.txt"
cut -f1 "$prov/dropped.tsv" | sed '/^$/d' | sort -u > "$work/dropped.txt"
comm -23 "$work/imported.txt" "$work/dropped.txt" > "$work/lane-p.txt"

# Root config files: every file at the top level except documentation, licenses and lockfiles.
git ls-files --cached --others --exclude-standard \
  | grep -v / \
  | grep -vE '^(LICENSE|NOTICE|package-lock\.json|flake\.lock)$|\.md$' > "$work/root.txt" || true

# Lane C snapshot: the candidate files that are not Lane P and exist in the working tree.
{ git ls-files --cached --others --exclude-standard -- src scripts e2e; cat "$work/root.txt"; } \
  | sort -u | comm -23 - "$work/lane-p.txt" > "$work/candidates.txt"
mkdir -p "$work/lane-c"
: > "$work/lane-c.txt"
while IFS= read -r file; do
  [ -f "$file" ] || continue
  mkdir -p "$work/lane-c/$(dirname "$file")"
  cp "$file" "$work/lane-c/$file"
  printf '%s\n' "$file" >> "$work/lane-c.txt"
done < "$work/candidates.txt"
lane_c_count=$(wc -l < "$work/lane-c.txt")
if [ "$lane_c_count" -eq 0 ]; then
  echo "similarity-audit: no Lane C files, nothing to compare"
  exit 0
fi
echo "similarity-audit: $lane_c_count Lane C files ($(wc -l < "$work/lane-p.txt") Lane P paths excluded)"

mkdir -p "$out"
printf 'corpus\tclones\tduplicated_lines\n' > "$out/summary.tsv"
index=0
for entry in "${corpora[@]}"; do
  index=$((index + 1))
  dir=${entry%%$'\t'*} rev=${entry#*$'\t'}
  dest="$out/$index-$(basename "$(cd "$dir" && pwd -L)")"
  if [ -n "$rev" ]; then
    corpus="$work/corpus-$index"
    mkdir -p "$corpus"
    git -C "$dir" archive "$rev" | tar -x -C "$corpus"
    label="$(basename "$(cd "$dir" && pwd -L)")@$rev"
    echo "similarity-audit: $label: $(find "$corpus" -type f | wc -l) tracked files"
  else
    corpus=$(cd "$dir" && pwd -P)
    label=$corpus
  fi
  rm -rf "$dest"
  mkdir -p "$dest" "$work/report-$index"
  npx --yes jscpd@4 --min-tokens 50 --reporters json --silent \
    --ignore '**/node_modules/**,**/.git/**' --output "$work/report-$index" "$work/lane-c" "$corpus"
  python3 - "$work/report-$index/jscpd-report.json" "$work/lane-c" "$corpus" "$dest" "$out/summary.tsv" "$label" <<'PY'
import json, os, sys

report_path, lane_c, corpus, dest, summary, label = sys.argv[1:]
lane_c, corpus = os.path.realpath(lane_c), os.path.realpath(corpus)


def inside(name, root):
    """Whether the file jscpd reported lies under root, after resolving symlinks on both sides."""
    return os.path.realpath(name).startswith(root + os.sep)


report = json.load(open(report_path))
# jscpd lists every file it tokenized under statistics.formats.<format>.sources. A side with no
# files there means the paths did not line up (or the side has nothing jscpd reads), so a zero
# clone count would mean nothing.
scanned = [
    name
    for stats in report.get("statistics", {}).get("formats", {}).values()
    for name in stats.get("sources", {})
]
for side, root in (("Lane C", lane_c), ("corpus", corpus)):
    if not any(inside(name, root) for name in scanned):
        print(f"similarity-audit: warning: jscpd read no {side} files under {root}", file=sys.stderr)

rows = []
for clone in report["duplicates"]:
    first, second = clone["firstFile"], clone["secondFile"]
    for ours, theirs in ((first, second), (second, first)):
        if inside(ours["name"], lane_c) and inside(theirs["name"], corpus):
            rows.append((
                os.path.relpath(os.path.realpath(ours["name"]), lane_c),
                f"{ours['startLoc']['line']}-{ours['endLoc']['line']}",
                os.path.relpath(os.path.realpath(theirs["name"]), corpus),
                f"{theirs['startLoc']['line']}-{theirs['endLoc']['line']}",
                clone["lines"],
            ))
            break
with open(os.path.join(dest, "clones.tsv"), "w") as f:
    f.write("lane_c_file\tlane_c_lines\tcorpus_file\tcorpus_lines\tlines\n")
    f.writelines("\t".join(map(str, row)) + "\n" for row in rows)
total = sum(row[4] for row in rows)
with open(summary, "a") as f:
    f.write(f"{label}\t{len(rows)}\t{total}\n")
print(f"similarity-audit: {label}: {len(rows)} cross clones, {total} lines")
PY
done
echo "similarity-audit: wrote $out"
