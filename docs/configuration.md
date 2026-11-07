# Configuration

A deployment configures the client in three places:

1. `config.json`, fetched each time the app starts. It holds nearly every setting.
2. `runtime-config.js`, a script that sets a few window globals before the app loads.
3. Environment variables at build time, for the version, the iOS bundle and client plugins.

The homeserver adds a few settings of its own through `/.well-known/matrix/client` (last section).

## config.json

The app fetches `/config.json` from the root of its origin before it shows anything (`src/app/config/ClientConfigLoader.tsx`). The file must hold a JSON object. Every key is optional, and a missing key means the default in the tables below, so `{}` is a valid configuration. The TypeScript type is `ClientConfig` in `src/app/config/useClientConfig.ts`.

- **Where it comes from.** `vite build` copies `config.mindroom.json` to `dist/config.json`, and the dev server answers `/config.json` with the same file. A deployment replaces `dist/config.json` with its own; no new build is needed.
- **When a change applies.** On the web the app starts with the copy it stored in `localStorage` at the previous start and fetches a fresh one in the background, so a changed file takes effect on the second load after the change. The native apps fetch it at every start.
- **Failures.** If the fetch fails, the app shows an error with a retry button, plus a button to go on with the stored copy when there is one. A redirect or a 401 or 403 answer counts as an expired sign-in at an authenticating proxy and starts sign-in recovery (see `__AUTHENTICATION_RECOVERY_CONFIG__` below).
- **Requests.** `cache: no-store`, same-origin credentials, and redirects are not followed.

The configuration this repository ships (`config.mindroom.json`) sets `homeserverList` (`mindroom.chat`, `matrix.org`), `defaultHomeserver`, `allowCustomHomeservers`, `hashRouter` (off), `auth.allowRegistration`, `auth.requireAppleProvider`, `sidebar.showMindRoom`, `sidebar.mindRoomProvisioningUrl` (`https://mindroom.chat`), `welcome`, `splash`, `mindroom` (its own thinking messages, canvases off, no computer API origin), `messageRendering` (`obsidian`, `readdlespark`) and part of `push.ios` (push stays off).

### Sign-in

| Key | Type | Default | Effect |
|---|---|---|---|
| `homeserverList` | string[] | none | Homeservers the sign-in, registration and password reset pages offer: suggestions under the Server field, or a drop-down when the choice is locked (below). Each entry is a server name (looked up through `/.well-known/matrix/client`) or a URL. HTTP is accepted only for localhost and private network addresses. |
| `defaultHomeserver` | number | `0` | Index in `homeserverList` of the preselected server. Out of range: the first entry. Without a list: `mindroom.chat`. |
| `allowCustomHomeservers` | boolean | `true` | `false` locks sign-in to the listed servers: the Server field becomes a drop-down, and a server named in a link that is not on the list is replaced by the default, so a crafted link cannot send credentials elsewhere. With `true`, single sign-on and Sign in with Apple start at once only on the listed servers and the default; on any other server a press first names the host that receives the login and asks whether the person trusts it. |
| `auth.hideServerPickerWhenSingle` | boolean | `false` | With `true` and exactly one server in `homeserverList`, the Server field is hidden and sign-in is locked to that server. |
| `auth.allowRegistration` | boolean | `true` | `false` removes the Register link and sends `/register/...` to the login page. |
| `auth.disablePasswordLogin` | boolean | `false` | `true` hides the password form, and password registration, on every server. On `mindroom.chat` both are always off and registration is single sign-on only, whatever this says. |
| `auth.requireAppleProvider` | boolean | `false` | With `true`, on `mindroom.chat` only: when the server offers no Apple sign-in, the single sign-on buttons are replaced by an error (an App Store rule). |
| `auth.poweredBy` | `{label, url}[]` | MindRoom (`https://mindroom.chat`) and Matrix (`https://matrix.org`) | The "Powered by" links under the sign-in card. `[]` hides the line. Each `url` must be an absolute `http`, `https` or `mailto` address; other entries are left out, and a value that is no list keeps the default. |
| `auth.supportUrl` | string | none | A Support link under the sign-in card (`http`, `https` or `mailto`). |
| `auth.privacyUrl` | string | none | A Privacy link under the sign-in card (`http`, `https` or `mailto`). |
| `auth.termsUrl` | string | none | A Terms link under the sign-in card (`http`, `https` or `mailto`). |

