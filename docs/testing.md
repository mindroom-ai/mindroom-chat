# Running browser tests

Use the repository runner for the complete Playwright suite:

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e:parallel -- --jobs 8
```

Use the Node version in `.node-version` and a running Docker daemon with Docker Compose.
The runner uses Node built-ins; it needs no Python, SSH access, fixed ports, or existing Matrix accounts.
It starts a disposable local Matrix server, builds the application once, copies the build into the run directory, and starts a production preview plus a fresh Vite server.
Matrix ports bind only to loopback.
All services and the Matrix volume created by the runner are removed when it exits, including after Ctrl-C.
Reports and the build snapshot remain available.

The default command includes every spec discovered by every `playwright*.config.*` file.
Shared Chromium cases run once; supplemental Firefox and WebKit cases remain included.
Unit tests remain a separate command: `npm test`.

Two browser integrations require external prerequisites described below.
Without them, the command still runs the remaining tests, records those integrations as **blocked**, and exits nonzero.
A completed process is not evidence that every requested case passed: check `summary.json` for failed, skipped, missing, and unrun cases.

## Execution and isolation

The default concurrency is half the available CPUs, capped at eight spec processes.
Override it with `--jobs N`; each process always uses one Playwright worker and zero retries.
Each spec/project job receives fresh primary, secondary, third, deactivation, and agent accounts plus its own fixture room.
Inherited account credentials are not reused.
The standard, App Store, minimap, and narrow-toolbar fixtures are seeded automatically.
The runner never changes test assertions or expected interface defaults.

Performance, native momentum, long-message folding, thinking-marker, screenshot, and external integration jobs run sequentially after the parallel queue finishes.
Avoid unrelated heavy workloads during this phase.
Source-import fixtures use Vite; application checks use the production preview.

Every Playwright process has its own working directory and output directory.
This also keeps legacy `ui-audit/` screenshots and App Store release captures inside the run's artifacts rather than changing repository release images.
Separate complete runs use separate Docker Compose projects, ports, accounts, and report directories.
Use separate checkouts for simultaneous builds, since `npm run build` writes the checkout's shared `dist/` directory before the runner copies it.

## External integrations

### Hosted SSO shell

The deployed authentication shell checks real provider links on an SSO-enabled homeserver.
Supply its URL explicitly:

```bash
npm run test:e2e:parallel -- --sso-homeserver https://mindroom.chat
```

`E2E_SSO_HOMESERVER` is the equivalent environment setting.
These tests inspect authentication routes; the runner does not provision accounts on that server.

### Worker computer

The real worker-computer test needs the MindRoom backend's isolated gateway fixture.
Follow the backend's `docs/tools/worker-computer.md` and start `scripts/test-worker-computer.py --serve` with `--chat-origin` set to the local Chat preview URL.
Start all backend fixture containers before the browser run; Docker network changes during browser startup can interrupt requests.
The fixture provides `chat-fixture.json`, including its loopback API, UI, and Matrix origins.

Build and serve the Chat checkout being tested, then point both the backend fixture and runner at that same preview:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

From another shell, after starting the backend fixture for that origin:

```bash
npm run test:e2e:parallel -- \
  --production-url http://127.0.0.1:4173 \
  --computer-fixture ./test-results/worker/chat-fixture.json \
  --sso-homeserver https://mindroom.chat \
  --jobs 8
```

Replace the fixture path with the actual output from the backend setup.
`E2E_COMPUTER_FIXTURE` is also supported.
The fixture's `ui_origin` must match `--production-url`; the runner rejects non-loopback fixture services.
With `--production-url`, the runner uses that existing build instead of building or starting its own production preview.
It still starts a fresh Vite server and disposable Matrix stack for other tests.
The external preview and backend fixture remain owned by whoever started them; shut them down using their own cleanup instructions.

## Inspecting coverage and rerunning

```bash
# Discovery only: no builds, containers, account creation, or browser launches.
npm run test:e2e:parallel -- --list

# Select specific files; all configured projects for those files are included.
npm run test:e2e:parallel -- --jobs 2 \
  e2e/account-storage.spec.ts e2e/live/cinny031-focused-room-view.spec.ts

# Select a queue explicitly; this is a partial run.
npm run test:e2e:parallel -- --phase parallel
npm run test:e2e:parallel -- --phase serial

# Reuse a known-current dist/ build for a focused rerun.
npm run test:e2e:parallel -- --skip-build e2e/account-storage.spec.ts
```

The default artifact parent is `test-results/parallel/`; `--artifacts DIRECTORY` selects another parent.
Each invocation creates a unique run directory containing `summary.json`, startup/build logs, the production snapshot, and per-spec setup logs, Playwright JSON reports, traces, videos, and screenshots.
The summary records the selected scope, every discovered case, each job outcome, and aggregate case counts.
It is updated as jobs finish, including when another job fails.
A missing report, missing expected case, failed repeat, setup error, blocked integration, or interruption cannot turn into a successful exit.
Browser traces may contain disposable fixture credentials; keep artifacts local unless reviewed for publication.

### Linux browser containers

On hosts where Playwright's browser dependencies are unavailable, use the matching official Playwright image:

```bash
npm run test:e2e:parallel -- --docker-browsers --jobs 8
```

This mode requires Linux host networking and downloads the image matching the installed Playwright version if necessary.
It runs browser jobs with the current user's UID/GID and preserves reports on the host.
`E2E_PLAYWRIGHT_IMAGE` can select an already prepared compatible image.
Browser containers are separate from the disposable Matrix Compose project and are removed on completion or interruption.

## Known unresolved browser checks

The long-message fold-anchor check remains strict: isolated validation observed 634px of displacement against its original 40px limit.
Waiting for eventual recovery can hide a visible jump, so the runner does not add settling waits or retries.
The native momentum pixel check also fails intermittently on software graphics; the same blank frames reproduce on a static page.
That control identifies an environment confound and does not establish that application scrolling is correct.
Neither case is skipped or treated as an expected pass by the runner.

For runner changes, use `npm run test:e2e:runner` plus a real run covering account isolation, source fixtures, and the sequential queue.
The runner's fast behavioral tests also run in PR CI; CI does not automatically start the full slow browser suite.
