# Real-Activity Replay & K× Time-Offset Multiplier Perf Harness

## Goal

Measure MindRoom Chat against real production Matrix/MindRoom activity shapes—and scale
concurrency cleanly by `K×` threads, `R×` rooms, and `S×` playback speed—using a zero-dependency,
loopback-only replay server that requires no running LLM backend and commits zero user data.

## Architecture

Three focused Node 22 ESM modules under `scripts/perf/replay/` plus a surgical integration into
`e2e/perf/real-work.live.spec.ts`:

```
  [Production CS-API (GET only)]
                │  capture.mjs (operator runs locally; out dir chmod 0700)
                ▼
     capture/ (manifest.json, snapshot.json, live.jsonl, blobs/<sha256>)
                │
                ▼
  multiplier.mjs (K× threads, R× rooms, S× speed, staggered offsets, pointer remapping)
                │
                ▼
  server.mjs (127.0.0.1 HTTP Matrix CS-API v1.11 + Tuwunel summaries + 5s JSONL stats)
                │
                ▼
  e2e/perf/real-work.live.spec.ts (PERF_TARGET=external + PERF_REPLAY_CAPTURE)
```

## Capture Format (`scripts/perf/replay/capture.mjs`)

- **Strict read-only (`GET` only)**: every homeserver request uses `GET` with bearer auth and an
  inline JSON `filter` query parameter on `/_matrix/client/v3/sync` (never creates filters, posts
  events, sends receipts, or mutates state).
- **Capture sequence**:
  1. `GET /_matrix/client/v3/account/whoami` for viewer `userId` and domain.
  2. Initial `GET /_matrix/client/v3/sync` (state, account data, joined rooms, spaces).
  3. For focused rooms (`--rooms`, or joined non-space rooms): paginate `/v1/rooms/{r}/threads`
     (up to `--max-threads`, default 600) preserving Tuwunel's bundled
     `unsigned['m.relations']['m.thread']` (`latest_event`, `io.mindroom.latest_reply`,
     `io.mindroom.title`); backfill `/v1/rooms/{r}/relations/{root}/m.thread` for the top
     `--heavy-threads` (default 25); paginate `/v3/rooms/{r}/messages` for room tail history.
  4. Long-poll `/v3/sync` for `--duration` seconds (default 60), writing `{ tauMs, response }`
     entries to `live.jsonl`.
  5. Optional `--synthesize-live`: converts captured `m.replace` edit chains into `io.mindroom.live`
     `v: 1` `snapshot` + `delta` splice frames and `io.mindroom.active_runs` state updates when a
     capture window is quiet or `--duration 0`.
  6. Downloads referenced `mxc://` blobs (prioritizing `io.mindroom.long_text` v2 JSON sidecars
     over avatars/images, capped by `--max-blobs` and `--max-blob-bytes`) to `blobs/<sha256>`.
- **Directory permissions**: `--out` is `chmod 0o700`, blobs `0o600`; captures stay strictly local
  and are never checked into git.

## K× Time-Offset Multiplier (`scripts/perf/replay/multiplier.mjs`)

Pure, deterministic transformation of a capture bundle into a multiplied timeline:

- **Staggering & looping**: for thread copy `k ∈ [0, K-1]`, `offsetMs = floor((k / K) * durationMs)`.
  At replay `elapsedMs`, each copy is at `virtualMs = elapsedMs * speed + offsetMs`, generation
  `gen = floor(virtualMs / durationMs)`, and local time `tauMs = virtualMs % durationMs`.
  Live-created events receive generation-scoped IDs (`$id__r{r}_k{k}_g{gen}`) so looping never
  emits duplicate `event_id`s into `EventTimelineSet` or IndexedDB. Snapshot-era events use
  copy-scoped IDs (`$id__r{r}_k{k}`) with copy `(0, 0)` preserving original IDs.
- **Room cloning (`R×`)**: clones room IDs (`!local__r{r}:domain`) and duplicates `m.space.child`
  state entries in parent spaces so cloned rooms appear in space hierarchy.
- **Pointer remapping** (copy-on-write envelopes sharing heavy text/tool payloads by reference):
  - Core Matrix: `event_id`, `room_id`, `redacts`, `m.relates_to.{event_id, m.in_reply_to.event_id}`,
    `unsigned['m.relations']['m.replace']`, `unsigned['m.relations']['m.thread']` (`latest_event`,
    `io.mindroom.latest_reply`, `io.mindroom.title`, and nested edits), `m.room.pinned_events.pinned`.
  - MindRoom content & account data: `io.mindroom.fork.{thread_id, event_id}`,
    `io.mindroom.ui_action.{room_id, thread_id}`, `io.mindroom.tool_approval` (`thread_id`,
    `grant_card_event_id`, `response_event_id`, `approval_provenance.grant_card_event_id`),
    `com.mindroom.voice_source_event_id`, `io.mindroom.pinned_canvases`.
  - Thread-keyed state: `com.mindroom.thread.tags` (both JSON tuple `'["$root","tag"]'` and legacy
    plain `'$root'` keys), `io.mindroom.thread_summary` (`state_key` + `content.event_id`),
    `com.mindroom.scheduled.task` (suffixed `state_key`, remapped `thread_id`/`source_event_id` in
    both top-level and `workflow` object/JSON string, shifted `execute_at`/`scheduled_at`).
