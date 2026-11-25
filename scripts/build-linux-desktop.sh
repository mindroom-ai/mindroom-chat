#!/usr/bin/env bash
# Build and fail-closed verify the Linux Electron desktop packages (AppImage and .deb).
set -euo pipefail

die() { echo "$*" >&2; exit 1; }
usage() {
  echo "usage: $0 --arch <x64|arm64> [--skip-web-build] [--verify-only <appimage> <blockmap> <deb>]" >&2
  exit 2
}

scratch=""
cleanup() { if [[ -n "$scratch" ]]; then rm -rf "$scratch"; fi; }
trap cleanup EXIT

require_files() {
  local f
  for f in "$@"; do
    [[ -s "$f" ]] || die "Missing or empty artifact: $f"
  done
}

abs_path() {
  local dir
  dir=$(cd "$(dirname "$1")"; pwd)
  printf '%s/%s\n' "$dir" "$(basename "$1")"
}

check_no_macos_artifacts() {
  local label="$1" listing="$2" forbidden
  for forbidden in "mindroom-screenshot-helper" "mindroom-trackpad-swipe.node" "MindRoom Desktop Helper.app"; do
    if grep -Fq "$forbidden" <<<"$listing"; then
      die "$label must not contain macOS artifact '$forbidden'"
    fi
  done
}

host_matches_arch() {
  local host_arch
  host_arch=$(uname -m)
  case "$1" in
    x64) [[ "$host_arch" == "x86_64" ]] ;;
    arm64) [[ "$host_arch" == "aarch64" || "$host_arch" == "arm64" ]] ;;
    *) return 1 ;;
  esac
}

smoke_launch() {
  local extracted_bin="$1" target_arch="$2" require_smoke="${MINDROOM_LINUX_REQUIRE_SMOKE:-0}"
  local host_arch smoke_home smoke_log smoke_rc

  if ! host_matches_arch "$target_arch"; then
    host_arch=$(uname -m)
    [[ "$require_smoke" != "1" ]] || die "Smoke launch required but host arch '$host_arch' != --arch '$target_arch'"
    echo "Skipping packaged smoke launch: host arch '$host_arch' != --arch '$target_arch'"
    return 0
  fi
  if ! command -v xvfb-run >/dev/null 2>&1; then
    [[ "$require_smoke" != "1" ]] || die "xvfb-run is required when MINDROOM_LINUX_REQUIRE_SMOKE=1"
    echo "Skipping packaged smoke launch: xvfb-run not found"
    return 0
  fi

  smoke_home="$scratch/smoke-home"
  smoke_log="$scratch/smoke.log"
  mkdir -p "$smoke_home/.config" "$smoke_home/.cache" "$smoke_home/.local/share" "$smoke_home/runtime"
  chmod 700 "$smoke_home/runtime"

  set +e
  APPIMAGE="" HOME="$smoke_home" XDG_CONFIG_HOME="$smoke_home/.config" \
    XDG_CACHE_HOME="$smoke_home/.cache" XDG_DATA_HOME="$smoke_home/.local/share" \
    XDG_RUNTIME_DIR="$smoke_home/runtime" \
    xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
    timeout -k 5 -s TERM 6 "$extracted_bin" --no-sandbox --disable-gpu --password-store=basic \
    >"$smoke_log" 2>&1
  smoke_rc=$?
  set -e

  if [[ "$smoke_rc" -ne 124 ]]; then
    cat "$smoke_log" >&2
    die "Packaged Linux smoke launch failed (expected timeout exit 124, got $smoke_rc)"
  fi
  if grep -Eqi 'A JavaScript error occurred in the main process|Asar integrity|Failed to load app\.asar|Cannot find module|No web bundle at' "$smoke_log"; then
    cat "$smoke_log" >&2
    die "Packaged Linux smoke launch reported a fatal startup error"
  fi
  if [[ ! -d "$smoke_home/.config/MindRoom Chat" ]]; then
    cat "$smoke_log" >&2
    die "Packaged Linux smoke launch did not initialize userData directory"
  fi
}

