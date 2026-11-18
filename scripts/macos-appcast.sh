#!/usr/bin/env bash
# Makes one release's appcast.xml, the Mac app's update feed item, and passes it on only if it is
# that release's signed DMG (docs/ios-release.md "Updates"). Run from the repository root:
#   scripts/macos-appcast.sh <dmg> <download-url-prefix> <version> <appcast-path> < private-key
# Sparkle's generate_appcast reads the item from the app in the DMG and signs the DMG's bytes with
# the EdDSA private key, which comes on standard input only. Without the app's SUPublicEDKey, or
# with a key that is not its pair, the tool only warns and leaves the signature out; so the result
# must have exactly one item, of this version, with one enclosure of this DMG's URL and length and
# a signature. The pinned tool signs only with the pair of the app's key, so no second check.
set -euo pipefail

dmg=$1 prefix=$2 version=$3 appcast=$4
key=$(cat)
if [[ -z "$key" ]]; then
  echo "error: no Sparkle private key on standard input: the appcast cannot be signed." >&2
  exit 1
fi
scripts/fetch-sparkle.sh
folder=$(mktemp -d)
trap 'rm -rf "$folder"' EXIT
# A fresh folder: generate_appcast extends a feed it finds.
mkdir "$folder/in"
cp "$dmg" "$folder/in/"
printf '%s' "$key" | ios/MacUpdater/Sparkle/bin/generate_appcast --ed-key-file - \
  --download-url-prefix "$prefix" -o "$folder/appcast.xml" "$folder/in"
if ! problem=$(python3 - "$folder/appcast.xml" "$prefix" "$version" "$dmg" <<'PY'
import os, sys, xml.etree.ElementTree as ET

feed, prefix, version, dmg = sys.argv[1:]
sparkle = '{http://www.andymatuschak.org/xml-namespaces/sparkle}'

def problem():
    try:
        items = ET.parse(feed).getroot().findall('channel/item')
    except (OSError, ET.ParseError):
        return 'no XML'
    if len(items) != 1:
        return f'{len(items)} items'
    if items[0].findtext(sparkle + 'version') != version:
        return 'another version'
    enclosures = items[0].findall('enclosure')
    if len(enclosures) != 1:
        return f'{len(enclosures)} enclosures'
    enclosure = enclosures[0]
    if enclosure.get('url') != prefix + 'MindRoom.dmg':
        return 'another URL'
    if enclosure.get('length') != str(os.path.getsize(dmg)):
        return 'another length'
    if not enclosure.get(sparkle + 'edSignature'):
        return 'no signature'
    return ''

found = problem()
print(found)
sys.exit(1 if found else 0)
PY
); then
  echo "The appcast is not this release's signed enclosure ($problem): the app has no SUPublicEDKey, the private key is not its pair, or the DMG is another build's." >&2
  exit 1
fi
rm -f "$appcast"
mv "$folder/appcast.xml" "$appcast"
echo "Signed appcast for $version: $appcast"
