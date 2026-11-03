# Every recipe expects the `nix develop` shell (Node 22, npm, Chromium, Python 3, just).

default:
    @just --list

# Install the locked dependencies.
install:
    npm ci

# Type-check with tsc. Stops reporting at the first syntax error, so blanked lines hide the rest.
typecheck:
    npx tsc --noEmit -p .

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
check: typecheck lint test license-check verify-ported

# Added in Task 2.
license-check:
    @echo "added in Task 2"

# Added in Task 2.
verify-ported:
    @echo "added in Task 2"
