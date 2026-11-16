#!/bin/bash
set -euo pipefail

if [[ "${CI_XCODE_SCHEME:-}" == AppStoreMac && "${CI_PRODUCT_PLATFORM:-}" != macOS ]]; then
  echo 'Error: AppStoreMac requires CI_PRODUCT_PLATFORM=macOS.' >&2
  exit 1
fi

# Other schemes/platforms, including the pending iOS/Watch workflow, keep their existing path.
if [[ "${CI_PRODUCT_PLATFORM:-}" != macOS || "${CI_XCODE_SCHEME:-}" != AppStoreMac || "${CI_XCODEBUILD_ACTION:-}" != archive ]]; then
  exit 0
fi
if [[ "${CI_XCODEBUILD_EXIT_CODE:-0}" != 0 ]]; then
  exit 0
fi
: "${CI_ARCHIVE_PATH:?CI_ARCHIVE_PATH is required for the Mac Store archive check}"
: "${CI_APP_STORE_SIGNED_APP_PATH:?CI_APP_STORE_SIGNED_APP_PATH is required before Store distribution}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
source "$SCRIPT_DIR/ci_common.sh"
init_homebrew
cd "$REPO_ROOT"

# Require the actual Store-signed export before the distribution post-action.
node --input-type=module <<'NODE'
  import { execFileSync } from 'node:child_process';
  import { inspectMacStoreArtifact, inspectMacStoreExport } from './scripts/macos-store-preflight.mjs';

  const metadata = Object.fromEntries(
    execFileSync(process.execPath, ['scripts/ios-ci-version.mjs'], { encoding: 'utf8' })
      .trim().split('\n').map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
  const expected = {
    version: metadata.marketing_version,
    build: metadata.build_number,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  };
  const archive = inspectMacStoreArtifact({
    ...expected, artifact: process.env.CI_ARCHIVE_PATH, structureOnly: true,
  });
  if (archive.problems.length) throw new Error(archive.problems.join('\n'));
  const result = inspectMacStoreExport({
    ...expected, artifact: process.env.CI_APP_STORE_SIGNED_APP_PATH, structureOnly: false,
  });
  if (result.problems.length) throw new Error(result.problems.join('\n'));
  console.log(JSON.stringify({ ...result, status: 'Mac archive and Store-signed export checks passed; Apple validation still required' }));
NODE
