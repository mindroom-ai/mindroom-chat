# CINNY-126 exact-trace replay

The loader requires the three private authoritative artifacts and verifies their SHA-256 hashes before replaying anything.

- `incident-window-all-events.json`: `a0f41c772c3ee221943244daeca1de5c45e926ef7ce1c714b37574a3e327f4b6`.
- `edit-events-full.json`: `2834620072ae2ec92c9566e53f9dccc048fa8775c14616be0b3e374d15a0ede6`.
- `incident-core-events.json`: `65cbcd390bfaac8679240854e57cb9c979045df4d273f490d5eaeb3c1a44f2be`.

The artifacts are intentionally not committed because they contain private incident content.

The event IDs kept in `trace.ts` are opaque topology anchors and contain no message content.

The offline SDK gate uses matrix-js-sdk 41.7.0 `Room.addLiveEvents`, a real SDK `Thread`, compact-card and global-Threads view models, unread derivation, and the room tag snapshot resolver.

It is an SDK and shared-view-model gate, not a browser UI substitute.

Run the exact-cadence offline acceptance gate with `npm run cinny-126:replay:offline -- --scenario=exact --speed=1`.

The `warm`, `slow-init`, and `forced-init-failure` scenarios are diagnostics and are not acceptance substitutes.

Set `CINNY_126_ARTIFACT_DIR` only when the authoritative artifact directory is stored somewhere other than its default incident-report location.

The live driver is pinned to `https://mindroom.chat`, refuses all three original account IDs, requires three distinct test accounts, and requires the explicit `TEST_ONLY` confirmation.

It creates a fresh invite-only room itself, sets joined-only history visibility and the fixed `CINNY-126 TEST ONLY` topic, writes a per-invocation canary state event, joins the two invited test accounts, and verifies that exactly those three accounts are present before replaying anything.

It also requires a test audio MXC and three distinct test attachment IDs, rejects every verified incident media identifier, and fails closed if any replay attachment lacks a safe mapping.

Required live variables are `CINNY_126_TEST_ROOM_CONFIRM=TEST_ONLY`, `CINNY_126_USER_ACCESS_TOKEN`, `CINNY_126_ROUTER_ACCESS_TOKEN`, `CINNY_126_AGENT_ACCESS_TOKEN`, `CINNY_126_TEST_AUDIO_MXC`, and `CINNY_126_TEST_ATTACHMENT_IDS`.

`CINNY_126_TEST_ATTACHMENT_IDS` is a JSON array containing exactly three IDs.

Run the live sender with `npm run cinny-126:replay:live` and keep the client-under-test on the room overview during the countdown and replay.

Browser acceptance must separately verify the compact card, unread navigation state, global Threads preview, and first-entry body because the live sender deliberately does not control or authenticate a user interface.

Never point the live sender at a real room or use a real user account.
