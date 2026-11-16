#!/bin/bash
set -euo pipefail

# Other schemes/platforms, including the pending iOS/Watch workflow, keep their existing path.
if [[ "${CI_PRODUCT_PLATFORM:-}" != macOS || "${CI_XCODE_SCHEME:-}" != AppStoreMac || "${CI_XCODEBUILD_ACTION:-}" != archive ]]; then
  exit 0
fi
if [[ "${CI_XCODEBUILD_EXIT_CODE:-0}" != 0 ]]; then
  exit 0
fi
: "${CI_ARCHIVE_PATH:?CI_ARCHIVE_PATH is required for the Mac Store archive check}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$SCRIPT_DIR/ci_common.sh"
init_homebrew
cd "$REPO_ROOT"

# Exported Store distribution signing is checked separately on the exported .app. The archive
# check here proves metadata, source identity, architectures and native bundle placement.
node --input-type=module <<'NODE'
  import fs from 'node:fs';
  import { execFileSync } from 'node:child_process';
  import { getSingleAppTargetBuildSettingValue } from './scripts/ios-xcode-project.mjs';
  import { inspectMacStoreArtifact } from './scripts/macos-store-preflight.mjs';

  const project = fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  const result = inspectMacStoreArtifact({
    artifact: process.env.CI_ARCHIVE_PATH,
    version: getSingleAppTargetBuildSettingValue(project, 'MARKETING_VERSION', 'AppStoreMac'),
    build: getSingleAppTargetBuildSettingValue(project, 'CURRENT_PROJECT_VERSION', 'AppStoreMac'),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    structureOnly: true,
  });
  if (result.problems.length) throw new Error(result.problems.join('\n'));
  console.log(JSON.stringify({ ...result, status: 'Mac archive structure passed; exported Store signing still requires validation' }));
NODE