- **Agent-keyed state merging**: `io.mindroom.background_jobs` and `io.mindroom.active_runs` are
  keyed by agent user ID (`state_key === sender`). Across in-room copies `k = 0..K-1`, the
  multiplier **merges** per `(roomId, agentUserId)` rather than overwriting: suffixing
  `job_id`/`run`/`subagent`, summing `total`, unioning `threads[]`, and re-stamping
  `origin_server_ts` and `updated_at` to `replayNow` so `now > ts + ttl_ms` never expires live runs.
- **Ephemeral streams**:
  - `io.mindroom.live`: remaps `reply`, mints valid monotonic `sid` (`/^\d{13}-[0-9a-f]{8}$/`) with
    contiguous `seq = 0, 1, 2...`, and materializes `LiveDocs` across warmup (`tauMs <= offsetMs`)
    so any mid-stream client receives a valid `snapshot` frame before subsequent `delta`s.
  - `io.mindroom.subagents`: remaps `run`, `meta.{subagent, root, parent, thread_id}`, shifts Unix
    second timestamps (`started_at`, `ended_at`, tool `started_at`), and enforces `snapshot`-first.
  - `m.receipt`: remaps outer `event_id` keys and inner `thread_id` (preserving `"main"`), shifts `ts`.
- **Trust preservation**: viewer and `@mindroom_*` agent senders keep their original same-server
  domain so `isMindroomAgentUserIdForViewer` keeps agent metadata and live frames trusted.

## Replay Server (`scripts/perf/replay/server.mjs`)

- Zero-dependency `node:http` server bound strictly to `127.0.0.1` (`--port 0` for ephemeral).
- Implements Matrix CS-API v1.11 + Tuwunel extensions used by MindRoom Chat: `/versions`,
  `/v3/login` (password flow returning the captured viewer MXID), `/whoami`, `/capabilities`,
  `/v1/media/config`, `/pushrules/`, `/account_data`, `/filter`, `/joined_rooms`, `/profile`,
  `/v3/sync` (initial + incremental long-poll with `timeline.limit`, `limited: true`, `prev_batch`,
  warm-reload catch-up from saved `since`), `/v1/rooms/{r}/threads` (live-updated bundled
  summaries), `/v1/rooms/{r}/relations/{ev}`, `/v3/rooms/{r}/messages`, `/context`, `/event`,
  `/members`, `/state`, `/v1/media/{download,thumbnail}` (and `/v3/media/...` alias, with 1×1 PNG
  thumbnail fallback and 404 download fallback for uncaptured media), crypto stubs, in-memory write
  stubs, and control routes `GET /__replay/status` & `POST /__replay/reset`.
- Writes 5-second JSONL telemetry (`{ t, target, streaming, frames, edits, jobs, stuck }`) to
  `--stats-file` matching `scripts/perf/real-work/driver.py`, and `--print-ready` emits one JSON
  handshake line on stdout once bound.

## Perf Spec Integration (`e2e/perf/real-work.live.spec.ts`)

When `PERF_TARGET=external` and `PERF_REPLAY_CAPTURE` is set:
- Spawns `scripts/perf/replay/server.mjs` on an ephemeral loopback port with
  `PERF_MULTIPLY_THREADS` (default `1`), `PERF_MULTIPLY_ROOMS` (default `1`), `PERF_REPLAY_SPEED`
  (default `1`), and a temp `--stats-file`.
- Uses the ready handshake for `homeserver`, bare `username` (avoiding remote `.well-known`
  discovery while returning full captured `user_id` on login), and `roomId`.
- Unlocks all 7 `SCENARIOS` (plus `soak` when `PERF_SOAK=1`) and feeds 5 s stats into `achieved`
  reporting while keeping `target: null` so natural activity variance does not trigger fixed-stream
  shortfall exclusion in `compare.mjs`.
- Leaves static `PERF_TARGET=external` (without `PERF_REPLAY_CAPTURE`) 100% unchanged.

## Verification

1. `node --test scripts/perf/replay/replay.test.mjs`: unit tests for `capture.mjs` helpers,
   `multiplier.mjs` cloning/merging/remapping/live-doc synthesis, and HTTP end-to-end tests for
   `server.mjs` (all using invented placeholder fixtures).
2. `scripts/perf/replay/sdk-integration.test.ts`: Vitest integration booting the patched
   `matrix-js-sdk` against `startReplayServer` to verify sync, `fetchRoomThreads()`,
   `paginateEventTimeline()`, `fetchRelations()`, live `io.mindroom.live` delivery, and warm reload.
3. Remote CI / M5 verification: `eslint`, `tsc --noEmit`, Vitest, and Playwright live replay run.
