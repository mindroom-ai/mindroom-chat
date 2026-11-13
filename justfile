# Every recipe expects the `nix develop` shell (Node 24, npm, Chromium, Python 3, just).

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

# Type-check everything with the stricter flags of tsconfig.strict.json (unused names, implicit returns, unchecked index access, ...). Fails on errors in Lane C files only and prints how many Lane P errors it ignored.
strict:
    node --test scripts/strict-check.test.mjs scripts/provenance-paths.test.mjs
    node scripts/strict-check.mjs

# Run the unit tests. On NixOS, scripts/with-fhs-bin.sh adds the /bin/bash and /usr/bin tools that tests of the iOS CI scripts expect.
test *args:
    bash scripts/with-fhs-bin.sh npx vitest run {{args}}

# Lint with ESLint (rules: .eslintrc.cjs): src, e2e, scripts and the config files (package.json "lint" names them). Lane C TypeScript also gets type-aware rules (floating and misused promises, `await` of non-promises, exhaustive switches, needless assertions, enum comparisons) with the types of tsconfig.strict.json, takes `PopOut` and `TooltipProvider` from src/app/ui/directional.tsx rather than folds, and writes styles with logical sides (`paddingInlineStart`, `insetInlineEnd`, `textAlign: 'start'`, no four-part `margin` or `padding`) so they mirror in right-to-left languages; a side that must stay physical takes a disable comment with its reason (safe-area insets are allowed).
lint:
    npm run lint

# Format the files you changed, in either lane, with Prettier (2.8.8, the style of the Lane P files).
format *paths:
    npx prettier --write {{paths}}

# Vite dev server on http://127.0.0.1:4200 (extra arguments go to Vite, for example --host).
dev *args:
    npx vite {{args}}

# Production build into dist/; docs/deployment.md "Build" lists what it holds. The npm dependencies' THIRD_PARTY_NOTICES.txt in public/licenses/ comes from scripts/third-party-notices.mjs.
build:
    npx vite build

# Cut a release by hand: tag GitHub main (or the commit of main you name) with the next calendar version vYYYY.M.N and publish its GitHub release, with notes from the commits since the last release; the release event then publishes its container image (.github/workflows/image.yml). Shows the plan and asks before it creates anything; --dry-run only shows it, --yes does not ask. Needs `gh` signed in with write access. docs/ios-release.md describes the scheme; .github/workflows/release.yml does the same after CI while release.config.json says "autoRelease": true.
release *args:
    git fetch --quiet --tags https://github.com/mindroom-ai/mindroom-chat.git
    git fetch --quiet https://github.com/mindroom-ai/mindroom-chat.git main
    node scripts/calver.mjs release --main FETCH_HEAD {{args}}

# What a first visit downloads before the app runs, the largest chunks, and the size budget (scripts/perf/bundle-budget.json) of a build (default dist/). A build made with `npx vite build --manifest` also lists every chunk with its style sheets by source module, sorted by name, so that list diffs line by line between two builds. `--sources` attributes the initial bytes to packages; build with `npx vite build --sourcemap` for it.
bundle-report dist="dist" *args:
    node scripts/perf/bundle-report.mjs {{dist}} --budget scripts/perf/bundle-budget.json {{args}}

# The full local check. CI (.github/workflows/ci.yml) runs typecheck, strict, lint, test and a smoke subset of the e2e specs on every push to main and every pull request; scripts/push-gate.sh runs the overlap history check before each push.
check: typecheck strict lint test script-tests license-check verify-ported check-holes identifier-renames upstream-overlap

# Fail when an installed package has a license outside the allowlist (also runs the script's own tests).
license-check:
    node --test scripts/license-check.test.mjs
    node scripts/license-check.mjs node_modules

# Recompute the Lane P import from a legacy MindRoom Chat checkout (mindroom-ai/mindroom-chat-legacy) and compare it with the import commit; skipped without a path.
verify-ported *checkout:
    bash scripts/verify-ported.sh {{checkout}}

# Lane P files may differ from each import only in their blanked lines. Later Lane P edits are allowed, so each wave is checked at the commit that filled its blanks, not the working tree.
check-holes:
    python3 scripts/check_holes.py --wave 1 --rev feed1b4
    python3 scripts/check_holes.py --wave 2 --rev ec7dca5
    python3 scripts/check_holes.py --overlap --rev 54314f8

# Every Lane P line a commit of docs/provenance/identifier-renames.tsv changes differs only by the names it lists (also runs the script's own tests).
identifier-renames:
    node --test scripts/check-identifier-renames.test.mjs
    node scripts/check-identifier-renames.mjs

