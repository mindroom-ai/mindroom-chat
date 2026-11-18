#!/usr/bin/env bash
# Build phase of target App: writes the updater's keys into the built Mac app's Info.plist (which
# the Store app and iOS share, so they cannot live there). Only a Mac Catalyst build that has the
# build setting MINDROOM_UPDATE_FEED_URL (App's Release configuration) gets them; any other build
# carries the updater bundle but never starts it, so a local build never replaces itself with the
# release.
set -euo pipefail

if [[ "${IS_MACCATALYST:-}" != YES || -z "${MINDROOM_UPDATE_FEED_URL:-}" ]]; then
  exit 0
fi
key=${MINDROOM_UPDATE_PUBLIC_KEY:-}
# Until the real key replaces the placeholder in the project, no updater ships: without
# SUPublicEDKey a release's appcast gets no signature, and scripts/macos-appcast.sh refuses it.
if [[ "$key" == PLACEHOLDER* ]]; then
  echo "warning: MINDROOM_UPDATE_PUBLIC_KEY is still the placeholder: this app gets no updater keys."
  exit 0
fi
if [[ ! "$key" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
  echo "error: MINDROOM_UPDATE_PUBLIC_KEY must be Sparkle's 44-character base64 EdDSA public key." >&2
  exit 1
fi
plist="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
plutil -replace SUFeedURL -string "$MINDROOM_UPDATE_FEED_URL" "$plist"
plutil -replace SUPublicEDKey -string "$key" "$plist"
plutil -replace SUEnableAutomaticChecks -bool YES "$plist"
plutil -replace SUAutomaticallyUpdate -bool YES "$plist"
plutil -replace SUScheduledCheckInterval -integer 3600 "$plist"
plutil -replace SUVerifyUpdateBeforeExtraction -bool YES "$plist"
