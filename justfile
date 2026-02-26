set shell := ["bash", "-euo", "pipefail", "-c"]

default:
  @just --list

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
