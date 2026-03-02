# MindRoom

MindRoom is a Matrix client focused on AI-agent workflows.
This repository is a fork of [Cinny](https://github.com/cinnyapp/cinny), with product and UX changes for MindRoom use cases.

## What MindRoom Is

MindRoom is designed for teams that use Matrix as the execution and collaboration layer for AI-assisted work.
The app prioritizes:

- reliable streaming/edit rendering,
- thread-first workflows,
- tool-call and run-metadata visibility,
- predictable deployment under root and subpath hosting,
- iOS distribution readiness.

## What Is Different From Upstream Cinny

| Area | MindRoom Fork |
| --- | --- |
| Branding | MindRoom identity, assets, defaults, and onboarding text |
| Message model | Strong focus on edit-resolution behavior for streaming content |
| Threads | Thread-aware composition, deep-linking, and timeline behavior improvements |
| Tool UX | MindRoom tool-trace rendering (`io.mindroom.tool_trace` v2 markers) |
| Long text | MindRoom v2 sidecar hydration, safer fallbacks, original download support |
| Commands | `!` command autocomplete for MindRoom workflows |
| Apple auth | Apple-first SSO provider handling (`Sign in with Apple` / `Sign up with Apple`) |
| Voice | iOS-friendly recording defaults and composer-first UX |
| Deployment | Runtime base-path support for one build artifact |
| iOS | Capacitor app setup and App Store compliance workflow/docs |

For detailed implementation and rationale, see:

- [`FORK_CHANGES.md`](./FORK_CHANGES.md)

## App Store / iOS Submission Docs

- Checklist: [`APP_STORE_COMPLIANCE.md`](./APP_STORE_COMPLIANCE.md)
- Submission metadata/review notes packet: [`APP_STORE_SUBMISSION_PACKET.md`](./APP_STORE_SUBMISSION_PACKET.md)
- Build guide: [`ios-build.md`](./ios-build.md)

## Quick Start

```bash
npm ci
npm run test
npm run build
```

## Runtime Configuration

Main runtime config file:

- [`config.json`](./config.json)

Notable options:

- homeserver defaults and allowed-server policy,
- auth behavior (including `allowRegistration`, support/privacy/terms links),
- sidebar and welcome-page behavior.

## Self-Hosting

### Standard static hosting

Build and serve `dist/` with your preferred web server.

### Runtime base-path (single build artifact)

- Build once with relative assets: `npm run build`
- At runtime set `APP_BASE_PATH` to `/` or `/mindroom`
- Example: `APP_BASE_PATH=/mindroom ./your-server`

Containerized runtime also supports:

- `APP_ENABLE_SERVICE_WORKER` (enabled by default in container runtime config)

### Optional build-time base path

- `APP_BUILD_BASE_PATH=/mindroom npm run build`

### Reverse-proxy examples

- Netlify: [`netlify.toml`](./netlify.toml)
- Nginx: [`contrib/nginx/cinny.domain.tld.conf`](./contrib/nginx/cinny.domain.tld.conf)
- Caddy: [`contrib/caddy/caddyfile`](./contrib/caddy/caddyfile)

## iOS Build / Archive

```bash
npm run build
npm run ios:icons
npm run appstore:preflight
npx cap sync ios
npx cap open ios
```

Then archive from Xcode (`App` scheme, `Any iOS Device (arm64)`).

## Local Development

```bash
npm ci
npm start
```

## Docker

```bash
docker build -t mindroom-cinny:latest .
docker run -p 8080:80 mindroom-cinny:latest
```

## Releases

- Every push to `dev` creates an automated GitHub release tag in the format
  `v<base_version>-mindroom.<n>`.
- `base_version` is read from [`package.json`](./package.json) by default
  (or `BASE_VERSION` if set), with upstream-style semver tags as fallback;
  `<n>` increments from existing fork tags for that base version.
- The Python helper is reusable across forks via env vars:
  `RELEASE_TAG_PREFIX`, `RELEASE_TAG_SUFFIX`, `BASE_TAG_PREFIX`, `BASE_VERSION`.
- Local preview of the next tag:

```bash
npm run release:next-tag
```

## Upstream Attribution

This project is built on top of Cinny and Matrix ecosystem libraries.

- Upstream Cinny: <https://github.com/cinnyapp/cinny>
- Matrix: <https://matrix.org>

## License

Licensed under AGPL-3.0-only (same as upstream project).
See [`LICENSE`](./LICENSE).
