# Client plugins

A build can add code from outside this repository: `MINDROOM_CLIENT_PLUGINS` names plugin directories ([`configuration.md`](configuration.md#build-time-variables)).
Each has its own installed `node_modules`, so this repository's `package.json` and lockfile stay as they are, and a `package.json` that declares the plugin:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "mindroomClientPlugin": { "id": "my-plugin", "apiVersion": 6, "entry": "./src/index.tsx" }
}
```

`scripts/client-plugins.mjs` checks each declaration, failing the build on one it cannot use, and replaces `src/app/plugins/pluginEntries.ts`, which lists no plugins, with a module that imports each entry. Without plugins none of their code ships.

## The client SDK

A plugin imports the app only through the client SDK, `@mindroom/client-sdk/<subpath>`; the build resolves each subpath that `CLIENT_SDK_ALIAS` in `scripts/client-plugins.mjs` lists to its module in `src/client-sdk/`, and `tsconfig.json` maps `@mindroom/client-sdk/*` to `src/client-sdk/` for this repository's type checks.
Each subpath is a module of its own, so a plugin's entry, which loads with the app, binds only the subpaths it imports.

### `core`

`core` has the plugin types (`ClientPlugin`, `MessageRenderer`, `PluginEvent`, `PluginPage`, `PluginPageProps`, `MessageLink`, `MessageLinkCardProps`), `usePluginConfig`, `usePluginStorage`, `usePluginTranslation`, `getPluginTranslation`, `useRoomSidePanel`, `usePanelFrame`, `pluginRoutePath`, `usePluginRouteHref`, `pluginPublicUrl`, `reloadForNewVersion()`, which reloads the page into the newest version the server has, as the app's own update notice does, also when the page has not noticed that version yet, and `commandUsage()`, the refusal a slash command's `run` throws to show its usage.

### `matrix`

`matrix` has the signed-in account's Matrix data, as the app reads it: `useMatrixClient()`, the account's `MatrixClient`;
`useRoomMembers(client, roomId)`, the room's members (matrix-js-sdk's `RoomMember`, with `membership`, display `name` and avatar), rendered again on each change of a member's membership, name or power level, the full list loaded in the background, and after a switch to another room never the previous room's;
`hasActiveMindroomAgent(members)`, the app's own test of a room with an agent: whether a member who has joined or is invited has a MindRoom agent's user ID, and `isMindroomAgentUserId(userId)`, its test of one user ID: whose localpart starts with `mindroom_`, in any letter case, on any homeserver, so both name agents but prove none;
`useRoomPermissions(room)`, what the room lets a user do, as the app answers it: `event(eventType, userId)` and `stateEvent(eventType, userId)` for sending events, `action(action, userId)` for `invite`, `kick`, `ban` and `redact`, and `notification(key, userId)` for a notification such as `room` (`@room`), from the room's power levels and, from room version 12, its creators, who outrank every level, rendered again when either changes;
`getRoomPermissions(room)`, that answer read once from the room's current state, for code that is no component, such as a slash command's `run` or a room menu entry's `shows` and `run`;
read it again for a later answer;
`getMemberDisplayName(room, userId)`, the name the app's timeline and member list show for a member of the room, with the user ID after it (isolated, between U+2066 and U+2069) when another member shows a name that reads the same (a member without a name shows as their user ID's localpart) or the name looks like a user ID or holds hidden characters, which are left out, and for one who left without a name the name they last had, or undefined for someone without a name of their own, whom the app names by their user ID's localpart, or whom the room does not know, decided from the members the client has loaded (in a room whose member list has not loaded yet, a copied name may show without the user ID);
and `useMediaAuthentication()`, whether the app asks the homeserver's authenticated media endpoints (Matrix 1.11), which it does once the homeserver has them and a service worker that adds the access token controls the page, or in the native app, rendered again when a service worker takes control, for `mxcUrlToHttp(client, mxcUrl, useAuthentication, width?, height?, method?)`, the HTTP URL of an `mxc://` URI as the app's own media use it, a thumbnail when a size is given (`method` `crop` or `scale`), or null;
in the native app without a service worker it carries the account's access token, so it is for the account's own requests only.

### `room`

`room` takes the user to rooms and threads, names the thread a room's page shows, creates sub-rooms and names the rooms a room is a sub-room of, shows a person's profile card, names the floating one that is open and closes it, and shows a thread on a plugin's own surface: `useRoomNavigate()` gives `navigateRoom(roomId, options?)`, which opens a room where the app opens it (in its space, in Direct, or in Home), and `navigateRoomThread(roomId, threadId, options?)`, which opens a thread whose back button leads to its room (a step back when the thread was opened from the room, else the room in the thread's place, so the browser's Back returns to the page it was opened from), where the app's own thread links open it: in the room page's thread column, beside the room's messages once the person chose that on this device and the page has room for both, else filling the page.
`options` is `{ eventId?, replace? }`: `eventId` opens the room, or the thread, at that event, scrolled to and marked as the app's own message links open one, and `replace: true` puts the room or the thread in place of the current page in the history, so Back skips that page.
Only those two count, so a callback's extra argument there (an index, a click event) opens the room or the thread itself, as a new page.
And `useRoomHref(roomId, threadId?)` is the `href` of the room or the thread at that path, with the base path or the hash router the app uses.

#### The shown thread

`useShownThread()` is the root event ID of the thread the room's page shows, the one `openBesideThread` of `useRoomSidePanel` takes, also when the page's address names a reply in that thread, for a component in the room's page (in the room header slot, a message renderer or a side panel), rendered again when the room shows another thread;
it is undefined while the page shows the room's own timeline, until the room has the event the address names (so never a reply's ID), while the server has not confirmed the root (a new thread's first message, still sending, has no ID a plugin could use), and outside a room's page (the search page, and a plugin's test, where `renderPluginComponent` renders none).

#### Sub-rooms

`createSubRoom(parent, { name })` creates a sub-room of the room `parent` called `name`, as the room menu's New Sub-room does, and resolves to its room ID: listed under `parent`, open only to its members, and encrypted and federated as `createRoom` in `config.json` says when it is called, with no option for either.
The room menu offers New Sub-room in chat rooms only, not in spaces or direct chats, and `offersSubRooms(room)` says whether it offers it in `room`; `createSubRoom` takes any room it may list rooms in, so a plugin asks `offersSubRooms` to offer it where the menu does.
`createSubRoom` is no hook, so a slash command's or a room menu entry's `run` calls it as well as a component; it refuses, creating nothing, a blank name, a parent where the signed-in user may not list rooms, and a call while the app provides no configuration (in a plugin's test, while nothing `renderPluginComponent` rendered is mounted).
When the homeserver refuses to list the new room under `parent`, it leaves and forgets the room, if the homeserver lets it, and rejects with that refusal.
It resolves once the server has created the room, before sync has it, and does not open it; `navigateRoom` does.
`useParentRooms(room)` gives the chat rooms the client has that list `room` as a sub-room, spaces left out, as the room menu's Remove from lists them, rendered again when a link to `room` changes; `getParentRooms(room)` reads the same once, as `offersSubRooms` does, for a slash command's or a room menu entry's `run`.
In a plugin's test, where the app follows no rooms, `useParentRooms` gives none and `offersSubRooms` takes no room for a direct chat.

#### Profile cards

`useOpenUserProfile()` gives a function `(roomId, userId, anchor, side?)` that opens the profile card of the person `userId` in the room `roomId` as a mention pill opens it: floating at `anchor`, an element's rectangle (`getBoundingClientRect()`), on its `side` (`Top`, `Right`, `Bottom` or `Left`, where `Left` and `Right` follow the reading order; below it unless given), until Escape or a click outside closes it;
for a room the client does not have, it opens nothing, also once sync brings the room.
`useShownUserProfile()` is the floating card that is open, whether `useOpenUserProfile` or the app's own mention pills, member rows and senders' names opened it: `{ roomId, userId }`, the room and the person it shows, or undefined while none is open, rendered again when it closes or shows another person or room; `useCloseUserProfile()` gives a function that closes it.
The card closes on an Escape that reaches the document without `preventDefault`, and the window does not hear it then (a listener on the document added after the card opened still does, once the card has closed).
So a plugin whose own surface closes on Escape leaves one alone while `useShownUserProfile` names a card, reading it as the Escape arrives, before the card: a plugin that closed its surface on that Escape and cancelled it would leave the card open over nothing, and one that hears Escape on the document in the capture phase may close the card itself with `useCloseUserProfile`.
`UserProfileCard` (`{ room, userId, onDone }`) is that card itself, for a plugin's own surface such as its side panel: the person's avatar, name and ID, power tag, shared rooms, server, Message, moderation and blocking, as the floating card shows them; `onDone` runs once the card has done its job: before it opens a direct chat, a shared room or the settings, and when a call starts.
Like the floating card, it starts afresh when `room` or `userId` changes, so what was begun for one person, such as a ban and its reason, never goes to the next.

#### `ThreadView`

`ThreadView` (`{ room, threadId }`) is the thread `threadId` (its root's event ID) of `room` as the room's page shows it, for a plugin's own surface such as its side panel: the root and its replies with the app's message actions and link cards, and floating over the timeline's end, as on the room's page (`ConversationLayout`), the thread's background jobs and tool approvals, the typing notice, the composer while the signed-in account may post in the room (else why not, also in an upgraded room, and the Retry and Delete of a root that did not send) and read receipts.
It fills its parent, a flex column, and scrolls inside it; its timeline and composer load only once one renders, so a plugin entry that imports `room` adds nothing to the app's start, and it shows nothing while they load.
It may show a thread of the room whose page is open, also the one that page shows: it is a conversation view of its own (`src/app/navigation/conversationView.ts`), so its composer has a reply and staged files of its own, which go with it when it unmounts, while the thread's unsent text is the one draft both composers show, and it records voice messages into its thread: one composer in the app has its recorder open at a time, and opening another one ends the recording as leaving the room does, and a voice message whose send failed comes back in a view of its thread;
Reply drafts in the composer of the timeline it was chosen in, and Up in an empty composer edits only in the timeline of the composer that has the focus;
and while the room's page is behind the panel (on a phone, or filling the room) the view's composer keeps its menus and typing notices (not while its own side panel is folded), and read receipts and notifications count the thread as on screen while the view shows it, not while its side panel is folded or under a phone's navigation drawer.
Its menus, and the profile card its rows open, take their Escape at the document, after it bubbled through the plugin's elements, so a plugin that closes its surface on Escape listens on the window, which only an Escape nothing took reaches (one that is not `defaultPrevented`), as the example plugin's Example thread panel does.

### `server`

`server` reaches the room's MindRoom server, for a plugin whose MindRoom plugin serves routes under `/api/plugins/<name>/` (MindRoom's `docs/plugins.md`, "HTTP routes"): `useMindroomServer(roomId)` gives that server by the rule call transcripts use (the one the room's agents published while the homeserver binds sign-in tokens to it and the deployment trusts it, else `mindroom.computers.apiUrl` from `config.json`), or undefined in a room without a MindRoom agent or without either.
Until the room's members and the homeserver's answer on binding tokens are in (at the page's start, and on a switch to a room whose members still load), it can be undefined, or the configured server with the published one after it;
`useMindroomServerStatus(roomId)` gives `{ server, pending }`, `pending` with no `server` until both are in and then the server `useMindroomServer` gives, for a plugin that signs in at once or tells the person there is no server;
that server can still change after, as when an agent that just joined publishes its own.
A check that could not reach the homeserver counts as an answer that it binds no tokens, and a member list that could not load as the members the client has.
A room the client does not know has no member list to wait for: once the homeserver answered, it has no server, and once the client learns of the room, as by a join or an invite, it is `pending` again until the room's members are in.

#### Room computers

`useRoomComputers(roomId)` gives the room's agents with a computer, by the rule of the room's own computer button (with a computer server set, the person's in Settings, else `mindroom.computers.apiUrl`, every agent that joined but one whose MindRoom says it has none; without one, each agent that published a computer, while the homeserver binds sign-in tokens), each as a `RoomComputer`, `{ userId, name, server, openSession(signal?) }`.
`server` is the agent's own MindRoom server, a `MindroomServer` as `useMindroomServer` gives the room's, sharing the account's session there: the one `openSession` signs in to, which is the computer server set for every agent when there is one, else the server the agent published, with a session for a token bound to it.
In a room whose agents publish different servers, each agent's own server is the one to use for that agent's routes and websockets.
Each agent's `server` stays the same object while that agent's server does, for every caller.
Within one component's `useRoomComputers`, while the agent stays listed in the same room with that server and the token's binding, its `openSession` stays the same function too, and its `RoomComputer` the same object until the agent's name changes.
So a plugin may key work on them, as on a React dependency.
`openSession` opens a session on that computer as the room's computer panel does, once: a sign-in token for the computer's server (bound to it when the agent published that server), then the session for that room and agent, which starts in `view` mode.
It resolves with the session (`ComputerSessionClient`): its `status` (`ComputerStatus`: `state` `starting`, `ready` or `stopped`, and `mode` `view` or `control`), `refreshStatus()`, `createStream()` (a `ComputerStreamConnection`, the URL and subprotocols of the screen's RFB websocket, which must be open for `control('take')`), `control(action)` with `take`, `release` (which also closes that websocket) or `stop`, and `dispose()`, which ends it on the server, each with an optional `signal`;
and it rejects with `ComputerApiError` and its `status`: 0 when the homeserver could not give a sign-in token, the server gave no answer or the signal aborted, 403 when the homeserver will not sign in there (it binds no tokens to a server the agent published), else the server's refusal.
Retrying, reconnecting, choosing an agent for the person, drawing the screen and ending a session the plugin no longer shows are the plugin's.

#### `MindroomServer`

The server has its `origin`;
`request(path, init?)`, which sends a request to that path as the signed-in user, with their client session as bearer and no cookies, and resolves with the answer's JSON, undefined for an empty answer, or rejects with `MindroomServerError` (its `status`, 0 without an answer or for one that is not JSON, and the parsed `body`), and rejects with a `TypeError` for a path that leads to another origin before sending anything;
`send(path, init?)`, which sends as `request` does, never from the HTTP cache, and resolves with the answer's `Response` whatever its type or status, such as an image a route serves, and rejects as `request` does without an answer, when the sign-in fails or for another origin;
`openSocket(path)`, which resolves with a `WebSocket` (`wss:`, or `ws:` for an `http:` server) that offers the session as `mindroom-session` and `mindroom-session.<token>`, as MindRoom's `client_stream` takes it, and rejects as `request` does when the sign-in fails;
and `token({ signal?, refused? })`, the session's token for a request `send` cannot make, such as an upload that reports its progress through `XMLHttpRequest` with `Authorization: Bearer <token>`, asked for anew for each request and never kept: it signs in when there is no session or it is about to run out, and after a 401 the plugin asks again with `refused`, the token the server refused, which signs in again, and sends once more.
The app and every plugin share one session per account and server, since MindRoom keeps eight per user and a ninth sign-in ends the oldest (`src/app/computer/clientSessions.ts`): it is renewed a minute before it runs out, a 401 signs in again and sends once more (so a plugin's route refuses with 403, never 401, for reasons of its own), and sign-out ends every session the page may still hold there (`DELETE /api/client-sessions`), once a call transcribed on this device left with it (3 seconds at most).
Reconnecting is the plugin's: the server closes a socket with 4401 once its session ends, after which the next `openSocket` signs in again, with 1012 when the plugin reloads, with 1008 once the user left the room and with 1013 while membership is unavailable;
a handshake it refused shows only as a socket that closes before it opens, so the next `openSocket` first asks `GET /api/plugins` whether the session lives and signs in again only on a 401, and a refused origin or membership never ends the user's other sessions.

### `ui`

`ui` has the app's own components, with the app's props, so a plugin's menus, dialogs, pop-outs and rows look like the app's, in its theme: the glass `Menu`, `Dialog`, `Header` and `IconButton`;
`MenuEntry` and `MenuGroup`, the room menu's rows and the groups they come in;
`NavItem`, `NavButton` and `NavItemContent`, the sidebar's rows;
`PopOut`, folds' pop-out placed in reading order, so on a right-to-left page its `position` `Left` and `Right` trade places, and so do its `align` `Start` and `End` along the anchor's top or bottom;
and `IconTooltip`, an icon button's tooltip, placed so too.

#### Text as the app shows it

For text, such as an agent's, that a plugin shows as the app does, `ui` also has `useMarkdownHtml(markdown)`, the HTML of `markdown` as the app renders an agent's reply while it streams: sanitized, with the link schemes `messageRendering.additionalAllowedUriSchemes` in `config.json` adds;
undefined until the app's Markdown renderer has loaded, which it starts loading, and rendered again once it has;
`sanitizeHtml(html)`, `html` with only what the app keeps of a message's HTML, under the app's default policy, which a plugin cannot loosen: no script, event handler or `javascript:` link, and images only from `mxc://` sources, which `mxcUrlToHttp` turns into ones a browser loads;
and `replaceMatrixUserIdsWithDisplayNames(room, text)`, `text` with the Matrix user ID of each member of `room` replaced by the name the app shows for them there, also before trailing punctuation, as thread previews show an agent's message, which names people by their IDs;
other IDs stay.
The names it puts in are plain text: in Markdown given to `useMarkdownHtml` afterwards, a name's own Markdown takes effect, and IDs in code or in a link's target are replaced too.
The plugin puts the HTML into its own element (React's `dangerouslySetInnerHTML`), without what the app adds as it draws a message, such as: links and mentions in it are plain links, without the app's pills or link handling;
math stays as its `$` text, which the app typesets;
a spoiler (`data-mx-spoiler`) shows, where the app hides it until a click;
and direction controls (such as U+202E, which reverses what follows) stay as they are, as in any text a plugin renders, where the app shows them as code points (`<U+202E>`).

#### A plugin's own surfaces

For a surface a plugin draws itself, such as a side panel with `frame: 'own'` or a page, `ui` also has `useThemeKind()`, `light` or `dark` as the app applies its theme, the person's choice or the system's, rendered again once another kind is on the page, for code that needs the kind, such as a chart's colors (styles take the app's CSS variables);
`useScreenSize()`, `Mobile`, `Tablet` or `Desktop`, the size the app lays out by, rendered again when it changes, so a plugin and the app agree on what a phone is;
and `pdfFrameUrl(objectUrl)`, the URL for a plugin's own `<iframe>` that shows a PDF it holds as a `blob:` object URL in the browser's viewer: the app's frame page under the app's base path, with the object URL after `#`, since the app's frame policy refuses `blob:` frames;
the page shows the object URL's bytes as a PDF whatever type its blob carries.
For any other URL it is undefined, as the app's own PDF viewer shows none.
A browser without a PDF viewer of its own (`navigator.pdfViewerEnabled` false, as in Android's WebView and Chrome on Android) shows an empty frame there, so the app offers only a PDF's download in such a browser, and a plugin can check that flag the same way.

#### Panels that move

For a side panel with `frame: 'own'` that moves in and out as the room's panels do (they move only beside the conversation, not while they fill the room or on a phone), `ui` also has `usePanelPresence()`, the panel's place among the room's side panels, undefined outside one: its `phase`, `shown` (there as the room showed, so it does not move in), `enter` (just opened), `swap` (opened in another panel's place) or `exit` (closing);
`register()`, which a `Component` that moves calls once while mounted, from a layout effect that depends on `register` and returns what `register()` returns, so that once closing it stays until it calls `done()`, after it has moved out (if it goes first, such as when a failure takes its place, the place lets it go then);
what `register()` returns (a `PanelRegistration`) also has its own `done`, the presence's `done` while it is registered, which ends nothing once it has unregistered, so a motion that ends after its panel has gone (another panel took its place, which may close in turn) leaves the next panel's exit alone (call it only for the exit you are animating; a kept `done` from an earlier exit is not supported), where the presence's `done` ends whichever exit is current;
and `lastWidth`, a ref to the width in pixels the last panel there had as it left, which one in `swap` starts from: the room's own panels set it as they go (to undefined when they did not move, so the next one shows at its own width), and a moving panel may too.
`animatePanel(element, from, to, hold)` moves `element`'s width (and `gap`, the room a panel adds beside itself, as a negative start margin) in the time and on the curve the room's panels take, from `from` (`{ width, gap }`, in pixels): with `hold` to `to`, where it stays, for a panel about to go, and otherwise to the width and gap `element` is styled with, where it settles.
It returns the `Animation`, whose `finished` a closing panel waits for before `done()`, or undefined, moving nothing, under reduced motion or without the Web Animations API, when a closing panel calls `done()` at once.

#### In unit tests

The app's unit test setup draws `Menu`, `Dialog`, `Header` and `IconButton` as folds' plain components, so in a plugin's tests a menu's rows are found by their text, not as `menuitem`s.

### `testing`

`testing` is for a plugin's tests only: only the unit tests resolve it (`vitest.config.ts`), so the build fails on code that ships and imports it.
`renderPluginComponent(ui, { id, plugin, config, language, client, frame, screenSize, themeKind })` renders a plugin's components into the document (the test needs `// @vitest-environment jsdom`) with `config` as the plugin's `config.json` section, its strings in `language`, English unless named, `client` as the account's client (such as one from matrix-js-sdk's `createClient({ baseUrl, userId })` whose store holds the test's rooms; unless given, a stand-in that has its user ID, builds media URLs for `mxcUrlToHttp` on `https://example.org` and knows no room), `frame` as the side panel frame `usePanelFrame` returns, as the app gives it to a panel with `frame: 'own'` (unless given, none), `screenSize` as the size `useScreenSize` returns (`Desktop` unless given), `themeKind` as the kind `useThemeKind` returns, marked on the document's root element as the app marks it, until the test ends (unless given, the kind marked there, `light` when none is), and its storage for that account, signed in, and unmounts them after each test;
what they store stays for the rest of the test file.
`registerPluginStrings(id, plugin)` registers the strings of `plugin`, its entry's default export, as `renderPluginComponent` does first, for a test that renders with React Testing Library's `render` or `renderHook` instead, so that `usePluginTranslation` translates with them there too.
`<PanelPlace>{panel}</PanelPlace>` holds `panel`, a keyed element or none, in the room's place for a side panel, so a test of a panel with `frame: 'own'` that moves with `usePanelPresence` and `animatePanel` rerenders it with another key to swap panels or with none to close one: a panel that registered stays while it moves out until its registration's `done`, and a later `done` of a panel that has gone ends nothing.
The room catches a panel that fails inside the place, so a test of one puts its own error boundary around the panel.
A component that needs more of the app, such as a router for `usePluginRouteHref`, the `room` hooks or `UserProfileCard`, gets it from the element `renderPluginComponent` renders (a `MemoryRouter` of the shared React Router around it);
the app's floating profile card is not rendered there, so what `useOpenUserProfile` opens does not show;
one that uses `useMindroomServer`, `useMindroomServerStatus` or `useRoomComputers` needs a `client` from `createClient`, whose homeserver the hook asks through `fetch` whether it binds sign-in tokens, so the test stubs `fetch` (`useMindroomServerStatus` is pending until the stub answers).

### `fixtures`

`fixtures` is for a plugin's end-to-end fixture pages only (docs/development.md "A client plugin in its own repository"), which render its components on their own in the browser: the dev server, the fixture page build and the unit tests resolve it, the app's build does not, and it imports nothing of Vitest.
`bootFixturePage({ id, plugin, appearance, language })` sets the page up as the app sets itself up before it renders: the app's styles and fonts, its light or dark theme (`appearance`, `light` unless given) marked on the root element as `useThemeKind` reads it, and the plugin's strings for `usePluginTranslation` and `getPluginTranslation` in `language`, else the language the app would pick in that browser; it resolves once they have loaded.
`fixtureMindroomServer({ client, apiUrl })` is the `MindroomServer` at `apiUrl` for a signed-in matrix-js-sdk `client`, as `useMindroomServer` gives it, built outside React and sharing the account's session there; its sign-in asks for a token the homeserver binds to that server.

## SDK versions

`apiVersion` is the SDK version the plugin needs: the build refuses a plugin that needs a newer one than it provides (`CLIENT_PLUGIN_API_VERSION` in `scripts/client-plugins.mjs`, now 55), naming the plugin.
The SDK only grows: nothing a plugin uses is changed or removed, and each addition raises that version, a new export as well as a new kind of contribution in `ClientPlugin` or a new field of the declaration, so a plugin built for an older SDK still builds and one that uses a newer addition never builds into a client that would ignore it.

### What each version added

- version 1 had no SDK
- version 3 added header actions
- version 4 added account storage
- version 5 added pages
- version 6 added `pluginPublicUrl`
- version 7 the `testing` subpath
- version 8 conversation covers
- version 9 the `matrix` subpath and `renderPluginComponent`'s `client`
- version 10 the `room` subpath and `reloadForNewVersion`
- version 11 `useRoomSidePanel` with side panels' `request` and `remember`
- version 12 slash commands
- version 13 slash commands' `threadId`
- version 14 the room header slot's `headerRef`
- version 15 room menu entries
- version 16 `useRoomNavigate`'s `eventId` and `replace`
- version 17 side panels' `icon` and `placement`
- version 18 the `server` subpath
- version 19 room menu entries' `critical`
- version 20 `matrix`'s `isMindroomAgentUserId`, `useRoomPermissions`, `useMediaAuthentication` and `mxcUrlToHttp`
- version 21 `createSubRoom`
- version 22 `useRoomSidePanel`'s `openBesideThread`
- version 23 `useOpenUserProfile` and `UserProfileCard`
- version 24 the `ui` subpath
- version 25 the declaration's `build`
- version 26 side panels' `label` as a key of the plugin's strings and their `opensOverMembers`
- version 27 side panels' `frame` and `usePanelFrame`
- version 28 `ui`'s `useMarkdownHtml`, `sanitizeHtml` and `replaceMatrixUserIdsWithDisplayNames`
- version 29 `renderPluginComponent`'s `frame`
- version 30 side panels' `placement` `row`
- version 31 `matrix`'s `getRoomPermissions` and `getMemberDisplayName`
- version 32 `server`'s `send` and `token`
- version 33 `getPluginTranslation` and `commandUsage`
- version 34 `room`'s `useParentRooms`, `getParentRooms` and `offersSubRooms`
- version 35 `ui`'s `useThemeKind`, `useScreenSize` and `pdfFrameUrl`
- version 36 `room`'s `useShownThread`
- version 37 `server`'s `useMindroomServerStatus`
- version 38 `ui`'s `usePanelPresence` and `animatePanel`
- version 39 `renderPluginComponent`'s `screenSize` and `themeKind`
- version 40 `server`'s `useRoomComputers`
- version 41 the `done` of what `ui`'s `register()` returns
- version 42 `server`'s `RoomComputer.server`
- version 43 `messageLinks`
- version 44 `ui`'s `PINCH_SURFACE_ATTRIBUTE`
- version 45 `room`'s `useShownUserProfile` and `useCloseUserProfile`, and `testing`'s `registerPluginStrings`
- version 46 the hooks of build modules in the unit tests, with `MINDROOM_CLIENT_PLUGIN_TESTS_ONLY` and the configs a plugin outside this repository extends
- version 47 `room`'s `ThreadView`
- version 48 `MessageRenderer`'s `preview`
- version 49 the end-to-end specs of a plugin directory in `E2E_PLUGIN_DIRS`, in a Playwright project of their own, with `@mindroom/e2e/*` and `@playwright/test` in `tsconfig.plugin.json`
- version 50 `ui`'s `usePinchSurface` and `SurfacePinch`
- version 51 `ui`'s `PINCH_CHROME_ATTRIBUTE`
- version 52 `room`'s `navigateRoomThread` opening a thread in the column beside the room's messages where the person chose that
- version 53 the `fixtures` subpath
- version 54 `testing`'s `PanelPlace`
- version 55 a message renderer's `hidden`

## Pinches

Pinches: the app turns a pinch into its page zoom (`src/app/theme/usePinchToZoom.ts`), except over an element that has the attribute `ui`'s `PINCH_SURFACE_ATTRIBUTE` names (`data-pinch-surface`, with any value), such as a board or slides that zoom themselves, or the image viewer.
A touch pinch is the element's when every finger down as it starts landed inside it (each finger's `Touch.target`, which stays where it landed), and stays its own until fewer than two fingers are down, also when another finger lands outside it or the element under a finger is removed; a pinch that starts with a finger outside it stays the app's.
Safari's `gesturestart`, `gesturechange` and `gestureend` go with the touch pinch they come with; a trackpad's, and ctrl with the wheel, are the element's when their `event.target` is inside it.
Chrome inside such an element, such as its toolbar or a field on it, has the attribute `ui`'s `PINCH_CHROME_ATTRIBUTE` names (`data-pinch-chrome`, with any value): a pinch with a finger, or a trackpad's or ctrl with the wheel with its `event.target`, on chrome is the app's, as if no marked element were around it, also when that element is nested in another, while an element marked inside chrome keeps the pinches whose fingers all land on it (one with a finger outside it is the app's, since that chrome is between it and the element around).
An element that zooms itself marks itself with `ui`'s `usePinchSurface(ref, { onPinch })`, which sets the attribute on `ref`'s element while it is mounted, and the app hands `onPinch` each pinch it leaves that element by this rule, so the element repeats none of it and never sees a pinch the app took: a `SurfacePinch`, `{ phase, scale, centre }`, whose `phase` is `start`, then `move` as the pinch changes, then exactly one `end`, also when the pinch's own end was lost (a pointer end, `gestureend`, a touch event with fewer than two fingers or the next pinch's start ends it) and when the hook goes or, as the hook's component renders, its `ref` names another element mid-pinch (it ends then, with the `onPinch` that element had, and the rest of that pinch is handed to nobody), `scale` the pinch's spread against its start and `centre` its point in client coordinates.
A touch pinch measures its first two fingers' distance and midpoint, and starts again from the two first fingers when a finger that lands or lifts makes them others (fewer than two ends it);
a trackpad's gesture, with no finger down, starts as it first changes, unless a touch has come by then, and gives `gesturechange`'s `scale` and the event's point;
ctrl with the wheel folds the deltas into one scale (`exp(-deltaY / 100)` each, as Chromium makes them from a trackpad's, with `deltaY` in pixels: a line is a third of a 100 px notch and a page a notch, as the page zoom counts them too), at the pointer, and ends once the wheel rests for 200 ms.
Only the innermost marked element that owns a pinch gets it, so nested surfaces never both do, and an element marked only by the attribute gets no `onPinch`.
To zoom its content around the pinch as a CSS transform, a surface gives the content `transform-origin: 0 0` and `transform: translate(x, y) scale(s)`: at `start` it keeps the content's `s0`, `x0` and `y0` and the centre `p0` in its own coordinates (`centre` less its element's `getBoundingClientRect()` left and top and its border, `clientLeft` and `clientTop`, for content laid out inside the border), and at each `move`, with `p` the centre so measured, `s = s0 × scale`, `x = p.x − (p0.x − x0) × scale` and `y = p.y − (p0.y − y0) × scale`, which keeps the point of the content under the fingers where the pinch started (the example plugin's pinch board does this).
The surface owns that zoom, and the app keeps none of it: it resets it (scale 1, no translation) when it closes or shows other content, so it opens again unzoomed.
For a pinch it hands an element, the app calls `preventDefault()` on the two-finger `touchmove`, the `gesture*` events and ctrl with the wheel itself, so iOS Safari does not magnify the page and other browsers do not zoom it.
An element marked only by the attribute, such as the image viewer's frame, whose own listeners zoom the picture, takes only the pinches the app leaves it, by the same rule (the gesture events of a pinch that started with a finger outside it are the app's, though they may arrive at it), and calls `preventDefault()` on those events itself.
One-finger touches, such as a scroll or a tap, are never affected.

## Shared packages

The app shares its React, React DOM, matrix-js-sdk, jotai, TanStack Query, React Router, i18next and react-i18next, folds, focus-trap, focus-trap-react, dayjs and react-aria, with the packages some of them are built on (scheduler, @tanstack/query-core, @remix-run/router), with every plugin (`SHARED_PACKAGES` in `scripts/client-plugins.mjs`): in a build and in the dev server, a plugin's imports of them, and those of the packages it installed, resolve as the app's own imports do, to the app's copies in the app's versions, so the state each keeps is one (the Matrix SDK's classes, query caches, atom stores, the router, translations, focus traps, the date locale, the scroll lock, overlay stack and focus scopes of dialogs and menus);
a CommonJS package's `require` of one gets the module the app imports too.
A build needs none of them installed in the plugin's directory, wherever it is, and does not use a copy installed there (for the plugin's tests, or for one of its packages); an import the app's copy cannot resolve, such as a file only a newer version has, fails the build.
A plugin directory inside another one belongs to the inner plugin, and the app's own directory inside a plugin directory to the app.
The dev server pre-bundles the packages a plugin installed without plugin hooks; there an esbuild plugin in `scripts/client-plugins.mjs` resolves their imports and requires of the shared packages.
Not redirected: packages linked in from outside the plugin's directory (`npm link`, `file:`), which the notices and the bundle report below do not count as the plugin's either, a plugin's `?worker` bundles in a build, and its `.css.ts` style files, which vanilla-extract compiles on its own. react-aria's scoped parts (`@react-aria/*`, `@react-stately/*`) are not shared: a plugin, or a package it installed, that imports one directly bundles the copy it installed, with focus scopes and an overlay stack apart from the app's, so a plugin imports react-aria itself.
A plugin lists the ones it imports under `peerDependencies`, never `dependencies`: the build fails, naming the plugin and the package, on one under `dependencies`, and on a copy of one the plugin bundles under another name (an npm alias).
A plugin uses the app's `QueryClient` (`useQueryClient()`, or `useQuery` without a client of its own), never one it creates: the app keeps one per signed-in account.

## Other imports

Every other import of a plugin, the client SDK's aside, resolves in its own directory, so a package the plugin installed comes from its `node_modules`, even one the app bundles too; the build's check for two copies of one package version (`scripts/package-copies.mjs`) leaves those out.
The third-party notices the build ships, which anyone can read, list the production packages of each plugin's `package-lock.json` that are installed in its directory, with their names, licenses and repositories, and `just license-check` checks every package installed there, both for the plugins `MINDROOM_CLIENT_PLUGINS` lists.
With the same variable, `scripts/perf/bundle-report.mjs` (`just bundle-report`) lists the minified and gzip size of the JavaScript each plugin adds, its packages included, from the source maps of `npx vite build --sourcemap`.

## Build modules

A declaration may add `build`, a path in the plugin's directory to an ES module whose default export is a Vite plugin or an array of them, for the transforms the plugin's own modules need, such as scoping a style sheet one of its packages ships to the plugin's own elements, or marking its modules free of side effects.
`clientPlugins` in `scripts/client-plugins.mjs` imports it and adds its plugins to the build, before its own, with each hook kept to the plugin's modules, those of the packages it installed included, as above: `transform` and `load` run only for them, the modules its `resolveId` makes up included, whose ids start with `\0`, its id and a colon (Vite's virtual modules, named for the plugin, such as `\0my-plugin:settings`), and `resolveId` only for their imports, while `name`, `enforce` and `apply` mean what they mean in Vite, so a plugin's hooks see none of the app's modules or another plugin's;
any other hook or property fails the build, naming the plugin and the hook.
A made-up module's imports resolve from the app's directory, as Vite resolves a virtual module's, unless the plugin's `resolveId` takes them.
A `resolveId` with `enforce: 'pre'` sees the plugin's imports of the packages the app shares before they resolve to the app's copies, so it can put a module of the plugin's own in place of one for a package it installed, such as a module that exports only the names a big CommonJS bundle reads; that module imports the package by its name, and the plugin's `resolveId` passes that import on (returns null for it), so it resolves to the app's copy.
The hooks run in the build, and in the dev server for the files it serves itself and in the unit tests of the plugins `MINDROOM_CLIENT_PLUGINS` lists, unless `apply: 'build'` keeps them out of both (a function `apply` gets `mode` `test` in the unit tests); not where the dev server pre-bundles the packages a plugin installed, nor in the bundles of `?worker` imports, which take only `worker.plugins`.
A build module is code the build runs, as an entry is code the browser runs: the build trusts the directories `MINDROOM_CLIENT_PLUGINS` lists.

## The entry

An entry's default export is a `ClientPlugin` (`src/app/plugins/registry.ts`): a list per kind of contribution, its strings, and an optional `forgetAccount` (account storage, below).
`registeredPlugins` freezes them, in the listed order, when its module loads, and `src/index.tsx` loads it before the app routes.
A plugin's module runs then, before `config.json` has loaded, so a plugin reads its settings (`plugins.<id>`) only while it renders, with `usePluginConfig(id)` (`src/app/plugins/pluginConfig.ts`).

## Message renderers

Message renderers (`src/app/plugins/messageRenderers.ts`) are the first kind: `{ match, Component, trust?, preview?, hidden? }`.
`RenderMessageContent` asks them before its own renderers, wherever it renders a message body: timelines, pins, and search results short enough to show whole.
`match(event)` is pure and synchronous, and sees the content the app renders the message from, latest edit included; `Component` renders it.
Only a MindRoom agent on the viewer's homeserver may send the messages a renderer takes, or with `trust: 'server'` anyone on that homeserver.
A `match` that throws counts as no match.
A `Component` that throws shows the app's own rendering instead, until the message's content changes (as a reply streams in) or another renderer takes it, and the failure is logged and reported with `[plugin <id>@<version>]`.
`preview(event)`, pure and synchronous, gives the message a one-line text for the places that show it on one line: an Activity row and a row of the Threads page show it for the thread's last reply, and for the thread's root as its title there while the thread has no AI title.
The app asks only the renderer the timeline would pick, after the trust check and `match`; it puts the text on one line, cuts it as its own previews and writes out direction controls, and a `preview` that throws or gives anything but a string or undefined (each logged once per plugin), gives undefined or gives a blank text leaves the app's own text.
`hidden(event)`, pure and synchronous, leaves a reply in a thread that the renderer takes without a row in the open thread's timeline (the room's timeline, where Classic shows thread replies, keeps it), for a message only agents need, whose answer follows: the app asks it of the renderer the timeline would pick, after the trust check and `match`, only for a reply in a thread, and only of a MindRoom agent on the viewer's homeserver whatever `trust` says, so no one else can hide a prompt to the agents from the room;
no row quotes a message it hides among the thread's loaded rows, as an agent's answer would quote the message that woke it;
a thread's root, a message outside any thread and the message a route or a jump opens keep their rows, and so does a `hidden` that throws (logged once per plugin) or gives anything but `true`.
Activity, the Threads page and Compact's thread cards still list the message, Activity and the Threads page with its `preview`.

## Side panels

Side panels (`src/app/plugins/sidePanels.ts`) are the second kind: `{ id, label, icon?, placement?, Component, remember?, opensOverMembers?, frame? }`.
Each is one more of the room's side panels, beside the computer, a canvas, the call, its live transcript, the sub-agents and the members, under their rule (`src/app/ui/panels/roomPanels.ts`): one shows at a time, and opening one closes the others, except that the members stay open behind the call or its live transcript.
Its `label` names it in the app's language when it is the key of one of the plugin's strings (`translations`, below), and exactly as given otherwise, such as text with `.` or `:` (which names no other namespace), a template like `$t(…)`, or the key of a group of strings.
Its toggle in the room header, named by its `label` and drawn with its `icon` (a folds icon such as `Icons.Star`, a bulb unless given), shows and hides it, where `placement` puts it: `auto` and `menu`, the default, as they put a header action (below), and `row` in the header's row on every screen, phones included.
The toggle is pressed, its button tinted and its menu entry checked, while the room shows the panel and the panel is not folded to its tab; choosing it then closes the panel, and choosing it while the panel is folded unfolds it with what it shows.
The panel opens in the room it was opened in, as wide as the call panel and resizable (over the room on phones), with the label as its title and a Close button (unless it draws its own frame, below), above what it shows: a column as tall as the panel, which scrolls when what it holds is taller still, and whose parts that may shrink, such as a folds `Box` or anything with an overflow of its own, shrink until the column fits the panel, to nothing if need be, before it scrolls, so a part that must keep its height takes `flexShrink: 0` (a folds `Box` `shrink="No"`), and `Component` gets the room's id (`roomId`) and a `request` (below).

### The frame

Like the computer, a canvas and the call, it has the room's frame (`src/app/ui/panels/PanelFrame.tsx`, drawn by `ResizablePanel`), with no code of its own: a 40 px strip at the start of its box, which the panel's smallest width grows by, whose Fill puts it across the room in the conversation's place, and whose Fold leaves only a tab with its `label` at the room's edge, beside the conversation at full width, until the tab brings it back.
While the room's page shows, each room keeps the layout of each of its panels as long as the panel stays open; a panel opens beside the conversation, and one asked for again while it fills the room stays so; each canvas shown, though, opens beside the conversation, or across the room from the Canvases page.
The computer's and a canvas's own Expand fill the room as Fill does.
Filling the room, or covering the conversation on a phone, a panel keeps the conversation under it as it was (its draft, a voice message being recorded, the reader's place), out of reach and out of sight as under a conversation cover (below): it takes no focus, sends no read receipt or typing notice, a message that arrives notifies as for a room not on screen, the composer's popovers (emoji board, autocomplete, model picker, menu) close, and neither an edge swipe nor the room's shortcuts for Members and resolving the thread act on it.
Phones show no frame, as a panel there covers the conversation already, and the members have none: their header button shows and hides them.
A panel with `frame: 'own'` draws its frame itself, such as a card with its own Fill and Hide: the room draws no title, Close, splitter or strip for it and gives it no box, so its `Component` takes its own width, and it opens and closes at once, without the frame's motion, unless its `Component` moves itself: it registers with `usePanelPresence()` (`ui`, above) and calls its registration's `done()` once it has moved out.
`usePanelFrame()` gives a side panel's `Component` its frame, `{ label, layout, setLayout }`: `layout` is `beside`, `filled` or `folded`, and `setLayout` changes it as the frame's Fill, Fold and tab do, kept per room as above.
The frame keeps its identity while the layout stays, and one the panel got in another room changes nothing in the room shown.
A panel the room frames has it beside the conversation only, undefined on phones; one with `frame: 'own'` has it on phones too.
Filling the room, such a panel takes the conversation's place as any does; folded, it covers nothing, on phones too, so the conversation lays out as with no panel beside what the `Component` still draws, such as its own tab at the room's edge.
Over the conversation on a phone it also hides the room header, and with it the panel's toggle, so its `Component` offers a way out of its own: Hide, which shows the conversation beside its tab, or a Close that calls `close()` of `useRoomSidePanel` (below).
While its `Component` loads its code, and if it throws, the room draws the panel's title and Close around it (below), so it can still be closed.
A `Component` that throws shows "This panel stopped working." in the panel, which can still be closed, until it gets another `request`, and the failure is logged and reported with `[plugin <id>@<version>]`.

### Opening a panel from code

A plugin's code opens its panels too: `useRoomSidePanel(id, panelId)` gives a component rendered in a room's page, such as a message renderer's card in the timeline, `{ isOpen, open, openBesideThread, close }` for the panel `panelId` of plugin `id` in that room, and undefined elsewhere (the search page).
`open(request)` opens the panel as its toggle does, under the same rule, or keeps it open and unfolds it, and hands `Component` `request`, which each `open` replaces; its toggle opens it with no request.
`close()` closes it if it shows, and `isOpen` says whether it shows.
`open` and `close` keep their identity while the room shows.
A plugin opens its panel in answer to something the person does, such as a click, never as its component mounts: the conversation's components, a message renderer's cards among them, mount again whenever it shows another thread or view, so opening there takes the side panel back each time.
The one exception is `openBesideThread(threadId, request)`, which a renderer of a thread's root message may call from an effect that depends on it, with its event's ID: it takes a new identity whenever the room shows another thread or its own timeline, so the effect asks again then, also in a card that stays mounted as its thread opens.
Only the first call since the room began to show that thread counts, so a card that mounts again does not open a panel the person closed, and once another thread or the room's own timeline has shown, the thread's next call counts again.
That call does something only while the room shows that thread and not on a phone: it opens the panel with `request`, beside the conversation, when no other side panel shows, or only the members list and the panel has `opensOverMembers: true`, which closes the list, and when the panel itself shows, it hands it the request and leaves it folded or filling the room.
Otherwise it does nothing.

### Remembered panels

A panel with `remember: true` stays open in each room it opened in, for the signed-in account, until it closes there (its Close, its toggle, another panel's opening in that room): after a reload, or a switch to another room and back, it opens again with its `request` when the room shows, unless another of the room's panels is open then (the members over the page, on phones or in a narrow room, do not count: the navigation puts them away).
With `opensOverMembers: true` the members beside the conversation do not count either: the panel opens again in their place, and they close, as when the person opens the panel.
The app keeps it in this browser, with the request as JSON, beside the account's plugin storage (`mindroom.plugin:<encoded user ID>/:side-panel/<encoded room ID>`, `src/app/room/usePluginPanel.ts`), so other accounts never see it and the app deletes it with the account's plugin storage (below).
The request should therefore hold only what the panel needs to open again, never secrets or message text.
Such a panel's `request` is a value JSON holds: when the panel opens again as its room shows, it comes back as `JSON.parse` reads it, and one `JSON.stringify` refuses (a `BigInt`, a cycle) makes `open` throw once the panel shows it, before the room remembers it.

## Strings

A plugin's strings (`translations` in `src/app/plugins/pluginTranslations.ts`): `en`, its English strings, which ship with its code, and `load(language)`, which resolves to the strings of another of the app's languages, such as `(await import('./locales/de.json')).default`, or to none; `language` is the code of the app's language, such as `de` or `zh-TW` (`src/app/i18n/i18nLanguages.ts`).
The registry adds them as the i18n namespace `plugin.<id>` (`registerNamespace`, `src/app/i18n/i18n.ts`); a language without strings, or whose `load` fails, shows English, and a change of language waits until `load` settles.
A component translates with `usePluginTranslation(id)`, whose `t` takes the keys of those strings (`a.b` for nesting) and i18next's options, and renders again in the app's language when it changes, and once strings that were still loading arrive; code outside React uses `getPluginTranslation(id)`, whose `t` translates into the language in use when called.
A plugin's module runs once, before the strings of the language in use have loaded, and the language can change later, so it translates when its text shows, never when the module loads.

## Room header slot

The room header slot (`roomHeaderSlot`) is the third kind: components that get the open room (`room`, matrix-js-sdk's `Room`) and render under the room header, or render nothing, such as a banner about the room's state.
They also get `headerRef`, a React ref to the header's element, which holds the header's row (the room's name and its buttons) and the slot, so a plugin can take something dragged from its side panel anywhere on the header: it reads the element's box for a drag it drives with the pointer, or listens to its drag events (`dragenter` and `dragover`, cancelled for its own drag type, and `drop`), and removes its listeners as it unmounts; it never changes the element.
React sets the ref after the slot's components run their layout effects, so a component reads it in `useEffect` or in an event handler.
The composer's file drop covers the header above it too (the room area's header for the room's composer, the room header the thread column shows while it fills the page for the thread's) but takes only drags that carry files, so a drag of the plugin's own type reaches the plugin untouched.
`src/app/room/RoomHeaderSlot.tsx` shows them in build order inside the floating header, across the conversation column, on the header's own frosted surface (the slot adds no background of its own): the conversation's top inset grows with them, and it scrolls under them as under the header; where a short screen hides the header, it hides them too.
While the thread column fills the page, they show under the room header it shows instead, and `headerRef` names that header: the column filling the page or going back beside the messages remounts them in the other header, so a component must not rely on staying mounted as the room page's layout changes.
Each mounts afresh in every room and renders again whenever the room view does, so one that shows the room's state listens to the room's events itself.
One that throws shows nothing there, and the failure is logged and reported with `[plugin <id>@<version>]`.

## Header actions

Header actions (`src/app/plugins/headerActions.ts`) are the fourth kind: `{ id, label, icon, placement?, run }`.
Each is one of the room header's actions (`src/app/room/roomHeaderActions.tsx`), which the core ones are too: `placement` puts it in the room menu (`menu`, the default) or in the header's row of buttons, except on phones, where it goes in the room menu (`auto`); the room menu offers, in the row's order, every action its row leaves out.
`label` is a key of the plugin's strings, shown in the app's language as the button's tooltip and name or as the entry's text; `icon` is drawn as folds draws its icons (`Icons.Star`); `run({ roomId, threadId })` runs it in the open room, and in the thread open there once the server has its root.
A `run` that throws, or whose promise rejects, is logged with `[plugin <id>@<version>]`.

## Account storage

Account storage (`src/app/plugins/pluginStorage.ts`): `usePluginStorage(id)` gives a plugin's components strings by key (`getItem`, `setItem`, `removeItem`) for the signed-in account, in localStorage under `mindroom.plugin:<encoded user ID>/<id>/`, so no account reads what another stored.
When this browser deletes an account's local data (Logout, Remove from Device, a logout the homeserver reports, deactivation) and no other login of the same user ID stays, the app deletes every plugin's storage for that account and calls each plugin's `forgetAccount(userId)`, an optional function of its `ClientPlugin`, for what the plugin keeps elsewhere (its own IndexedDB database, say; the account's components are still mounted then, in this tab and maybe others, so a plugin closes its connections when they get `versionchange`, or the deletion waits).
It waits for the promise `forgetAccount` returns, five seconds at most, before the page reloads; one that throws or rejects is logged with the plugin's tag.
`setItem` stores nothing while no login of the account is left in this browser (it returns false), so a component that saves as it unmounts, in this tab or another, puts nothing back.
As the app starts, it also deletes the plugin storage of every account without a stored login, which catches a value another tab wrote past that check while the account signed out (the sign-out's reload starts the app); it keeps all of it while the stored account list holds anything this version cannot read.
Switching accounts and Clear Cache keep the storage, and `forgetAccount` runs whether `config.json` enables the plugin or not, but not in a page load with `?plugins=off`.

## Pages

Pages (`src/app/plugins/pluginPages.tsx`) are `{ path, Component, fillsWindow? }`.
A plugin's pages live under `/p/<id>/` (`PLUGIN_ROOT_PATH` and `PLUGIN_PAGE_PATH`, one route for every plugin): `path` is a React Router path under that root (`''`, `items/:itemId`), matched and ranked as React Router matches routes, and `Component` gets its parameters as `params`.
A page keeps the app's rail unless `fillsWindow` is set; then it fills the window without the rail (on phones the top bar stays above it, as above every page).
`pluginRoutePath(id, path)` gives a page's path, and `usePluginRouteHref(id, path)` its `href` with the base path the app is served under, or after `#` with the hash router.
An address `/p/<id>/...` that no page of an enabled plugin takes shows "Page not found" with the rail, where it is: no redirect, and no space or room named after its segments.

## Public files

A plugin's `public/` directory, if it has one, ships as it is: the build copies its files to `public/plugins/<id>/` of the app, and the dev server serves them there.
That is for what the plugin does not import but loads by URL, such as a page for a frame, an image, a worker script or a font; `pluginPublicUrl(id)` is that directory's URL under the app's base path, such as `${pluginPublicUrl('my-plugin')}logo.svg` for `public/logo.svg`.
Each plugin gets its own directory, and deployments serve it as the app's other files under `public/`: with the same headers, and a missing file is a 404, never the app.
The build copies only files and directories: a symbolic link in `public/`, which could lead out of the plugin's directory, fails it, naming the link.

## Conversation covers

Conversation covers (`src/app/plugins/conversationCovers.ts`) are the sixth kind: `{ covers, subscribe, Component, close? }`, a layer over a room's conversation while the room stays open, such as a full view of something the room works on.
`covers(room)` says whether it covers the room's conversation now, and `subscribe(room, onChange)` calls `onChange` whenever that may change and returns its stop, as React's `useSyncExternalStore` takes them.
`src/app/room/ConversationCover.tsx` shows the first, in build order, whose `covers` holds, with `Component` given the room, over the conversation column under the header and its slot.
The host's rules apply on their own while it shows: the conversation under it is inert (no focus, clicks or find-in-page) and hidden from assistive technology, no read receipt goes out for it (`useReaderSees`, the Escape read), a message that arrives notifies and chimes as for a room not on screen, the composer sends no typing notice and stops one already out, its popovers (emoji board, autocomplete, model picker, menu) close, and a dropped file is not attached;
the focus moves into the cover as it shows, Tab and Shift+Tab go round inside it, and the focus goes back where it was when it goes, and coming back reads what the reader then sees, as coming back to the window does.
Escape in the cover calls `close(room)` when the plugin gives one, unless something in the cover took the key or an input method is composing.
A cover that throws, in `covers`, `subscribe` or the stop it returns, `close` or `Component`, is taken away for that room, the next cover whose `covers` holds shows instead, and the failure is logged and reported with `[plugin <id>@<version>]`.

## Slash commands

Slash commands (`src/app/plugins/slashCommands.ts`) are the seventh kind: `{ name, description, run }`.
The composer offers them after its own commands, in the same command menu, and runs them as it runs its own commands that act (`src/app/composer/commands/useCommands.ts`): the message is not sent, and `run({ room, args, threadId })` gets the room (matrix-js-sdk's `Room`, whose `client` is the account's client), the text typed after the name, and `threadId`, the root of the thread whose composer it was typed in (none in the main timeline or in Classic).
In a thread whose root the server has not confirmed yet, the command waits, its text in the composer, until the root has its own ID, as a message sent there does.
`name` is what follows the `/`, letters a to z only; `description` is a key of the plugin's strings, shown in the app's language in the menu.
A built-in command keeps its name, also one a later version of the app adds, so a plugin's command of the same name is none, and a name claimed more than once, by one plugin or by several, runs for none of them, with one warning that names the plugins.
A `run` that throws, or whose promise rejects, leaves the text in the composer with "/<name> failed: <the error's message>" above it, as a built-in command's failure does.
One that throws `commandUsage()` from `core`, for a text after the name that it does not take, shows instead the usage line a built-in command shows, "Could not run /<name>. <its description>", in the app's language; for a message of its own in the app's language, it throws an error whose message `getPluginTranslation(id)` translates.

## Room menu entries

Room menu entries (`src/app/plugins/roomActions.ts`) are the eighth kind: `{ id, label, icon, shows?, critical?, run }`.
Every room's menu lists them, a sidebar row's (its More Options button, a right-click or a long press) and the open room header's alike (`src/app/room/RoomActionsMenu.tsx`), in build order, in a group of their own after the menu's first group and before Remove from, Archive and Leave.
An entry that deletes or removes something says `critical: true`: the menu draws it as it draws Leave and lists it after Leave, at the end of the menu's last group, in build order; the app reads anything but `true` or nothing there as no entry.
`label` and `icon` are as a header action's.
`shows(room)`, pure and synchronous, says whether this room's menu lists the entry, and without it every room's does; one that throws leaves out only its entry, logged with `[plugin <id>@<version>]`.
Choosing the entry closes the menu and calls `run({ room, showDialog })` with the menu's room (matrix-js-sdk's `Room`), open or not, in the same click, before the menu has gone.
`showDialog(dialog)` shows what `dialog(close)` returns where the menu opened, as the menu's own Invite and Jump to Time show theirs: it stays after the menu has closed, until the plugin calls `close`.
The menu shows one dialog at a time, so a later `showDialog` takes the place of the dialog it shows then: a `run` that has to load something shows its dialog first and loads inside it.
A dialog that throws is taken away, and the failure is logged and reported with `[plugin <id>@<version>]`.
A `run` that throws, or whose promise rejects, is logged with the tag.
A header action, by contrast, is one of the open room's header actions, in its row or its menu, and runs with the IDs of the open room and its open thread; a room menu entry acts on whichever room's menu it is chosen in, with no thread.

## Message links

Message links (`src/app/plugins/messageLinks.ts`) are the ninth kind: `ClientPlugin.messageLinks`, a list of `{ match, Component }`.
They apply to the links of messages in a room's page (its timeline in every view, a thread and the pinned messages), every link with an `http:` or `https:` address; elsewhere (the Activity list, search, thread previews outside a room's page) links stay as they are.
A plain click (the primary button, with no Ctrl, Meta, Shift or Alt), or Enter on the focused link, on a link that the first enabled plugin's `match` takes (build order, then list order) shows that plugin's `Component` in place of opening the link, in a pop-out at the link, below it and lined up with its start, or above it when the link is in the lower half of the window, mirrored in right-to-left, on the app's glass menu surface (`src/app/room/MessageLinkCards.tsx`).
A modified click, a middle click, the context menu and dragging keep the browser's behavior, and the click goes no further than the link, so a thread card around it does not open its thread.
`match(url)`, pure and synchronous, takes the parsed URL; a `match` that throws counts as no match, logged with `[plugin <id>@<version>]`.
`Component` gets `{ href, roomId, close }`: the link's address, the room whose message holds it, and a function that closes the card.
It renders inside the room's page, so it can use what a message renderer can, such as `useRoomSidePanel` to open the plugin's panel.
A link whose text reads as another address keeps the app's check first and, once confirmed, opens as a link without a card.
Escape, a click outside the card and `close()` close the card, and the focus goes back to the link.
One card shows at a time: another link's card takes its place, and a switch to another room closes it.
A `Component` that throws closes the card, logged and reported with `[plugin <id>@<version>]`.
`plugins.<id>.enabled: false` and `?plugins=off` turn the kind off as they turn off the others.

## Turning plugins off

`plugins.<id>.enabled: false` in `config.json` hides a plugin's contributions, and `?plugins=off` in the address hides every plugin's for one page load.

## Tests

A plugin's tests (`*.test.ts` and `*.test.tsx` in its directory, outside `node_modules`) run with the app's unit tests while `MINDROOM_CLIENT_PLUGINS` lists the plugin (`vitest.config.ts`): with the app's setup files, the SDK's subpaths and automatic JSX, and, as in the build, the app's copies of the packages it shares with plugins, for the plugin's files and for the ES modules of the packages it installed (Vite loads those);
a CommonJS package's `require` of a shared package still resolves in the plugin's directory, and a plugin's own `.css.ts` files, which load its own vanilla-extract outside the setup's file scope, need a mock.
Its build module's hooks run there too, so the package names its `resolveId` maps resolve in its tests as in the build.
`MINDROOM_CLIENT_PLUGIN_TESTS_ONLY=1` runs the listed plugins' tests alone, without the app's own.
The app inside a plugin's directory, a link or a submodule at its top such as `.mindroom-chat`, lends it none of the app's tests.
A plugin in a repository of its own typechecks and lints with configs it extends from the app ([development.md](development.md#a-client-plugin-in-its-own-repository)).
A plugin's tests reach the app through the SDK's subpaths only, never its modules: a test that needs another answer from one of the SDK's hooks mocks that subpath (`vi.mock('@mindroom/client-sdk/matrix', ...)` with the original's exports spread in, from `importOriginal`), or gives `renderPluginComponent` its `client`.
They render a contribution's own component, or call its `run`, directly; how the app shows it in its surfaces, such as the room header, the timeline or the composer's commands, is for the plugin's end-to-end tests.

## The example plugin

`src/app/plugins/__fixtures__/example-plugin/` is a small plugin for the tests, with a contribution of each kind, its strings in English and German, an image in its `public/` directory that its banner shows, and a build module (`build.mjs`) whose transform writes the banner's words in place of a marker; it imports the app only through the SDK, and its own test (`index.test.tsx`) uses only the SDK, `testing` included, and runs in every unit test run.
