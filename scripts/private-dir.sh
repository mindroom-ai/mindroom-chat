# Sourced by the e2e scripts, which keep their snapshots, builds, logs, state and locks in fixed
# directories outside $TMPDIR. `private_dir <dir>` creates <dir> owner-only when it is missing,
# and stops the script, leaving <dir> untouched, when it is a symlink, belongs to another user or
# others may write to it. scripts/agent-stack/stack.py checks its root the same way.
private_dir() {
  # Without its trailing slashes: with them, the tests below would look through a symlink.
  set -- "${1%"${1##*[!/]}"}"
  [ -L "$1" ] || mkdir -p -m 700 "$1" || exit 1
  if [ -L "$1" ] || ! [ -O "$1" ] || [ -n "$(find "$1" -maxdepth 0 \( -perm -020 -o -perm -002 \))" ]; then
    echo "$(basename "$0"): refusing $1: it must be a directory (not a symlink) of the current user that no one else may write to" >&2
    exit 1
  fi
}
