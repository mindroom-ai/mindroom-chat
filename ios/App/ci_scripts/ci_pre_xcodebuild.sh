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

PACKAGE_VERSION="$(node -p "require('./package.json').version")"

if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
  MARKETING_VERSION="$PACKAGE_VERSION" CURRENT_PROJECT_VERSION="$CI_BUILD_NUMBER" node <<'NODE'
    const fs = require('fs');
    const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
    const marketingVersion = process.env.MARKETING_VERSION;
    const buildNumber = process.env.CURRENT_PROJECT_VERSION;
    const original = fs.readFileSync(projectPath, 'utf8');
    // The App target has Debug and Release build settings.
    const appBuildConfigurationCount = 2;

    const replaceExpectedOccurrences = (text, pattern, replacement, expectedCount) => {
      const matches = text.match(pattern) ?? [];
      if (matches.length !== expectedCount) {
        throw new Error(
          `Expected ${expectedCount} occurrences of ${pattern}, found ${matches.length}.`
        );
      }
      return text.replace(pattern, replacement);
    };

    let updated = replaceExpectedOccurrences(
      original,
      /MARKETING_VERSION = [^;]+;/g,
      'MARKETING_VERSION = ' + marketingVersion + ';',
      appBuildConfigurationCount
    );
    updated = replaceExpectedOccurrences(
      updated,
      /CURRENT_PROJECT_VERSION = [^;]+;/g,
      'CURRENT_PROJECT_VERSION = ' + buildNumber + ';',
      appBuildConfigurationCount
    );

    fs.writeFileSync(projectPath, updated);
NODE
fi

npm run build
npx cap sync ios
npm run appstore:preflight
