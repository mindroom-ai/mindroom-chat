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

# Run the unit tests. On NixOS, scripts/with-fhs-bin.sh adds the /bin/bash and /usr/bin tools that tests of the iOS CI scripts expect.
test *args:
    bash scripts/with-fhs-bin.sh npx vitest run {{args}}

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
check: typecheck lint test license-check verify-ported check-holes upstream-overlap

# Fail when an installed package has a license outside the allowlist (also runs the script's own tests).
license-check:
    node --test scripts/license-check.test.mjs
    node scripts/license-check.mjs node_modules

# Recompute the Lane P import from a MindRoom Chat checkout and compare it with the import commit; skipped without a path.
verify-ported *checkout:
    bash scripts/verify-ported.sh {{checkout}}

# Lane P files may differ from each import only in their blanked lines. Later Lane P edits are allowed, so each wave is checked at the commit that filled its blanks, not the working tree.
check-holes:
    python3 scripts/check_holes.py --wave 1 --rev feed1b4
    python3 scripts/check_holes.py --wave 2 --rev ec7dca5
    python3 scripts/check_holes.py --overlap --rev 54314f8

# No run of 3+ shared lines or 30+ shared tokens with any version of the upstream client (docs/provenance.md); pass a full upstream git clone, skipped without one. Add --history to check every commit.
upstream-overlap corpus='' *args:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "{{corpus}}" ]; then echo 'upstream-overlap: skipped (no upstream clone given)'; exit 0; fi
    python3 scripts/upstream-overlap/check.py --corpus "{{corpus}}" {{args}}

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

# Run a command on e2e slot N (homeserver port 28100+N, app port 4300+N; `just e2e-slot N down` stops it). Options before the command: --snapshot[=<rev>] runs it in a clean copy of a commit (default HEAD) with an empty homeserver; --preview serves that commit's production build. Example: `just e2e-slot 3 --preview npx playwright test e2e/live/pinned-threads.spec.ts`.
e2e-slot slot *args:
    bash scripts/e2e-slot.sh {{slot}} {{args}}

# Start (`up`, which prints its state as JSON), stop (`down`) or show (`status`) slot N's MindRoom backend with the stub model for the e2e/lane-c/agent-*.spec.ts specs, which start it themselves. Options: --checkout <MindRoom checkout> (default /home/basnijholt/Work/dev/mindroom, only read), --ref <commit> (default its origin/main). Example: `just agent-stack 16 up`.
agent-stack slot *args:
    python3 scripts/agent-stack/stack.py {{slot}} {{args}}

# Run the e2e suite (or the given specs) against one commit, each spec file in its own `e2e-slot --preview` run, spread over slots; writes one TSV row per spec. Example: `just e2e-suite --slots 25-28 --out results.tsv`.
e2e-suite *args:
    bash scripts/e2e-suite.sh {{args}}
