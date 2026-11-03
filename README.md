# mindroom-client

An Apache-2.0 web client for [MindRoom](https://github.com/mindroom-ai/mindroom), built on `matrix-js-sdk` with its Rust crypto (`@matrix-org/matrix-sdk-crypto-wasm`).

This is a clean-room rebuild of MindRoom Chat. Files authored by Bas Nijholt are ported at their original paths; everything else is written without access to the upstream client or MindRoom Chat source. `docs/provenance.md` explains the two lanes, and `AGENTS.md` holds the rules for working here.

The stack matches MindRoom Chat so ported files run unchanged: React 18.2, TypeScript 5.4, Vite 5.4, vanilla-extract, folds, jotai, TanStack Query, React Router, Slate, and i18next.

## Status

Early. The ported files are in place and the missing modules ("seams") are being written until the project compiles and its tests pass. `docs/provenance/m1-baseline.txt` records where the compile started.

## Development

Use the Nix dev shell, which provides Node 22, npm, Chromium (`CHROMIUM_PATH`), Python 3, and `just`:

```bash
nix develop
just install
just dev
```

| Recipe | What it does |
|---|---|
| `just install` | Install the locked dependencies (`npm ci`) |
| `just typecheck` | Type-check the app sources (`tsconfig.app.json`, no tests) |
| `just typecheck-tests` | Type-check everything, tests included; reports without failing |
| `just typecheck-all` | Type-check everything, reporting semantic errors while syntax errors remain |
| `just test [args]` | Unit tests (`vitest run`) |
| `just lint` | ESLint |
| `just format <paths>` | Prettier on files you wrote |
| `just dev` | Vite dev server on `http://127.0.0.1:4200` |
| `just build` | Production build into `dist/` |
| `just e2e [args]` | Playwright end-to-end specs (`just hs-up` / `just hs-down` start and stop the test homeserver) |
| `just check` | Typecheck, lint, test, license check, ported-file verification, hole check |

`AGENTS.md` lists every recipe.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
