#!/usr/bin/env bash
# Runs a command on a host where /bin/bash and the coreutils under /usr/bin exist.
#
# Some ported tests run shell scripts with PATH=<stub dir>:/usr/bin:/bin and stubs that start
# with `#!/bin/bash`, as on macOS (Xcode Cloud) and most Linux distributions. NixOS has neither
# path, so there the command runs in a private mount namespace in which /bin and /usr/bin are
# small tmpfs directories of symlinks into the Nix store. Elsewhere the command runs as is.
#
# Usage: scripts/with-fhs-bin.sh <command> [args...]
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

if [[ -x /bin/bash && -x /usr/bin/wc ]] || [[ -n "${MINDROOM_FHS_BIN:-}" ]]; then
  exec "$@"
fi

if ! command -v unshare >/dev/null 2>&1; then
  echo "with-fhs-bin: /bin/bash or /usr/bin/wc is missing and unshare is not available; running without them." >&2
  exec "$@"
fi

# Every program to expose, as `name=target` lines: what /bin and /usr/bin hold now, then bash,
# sed, grep and the whole coreutils package from PATH.
link_list() {
  local entry name
  for entry in /bin/* /usr/bin/*; do
    [[ -e "$entry" ]] || continue
    printf '%s=%s\n' "${entry##*/}" "$(readlink -f "$entry")"
  done
  for name in bash sed grep; do
    if command -v "$name" >/dev/null 2>&1; then
      printf '%s=%s\n' "$name" "$(readlink -f "$(command -v "$name")")"
    fi
  done
  local coreutils_bin
  coreutils_bin="$(dirname "$(readlink -f "$(command -v wc)")")"
  for entry in "$coreutils_bin"/*; do
    printf '%s=%s\n' "${entry##*/}" "$entry"
  done
}

links="$(link_list)"
real_uid="$(id -u)"
real_gid="$(id -g)"

# The outer namespace maps the caller to root so it may mount; the inner one maps root back to
# the caller's own IDs, so the command runs without extra capabilities.
# shellcheck disable=SC2016 # expanded by the inner shell
exec unshare --user --map-root-user --mount -- bash -c '
  set -euo pipefail
  links="$1"
  real_uid="$2"
  real_gid="$3"
  shift 3
  for dir in /bin /usr/bin; do
    mount -t tmpfs -o mode=0755 mindroom-fhs-bin "$dir"
    while IFS="=" read -r name target; do
      [[ -n "$name" && ! -e "$dir/$name" ]] && ln -s "$target" "$dir/$name"
    done <<<"$links"
  done
  exec unshare --user --map-user="$real_uid" --map-group="$real_gid" -- \
    env MINDROOM_FHS_BIN=1 "$@"
' with-fhs-bin "$links" "$real_uid" "$real_gid" "$@"
