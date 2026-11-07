# Sourced by the e2e scripts, which keep their snapshots, builds, logs, state and locks in fixed
# directories outside $TMPDIR. `private_dir <dir>` creates <dir> owner-only when it is missing,
# with any missing parents owner-only too, and stops the script, leaving <dir> untouched, when it
# is a symlink, belongs to another user or others may write to it. scripts/agent-stack/stack.py
# checks its root the same way.
private_dir() {
  # Without its trailing slashes: with them, find would look through a symlink.
  set -- "${1%"${1##*[!/]}"}"
  [ -L "$1" ] || (umask 077 && mkdir -p "$1") || exit 1
  # One find, so that one lstat answers every test: a directory (not a symlink) of this user that
  # neither its group nor others may write to.
  if [ -z "$(find "$1" -maxdepth 0 -type d -user "$(id -u)" ! -perm -020 ! -perm -002)" ]; then
    echo "$(basename "$0"): refusing $1: it must be a directory (not a symlink) of the current user that no one else may write to" >&2
    exit 1
  fi
}
