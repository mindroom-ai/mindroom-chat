#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

cd "$REPO_ROOT"

PACKAGE_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"

if [[ -n "${CI_BUILD_NUMBER:-}" ]]; then
  node -e "
    const fs = require('fs');
    const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
    const marketingVersion = process.argv[1];
    const buildNumber = process.argv[2];
    const original = fs.readFileSync(projectPath, 'utf8');
    const updated = original
      .replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + marketingVersion + ';')
      .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = ' + buildNumber + ';');
    fs.writeFileSync(projectPath, updated);
  " "$PACKAGE_VERSION" "$CI_BUILD_NUMBER"
fi

npm run build
npx cap sync ios
npm run appstore:preflight