### Branding

A company can put its own logo, name and footer on the signed-out pages without a new build: sign-in, registration and password reset (with every state inside their card: the server lookup, single sign-on, errors), and the Local MindRoom pairing page. The loading and error screens and the browser tab take the name too.

| Key | Type | Default | Effect |
|---|---|---|---|
| `branding.title` | string | `MindRoom Chat` | The name beside the logo in the card's header (the page's heading), at the bottom of the loading and error screens once the configuration has loaded, and in the browser tab, where a signed-in account adds its unread count in front. Without it the tab keeps `MindRoom`. A title too long for the header ends in an ellipsis. |
| `branding.logo.src` | string (URL) | the MindRoom Chat logo | The logo in the card's header: an `https` URL, or a path on the app's own origin such as `/branding/logo.svg`, served beside `config.json`. Shown 28 pixels high and as wide as its proportions make it, up to 160 pixels. It is loaded without a referrer; if it does not load, the default logo is shown. |
| `branding.logo.srcDark` | string (URL) | `src` | The logo in dark themes, under the same rules. Signed out, the app follows the system's light or dark setting. |
| `branding.logo.alt` | string | `MindRoom Chat Logo` | Required with `src`: what screen readers say for the logo. |
| `branding.footer.text` | string | none | A line of plain text under the card, before the credits. Markup is shown as written, not rendered. |
| `branding.footer.links` | `{label, url}[]` | `[]` | Links after the Support, Privacy and Terms links, each opened in a new tab. `url` must be an absolute `http`, `https` or `mailto` address. |

The credits and the Support, Privacy and Terms links stay under `auth` (above); `"poweredBy": []` hides the "Powered by" line. The footer shows, in this order: `branding.footer.text`, the credits, Support, Privacy, Terms, then `branding.footer.links`.

Values are checked when the configuration loads. A value that fails keeps its default and logs one `[branding]` warning in the browser console, so a typo never leaves the page blank:

- `branding` that is not an object: the whole look stays the default.
- A blank or non-text `title`: the default title.
- A `logo` without `alt` text, or whose `src` is not an `https` URL or on the app's own origin (`http` elsewhere, `data:`, `blob:`, `javascript:` and others are refused): the default logo. A refused `srcDark` makes dark themes show `src`.
- A `footer` that is not an object, or `text` that is not text: no footer text.
- A link without a label or with another scheme, in `branding.footer.links` or `auth.poweredBy`: that link is left out, the others stay.

Not covered by `branding`: the loading screen of the very first start (before any configuration has loaded, so it names MindRoom Chat), the welcome page (`welcome.*` below), the favicon, the web app manifest and home screen icons, notification titles, the device name a sign-in gives the session (`MindRoom Chat Web`), and the native apps' names.

An example:

```json
{
  "branding": {
    "title": "Example Co",
    "logo": {
      "src": "https://www.example.com/chat-logo.svg",
      "srcDark": "https://www.example.com/chat-logo-dark.svg",
      "alt": "Example Co"
    },
    "footer": {
      "text": "Example Co team chat. Ask the help desk for an account.",
      "links": [
        { "label": "Imprint", "url": "https://www.example.com/imprint" },
        { "label": "Help desk", "url": "mailto:help@example.com" }
      ]
    }
  },
  "auth": {
    "privacyUrl": "https://www.example.com/privacy"
  }
}
```

The MindRoom web client Helm chart (`cluster/k8s/client` in the MindRoom repository) deep-merges `config.values` over the `config.json` it renders, so a deployment sets the same keys there:

```yaml
config:
  values:
    branding:
      title: Example Co
      logo:
        src: https://www.example.com/chat-logo.svg
        srcDark: https://www.example.com/chat-logo-dark.svg
        alt: Example Co
      footer:
        text: Example Co team chat. Ask the help desk for an account.
        links:
          - label: Imprint
            url: https://www.example.com/imprint
```

### Routing

| Key | Type | Default | Effect |
|---|---|---|---|
| `hashRouter.enabled` | boolean | `false` | `true` keeps routes after `#` (`/#/home/`), for hosts that cannot answer every path with `index.html`. |
| `hashRouter.basename` | string | `/` | Prefix of the routes inside the hash. Read only when `enabled` is `true`. |

