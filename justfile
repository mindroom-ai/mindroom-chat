set shell := ["bash", "-euo", "pipefail", "-c"]

default:
  @just --list

# Reinstall dependencies and rebuild the web app
rebuild:
  npm ci
  npm run build

# Build once, then start the local dev server
run:
  npm run build
  npm start

# Run the repo lint checks
lint:
  npm run lint

# Run TypeScript without emitting build output
typecheck:
  npm run typecheck

# Run the Vitest suite once
test:
  npm run test

# Run the full repo verification suite
check:
  just lint
  just typecheck
  just test
  npm run build

# Full refresh after pulling commits (safe if dependencies changed)
ios-rebuild:
  npm install
  npm run build
  npm run ios:icons
  npm run appstore:preflight
  npx cap sync ios

# Faster refresh when node_modules is already up to date
ios-sync:
  npm run build
  npm run ios:icons
  npm run appstore:preflight
  npx cap sync ios

ios-open:
  npx cap open ios
