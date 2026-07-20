# CINNY-126 exact-trace replay

The loader verifies all three authoritative artifact SHA-256 hashes before replaying anything.

The offline SDK gate uses matrix-js-sdk 41.7.0 `Room.addLiveEvents`, a real SDK `Thread`, compact-card and global-Threads view models, unread derivation, and the room tag snapshot resolver.

It is an SDK and shared-view-model gate, not a browser UI substitute.

Run the exact-cadence offline acceptance gate with `npm run cinny-126:replay:offline -- --scenario=exact --speed=1`.

The `warm`, `slow-init`, and `forced-init-failure` scenarios are diagnostics and are not acceptance substitutes.

Set `CINNY_126_ARTIFACT_DIR` only when the authoritative artifact directory is stored somewhere other than its default incident-report location.

The live driver is pinned to `https://mindroom.chat`, refuses the incident room, refuses all three original account IDs, requires three distinct test accounts, requires the explicit `TEST_ONLY` confirmation, and requires the room topic to be exactly `CINNY-126 TEST ONLY` by default.

It also requires a test audio MXC and three test attachment IDs so the replay never republishes Bas's voice media or incident attachment references.

Required live variables are `CINNY_126_TEST_ROOM_ID`, `CINNY_126_TEST_ROOM_CONFIRM=TEST_ONLY`, `CINNY_126_USER_ACCESS_TOKEN`, `CINNY_126_ROUTER_ACCESS_TOKEN`, `CINNY_126_AGENT_ACCESS_TOKEN`, `CINNY_126_TEST_AUDIO_MXC`, and `CINNY_126_TEST_ATTACHMENT_IDS`.

Set `CINNY_126_TEST_ROOM_TOPIC` only if the disposable test room uses a different explicit test-only topic marker.

`CINNY_126_TEST_ATTACHMENT_IDS` is a JSON array containing exactly three IDs.

Run the live sender with `npm run cinny-126:replay:live` and keep the client-under-test on the room overview during the countdown and replay.

Browser acceptance must separately verify the compact card, unread navigation state, global Threads preview, and first-entry body because the live sender deliberately does not control or authenticate a user interface.

Never point the live sender at a real room or use a real user account.