### Navigation and Local MindRoom

| Key | Type | Default | Effect |
|---|---|---|---|
| `sidebar.showThreads` | boolean | `true` | `false` hides the Threads button in the icon rail and its switch in Settings. |
| `sidebar.showExploreCommunity` | boolean | `true` | `false` hides the Explore and Create Space buttons in the icon rail and their switches in Settings. |
| `sidebar.showMindRoom` | boolean | `true` | `false` turns Local MindRoom off: no icon rail entry or switch for it, no Settings page, no setup steps on the welcome page, and `/connect` (pairing links included) goes to `/`. |
| `sidebar.mindRoomProvisioningUrl` | string (URL) | the account's homeserver | Origin of the provisioning service that pairs a Local MindRoom (the `/connect` page, Settings, and the setup steps the welcome page shows a day after first use while nothing is paired). An account whose homeserver has another origin cannot sign in to that service, so it gets no Local MindRoom entry. |

On top of these, each person picks which of Threads, Canvases, Explore Community, Create Space, Search (the command palette) and Local MindRoom their own rail shows, in Settings > General > Sidebar. The choice is stored in the account's `io.mindroom.settings` account data, so it follows the account to every device; a button the deployment hides has no switch there. A hidden page stays reachable: Threads and Explore Community from the ⋮ menu of Home, Create Space from the command palette, the command palette from its keyboard shortcut (Ctrl + K, or ⌘ K on Apple devices), and Local MindRoom from its Settings page. The rail's account button opens a menu with Settings, the other accounts on the device, Add Account and Manage Accounts.

Eight more preferences follow the account to every device: Markdown, Enter for a new line, hiding membership changes, hiding profile changes, link previews (in rooms without encryption), hiding typing and read receipts, the 24-hour clock and the date format. Settings labels each of them "Your account (all devices)". They are stored in the account's `io.mindroom.client.settings` account data, apart from `io.mindroom.settings`, which other MindRoom clients write too. A change applies at once, also offline, and reaches the homeserver as soon as the device is online; for each setting the last change sent wins. Each time a device starts, it adds its own earlier choices that differ from the defaults wherever the account has no value yet; where the account has one, the account's value wins. Every other setting, such as the theme, zoom, message layout, media loading, link previews in encrypted rooms, notifications, the language, developer tools and error reports, stays on the device. Account data is not encrypted, so the homeserver can read these preferences.

### Explore

| Key | Type | Default | Effect |
|---|---|---|---|
| `featuredCommunities.spaces` | string[] (room IDs or aliases) | `[]` | Spaces on the Explore page's Featured section. |
| `featuredCommunities.rooms` | string[] (room IDs or aliases) | `[]` | Rooms on the Featured section. |
| `featuredCommunities.servers` | string[] (server names) | `[]` | Servers whose public room directories the Explore navigation lists, after the account's own server. |
| `featuredCommunities.openAsDefault` | boolean | `false` | `true` makes the Explore button open the Featured section instead of the own server's directory, when there is no Explore page to return to. |

### Creating rooms

| Key | Type | Default | Effect |
|---|---|---|---|
| `createRoom.defaultEncryption` | boolean | `true` | Initial state of the encryption switch for new private rooms. Public rooms are never encrypted. |
| `createRoom.showEncryptionOption` | boolean | `true` | `false` hides the encryption switch; the default above still applies. |
| `createRoom.defaultFederation` | boolean | `true` | Initial state of the federation switch for new rooms and spaces. |
| `createRoom.showFederationOption` | boolean | `true` | `false` hides the federation switch for rooms and spaces. |

With `showEncryptionOption: false` and `defaultEncryption: false` together, the welcome page also stops asking people to set up key backup.

### Copy and branding

