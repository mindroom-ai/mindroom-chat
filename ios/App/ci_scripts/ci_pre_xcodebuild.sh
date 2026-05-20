#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$SCRIPT_DIR/ci_common.sh"

init_homebrew

cd "$REPO_ROOT"

for command_name in node npm npx pod; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is not available before xcodebuild." >&2
    echo "ci_post_clone.sh should install dependencies and initialize CocoaPods before this script runs." >&2
    exit 1
  fi
done

resolve_ios_build_number() {
  if [[ -n "${IOS_BUILD_NUMBER:-}" ]]; then
    echo "$IOS_BUILD_NUMBER"
    return 0
  fi

  local candidate
  for candidate in "${CI_TAG:-}" "${GITHUB_REF_NAME:-}" "${RELEASE_TAG:-}" "${GITHUB_REF:-}"; do
    candidate="${candidate#refs/tags/}"
    if [[ "$candidate" =~ -mindroom\.([0-9]+)$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done
}

read_checked_in_build_setting() {
  local setting_name="$1"

  SETTING_NAME="$setting_name" node --input-type=module <<'NODE'
    import fs from 'node:fs';
    import { getSingleAppTargetBuildSettingValue } from './scripts/ios-xcode-project.mjs';

    const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
    const xcodeProject = fs.readFileSync(projectPath, 'utf8');
    process.stdout.write(getSingleAppTargetBuildSettingValue(xcodeProject, process.env.SETTING_NAME));
NODE
}

APPLE_MARKETING_VERSION="${IOS_MARKETING_VERSION:-${APP_STORE_MARKETING_VERSION:-$(read_checked_in_build_setting MARKETING_VERSION)}}"
CURRENT_PROJECT_VERSION="$(resolve_ios_build_number)"
if [[ -z "$CURRENT_PROJECT_VERSION" ]]; then
  CURRENT_PROJECT_VERSION="$(read_checked_in_build_setting CURRENT_PROJECT_VERSION)"
fi

if [[ ! "$APPLE_MARKETING_VERSION" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
  echo "Error: iOS MARKETING_VERSION must use Apple's three-integer format, got '$APPLE_MARKETING_VERSION'." >&2
  exit 1
fi

if [[ -n "$CURRENT_PROJECT_VERSION" && ! "$CURRENT_PROJECT_VERSION" =~ ^[0-9]+$ ]]; then
  echo "Error: iOS CURRENT_PROJECT_VERSION must be an integer build number, got '$CURRENT_PROJECT_VERSION'." >&2
  exit 1
fi

if [[ -n "$CURRENT_PROJECT_VERSION" ]]; then
  echo "Setting iOS MARKETING_VERSION=$APPLE_MARKETING_VERSION CURRENT_PROJECT_VERSION=$CURRENT_PROJECT_VERSION"
  MARKETING_VERSION="$APPLE_MARKETING_VERSION" CURRENT_PROJECT_VERSION="$CURRENT_PROJECT_VERSION" node --input-type=module <<'NODE'
    import fs from 'node:fs';
    import { replaceAppTargetBuildSetting } from './scripts/ios-xcode-project.mjs';

    const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
    const marketingVersion = process.env.MARKETING_VERSION;
    const buildNumber = process.env.CURRENT_PROJECT_VERSION;
    const original = fs.readFileSync(projectPath, 'utf8');
    let updated = replaceAppTargetBuildSetting(original, 'MARKETING_VERSION', marketingVersion);
    updated = replaceAppTargetBuildSetting(updated, 'CURRENT_PROJECT_VERSION', buildNumber);

    fs.writeFileSync(projectPath, updated);
NODE
elif [[ -n "${CI:-}" || -n "${CI_BUILD_NUMBER:-}" || -n "${CI_XCODEBUILD_ACTION:-}" ]]; then
  echo "Error: Could not determine iOS build number from IOS_BUILD_NUMBER, release tag, or the checked-in Xcode project." >&2
  exit 1
fi

npm run build
npx cap sync ios
npm run appstore:preflight
