#!/usr/bin/env bash
# Generates the Android launcher icons and launch screens from the MindRoom branding in
# public/res/branding/, in android/app/src/main/res/:
#
#   mipmap-*/ic_launcher_foreground.png  adaptive icon foreground (108 dp): the M and the glow
#                                        behind it on transparency, inside the 66 dp safe circle;
#                                        the background layer is @color/ic_launcher_background
#   mipmap-*/ic_launcher.png             legacy icon (Android 7): the adaptive icon's visible
#                                        72 dp as a 38 dp rounded square on a 48 dp canvas
#   mipmap-*/ic_launcher_round.png       legacy round icon: the same as a 44 dp circle
#   drawable*/splash.png                 launch screen: the M centred on the app's default
#                                        background (capacitor.config.ts), 28% of the shorter side
#
# The output carries no metadata or timestamps, so running it again changes nothing.
# Requires ImageMagick 7 (`magick`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
# The M alone on transparency, 690 x 676 px.
MARK="$ROOT/public/res/branding/mindroom-logo.png"

# The App Store tile's colour halfway down (mindroom-logo-square.png). The adaptive icon's
# background layer, values/ic_launcher_background.xml, must name the same colour.
ICON_BACKGROUND='#2B596B'
# The glow behind the cube, as on the tile (scripts/generate-web-icons.sh).
GLOW='#FFF1B4'
# The app's default background, which the status bar also starts with (capacitor.config.ts).
SPLASH_BACKGROUND='#1A1A1A'

if [[ ! -f "$MARK" ]]; then
  echo "Missing branding source: $MARK" >&2
  exit 1
fi
if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (magick not found)." >&2
  exit 1
fi
if ! grep -qi "$ICON_BACKGROUND" "$RES/values/ic_launcher_background.xml"; then
  echo "values/ic_launcher_background.xml does not name $ICON_BACKGROUND" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Writes PNG output without metadata or timestamps. Usage: write_png <format:path> <magick args>
write_png() {
  local target="$1"
  shift
  magick "$@" -strip -define png:exclude-chunks=date,time,tIME "$target"
}

# The adaptive icon at 432 px (108 dp at xxxhdpi). The M is 42% of the canvas wide, so its
# farthest pixel (63% of its width from its centre) stays 27% of the canvas from the centre,
# inside the safe circle (33 of 108 dp, 31%). The glow is 1.47 times the M's width and sits
# 0.15 of that width higher, the proportions of the tile.
FULL=432
mark=$((FULL * 42 / 100))
glow=$((mark * 147 / 100))
lift=$((mark * 15 / 100))
magick -size "${FULL}x${FULL}" xc:none \
  \( -size "${glow}x${glow}" "radial-gradient:${GLOW}4D-${GLOW}00" \) \
  -gravity center -geometry "+0-$lift" -compose Over -composite \
  \( "$MARK" -resize "${mark}x" \) -gravity center -geometry +0+0 -composite \
  "PNG32:$WORK/foreground.png"

# What a launcher shows of the adaptive icon: its middle 72 dp on the background colour.
visible=$((FULL * 72 / 108))
magick -size "${FULL}x${FULL}" "xc:$ICON_BACKGROUND" "$WORK/foreground.png" -composite \
  -gravity center -crop "${visible}x${visible}+0+0" +repage "PNG24:$WORK/visible.png"
radius=$((visible * 6 / 100))
magick "$WORK/visible.png" -alpha set \
  \( -size "${visible}x${visible}" xc:none -fill white \
  -draw "roundrectangle 0,0 $((visible - 1)),$((visible - 1)) $radius,$radius" \) \
  -compose DstIn -composite "PNG32:$WORK/square.png"
magick "$WORK/visible.png" -alpha set \
  \( -size "${visible}x${visible}" xc:none -fill white \
  -draw "circle $((visible / 2)),$((visible / 2)) $((visible / 2)),0" \) \
  -compose DstIn -composite "PNG32:$WORK/round.png"

# density:legacy icon size in px (48 dp); the adaptive foreground is 108 dp, 2.25 times that.
for entry in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  density="${entry%%:*}"
  size="${entry##*:}"
  dir="$RES/mipmap-$density"
  write_png "PNG32:$dir/ic_launcher_foreground.png" "$WORK/foreground.png" \
    -resize "$((size * 9 / 4))x$((size * 9 / 4))"
  write_png "PNG32:$dir/ic_launcher.png" "$WORK/square.png" -resize "$((size * 38 / 48))x" \
    -background none -gravity center -extent "${size}x${size}"
  write_png "PNG32:$dir/ic_launcher_round.png" "$WORK/round.png" -resize "$((size * 44 / 48))x" \
    -background none -gravity center -extent "${size}x${size}"
done

# drawable directory:width x height in px.
for entry in drawable:480x320 \
  drawable-land-mdpi:480x320 drawable-land-hdpi:800x480 drawable-land-xhdpi:1280x720 \
  drawable-land-xxhdpi:1600x960 drawable-land-xxxhdpi:1920x1280 \
  drawable-port-mdpi:320x480 drawable-port-hdpi:480x800 drawable-port-xhdpi:720x1280 \
  drawable-port-xxhdpi:960x1600 drawable-port-xxxhdpi:1280x1920; do
  dir="${entry%%:*}"
  geometry="${entry##*:}"
  width="${geometry%x*}"
  height="${geometry#*x}"
  shorter=$((width < height ? width : height))
  write_png "PNG24:$RES/$dir/splash.png" -size "$geometry" "xc:$SPLASH_BACKGROUND" \
    \( "$MARK" -resize "$((shorter * 28 / 100))x" \) -gravity center -composite
done

echo "Generated Android launcher icons and launch screens in $RES"