| Key | Type | Default | Effect |
|---|---|---|---|
| `welcome.title` | string | `Welcome to MindRoom Chat` | Heading of the welcome page (shown when no room is open). |
| `welcome.subtitle` | string | `AI agents that live in your chat rooms.` | Line under the heading; also shown in Settings > About. |
| `welcome.sourceLabel` | string | `Source Code` | Label of the first welcome button. |
| `welcome.sourceUrl` | string | `https://github.com/mindroom-ai/mindroom-chat` | Its link. An empty string hides the button. Settings > About always links to the default. |
| `welcome.docsLabel` | string | `Docs` | Label of the second welcome button. |
| `welcome.docsUrl` | string | `https://docs.mindroom.chat/` | Its link. An empty string hides the button. |
| `welcome.poweredBy` | `{label, url}[]` | MindRoom and Matrix | The "Powered by" links on the welcome page. `[]` hides the line. |
| `splash.loadingMessages` | string[] | `Loading MindRoom Chat`, translated | The startup screen shows one of these, picked at random at each start. Blank entries are skipped. |
| `mindroom.thinkingPlaceholderMessages` | string[] | `Making progress`, `Almost there`, `Boosting the GPUs`, `Checking the thread`, `Composing the reply` | Shown in turn, every 3.6 seconds, while an agent's reply still reads `Thinking...`. Blank and non-string entries are skipped; an empty list means the defaults. |

A `welcome` text equal to its English default is shown translated into the app language; any other text is shown as written in every language.

### Messages

| Key | Type | Default | Effect |
|---|---|---|---|
| `messageRendering.additionalAllowedUriSchemes` | string[] | `[]` | Link schemes that message HTML may use besides `https`, `http`, `ftp`, `mailto` and `magnet` (for example `obsidian`). Entries are lower-cased and a trailing `:` or `://` is dropped. Schemes that run script, read local files or embed documents (`javascript`, `vbscript`, `data`, `file`, `blob`, `about` and others) are always refused. |
| `messageRendering.linkFavicons` | boolean | `false` | `true` shows each web link's site icon beside it, loaded from `https://icons.duckduckgo.com/ip3/<host>.ico`: DuckDuckGo then sees the host names of the links people read and the address of their device. Only in unencrypted rooms, for people who load media automatically (Disable Media Auto Load off) and have Url Preview on, never inside spoilers; links with private or local hosts, credentials or a port never ask. Off, links load nothing from anywhere. |

### MindRoom features

| Key | Type | Default | Effect |
|---|---|---|---|
| `mindroom.canvas.enabled` | boolean | `false` | `true` turns on agent canvases: the canvas panel in rooms, and the Canvases button in the icon rail, which each person can hide in Settings > General > Sidebar. |
| `mindroom.canvas.libraries` | boolean | `false` | `true` lets canvas pages load scripts, styles and fonts from `https://cdn.jsdelivr.net/npm/`. The CDN then sees which files a viewer loads, and a page can put data in those addresses. Off, a canvas page can load nothing from outside. |
| `mindroom.computers.apiUrl` | string (origin) | `""` | Origin of the MindRoom backend for agent computers and Connections, for example `https://mindroom.example.org`. It must be HTTPS (HTTP only for localhost and private addresses) with no path, query or credentials; any other value counts as unset. Unset, the client uses the origin the room's agents publish as `io.mindroom.server` state. A value a user saves in Settings > General > Computers wins over both, and an empty value there turns computers off on that device. |
| `mindroom.uiActions.autoOpenFromHomeservers` | string[] (server names) | none | Agents whose user ID is on one of these servers may open panels in the client without a click (`io.mindroom.ui_action` events: show the computer, show a canvas, open the members panel, open a Settings section). Only events that arrive live, within 60 seconds, while the app is in the foreground count. Without the key no agent can. |

### Client plugins

