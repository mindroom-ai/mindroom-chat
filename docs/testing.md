# Parallel browser tests

Use a small scheduler plus explicit service setup.
Agents should run these commands rather than recreate scheduling logic.
Prerequisites: Node from `.node-version`, Bash, Python 3, curl, Docker Compose, `npm ci`, and Playwright browsers (`npx playwright install --with-deps`).
Use Linux, macOS, or WSL; existing shell helpers need Python (`uv run --no-project` can supply it).

Start a disposable Matrix stack on an unused local port:

```sh
export COMPOSE_PROJECT_NAME=chat-e2e-$USER-$$
export E2E_MATRIX_PORT=127.0.0.1:28108
export E2E_HOMESERVER=http://127.0.0.1:28108
export E2E_HOMESERVER_PUBLIC_URL=$E2E_HOMESERVER
npm run e2e:matrix:up
npm run build
```

Keep these servers running in separate terminals from the same checkout:

```sh
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
npm run start -- --host 127.0.0.1 --port 4188 --strictPort
```

Back in the first terminal:

```sh
export E2E_BASE_URL=http://127.0.0.1:4173
export E2E_DEV_BASE_URL=http://127.0.0.1:4188
npm run test:e2e:parallel -- --list
npm run test:e2e:parallel -- --jobs 8
# Focused rerun: append exact repository-relative spec paths.
# npm run test:e2e:parallel -- --jobs 2 e2e/account-storage.spec.ts
```

The scheduler discovers every Playwright config, deduplicates shared Chromium cases, and includes supplemental Firefox/WebKit cases.
Each spec/project gets fresh accounts, a fixture room, and its own working/output directory; it reuses the existing account and seed scripts.
App Store captures intentionally reuse their existing fixed display agents, so use one suite per disposable Matrix stack.
One Playwright worker runs per spec with zero retries; timing-sensitive and special-fixture specs run sequentially after the parallel pool.
Avoid heavy competing workloads during that phase; use separate checkouts for simultaneous builds and restart Vite after changing branches.

Results and legacy screenshots stay under `test-results/parallel/<run>/`; `E2E_ARTIFACTS` overrides the parent directory.
Read `summary.json` and each job's `report.json`: platform skips remain explicit, and failed setup/tests, missing reports/cases, all-skipped jobs, or blocked integrations cause a nonzero exit.
Ctrl-C stops child process groups and exits 130; app servers and Matrix remain caller-owned.
Stop the two server terminals and run `docker compose -f e2e/docker-compose.matrix.yaml down --volumes` in the first terminal to remove its Matrix project.
Artifacts can contain disposable credentials; keep them local.

## External prerequisites

Set `E2E_SSO_HOMESERVER=https://mindroom.chat` for hosted SSO route checks.
For worker-computer coverage, follow the backend's `docs/tools/worker-computer.md` and run `scripts/test-worker-computer.py --serve --chat-origin http://127.0.0.1:4173`.
Set `E2E_COMPUTER_FIXTURE` to its `chat-fixture.json`; its loopback `ui_origin` must equal `E2E_BASE_URL`.
Start backend fixture containers before browser jobs; network changes during tests can disrupt requests.
Without these prerequisites, those jobs are reported as blocked while the rest continue.

## Linux without native browser dependencies

Run the same scheduler inside the matching official Playwright image; keep the host services above running:

```sh
image=mcr.microsoft.com/playwright:v$(node -p 'require("@playwright/test/package.json").version')-noble
docker run --rm --init --network host --ipc host --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" -w "$PWD" -e E2E_HOMESERVER -e E2E_BASE_URL -e E2E_DEV_BASE_URL \
  -e E2E_SSO_HOMESERVER -e E2E_COMPUTER_FIXTURE "$image" node scripts/test-e2e-parallel.mjs --jobs 8
```

Keep an external worker fixture JSON inside the mounted checkout or mount its path too.
Known unresolved checks remain strict: immediate fold-anchor displacement and native momentum blank frames on software graphics (also reproduced on static HTML).
The settings-header live check also expects its own blur although settings now inherit the modal material; direct Playwright execution reproduces this failure without the scheduler.
The scheduler does not relax assertions or add retries.
Unit tests remain `npm test`; the scheduler's focused tests run through `npm run test:e2e:runner` in PR CI.
