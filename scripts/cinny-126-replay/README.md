# CINNY-126 replay

The offline loader requires a private artifact directory through `CINNY_126_ARTIFACT_DIR` and its separately trusted manifest digest through `CINNY_126_MANIFEST_SHA256`.

No fallback path, incident identifier, sender identity, artifact hash, or expected content fingerprint is committed.

The private directory must contain `incident-window-all-events.json`, `edit-events-full.json`, `incident-core-events.json`, and `manifest.json`.

`manifest.json` uses this schema, with every placeholder replaced privately:

```json
{
  "schemaVersion": 1,
  "artifactHashes": {
    "incident-window-all-events.json": "<sha256>",
    "edit-events-full.json": "<sha256>",
    "incident-core-events.json": "<sha256>"
  },
  "eventIds": {
    "room": "<room-id>",
    "threadRoot": "<event-id>",
    "voice": "<event-id>",
    "transcription": "<event-id>",
    "placeholder": "<event-id>",
    "finalEdit": "<event-id>",
    "summary": "<event-id>",
    "tags": ["<event-id>", "<event-id>"]
  },
  "expectedFingerprints": {
    "compactCard": { "length": 0, "sha256": "<sha256>" },
    "effectiveBody": { "length": 0, "sha256": "<sha256>" },
    "globalThreads": { "length": 0, "sha256": "<sha256>" },
    "overviewTags": { "length": 0, "sha256": "<sha256>" },
    "presentation": { "length": 0, "sha256": "<sha256>" }
  },
  "senders": {
    "user": "<mxid>",
    "router": "<mxid>",
    "agent": "<mxid>"
  }
}
```

The loader verifies the complete manifest bytes against `CINNY_126_MANIFEST_SHA256`, validates the authenticated manifest strictly, and then verifies each artifact SHA-256 before replaying anything.

Keep the trusted manifest digest outside the artifact directory so changing the manifest and artifacts together cannot bypass verification.

The expected presentation fingerprints stay private because low-entropy tag values are recoverable from a committed hash.

The offline SDK gate uses matrix-js-sdk 41.7.0 `Room.addLiveEvents`, a real SDK `Thread`, compact-card and global-Threads view models, unread derivation, and the room tag snapshot resolver.

It is an SDK and shared-view-model gate, not a browser UI substitute.

Run the exact-cadence offline acceptance gate with `npm run cinny-126:replay:offline -- --scenario=exact --speed=1`.

The `warm`, `slow-init`, and `forced-init-failure` scenarios are diagnostics and are not acceptance substitutes.

The live driver reads only event topology, sender roles, status transitions, and cadence from the private trace.

It creates entirely synthetic outbound message, edit, tag, and summary content and never clones incident content.

Every direct, nested reply, and tag-state event reference must have a fresh-room mapping or the live replay aborts.

The live driver is pinned to `https://mindroom.chat`, refuses the original accounts, requires three distinct test accounts, and requires the explicit `TEST_ONLY` confirmation.

It creates a fresh invite-only room, sets joined-only history visibility and a fixed test topic, writes a per-invocation canary state event, joins the two invited test accounts, and verifies the room isolation before replaying anything.

Required live variables are `CINNY_126_ARTIFACT_DIR`, `CINNY_126_MANIFEST_SHA256`, `CINNY_126_TEST_ROOM_CONFIRM=TEST_ONLY`, `CINNY_126_USER_ACCESS_TOKEN`, `CINNY_126_ROUTER_ACCESS_TOKEN`, and `CINNY_126_AGENT_ACCESS_TOKEN`.

Run the live sender with `npm run cinny-126:replay:live` and keep the client-under-test on the room overview during the countdown and replay.

Browser acceptance must verify the compact card shows `CINNY-126 synthetic final answer`, the room navigation remains unread, global Threads uses the final preview, both synthetic tags appear, and first thread entry opens on the final body.

Never point the live sender at a real room or use a real user account.
