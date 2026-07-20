# CINNY-126 — FINAL PLAN (synthesized from PLAN-codex + PLAN-claude + cross-critiques)

Source docs in `plan/`: PLAN-codex.md, PLAN-claude.md, CRITIQUE-codex.md, CRITIQUE-claude.md.
Trace artifacts (authoritative, verify SHA-256 before use):
`/home/basnijholt/.mindroom-chat/mindroom_data/agents/openclaw/workspace/skills/mindroom-dev/references/reports/CINNY-126-artifacts/`

## Decision summary

- **Primary root-cause hypothesis (bet): PLAN-claude H1** — matrix-js-sdk 41.7.0 pre-init thread edit buffering:
  - `Thread.addEvent` diverts `m.replace` to `addRelatedThreadEvent` and returns early (thread.ts:363).
  - Pre-init (`!initialEventsFetched`) edits are only pushed to `replayEvents` — no aggregation, no
    `RoomEvent.Timeline`, so previews, overview, the fork's sync engine, and even in-thread rendering
    never see the content until thread init replays the buffer.
  - Stranded rejected `initalEventFetchProm` (thread.ts:648/610) can make the buffer permanent.
  - **Decisive trace fact** (CRITIQUE-claude, verified): at 14:06:15 the user was INSIDE the thread and
    the reply body was still missing while tags (state pipeline) and summary appeared — inconsistent
    with a pure overview-preview bug, consistent with H1.
- **Secondary (conditional, from PLAN-codex):** `getVisibleThreadEventBodyPreviewText` /
  threadPresentation reads the placeholder's original `Thinking...` content even when a replacement is
  attached. Real code smell; fix ONLY if the evidence gate shows it on the live path (CRITIQUE-claude
  argues it's a near-no-op for this incident; CRITIQUE-codex bets on it — the harness decides).
- **Process discipline: adopt PLAN-codex's harness rigor** — exact replay, observation matrix,
  diagnostic vs acceptance separation, root-cause confirmation gate BEFORE any fix commit.

## Deliverable 0 — Exact-trace replay harness (FIRST, must go RED before any fix)

Build one replay driver (node + matrix-js-sdk or raw HTTP) from the three artifacts:
- Verify artifact SHA-256 hashes; preserve exact bodies, msgtypes (`m.text` → 16×`m.notice` →
  final `m.text`), `io.mindroom.stream_status` transitions, tag state events, summary event
  (including its `m.in_reply_to` targeting the FINAL edit, not the placeholder), senders, and the
  exact inter-edit delay vector (160,777,158,782,162,788,944,1983,166,164,164,1302,174,1236,316,188 ms;
  placeholder→first-edit gap 14,789 ms). Rewrite only newly assigned IDs/references.
- Run against a TEST room (not production rooms) on mindroom.chat with test accounts; client-under-test
  sits on room overview during replay.
- Scenarios: (1) exact cadence speed 1 = the only acceptance evidence; (2) claude's warm/fresh/
  slow-failing-init variants as robustness DIAGNOSTICS (label them so); forced-init-failure variant
  validates the stranded-promise trap specifically.
- Instrument diagnostics (not acceptance): `/relations` traffic, `ClientEvent.Event`,
  `RoomEvent.Timeline`, `ThreadEvent.Update`, `replacingEvent()`, serialized replacement state,
  overview refresh generation, final presentation text. Emit a one-line verdict per run that
  localizes which hypothesis failed (H1 buffering vs presentation helper vs sync-not-processed).
- Acceptance surfaces asserted: compact card final preview; streaming→completed state; tag chips on
  overview BEFORE entry; room-nav unread state; global Threads final preview; full 1,466-char body on
  first thread entry without reload/re-entry.
- Targets: current dev in desktop browser (red expected), then iOS simulator/physical capacitor build.

## Root-cause confirmation gate

No fix commit until the harness demonstrates, on the live path:
- H1: edits buffered pre-init, no `RoomEvent.Timeline` for any of the 17 edits, body missing in-thread
  until init replay → proceed with SDK patch.
- AND/OR: final edit attached + refresh ran, but presentation still `Thinking...` → proceed with
  presentation-helper fix.
Keep red-run evidence (logs, verdict lines) from current head for the report.

## Fix shape

1. **If H1 confirmed (expected):** two surgical `patch-package` changes to
   `matrix-js-sdk/src/models/thread.ts` (patched at compiled `lib/` level, repo already runs
   patch-package on postinstall):
   a. Pre-init `m.replace`: aggregate via `aggregateChildEvent` (mirror the existing annotation
      special-case) so `replacingEvent()` resolves and `ThreadEvent.Update` fires without full init.
   b. Clear `initalEventFetchProm` in the pagination-failure catch so init can retry (fixes the
      permanent-buffer trap).
   Both upstreamable; add SDK contract tests pinning behavior against future upgrades.
2. **If (and only if) the gate shows it live:** minimal change to
   `getVisibleThreadEventBodyPreviewText` to select the newest valid replacement through existing
   edit utilities. No broader preview refactors.
3. **No other changes.** Smallest root-cause diff; no symptom sweeps.

## Deliverable 2 — Flight recorder sync/receive events (secondary)

Extend the iOS flight recorder (CINNY-125 work) with a per-sync-batch record: event count, edit count,
room id (hashed), current route. Coalesce with immediate flush on edit bursts. Tests: multi-room
batches, duplicate emissions, edits before first completed batch, empty batches, route changes,
detach/reattach, strict old-session validation, one storage write per batch.

## Tests / regression evidence

- Replay harness red→green on the exact trace = primary regression evidence (archive under
  /tmp/CINNY-126-evidence/).
- Unit tests: SDK patch contract tests; presentation helper test IF that fix ships; recorder tests.
- New asserts both plans missed (from critiques): summary event's reply-to targeting the final
  `m.replace` event; tag-chip-on-overview-before-entry check.
- Deploy: npm run build + restart mindroom-cinny.service; iOS capacitor build for device verification.

## Non-goals

- No unconditional shipping of both SDK changes if the gate only proves one branch.
- No preview-path refactor beyond the single helper function.
- No replay rooms in production rooms.