# No run of 3+ shared lines or 30+ shared tokens with any version of the upstream client (docs/provenance.md); pass a full upstream git clone, skipped without one. Add --history to check every commit.
upstream-overlap corpus='' *args:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "{{corpus}}" ]; then echo 'upstream-overlap: skipped (no upstream clone given)'; exit 0; fi
    python3 scripts/upstream-overlap/check.py --corpus "{{corpus}}" {{args}}

# Install the pre-push hook that runs the upstream overlap check on every commit a push adds (scripts/git-hooks/install.sh): pass the upstream clone, then other clones to install it in (default: this one). The hook fetches the objects of the remote's main when the clone lacks them; the headers of scripts/git-hooks/install.sh, scripts/git-hooks/pre-push and scripts/upstream-overlap/check.py describe the rest.
install-hooks corpus *clones:
    bash scripts/git-hooks/install.sh --corpus "{{corpus}}" {{clones}}

# Compare Lane C code with each corpus given, a directory or a Git repository as <dir>@<commit> (scripts/similarity-audit.sh says what counts); writes docs/provenance/audit/<date>/.
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

# Run a command on e2e slot N (homeserver port 28100+N, app port 4300+N; `just e2e-slot N down` stops it). Options before the command: --snapshot[=<rev>] runs it in a clean copy of a commit (default HEAD) with an empty homeserver; --preview serves that commit's production build; --fresh starts the slot's homeserver empty and deletes it at the end; --rtc starts the slot's call service (scripts/e2e-rtc.sh) for the call specs. The script's header describes each option. Example: `just e2e-slot 3 --preview npx playwright test e2e/threads/pinned-threads.live.spec.ts`.
e2e-slot slot *args:
    bash scripts/e2e-slot.sh {{slot}} {{args}}

# Start (`up`, which prints its state as JSON), stop (`down`), show (`status`) or count the model calls and tokens of (`usage`) slot N's (0-99) MindRoom backend for the e2e/<domain>/agent-*.spec.ts specs, which start it themselves. Options (the docstring of scripts/agent-stack/stack.py describes each): --model stub|real (default $E2E_AGENT_MODEL, else stub; real runs Claude Haiku 5.5 and GPT-6 Luna with the provider keys of the environment), --transcription stub|real (call transcripts with OpenAI's speech-to-text and notes by GPT-6 Luna; default $E2E_AGENT_TRANSCRIPTION, else stub, always real with --model real), --calls <MatrixRTC service URL> [--calls-profile realtime|live] (the helper answers voice calls with gpt-realtime-2.1-mini or gpt-live-1; needs OPENAI_API_KEY), --client-sessions (the slot's Chat may sign in to the backend's plugin routes; needs a homeserver that binds OpenID tokens), --computers (the helper gets a Worker Computer, in Docker workers built from the same commit) [--computer-image <image>] (the workers' image instead, default $E2E_COMPUTER_IMAGE) [--computer-tools <list>] (the tools that run in the workers, default browser_mcp), --terminals (MindRoom's terminal toolkit beside the helper's shell, in the slot's sandbox runner; implies --client-sessions, not with --computers), --checkout <MindRoom checkout> (default $E2E_MINDROOM_CHECKOUT, else /home/basnijholt/Work/dev/mindroom; only read), --ref <commit> (default $E2E_MINDROOM_REF, else its origin/main). Example: `just agent-stack 16 up`.
agent-stack slot *args:
    python3 scripts/agent-stack/stack.py {{slot}} {{args}}

# Run the e2e suite (or the given specs) against one commit, each spec file in its own `e2e-slot --preview` run (the call specs with --rtc), spread over slots; writes one TSV row per spec, with tests skipped for a missing service in their own column. Example: `just e2e-suite --slots 25-28 --out results.tsv`.
e2e-suite *args:
    bash scripts/e2e-suite.sh {{args}}

# Tests of the e2e tooling, the notices generator, the bundle report and the iOS test fixture generators (scripts/e2e-results-tsv.test.mjs, scripts/third-party-notices.test.mjs, scripts/ios-routing-test-routes.test.mjs, scripts/ios-canvas-test-fixtures.test.mjs and scripts/perf/bundle-report.test.mjs with Node's test runner, scripts/test_matrix_http.py, scripts/reference/test_seed.py, scripts/agent-stack/test_stack.py, scripts/upstream-overlap/test_check.py and scripts/test_e2e_plugin_dirs.py with unittest). test_check.py pushes to local bare repositories through the pre-push hook, with a made-up corpus: no upstream clone is needed.
script-tests:
    node --test scripts/e2e-results-tsv.test.mjs scripts/third-party-notices.test.mjs scripts/ios-routing-test-routes.test.mjs scripts/ios-canvas-test-fixtures.test.mjs scripts/perf/bundle-report.test.mjs
    python3 -m unittest scripts/test_matrix_http.py scripts/reference/test_seed.py scripts/agent-stack/test_stack.py scripts/upstream-overlap/test_check.py scripts/test_e2e_plugin_dirs.py
