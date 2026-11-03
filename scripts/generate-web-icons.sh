#!/usr/bin/env bash
# Generates the web app icons from the MindRoom branding in public/res/branding/:
#
#   public/favicon.ico                         16, 32 and 48 px, the M on transparency
#   public/res/icons/apple-touch-icon.png      180 px opaque tile (iOS rounds the corners)
#   public/res/icons/mindroom-{192,512}.png    web app manifest, purpose "any": rounded tile
#   public/res/icons/mindroom-maskable-{192,512}.png
#                                              purpose "maskable": full-bleed background with
#                                              the M inside the central safe circle
#
# The output carries no timestamps, so running it again on unchanged branding changes nothing.
# Requires ImageMagick 7 (`magick`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANDING="$ROOT/public/res/branding"
ICONS="$ROOT/public/res/icons"

# The App Store tile: the M on its teal-to-navy gradient, 1024 px, no alpha.
TILE="$BRANDING/mindroom-logo-square.png"
# The M alone on transparency, 690 x 676 px.
MARK="$BRANDING/mindroom-logo.png"
# The M alone on transparency, 128 px.
SMALL_MARK="$BRANDING/mindroom-favicon.png"

# The tile's gradient, sampled at its top and bottom edges, and the glow behind the cube.
TILE_TOP='#437985'
TILE_BOTTOM='#12364E'
GLOW='#FFF1B4'

for source in "$TILE" "$MARK" "$SMALL_MARK"; do
  if [[ ! -f "$source" ]]; then
    echo "Missing branding source: $source" >&2
    exit 1
  fi
done

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (magick not found)." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$ICONS"

# Writes PNG output without metadata or timestamps. Usage: write_png <format:path> <magick args>
write_png() {
  local target="$1"
  shift
  magick "$@" -strip -define png:exclude-chunks=date,time,tIME "$target"
}

# The tile with rounded corners inside transparent padding, after the macOS icon grid: an
# 824 px body with 185 px corners on a 1024 px canvas.
magick "$TILE" -resize 824x824 -alpha set \
  \( -size 824x824 xc:none -fill white -draw 'roundrectangle 0,0 823,823 185,185' \) \
  -compose DstIn -composite \
  -compose Over -background none -gravity center -extent 1024x1024 "PNG32:$WORK/rounded.png"

# Full bleed for launchers that cut their own shape: the tile's gradient and glow, and the M
# at 60% of the width. The M's farthest pixel then sits 38% of the width from the centre,
# inside the 40% safe circle that every mask keeps.
magick -size 1024x1024 "gradient:$TILE_TOP-$TILE_BOTTOM" \
  \( -size 900x900 "radial-gradient:${GLOW}4D-${GLOW}00" \) \
  -gravity center -geometry +0-90 -compose Over -composite \
  \( "$MARK" -resize 614x \) -gravity center -geometry +0+0 -composite \
  -alpha off "PNG24:$WORK/maskable.png"

for size in 192 512; do
  write_png "PNG32:$ICONS/mindroom-$size.png" "$WORK/rounded.png" -resize "${size}x${size}"
  write_png "PNG24:$ICONS/mindroom-maskable-$size.png" "$WORK/maskable.png" \
    -resize "${size}x${size}"
done

write_png "PNG24:$ICONS/apple-touch-icon.png" "$TILE" -resize 180x180 -alpha off

# One image per size in the .ico, so browsers need not scale a large one down.
for size in 16 32 48; do
  write_png "PNG32:$WORK/favicon-$size.png" "$SMALL_MARK" -resize "${size}x${size}" \
    -background none -gravity center -extent "${size}x${size}"
done
magick "$WORK/favicon-16.png" "$WORK/favicon-32.png" "$WORK/favicon-48.png" \
  "$ROOT/public/favicon.ico"

echo "Generated web icons in $ICONS and public/favicon.ico"