A build can include client plugins (`MINDROOM_CLIENT_PLUGINS`, under [Build-time variables](#build-time-variables)). Each has a section of its own under `plugins`, named by its id, which it reads whenever it renders, so the section applies as the settings above do.

| Key | Type | Default | Effect |
|---|---|---|---|
| `plugins.<id>.enabled` | boolean | `true` | `false` hides everything the plugin `<id>` contributes, such as its message renderers. |
| `plugins.<id>.<setting>` | any | none | The plugin's own settings, as it documents them. |

`?plugins=off` in the page address, before any `#` (`https://chat.example.org/?plugins=off`), turns every plugin off for that page load, a quick way to tell whether a problem comes from what a plugin shows. Either way a plugin's code still loads with the app and only what it contributes is hidden, so neither helps when a plugin fails while its code loads, which stops the app from starting.

### Error reports

| Key | Type | Default | Effect |
|---|---|---|---|
| `errorReporting.dsn` | string (DSN) | none | DSN of a Sentry-compatible collector such as GlitchTip, `https://<public key>@<host>/<project id>`. HTTPS only; any other value counts as unset. Set, the client reports uncaught errors, unhandled rejections, crashes its root error boundary catches, entering the sync error state (with the `errcode`), messages still undecryptable after a minute (counted by failure code), failed sends (with the `errcode` and event type), main-thread blocks of 2 seconds or more, and rooms that take 3 seconds or more to show their messages. Each report carries the build (`version.json`'s `version` as the release), the browser, the viewport and the route template, such as `/home/:roomIdOrAlias/:eventId?/`. Reports never contain message text, room or display names, Matrix IDs, tokens, URL queries or file names (`src/app/bug-reports/error-reporting/scrub.ts`). The reporter is a chunk of its own, loaded only when this key is set, and each device can switch reports off in Settings > About (on by default). Unset, nothing is loaded or sent. Each report is posted as an envelope to the collector's envelope endpoint (`/api/<project id>/envelope/`), with the public key in the `X-Sentry-Auth` header and never in an address. |
| `errorReporting.tunnel` | string (path) | none | A path on the client's own origin, such as `/errors/envelope`, that the client's server forwards to the collector's envelope endpoint. Set, reports go there instead of to the collector: privacy blocklists (EasyPrivacy in uBlock Origin, Brave Shields, AdGuard) drop requests to error collectors, but not to the app's own origin. A value on another origin counts as unset. The server must forward the body, its `Content-Type` and the `X-Sentry-Auth` header to one fixed collector and project; see below. |
| `errorReporting.environment` | string | the page's host name | The `environment` of every report, such as `lab` or `production`, so test hosts and previews stay apart from the deployment in the collector. |

Without a tunnel the client posts to the collector's origin, which needs a CORS preflight for the `X-Sentry-Auth` header (GlitchTip allows it), and those reports cannot outlive the page. Reports that do not reach the collector are counted: the first of a page load logs one `[error-reports]` warning on the console, and the next report that gets through carries each failure as a `report` breadcrumb. For nginx, a tunnel for project 1 of `https://errors.example.org` looks like this; the address is fixed, so the tunnel relays nothing else, and the collector checks the key against that project:

```nginx
location = /errors/envelope {
  if ($request_method != POST) { return 405; }
  client_max_body_size 64k;
  client_body_buffer_size 64k;
  # Resolved per request, so nginx starts while the collector's name does not resolve.
  # 127.0.0.11 is Docker's DNS on user-defined networks; elsewhere use the host's resolver.
  resolver 127.0.0.11 ipv6=off valid=60s;
  set $collector https://errors.example.org;
  proxy_pass $collector/api/1/envelope/;
  # Only the body, its type and the key go on: no cookies, addresses or other headers.
  proxy_pass_request_headers off;
  proxy_set_header Content-Type $content_type;
  proxy_set_header X-Sentry-Auth $http_x_sentry_auth;
  proxy_ssl_server_name on;
  proxy_ssl_verify on;
  # The default depth of 1 rejects chains through a cross-signed root, as Let's Encrypt's are now.
  proxy_ssl_verify_depth 3;
  proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
  proxy_hide_header Set-Cookie;
  proxy_connect_timeout 5s;
  proxy_read_timeout 15s;
}
```

### Push notifications (iOS app)

Read only by the iOS app. Push stays off unless `enabled` is `true`, `appId` is set and `gatewayUrl` is an HTTPS URL. The values go into the Matrix pusher the app registers with the homeserver.

| Key | Type | Default | Effect |
|---|---|---|---|
| `push.ios.enabled` | boolean | `false` | Turns push on. |
| `push.ios.appId` | string | none | The pusher's `app_id`, as the push gateway knows the app. |
| `push.ios.gatewayUrl` | string (HTTPS URL) | none | The push gateway's notify URL (pusher `data.url`). |
| `push.ios.appDisplayName` | string | `MindRoom Chat iOS` | The pusher's `app_display_name`; also the title of `event_id_only` notifications. |
| `push.ios.deviceDisplayName` | string | `MindRoom Chat iOS` | The pusher's `device_display_name`. |
| `push.ios.profileTag` | string | a random tag per account, stored on the device | The pusher's `profile_tag`. |
| `push.ios.append` | boolean | `true` | The pusher's `append`. |
| `push.ios.format` | `"full"` or other | `event_id_only` | `"full"` sends the whole event to the gateway; anything else sends only its ID, and the notification reads "New message". |
| `push.ios.lang` | string | the app language | The pusher's `lang`. |

### Declared but not read

`sidebar.mindRoomUrl` is in the `ClientConfig` type, but no code reads it, so setting it changes nothing. It stays in the type because the ported welcome page test's configuration sets it.

## runtime-config.js

`index.html` loads `/runtime-config.js` and then `/authentication-recovery.js` before the app. The built `runtime-config.js` (from `src/boot/runtimeConfig.ts`) sets each global below only when it is not set yet, so a deployment prepends its own assignments to the file, as the Docker start script does. `serve.py` instead answers with a script of its own that sets only the first two.

| Global | Default | Effect |
|---|---|---|
| `window.__APP_BASE_PATH__` | `"/"` | Base path of the router and of the app's own URLs. Sub-paths do not work with the current build, whose asset URLs and `config.json` request start at `/`. |
| `window.__ENABLE_SERVICE_WORKER__` | `true` | Anything but `true` or the string `"true"` registers no service worker. The web app then has no offline start, and it loads media from the unauthenticated media endpoints. It also skips the check for new deployments, which only installs the new build's service worker for the next start; without a service worker each start loads the app from the server. |
| `window.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__` | `[]` | Up to 8 root-relative paths (each with everything under it) that the service worker sends to the network instead of answering with the app. `/connections`, `/mcp` and `/reports`, which a MindRoom backend serves on a shared origin, are always excluded. |
| `window.__AUTHENTICATION_RECOVERY_CONFIG__` | `null` | For a deployment behind an authenticating proxy: `{probeUrl, navigationUrl?, timeoutMs?}`. The client requests `probeUrl` at start, every minute, and when the window regains focus, becomes visible or comes back online. `204` means the proxy session holds; `401` or a redirect means it expired, and the client removes its service worker and navigates to `navigationUrl` (default: the current page) so the proxy can sign the person in, at most once per tab session. The Sign in button of the configuration error screen does the same. Both URLs must be on the app's origin, root-relative or absolute. `timeoutMs` is 1000 to 30000 (default 5000). An invalid value turns recovery off; with `null`, the Sign in button reloads the current page. |

### Docker start script

`docker-entrypoint.d/99-runtime-config.sh` writes `/usr/share/nginx/html/runtime-config.js` at container start, then appends the build's own `runtime-config.js` from `/opt/mindroom/runtime-config.js`:

| Variable | Default | Sets |
|---|---|---|
| `APP_BASE_PATH` | `/` | `__APP_BASE_PATH__` |
| `APP_ENABLE_SERVICE_WORKER` | `true` | `__ENABLE_SERVICE_WORKER__`: `true` for `1`, `true`, `TRUE`, `yes`, `YES`, `on` or `ON`, else `false` |
| `APP_AUTHENTICATION_RECOVERY_PROBE_URL` | none | `__AUTHENTICATION_RECOVERY_CONFIG__.probeUrl`; without it the config is `null` |
| `APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL` | none | `__AUTHENTICATION_RECOVERY_CONFIG__.navigationUrl` |

`serve.py` reads `APP_BASE_PATH` and `APP_ENABLE_SERVICE_WORKER` too (the latter in any letter case), and takes its port as the first argument (default 8090).

## Build-time variables

| Variable | Read by | Effect |
|---|---|---|
| `MINDROOM_BUILD_VERSION` | `scripts/build-version.mjs` | Build version in `version.json` and the service worker URL. Otherwise Netlify's `COMMIT_REF`, then `GITHUB_SHA`, then the checked-out Git commit, then Netlify's `DEPLOY_ID`, else `source-` and a digest of the files the build is made from. A build with client plugins (`MINDROOM_CLIENT_PLUGINS`) adds `-plugins-` and a digest of their files to it, and cuts a longer version short to keep the whole within the 128 characters pages accept. |
| `MINDROOM_RELEASE_VERSION` | `scripts/build-version.mjs` | Release name shown in Settings > About and in `version.json`. Otherwise the nearest release tag `vYYYY.M.N` as `git describe` names it (`v2026.11.3`, or `v2026.11.3-4-g1a2b3c4` four commits later), else `v<package version>`. A build from `git archive` has no tags to describe: pass the name in. iOS builds pass the app's version (`docs/ios-release.md`). |
| `MINDROOM_CLIENT_PLUGINS` | `scripts/client-plugins.mjs`, `scripts/build-version.mjs`, `vitest.config.ts` | Client plugins to build in: their directories, absolute and comma-separated, each with its own installed `node_modules` and a `package.json` that declares the plugin ([`architecture.md`](architecture.md#client-plugins)). The build fails, naming the directory, when one has no readable `package.json`, no `version` or no `mindroomClientPlugin` declaration, an id that is not kebab-case or that another listed plugin has, an `apiVersion` (the client SDK version the plugin needs) that is not a whole number from 1 or that is newer than the build's SDK (4), naming the plugin, or an entry that does not exist, and, naming the package too, when a plugin lists a package the app shares with plugins under `dependencies`. Unset, no plugin code ships. The unit tests (`just test`) also run the listed plugins' tests ([`architecture.md`](architecture.md#client-plugins)). The notices the build ships (`public/licenses/`) also list each plugin's installed production packages, from its `package-lock.json` (the build fails for a plugin that installed packages without one), and `just license-check` with the same variable also checks every package installed in each plugin's directory. The build version (`MINDROOM_BUILD_VERSION`) covers the plugins: each one's files in the listed order, without any `node_modules` (its lockfile stands for them) or `.git` in it, so a rebuild that changes only files in plugin directories offers open apps the update. Code a plugin takes from outside its directory, such as a linked package or a lockfile higher up, is not covered. The image build takes it as a build argument, for directories inside the build stage: `--build-arg MINDROOM_CLIENT_PLUGINS=/src/plugins/example` for a plugin the build context holds at `plugins/example`. |
| `MINDROOM_COMPUTER_API_URL` | `scripts/ios-client-config.mjs` (`npm run build:ios`) | Written into the iOS bundle's `mindroom.computers.apiUrl`. An empty value leaves it unset, so the app uses the origin the room's agents publish; it does not turn computers off. |

`npm run build:ios` writes `dist/config.json` from `config.mindroom.json` with `config.mindroom.ios.json` merged over it: objects merge key by key, and any other value replaces the base one. The shipped iOS overlay turns canvases and canvas libraries on. The Android build uses `config.mindroom.json` as it is.

### Development and test variables

The e2e scripts set these; they are listed so their effect is not a surprise.

| Variable | Effect |
|---|---|
| `MINDROOM_E2E_PROVISIONING_URL` | The dev and preview servers answer `/config.json` with `config.mindroom.json` whose `sidebar.mindRoomProvisioningUrl` is this origin (Playwright sets it to the app's own origin, where the specs stub the service). |
| `E2E_APP_PORT`, `E2E_MATRIX_PORT` | App and homeserver ports of an end-to-end slot (`scripts/e2e-slot.sh`). A slot's dev server keeps its own Vite cache. |
| `E2E_NO_WATCH` | `1` makes the dev server serve files as they were at its start. |
| `E2E_PORT`, `E2E_SERVER_COMMAND`, `E2E_REUSE_EXISTING_SERVER` | Override Playwright's app port, server command, and whether it reuses a server already listening (`playwright.config.ts`). |
| `E2E_SNAPSHOT_ROOT`, `E2E_MAX_CONCURRENT` | Where slot snapshots, builds and run tokens live, and how many slot runs go at once ([`development.md`](development.md#end-to-end-specs)). |

The variables the specs themselves read are listed at the top of `e2e/global-setup.ts`.

## Homeserver well-known

The client reads these keys from the homeserver's `/.well-known/matrix/client`:

| Key | Effect |
|---|---|
| `m.homeserver.base_url` | The client-server API base URL. Without a well-known (404), the address typed or configured is used as the base URL. |
| `org.matrix.msc4143.rtc_foci` | The first `livekit` entry's `livekit_service_url` is the MatrixRTC service for calls. The client reads it from `https://<server name>/.well-known/matrix/client` first, then asks the homeserver's `/rtc/transports`, then reads the well-known at the homeserver's base URL. |
| `io.mindroom.bug_reports.admins` | Matrix user IDs that receive bug reports. |
| `io.mindroom.emoji.room` | Alias or ID of the room that holds the server's shared custom emoji. |
