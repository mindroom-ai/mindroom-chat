# Every recipe expects the `nix develop` shell (Node 22, npm, Chromium, Python 3, just).

default:
    @just --list

# Install the locked dependencies.
install:
    npm ci

# Type-check the app sources (tsconfig.app.json: src without tests). The gate `just check` uses; must report 0 errors.
typecheck:
    npx tsc --noEmit -p tsconfig.app.json

# Type-check everything, tests and e2e included (tsconfig.json). Reports the errors without failing; docs/provenance/m1-baseline.txt records the count.
typecheck-tests:
    #!/usr/bin/env bash
    set -uo pipefail
    output=$(npx tsc --noEmit -p . --pretty false)
    if [ -n "$output" ]; then printf '%s\n' "$output"; fi
    echo "typecheck-tests: $(grep -c 'error TS' <<<"$output") errors (reported, not enforced)"

# Type-check and report syntax and semantic errors together.
typecheck-all:
    node scripts/typecheck-all.mjs

# Run the unit tests.
test *args:
    npx vitest run {{args}}

# Lint with ESLint.
lint:
    npm run lint

# Format files you wrote with Prettier. Never run it on a Lane P file: it rewrites lines the Lane P rules do not allow you to change.
format *paths:
    npx prettier --write {{paths}}

# Vite dev server on http://127.0.0.1:4200 (extra arguments go to Vite, for example --host).
dev *args:
    npx vite {{args}}

# Production build into dist/.
build:
    npx vite build

# Everything CI runs.
check: typecheck lint test license-check verify-ported check-holes

# Fail when an installed package has a license outside the allowlist (also runs the script's own tests).
license-check:
    node --test scripts/license-check.test.mjs
    node scripts/license-check.mjs node_modules

# Recompute the Lane P import from a MindRoom Chat checkout and compare it with the import commit; skipped without a path.
verify-ported *checkout:
    bash scripts/verify-ported.sh {{checkout}}

# Lane P files may differ from each import only in their blanked lines. Later Lane P edits are allowed, so each wave is checked at the commit that filled its blanks, not the working tree.
check-holes:
    python3 scripts/check_holes.py --wave 1 --rev f824c82
    python3 scripts/check_holes.py --wave 2 --rev 2717365

# Compare Lane C code with each corpus directory given; writes docs/provenance/audit/<date>/.
similarity-audit *corpora:
    bash scripts/similarity-audit.sh {{corpora}}

# Start the disposable Tuwunel test homeserver (server name matrix.localhost) on http://127.0.0.1:28008 and wait until it is healthy.
hs-up:
    docker compose -f e2e/docker-compose.yaml up -d --wait

# Stop the test homeserver and delete its data.
hs-down:
    docker compose -f e2e/docker-compose.yaml down --volumes --remove-orphans

# Run Playwright (Chromium from CHROMIUM_PATH) against the dev server on port 4200, which Playwright starts when nothing listens there. Pass a spec path or any Playwright option, for example `just e2e --list`. Run `just hs-up` first for specs that need the homeserver.
e2e *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # Some specs launch their own browser from this variable.
    if [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ] && [ -n "${CHROMIUM_PATH:-}" ]; then
      export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$CHROMIUM_PATH"
    fi
    exec npx playwright test {{args}}
