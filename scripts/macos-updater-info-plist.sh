#!/usr/bin/env bash
# Build phase of target App: writes the updater's keys into the built Mac app's Info.plist (which
# the Store app and iOS share, so they cannot live there). Only a Mac Catalyst build that has the
# build setting MINDROOM_UPDATE_FEED_URL (App's Release configuration) gets them; any other build
# carries the updater bundle but never starts it, so a local build never replaces itself with the
# release.
set -euo pipefail

[[ "${IS_MACCATALYST:-}" == YES ]] || exit 0
plist="$TARGET_BUILD_DIR/$INFOPLIST_PATH"
key=${MINDROOM_UPDATE_PUBLIC_KEY:-}
# Without the feed, or until the real key replaces the placeholder in the project, no updater
# starts: Xcode may reuse a plist an earlier build wrote the keys into, so they are removed. A
# signed release then fails at its appcast (no SUPublicEDKey, no signature).
if [[ -z "${MINDROOM_UPDATE_FEED_URL:-}" || "$key" == PLACEHOLDER* ]]; then
  for name in SUFeedURL SUPublicEDKey SUEnableAutomaticChecks SUAutomaticallyUpdate \
    SUScheduledCheckInterval SUVerifyUpdateBeforeExtraction; do
    plutil -remove "$name" "$plist" 2> /dev/null || true
  done
  exit 0
fi
if [[ ! "$key" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
  echo "error: MINDROOM_UPDATE_PUBLIC_KEY must be Sparkle's 44-character base64 EdDSA public key." >&2
  exit 1
fi
plutil -replace SUFeedURL -string "$MINDROOM_UPDATE_FEED_URL" "$plist"
plutil -replace SUPublicEDKey -string "$key" "$plist"
plutil -replace SUEnableAutomaticChecks -bool YES "$plist"
plutil -replace SUAutomaticallyUpdate -bool YES "$plist"
plutil -replace SUScheduledCheckInterval -integer 3600 "$plist"
plutil -replace SUVerifyUpdateBeforeExtraction -bool YES "$plist"
