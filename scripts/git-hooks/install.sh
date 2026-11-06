#!/usr/bin/env bash
# Install the upstream-overlap pre-push hook (scripts/git-hooks/pre-push) in mindroom-client clones.
#
# Usage: scripts/git-hooks/install.sh --corpus <upstream clone> [<clone>...]   (default: this clone)
#
# Each clone's hooks directory (the shared one of its worktrees) gets copies of the hook and of
# scripts/upstream-overlap/check.py, and the corpus path, so a branch that lacks or edits them
# changes nothing; install again after changing either file. Other hooks stay: a pre-push hook that
# is not this one is kept as pre-push.local, which this hook runs first, and the other hook names
# (such as the global forbidden-word hooks) are left alone. A clone with core.hooksPath set is
# refused, because git would never run a hook from its hooks directory.
set -euo pipefail

source_dir=$(cd "$(dirname "$0")/../.." && pwd)
marker='# mindroom-client upstream-overlap pre-push hook'
corpus=''
clones=()
while [ $# -gt 0 ]; do
  case "$1" in
    --corpus)
      corpus=${2:?--corpus needs a path}
      shift 2
      ;;
    *)
      clones+=("$1")
      shift
      ;;
  esac
done
if [ -z "$corpus" ]; then
  echo "usage: $0 --corpus <upstream clone> [<clone>...]" >&2
  exit 2
fi
if [ ! -d "$corpus" ]; then
  echo "install-hooks: corpus $corpus is not a directory" >&2
  exit 1
fi
corpus=$(cd "$corpus" && pwd)
[ ${#clones[@]} -gt 0 ] || clones=("$source_dir")

# Copy through a temporary file, so that a push running meanwhile reads the old file or the new one.
put() {
  cp "$1" "$2.tmp.$$"
  chmod "$3" "$2.tmp.$$"
  mv -f "$2.tmp.$$" "$2"
}

for clone in "${clones[@]}"; do
  if [ -n "$(git -C "$clone" config core.hooksPath || true)" ]; then
    echo "install-hooks: $clone sets core.hooksPath ($(git -C "$clone" config core.hooksPath)), so git reads" \
      "hooks there; add scripts/git-hooks/pre-push to that directory by hand or unset it. Not installed." >&2
    exit 1
  fi
  hooks=$(git -C "$clone" rev-parse --path-format=absolute --git-path hooks)
  mkdir -p "$hooks/upstream-overlap"
  if { [ -e "$hooks/pre-push" ] || [ -L "$hooks/pre-push" ]; } && ! grep -qF "$marker" "$hooks/pre-push" 2>/dev/null; then
    if [ -e "$hooks/pre-push.local" ] || [ -L "$hooks/pre-push.local" ]; then
      echo "install-hooks: $hooks has a pre-push hook and a pre-push.local already; merge them by hand." >&2
      exit 1
    fi
    mv "$hooks/pre-push" "$hooks/pre-push.local"
    echo "install-hooks: kept the existing pre-push hook as $hooks/pre-push.local (it runs first)"
  fi
  put "$source_dir/scripts/upstream-overlap/check.py" "$hooks/upstream-overlap/check.py" 0755
  printf '%s\n' "$corpus" >"$hooks/upstream-overlap/corpus.tmp.$$"
  mv -f "$hooks/upstream-overlap/corpus.tmp.$$" "$hooks/upstream-overlap/corpus"
  put "$source_dir/scripts/git-hooks/pre-push" "$hooks/pre-push" 0755
  echo "install-hooks: $hooks/pre-push installed (corpus $corpus)"
done