verify_linux_artifacts() {
  local appimage="$1" blockmap="$2" deb="$3"
  local appimage_abs deb_abs deb_info deb_listing deb_extract desktop_file
  local deb_asar deb_resources pkg_type appimage_work appimage_exec squashfs_root

  require_files "$appimage" "$blockmap" "$deb"
  command -v dpkg-deb >/dev/null 2>&1 || die "dpkg-deb is required to verify Linux .deb packages"
  appimage_abs=$(abs_path "$appimage")
  deb_abs=$(abs_path "$deb")
  scratch=$(umask 077; mktemp -d "${TMPDIR:-/tmp}/mindroom-linux-verify.XXXXXX")

  deb_info=$(dpkg-deb -I "$deb_abs")
  grep -Eq "^[[:space:]]*Architecture:[[:space:]]*${deb_arch}$" <<<"$deb_info" \
    || die ".deb Architecture does not match ${deb_arch}: $deb"
  grep -Eq '^[[:space:]]*Homepage:[[:space:]]*https://github\.com/mindroom-ai/mindroom-chat$' <<<"$deb_info" \
    || die ".deb is missing expected Homepage metadata: $deb"

  deb_listing=$(dpkg-deb -c "$deb_abs")
  check_no_macos_artifacts ".deb ($deb)" "$deb_listing"

  deb_extract="$scratch/deb"
  mkdir -p "$deb_extract"
  dpkg-deb -x "$deb_abs" "$deb_extract"

  desktop_file="$deb_extract/usr/share/applications/mindroom-chat.desktop"
  [[ -s "$desktop_file" ]] || die ".deb is missing usr/share/applications/mindroom-chat.desktop: $deb"
  grep -Fqx 'StartupWMClass=mindroom-chat' "$desktop_file" \
    || die ".deb desktop entry is missing StartupWMClass=mindroom-chat: $deb"
  grep -Fqx 'Name=MindRoom Chat' "$desktop_file" \
    || die ".deb desktop entry is missing Name=MindRoom Chat: $deb"

  deb_asar=$(find "$deb_extract" -type f -path '*/resources/app.asar')
  [[ -n "$deb_asar" && -s "$deb_asar" ]] || die ".deb is missing resources/app.asar: $deb"
  deb_resources=$(dirname "$deb_asar")
  [[ -f "$deb_resources/package-type" ]] || die ".deb is missing resources/package-type: $deb"
  pkg_type=$(tr -d '[:space:]' < "$deb_resources/package-type")
  [[ "$pkg_type" == "deb" ]] || die ".deb resources/package-type expected 'deb', got '$pkg_type': $deb"
  [[ -s "$deb_resources/apparmor-profile" ]] || die ".deb is missing resources/apparmor-profile: $deb"

  appimage_work="$scratch/appimage"
  mkdir -p "$appimage_work"
  appimage_exec="$appimage_abs"
  if [[ ! -x "$appimage_exec" ]]; then
    appimage_exec="$scratch/MindRoom-Chat.AppImage"
    cp "$appimage_abs" "$appimage_exec"
    chmod 755 "$appimage_exec"
  fi
  (
    cd "$appimage_work"
    "$appimage_exec" --appimage-extract >/dev/null
  )

  squashfs_root="$appimage_work/squashfs-root"
  [[ -d "$squashfs_root" ]] || die "AppImage extraction did not produce squashfs-root: $appimage"
  [[ -s "$squashfs_root/resources/app.asar" ]] || die "AppImage is missing resources/app.asar: $appimage"
  [[ -s "$squashfs_root/resources/app-update.yml" ]] || die "AppImage is missing resources/app-update.yml: $appimage"
  grep -Fq 'releases/download/linux-feed' "$squashfs_root/resources/app-update.yml" \
    || die "AppImage resources/app-update.yml does not point to linux-feed: $appimage"
  if grep -Fq 'releases/download/mac-feed' "$squashfs_root/resources/app-update.yml"; then
    die "AppImage resources/app-update.yml must not point to mac-feed: $appimage"
  fi
  if [[ -e "$squashfs_root/resources/package-type" || -L "$squashfs_root/resources/package-type" ]]; then
    die "AppImage must not contain resources/package-type: $appimage"
  fi

  check_no_macos_artifacts "AppImage ($appimage)" "$(find "$squashfs_root" -mindepth 1)"
  [[ -x "$squashfs_root/mindroom-chat" ]] || die "Extracted AppImage is missing executable mindroom-chat: $appimage"
  smoke_launch "$squashfs_root/mindroom-chat" "$arch"
}

arch=""
skip_web_build=0
verify_only=0
verify_appimage=""
verify_blockmap=""
verify_deb=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) [[ $# -ge 2 ]] || usage; arch="$2"; shift 2 ;;
    --skip-web-build) skip_web_build=1; shift ;;
    --verify-only)
      [[ $# -ge 4 ]] || usage
      verify_only=1; verify_appimage="$2"; verify_blockmap="$3"; verify_deb="$4"
      shift 4 ;;
    *) usage ;;
  esac
done

case "$arch" in
  x64) appimage_arch="x86_64"; deb_arch="amd64" ;;
  arm64) appimage_arch="arm64"; deb_arch="arm64" ;;
  *) usage ;;
esac

if [[ -n "${MARKETING_VERSION:-}" ]]; then
  [[ "$MARKETING_VERSION" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.(0|[1-9][0-9]*)$ ]] \
    || die "Invalid MARKETING_VERSION '$MARKETING_VERSION': expected YYYY.M.N without leading 'v'."
fi

if [[ "$verify_only" -eq 1 ]]; then
  verify_linux_artifacts "$verify_appimage" "$verify_blockmap" "$verify_deb"
  echo "Verified Linux desktop artifacts ($arch)"
  exit 0
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
out_dir="build/desktop-dist"
rm -rf "$out_dir"
if [[ "$skip_web_build" -eq 0 ]]; then
  npm run build:desktop
fi

CSC_IDENTITY_AUTO_DISCOVERY=false MINDROOM_DESKTOP_SIGN=0 \
  npx electron-builder --linux AppImage deb "--${arch}" \
  --config electron/builder.config.cjs --publish never

appimage_path="$out_dir/MindRoom-Chat-${appimage_arch}.AppImage"
verify_linux_artifacts "$appimage_path" "${appimage_path}.blockmap" "$out_dir/MindRoom-Chat-${deb_arch}.deb"
echo "Verified Linux desktop artifacts ($arch): $out_dir"
