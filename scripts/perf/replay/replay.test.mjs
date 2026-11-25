import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCaptureSyncFilter,
  extractMxcReferences,
  isInsideGitRepo,
  matrixGet,
  parseCaptureArgs,
  parseMxcUri,
  runCapture,
} from './capture.mjs';
import {
  applyLiveDeltaToDocs,
  copyOffsetMs,
  createReplayMultiplier,
  mapRoomId,
} from './multiplier.mjs';
import { startReplayServer } from './server.mjs';

const SID_RE = /^\d{13}-[0-9a-f]{8}$/;
const VIEWER = '@viewer:example.test';
const AGENT = '@mindroom_helper:example.test';
const ROOM_ID = '!main:example.test';
const SPACE_ID = '!space:example.test';
const BASE_TS = 1_760_000_000_000;

function makeFixtureBundle() {
  const heavyTrace = { version: 2, events: [{ id: 'tc1', tool: 'search', status: 'done' }] };
  const rootEv = {
    type: 'm.room.message',
    event_id: '$root1',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 60_000,
    content: { msgtype: 'm.text', body: 'Thread root question' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 2,
          current_user_participated: true,
          latest_event: {
            type: 'm.room.message',
            event_id: '$rep2',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 10_000,
            content: { msgtype: 'm.text', body: 'Second reply' },
          },
          'io.mindroom.latest_reply': {
            type: 'm.room.message',
            event_id: '$rep2',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 10_000,
            content: { msgtype: 'm.text', body: 'Second reply' },
          },
          'io.mindroom.title': {
            type: 'm.room.message',
            event_id: '$title1',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 20_000,
            content: {
              msgtype: 'm.notice',
              body: 'Summary Title',
              'io.mindroom.thread_summary': { summary: 'Summary Title', version: 1 },
            },
          },
        },
      },
    },
  };
  const rep1 = {
    type: 'm.room.message',
    event_id: '$rep1',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 30_000,
    content: {
      msgtype: 'm.text',
      body: 'First reply body',
      'io.mindroom.tool_trace': heavyTrace,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root1',
        'm.in_reply_to': { event_id: '$root1' },
      },
      'io.mindroom.fork': { thread_id: '$root1', event_id: '$root1' },
      'io.mindroom.ui_action': { room_id: ROOM_ID, thread_id: '$root1', action: 'show_canvas' },
      'com.mindroom.voice_source_event_id': '$root1',
    },
  };
  const rep2 = {
    type: 'm.room.message',
    event_id: '$rep2',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 10_000,
    content: {
      msgtype: 'm.text',
      body: 'Second reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root1',
        'm.in_reply_to': { event_id: '$rep1' },
      },
    },
  };
  const approvalEv = {
    type: 'io.mindroom.tool_approval',
    event_id: '$appr1',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 9_000,
    content: {
      thread_id: '$root1',
      grant_card_event_id: '$rep1',
      response_event_id: '$rep2',
      approval_provenance: { kind: 'timed_grant', grant_card_event_id: '$rep1' },
      'io.mindroom.tool_approval': { thread_id: '$root1', grant_card_event_id: '$rep1' },
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root1' },
    },
  };
  const olderMsg1 = {
    type: 'm.room.message',
    event_id: '$old1',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 120_000,
    content: { msgtype: 'm.text', body: 'Older 1' },
  };
  const olderMsg2 = {
    type: 'm.room.message',
    event_id: '$old2',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 110_000,
    content: { msgtype: 'm.text', body: 'Older 2' },
  };

  const stateEvents = [
    {
      type: 'm.room.create',
      event_id: '$st_create',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '',
      origin_server_ts: BASE_TS - 500_000,
      content: { room_version: '11', creator: AGENT },
    },
    {
      type: 'm.room.name',
      event_id: '$st_name',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '',
      origin_server_ts: BASE_TS - 499_000,
      content: { name: 'Engineering' },
    },
    {
      type: 'm.room.member',
      event_id: '$st_viewer',
      room_id: ROOM_ID,
      sender: VIEWER,
      state_key: VIEWER,
      origin_server_ts: BASE_TS - 498_000,
      content: { membership: 'join', displayname: 'Viewer' },
    },
    {
      type: 'm.room.member',
      event_id: '$st_agent',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: AGENT,
      origin_server_ts: BASE_TS - 497_000,
      content: { membership: 'join', displayname: 'Helper Agent' },
    },
    {
      type: 'm.space.parent',
      event_id: '$st_parent',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: SPACE_ID,
      origin_server_ts: BASE_TS - 496_000,
      content: { canonical: true, via: ['example.test'] },
    },
    {
      type: 'm.room.pinned_events',
      event_id: '$st_pins',
      room_id: ROOM_ID,
      sender: VIEWER,
      state_key: '',
      origin_server_ts: BASE_TS - 5_000,
      content: { pinned: ['$root1'] },
    },
    {
      type: 'com.mindroom.thread.tags',
      event_id: '$st_tag_tuple',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '["$root1","urgent"]',
      origin_server_ts: BASE_TS - 5_000,
      content: { set_by: VIEWER, set_at: '2026-11-24T10:00:00.000Z' },
    },
    {
      type: 'com.mindroom.thread.tags',
      event_id: '$st_tag_plain',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '$root1',
      origin_server_ts: BASE_TS - 5_000,
      content: { tags: { review: { set_by: VIEWER, set_at: '2026-11-24T10:00:00.000Z' } } },
    },
    {
      type: 'io.mindroom.thread_summary',
      event_id: '$st_summary',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '$root1',
      origin_server_ts: BASE_TS - 5_000,
      content: { summary: 'Summary Title', event_id: '$title1', version: 1 },
    },
    {
      type: 'com.mindroom.scheduled.task',
      event_id: '$st_sched',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: 'task-42',
      origin_server_ts: BASE_TS - 5_000,
      content: {
        status: 'pending',
        thread_id: '$root1',
        source_event_id: '$rep1',
        execute_at: '2026-11-24T11:00:00.000Z',
        workflow: JSON.stringify({
          thread_id: '$root1',
          source_event_id: '$rep1',
          execute_at: '2026-11-24T11:00:00.000Z',
        }),
      },
    },
    {
      type: 'io.mindroom.background_jobs',
      event_id: '$st_jobs',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: AGENT,
      origin_server_ts: BASE_TS - 4_000,
      content: {
        total: 3,
        jobs: [
          {
            job_id: 'job-1',
            thread_id: '$root1',
            kind: 'delegate',
            tool: 'run_subagent',
            status: 'running',
            started_at: '2026-11-24T10:00:00.000Z',
            run: 'run-1',
            subagent: 'sub-1',
          },
        ],
      },
    },
    {
      type: 'io.mindroom.active_runs',
      event_id: '$st_ar',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: AGENT,
      origin_server_ts: BASE_TS - 999_999,
      content: {
        version: 1,
        updated_at: BASE_TS - 999_999,
        ttl_ms: 60_000,
        threads: [{ thread_id: '$root1' }],
      },
    },
  ];

  const spaceState = [
    {
      type: 'm.room.create',
      event_id: '$sp_create',
      room_id: SPACE_ID,
      sender: AGENT,
      state_key: '',
      origin_server_ts: BASE_TS - 600_000,
      content: { room_version: '11', type: 'm.space' },
    },
    {
      type: 'm.space.child',
      event_id: '$sp_child',
      room_id: SPACE_ID,
      sender: AGENT,
      state_key: ROOM_ID,
      origin_server_ts: BASE_TS - 599_000,
      content: { via: ['example.test'] },
    },
  ];

  const liveEntries = [
    {
      tauMs: 1_000,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$live_reply',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_000,
                    content: {
                      msgtype: 'm.text',
                      body: 'Hello',
                      'io.mindroom.stream_status': 'streaming',
                      'm.relates_to': {
                        rel_type: 'm.thread',
                        event_id: '$root1',
                        'm.in_reply_to': { event_id: '$rep2' },
                      },
                    },
                  },
                ],
              },
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_000,
                    content: {
                      v: 1,
                      reply: '$live_reply',
                      sid: '1760000001000-11223344',
                      seq: 0,
                      snapshot: {
                        md: 'Hello',
                        reasoning: '',
                        tools: [],
                        status: 'streaming',
                        activity: 'Thinking',
                        segments: [],
                      },
                    },
                  },
                  {
                    type: 'io.mindroom.subagents',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_000,
                    content: {
                      v: 1,
                      run: 'run-1',
                      sid: '1760000001000-55667788',
                      seq: 0,
                      meta: {
                        agent: 'worker',
                        subagent: 'sub-1',
                        caller: 'helper',
                        root: 'run-root',
                        parent: 'run-parent',
                        thread_id: '$root1',
                        source: 'delegate',
                        status: 'running',
                        started_at: Math.floor(BASE_TS / 1000),
                        ended_at: null,
                      },
                      snapshot: {
                        md: 'Working',
                        reasoning: '',
                        tools: [{ id: 't1', started_at: Math.floor(BASE_TS / 1000) }],
                        status: 'streaming',
                        activity: '',
                        segments: [],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 4_000,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 4_000,
                    content: {
                      v: 1,
                      reply: '$live_reply',
                      sid: '1760000001000-11223344',
                      seq: 1,
                      delta: {
                        md: { at: 5, del: 0, ins: ' world', len: 11 },
                        status: 'streaming',
                      },
                    },
                  },
                  {
                    type: 'm.receipt',
                    content: {
                      $live_reply: {
                        'm.read': {
                          [VIEWER]: { ts: BASE_TS + 4_000, thread_id: '$root1' },
                          [AGENT]: { ts: BASE_TS + 4_000, thread_id: 'main' },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 7_000,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$live_edit',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 7_000,
                    content: {
                      msgtype: 'm.text',
                      body: '* Hello world!',
                      'm.new_content': {
                        msgtype: 'm.text',
                        body: 'Hello world!',
                        'io.mindroom.stream_status': 'completed',
                      },
                      'm.relates_to': { rel_type: 'm.replace', event_id: '$live_reply' },
                    },
                  },
                ],
              },
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 7_000,
                    content: {
                      v: 1,
                      reply: '$live_reply',
                      sid: '1760000001000-11223344',
                      seq: 2,
                      delta: {
                        md: { at: 11, del: 0, ins: '!', len: 12 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];

  return {
    manifest: {
      version: 1,
      capturedAtMs: BASE_TS,
      userId: VIEWER,
      viewerDomain: 'example.test',
      primaryRoomId: ROOM_ID,
      primaryRoomName: 'Engineering',
      focusedRoomIds: [ROOM_ID],
      durationMs: 9_000,
      blobIndex: {},
    },
    snapshot: {
      initialSync: {
        next_batch: 'b0',
        account_data: {
          events: [
            {
              type: 'io.mindroom.pinned_canvases',
              content: { canvases: [{ room_id: ROOM_ID, event_id: '$rep1' }] },
            },
          ],
        },
        rooms: {
          join: {
            [ROOM_ID]: {
              state: { events: stateEvents },
              timeline: {
                events: [rootEv, rep1, rep2, approvalEv],
                limited: true,
                prev_batch: 'pb0',
              },
              ephemeral: { events: [] },
              account_data: { events: [] },
              unread_notifications: { highlight_count: 0, notification_count: 1 },
            },
            [SPACE_ID]: {
              state: { events: spaceState },
              timeline: { events: [], limited: false, prev_batch: 'sp0' },
              ephemeral: { events: [] },
              account_data: { events: [] },
            },
          },
        },
      },
      rooms: {
        [ROOM_ID]: {
          threads: [rootEv],
          threadRelations: { $root1: [approvalEv, rep2, rep1] },
          messagesTail: [olderMsg2, olderMsg1],
          members: stateEvents.filter((e) => e.type === 'm.room.member'),
        },
      },
    },
    liveEntries,
    heavyTrace,
  };
}

// ============================================================================
// 1. capture.mjs unit tests
// ============================================================================

test('capture helpers: GET-only sync filter and prioritized mxc extraction', () => {
  const filter = buildCaptureSyncFilter(25);
  assert.equal(filter.room.timeline.limit, 25);
  assert.deepEqual(filter.room.ephemeral.types, [
    'm.typing',
    'm.receipt',
    'io.mindroom.live',
    'io.mindroom.subagents',
  ]);

  assert.deepEqual(parseMxcUri('mxc://srv.test/abc123'), {
    mxcUri: 'mxc://srv.test/abc123',
    server: 'srv.test',
    mediaId: 'abc123',
  });
  assert.equal(parseMxcUri('https://srv.test/abc'), null);

  const snapshot = {
    initialSync: {
      rooms: {
        join: {
          [ROOM_ID]: {
            state: {
              events: [
                { type: 'm.room.member', content: { avatar_url: 'mxc://srv.test/avatar1' } },
              ],
            },
            timeline: {
              events: [
                {
                  type: 'm.room.message',
                  content: {
                    msgtype: 'm.file',
                    url: 'mxc://srv.test/longtext1',
                    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
                  },
                },
                {
                  type: 'm.room.message',
                  content: { msgtype: 'm.image', url: 'mxc://srv.test/img1' },
                },
              ],
            },
          },
        },
      },
    },
    rooms: {},
  };
  const refs = extractMxcReferences(snapshot, []);
  assert.equal(refs.length, 3);
  assert.equal(refs[0].mediaId, 'longtext1');
  assert.equal(refs[0].priority, 1);
  assert.equal(refs[1].priority, 2);
});

test('capture: matrixGet rejects oversized responses early via Content-Length and chunked streams', async () => {
  // Case A: Content-Length exceeds maxBytes -> rejected before reading stream body
  let headerBodyPulled = false;
  let headerBodyCancelled = false;
  let headerSignal = null;
  const headerFetch = async (_url, init) => {
    headerSignal = init?.signal ?? null;
    return new Response(
      new ReadableStream(
        {
          pull() {
            headerBodyPulled = true;
            throw new Error('stream should not be read when Content-Length exceeds maxBytes');
          },
          cancel() {
            headerBodyCancelled = true;
          },
        },
        { highWaterMark: 0 }
      ),
      {
        status: 200,
        headers: { 'content-length': '10000', 'content-type': 'application/octet-stream' },
      }
    );
  };
  await assert.rejects(
    () =>
      matrixGet('http://127.0.0.1:1', 'tok', '/_matrix/client/v1/media/download/a/b', {
        binary: true,
        maxBytes: 256,
        fetchFn: headerFetch,
      }),
    (err) => err?.code === 'BLOB_TOO_LARGE'
  );
  assert.equal(headerBodyPulled, false);
  assert.equal(headerBodyCancelled, true);
  assert.equal(headerSignal?.aborted, true);

  // Case B: Chunked stream without Content-Length -> aborted as soon as cap is exceeded
  let pulledChunks = 0;
  let streamCancelled = false;
  let streamSignal = null;
  const totalChunks = 50;
  const chunkSize = 100;
  const streamFetch = async (_url, init) => {
    streamSignal = init?.signal ?? null;
    return new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (pulledChunks >= totalChunks) {
              controller.close();
              return;
            }
            pulledChunks += 1;
            controller.enqueue(new Uint8Array(chunkSize).fill(65));
          },
          cancel() {
            streamCancelled = true;
          },
        },
        { highWaterMark: 0 }
      ),
      { status: 200, headers: { 'content-type': 'application/octet-stream' } }
    );
  };
  await assert.rejects(
    () =>
      matrixGet('http://127.0.0.1:1', 'tok', '/_matrix/client/v1/media/download/a/c', {
        binary: true,
        maxBytes: 250,
        fetchFn: streamFetch,
      }),
    (err) => err?.code === 'BLOB_TOO_LARGE'
  );
  assert.equal(streamCancelled, true);
  assert.equal(streamSignal?.aborted, true);
  assert.equal(pulledChunks, 3);
});

test('runCapture enforces GET-only, set_presence=offline, 0700 perms, and downloads long_text blobs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cap-test-'));
  const methods = [];
  const syncUrls = [];
  const sidecarJson = JSON.stringify({ msgtype: 'm.text', body: 'Full hydrated long text body' });
  const srv = http.createServer((req, res) => {
    methods.push(req.method);
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code, body, ct = 'application/json') => {
      res.writeHead(code, { 'Content-Type': ct });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (u.pathname === '/_matrix/client/v3/account/whoami') {
      return send(200, { user_id: VIEWER, device_id: 'CAP_DEV_1' });
    }
    if (u.pathname === '/_matrix/client/v3/sync') {
      syncUrls.push(u.searchParams.get('set_presence'));
      return send(200, {
        next_batch: 'nb1',
        rooms: {
          join: {
            [ROOM_ID]: {
              state: {
                events: [
                  { type: 'm.room.name', state_key: '', content: { name: 'Captured Room' } },
                ],
              },
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$lt1',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS,
                    content: {
                      msgtype: 'm.file',
                      body: 'Preview...',
                      url: 'mxc://example.test/sidecar1',
                      'io.mindroom.long_text': {
                        version: 2,
                        encoding: 'matrix_event_content_json',
                      },
                    },
                  },
                ],
                prev_batch: '',
              },
            },
          },
        },
      });
    }
    if (u.pathname.endsWith('/threads')) return send(200, { chunk: [] });
    if (u.pathname.endsWith('/members')) return send(200, { chunk: [] });
    if (u.pathname === '/_matrix/client/v1/media/download/example.test/sidecar1') {
      return send(200, sidecarJson, 'application/json');
    }
    return send(404, { errcode: 'M_NOT_FOUND' });
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  try {
    const outDir = path.join(dir, 'cap');
    const manifest = await runCapture({
      homeserver: `http://127.0.0.1:${port}`,
      token: 'fake-token',
      deviceId: 'CAP_DEV_1',
      out: outDir,
      duration: 0,
    });
    assert.ok(methods.length > 0);
    assert.ok(
      methods.every((m) => m === 'GET'),
      `Non-GET methods used: ${methods.join(',')}`
    );
    assert.ok(syncUrls.length > 0);
    assert.ok(
      syncUrls.every((p) => p === 'offline'),
      `expected set_presence=offline on /sync`
    );
    assert.equal(fs.statSync(outDir).mode & 0o777, 0o700);
    assert.equal(manifest.primaryRoomName, 'Captured Room');
    assert.equal(manifest.stats.blobs, 1);
    const blobEntry = manifest.blobIndex['example.test/sidecar1'];
    assert.equal(fs.readFileSync(path.join(outDir, 'blobs', blobEntry.file), 'utf8'), sidecarJson);
  } finally {
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2. multiplier.mjs unit tests
// ============================================================================

test('multiplier: K=3 threads, R=2 rooms, pointer remapping, merged jobs/active_runs, copy-on-write', () => {
  const bundle = makeFixtureBundle();
  const startNow = BASE_TS + 5_000_000;
  const mult = createReplayMultiplier(bundle, {
    multiplyThreads: 3,
    multiplyRooms: 2,
    speed: 1,
    startNowMs: startNow,
  });

  assert.equal(copyOffsetMs(0, 3, 9_000), 0);
  assert.equal(copyOffsetMs(1, 3, 9_000), 3_000);
  assert.equal(copyOffsetMs(2, 3, 9_000), 6_000);

  const room0 = mult.initialState.rooms[ROOM_ID];
  const room1Id = mapRoomId(ROOM_ID, 1);
  const room1 = mult.initialState.rooms[room1Id];
  const space = mult.initialState.rooms[SPACE_ID];
  assert.ok(room0 && room1 && space);

  // Space m.space.child includes both original and cloned room
  const spaceChildren = space.state
    .filter((e) => e.type === 'm.space.child')
    .map((e) => e.state_key)
    .sort();
  assert.deepEqual(spaceChildren, [ROOM_ID, room1Id].sort());

  // 3 cloned threads in primary room
  assert.equal(room0.threads.length, 3);
  const clone1Root = room0.threads.find((e) => e.event_id === '$root1__r0_k1');
  assert.ok(clone1Root);
  assert.equal(
    clone1Root.unsigned['m.relations']['m.thread'].latest_event.event_id,
    '$rep2__r0_k1'
  );
  assert.equal(
    clone1Root.unsigned['m.relations']['m.thread']['io.mindroom.latest_reply'].event_id,
    '$rep2__r0_k1'
  );
  assert.equal(
    clone1Root.unsigned['m.relations']['m.thread']['io.mindroom.title'].event_id,
    '$title1__r0_k1'
  );

  // Copy-on-write shares heavy tool_trace object by reference across copies
  const clone1Rep1 = room0.threadRelations['$root1__r0_k1'].find(
    (e) => e.event_id === '$rep1__r0_k1'
  );
  assert.equal(clone1Rep1.content['io.mindroom.tool_trace'], bundle.heavyTrace);
  assert.equal(clone1Rep1.content['io.mindroom.fork'].thread_id, '$root1__r0_k1');
  assert.equal(clone1Rep1.content['io.mindroom.ui_action'].thread_id, '$root1__r0_k1');
  assert.equal(clone1Rep1.content['com.mindroom.voice_source_event_id'], '$root1__r0_k1');

  // Cloned room ui_action remaps room_id too
  const room1Rep1 = room1.threadRelations['$root1__r1_k0'].find(
    (e) => e.event_id === '$rep1__r1_k0'
  );
  assert.equal(room1Rep1.content['io.mindroom.ui_action'].room_id, room1Id);

  // Tool approval pointer remapping
  const clone1Appr = room0.threadRelations['$root1__r0_k1'].find(
    (e) => e.event_id === '$appr1__r0_k1'
  );
  assert.equal(clone1Appr.content.thread_id, '$root1__r0_k1');
  assert.equal(clone1Appr.content.grant_card_event_id, '$rep1__r0_k1');
  assert.equal(clone1Appr.content.approval_provenance.grant_card_event_id, '$rep1__r0_k1');
  assert.equal(clone1Appr.content['io.mindroom.tool_approval'].grant_card_event_id, '$rep1__r0_k1');

  // Thread-keyed state events: tuple tags, plain tags, thread_summary, scheduled.task
  const stateKeys = (type) => room0.state.filter((e) => e.type === type).map((e) => e.state_key);
  assert.ok(stateKeys('com.mindroom.thread.tags').includes('["$root1__r0_k2","urgent"]'));
  assert.ok(stateKeys('com.mindroom.thread.tags').includes('$root1__r0_k2'));
  const sum2 = room0.state.find(
    (e) => e.type === 'io.mindroom.thread_summary' && e.state_key === '$root1__r0_k2'
  );
  assert.equal(sum2.content.event_id, '$title1__r0_k2');
  const sched2 = room0.state.find(
    (e) => e.type === 'com.mindroom.scheduled.task' && e.state_key === 'task-42__r0_k2'
  );
  assert.equal(sched2.content.thread_id, '$root1__r0_k2');
  const wf2 = JSON.parse(sched2.content.workflow);
  assert.equal(wf2.thread_id, '$root1__r0_k2');
  assert.notEqual(wf2.execute_at, '2026-11-24T11:00:00.000Z');

  // Merged pinned_events & pinned_canvases
  const pins = room0.state.find((e) => e.type === 'm.room.pinned_events');
  assert.deepEqual(pins.content.pinned.sort(), ['$root1', '$root1__r0_k1', '$root1__r0_k2'].sort());
  const pinnedCanvases = mult.initialState.accountData.find(
    (e) => e.type === 'io.mindroom.pinned_canvases'
  );
  assert.equal(pinnedCanvases.content.canvases.length, 6); // 2 rooms * 3 threads

  // MERGED background_jobs per (roomId, agentId)
  const jobsEvents = room0.state.filter((e) => e.type === 'io.mindroom.background_jobs');
  assert.equal(jobsEvents.length, 1);
  assert.equal(jobsEvents[0].sender, AGENT);
  assert.equal(jobsEvents[0].state_key, AGENT);
  assert.equal(jobsEvents[0].content.jobs.length, 3);
  assert.equal(jobsEvents[0].content.total, 9); // 3 copies * total=3

  // MERGED active_runs per (roomId, agentId) + TTL re-stamped to startNow
  const arEvents = room0.state.filter((e) => e.type === 'io.mindroom.active_runs');
  assert.equal(arEvents.length, 1);
  assert.equal(arEvents[0].origin_server_ts, startNow);
  assert.equal(arEvents[0].content.updated_at, startNow);
  assert.equal(arEvents[0].content.threads.length, 3);

  // refreshActiveRuns re-stamps to a later clock so TTL never kills active runs
  const later = startNow + 120_000;
  const refreshed = mult.refreshActiveRuns(later);
  assert.equal(refreshed[ROOM_ID].stateEvents[0].origin_server_ts, later);
  assert.equal(refreshed[ROOM_ID].stateEvents[0].content.updated_at, later);

  // Same-domain @mindroom_* identity preserved
  assert.ok(jobsEvents[0].sender.endsWith(`:${mult.meta.viewerDomain}`));
});

test('multiplier: warmupDeltas, mid-stream snapshot synthesis, subagents, receipts, and multi-gen unique IDs', () => {
  const bundle = makeFixtureBundle();
  const startNow = BASE_TS + 1_000_000;
  const mult = createReplayMultiplier(bundle, {
    multiplyThreads: 3,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: startNow,
  });

  // Warmup emits ordered deltas for staggered copies (k=1: tau=1000; k=2: tau=1000 & tau=4000)
  // WITH live/subagent frames included (not suppressed!).
  const warmupLive = mult.initialState.warmupDeltas.flatMap((d) =>
    (d.rooms[ROOM_ID]?.ephemeralEvents ?? []).filter((e) => e.type === 'io.mindroom.live')
  );
  const wK1Snap = warmupLive.find((e) => e.content.reply === '$live_reply__r0_k1_g0');
  const wK2Frames = warmupLive.filter((e) => e.content.reply === '$live_reply__r0_k2_g0');
  assert.ok(wK1Snap?.content.snapshot);
  assert.equal(wK1Snap.content.seq, 0);
  assert.equal(wK1Snap.content.snapshot.md, 'Hello');
  assert.match(wK1Snap.content.sid, SID_RE);
  assert.equal(wK2Frames.length, 2);
  assert.equal(wK2Frames[0].content.seq, 0);
  assert.equal(wK2Frames[0].content.snapshot.md, 'Hello');
  assert.equal(wK2Frames[1].content.seq, 1);
  assert.equal(wK2Frames[1].content.sid, wK2Frames[0].content.sid);
  const wK2Docs = applyLiveDeltaToDocs(wK2Frames[0].content.snapshot, wK2Frames[1].content.delta);
  assert.equal(wK2Docs.md, 'Hello world');

  // At elapsed = 1500ms:
  // - k=0 (offset 0): virtual=1500 -> tau=1000 fires (snapshot seq 0 + subagents + $live_reply)
  // - k=1 (offset 3000): virtual=4500 -> tau=4000 fires (delta seq 1 chaining onto warmup snapshot!)
  // - k=2 (offset 6000): virtual=7500 -> tau=7000 fires (delta seq 2 chaining onto warmup delta!)
  const d1 = mult.advance(1_500, startNow + 1_500);
  const live1 = d1.rooms[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'io.mindroom.live');
  assert.equal(live1.length, 3);

  const fK0 = live1.find((e) => e.content.reply === '$live_reply');
  const fK1 = live1.find((e) => e.content.reply === '$live_reply__r0_k1_g0');
  const fK2 = live1.find((e) => e.content.reply === '$live_reply__r0_k2_g0');
  assert.equal(fK0.content.seq, 0);
  assert.equal(fK0.content.snapshot.md, 'Hello');
  assert.match(fK0.content.sid, SID_RE);

  assert.equal(fK1.content.seq, 1);
  assert.equal(fK1.content.sid, wK1Snap.content.sid);
  assert.ok(fK1.content.delta);
  const k1AfterD1 = applyLiveDeltaToDocs(wK1Snap.content.snapshot, fK1.content.delta);
  assert.equal(k1AfterD1.md, 'Hello world');

  assert.equal(fK2.content.seq, 2);
  assert.equal(fK2.content.sid, wK2Frames[0].content.sid);
  assert.ok(fK2.content.delta);
  const k2AfterD1 = applyLiveDeltaToDocs(wK2Docs, fK2.content.delta);
  assert.equal(k2AfterD1.md, 'Hello world!');

  // Receipt for k=1 remaps thread_id but preserves "main"
  const receipts1 = d1.rooms[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'm.receipt');
  assert.equal(receipts1.length, 1);
  const recTarget = receipts1[0].content['$live_reply__r0_k1_g0']['m.read'];
  assert.equal(recTarget[VIEWER].thread_id, '$root1__r0_k1');
  assert.equal(recTarget[AGENT].thread_id, 'main');

  // Subagent frame for k=0 shifted Unix seconds and kept valid sid/seq
  const sub1 = d1.rooms[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'io.mindroom.subagents');
  assert.equal(sub1.length, 1);
  assert.match(sub1[0].content.sid, SID_RE);
  assert.ok(sub1[0].content.meta.started_at > Math.floor(BASE_TS / 1000));

  // Next step (elapsed = 4500ms): k=1 hits tau=7000 -> emits DELTA with seq=2!
  const d2 = mult.advance(4_500, startNow + 4_500);
  const fK1Delta = d2.rooms[ROOM_ID].ephemeralEvents.find(
    (e) => e.type === 'io.mindroom.live' && e.content.reply === '$live_reply__r0_k1_g0'
  );
  assert.equal(fK1Delta.content.seq, 2);
  assert.equal(fK1Delta.content.sid, wK1Snap.content.sid);
  assert.ok(fK1Delta.content.delta);
  const applied = applyLiveDeltaToDocs(k1AfterD1, fK1Delta.content.delta);
  assert.equal(applied.md, 'Hello world!');

  // Mid-stream capture that begins directly with a delta synthesizes a valid seq=0 snapshot!
  const midBundle = makeFixtureBundle();
  midBundle.liveEntries = [
    {
      tauMs: 100,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 100,
                    content: {
                      v: 1,
                      reply: '$mid_only',
                      sid: '1760000000100-aabbccdd',
                      seq: 5,
                      delta: { md: { at: 0, del: 0, ins: 'Mid-stream text', len: 15 } },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];
  const midMult = createReplayMultiplier(midBundle, {
    multiplyThreads: 1,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: startNow,
  });
  const midDelta = midMult.advance(200, startNow + 200);
  const synthSnap = midDelta.rooms[ROOM_ID].ephemeralEvents.find(
    (e) => e.type === 'io.mindroom.live' && e.content.reply === '$mid_only'
  );
  assert.equal(synthSnap.content.seq, 0);
  assert.ok(synthSnap.content.snapshot);
  assert.equal(synthSnap.content.snapshot.md, 'Mid-stream text');
  assert.match(synthSnap.content.sid, SID_RE);

  // Generation wraparound across 2.5 full loops: ZERO duplicate event_ids!
  const allEventIds = new Set(mult.initialState.rooms[ROOM_ID].timeline.map((e) => e.event_id));
  for (const w of mult.initialState.warmupDeltas) {
    for (const ev of w.rooms[ROOM_ID]?.timelineEvents ?? []) {
      assert.equal(allEventIds.has(ev.event_id), false, `duplicate warmup ${ev.event_id}`);
      allEventIds.add(ev.event_id);
    }
  }
  for (const ev of [...d1.rooms[ROOM_ID].timelineEvents, ...d2.rooms[ROOM_ID].timelineEvents]) {
    assert.equal(allEventIds.has(ev.event_id), false, `duplicate ${ev.event_id}`);
    allEventIds.add(ev.event_id);
  }
  for (let t = 7_500; t <= 24_000; t += 3_000) {
    const step = mult.advance(t, startNow + t);
    for (const ev of step.rooms[ROOM_ID]?.timelineEvents ?? []) {
      assert.equal(allEventIds.has(ev.event_id), false, `duplicate across gen: ${ev.event_id}`);
      allEventIds.add(ev.event_id);
    }
  }
});

// ============================================================================
// 3. server.mjs HTTP end-to-end tests
// ============================================================================

test('server: CS-API endpoints, live sync, threads, relations, messages, media, warm catch-up, reset & stats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-srv-test-'));
  const blobsDir = path.join(dir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  const longTextPayload = JSON.stringify({
    msgtype: 'm.text',
    body: 'Hydrated long_text sidecar!',
  });
  const sha = crypto.createHash('sha256').update(longTextPayload).digest('hex');
  fs.writeFileSync(path.join(blobsDir, sha), longTextPayload);

  const bundle = makeFixtureBundle();
  bundle.manifest.blobIndex = {
    'example.test/lt_blob': {
      file: sha,
      contentType: 'application/json',
      bytes: longTextPayload.length,
    },
  };
  const statsFile = path.join(dir, 'stats.jsonl');

  const srv = await startReplayServer({
    bundle,
    blobsDir,
    port: 0,
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 20, // fast replay so live frames arrive in < 300 ms
    statsFile,
    statsIntervalMs: 250,
  });

  const api = async (p, opts = {}) => {
    const headers = {
      Authorization: `Bearer ${srv.accessToken}`,
      ...(opts.headers ?? {}),
    };
    const res = await fetch(`${srv.baseUrl}${p}`, { ...opts, headers });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      ct,
      body: ct.includes('application/json')
        ? await res.json()
        : Buffer.from(await res.arrayBuffer()),
    };
  };

  try {
    // Login & discovery
    const versions = await api('/_matrix/client/versions');
    assert.ok(versions.body.versions.includes('v1.11'));
    const flows = await api('/_matrix/client/v3/login');
    assert.equal(flows.body.flows[0].type, 'm.login.password');
    const login = await api('/_matrix/client/v3/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.password', user: 'viewer', password: srv.password }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user_id, VIEWER);
    assert.equal(login.body.access_token, srv.accessToken);
    assert.equal(login.body.home_server, 'example.test');

    // Saved filter + initial /sync with limited timeline
    const flt = await api(`/_matrix/client/v3/user/${encodeURIComponent(VIEWER)}/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: { timeline: { limit: 2 } } }),
    });
    const initSync = await api(`/_matrix/client/v3/sync?filter=${flt.body.filter_id}&timeout=0`);
    assert.equal(initSync.status, 200);
    const roomSync = initSync.body.rooms.join[ROOM_ID];
    assert.equal(roomSync.timeline.events.length, 2);
    assert.equal(roomSync.timeline.limited, true);
    assert.ok(roomSync.timeline.prev_batch.startsWith('m'));
    const savedSince = initSync.body.next_batch;

    // /messages back-pagination from prev_batch
    const msgs = await api(
      `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/messages?dir=b&from=${roomSync.timeline.prev_batch}&limit=3`
    );
    assert.equal(msgs.body.chunk.length, 3);
    assert.ok(msgs.body.end);

    // /relations pagination (dir=b and dir=f)
    const rels = await api(
      `/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/relations/${encodeURIComponent('$root1')}/m.thread?dir=b&limit=2`
    );
    assert.equal(rels.body.chunk.length, 2);
    assert.ok(rels.body.next_batch);
    const relsPage2 = await api(
      `/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/relations/${encodeURIComponent('$root1')}/m.thread?dir=b&limit=2&from=${encodeURIComponent(rels.body.next_batch)}`
    );
    assert.ok(relsPage2.body.chunk.length >= 1);

    // Media download (long_text blob), thumbnail fallback (PNG), uncaptured download (404)
    const lt = await api('/_matrix/client/v1/media/download/example.test/lt_blob');
    assert.equal(lt.status, 200);
    assert.equal(lt.body.body, 'Hydrated long_text sidecar!');
    const thumb = await api('/_matrix/client/v1/media/thumbnail/example.test/missing?width=32');
    assert.equal(thumb.status, 200);
    assert.equal(thumb.ct, 'image/png');
    const missing = await api('/_matrix/client/v1/media/download/example.test/missing');
    assert.equal(missing.status, 404);

    // Incremental /sync receives live multiplied frames
    let gotLiveFrame = false;
    let since = savedSince;
    for (let i = 0; i < 6 && !gotLiveFrame; i += 1) {
      const inc = await api(
        `/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=1000`
      );
      since = inc.body.next_batch;
      const eps = inc.body.rooms.join[ROOM_ID]?.ephemeral?.events ?? [];
      if (eps.some((e) => e.type === 'io.mindroom.live')) gotLiveFrame = true;
    }
    assert.equal(
      gotLiveFrame,
      true,
      'expected incremental /sync to deliver io.mindroom.live frames'
    );

    // Warm reload catch-up from savedSince delivers accumulated live events immediately
    const warmCatchup = await api(
      `/_matrix/client/v3/sync?since=${encodeURIComponent(savedSince)}&timeout=0`
    );
    assert.notEqual(warmCatchup.body.next_batch, savedSince);
    assert.ok(
      (warmCatchup.body.rooms.join[ROOM_ID]?.ephemeral?.events?.length ?? 0) > 0 ||
        (warmCatchup.body.rooms.join[ROOM_ID]?.timeline?.events?.length ?? 0) > 0
    );

    // /threads returns cloned threads with updated live bundled summary
    const threads = await api(
      `/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/threads?limit=10`
    );
    assert.equal(threads.body.chunk.length, 2);
    assert.ok(threads.body.chunk[0].unsigned['m.relations']['m.thread'].count >= 2);

    // Write stub echoes event into /sync
    const sent = await api(
      `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/send/m.room.message/txn1`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'm.text', body: 'Local echo test' }),
      }
    );
    assert.equal(sent.status, 200);
    assert.ok(sent.body.event_id.startsWith('$local_'));

    // Status, reset & JSONL stats file
    const st = await api('/__replay/status');
    assert.equal(st.body.running, true);
    assert.equal(st.body.threadCount, 2);
    assert.ok(st.body.stats.totalFrames > 0);

    const preResetSyncSeq = st.body.syncSeq;
    const preResetSince = `s${preResetSyncSeq}`;
    const reset = await api('/__replay/reset', { method: 'POST' });
    assert.equal(reset.body.ok, true);
    assert.equal(reset.body.status.stats.totalFrames, 0);
    assert.ok(
      reset.body.status.syncSeq > preResetSyncSeq,
      `expected syncSeq to advance monotonically across reset (${reset.body.status.syncSeq} <= ${preResetSyncSeq})`
    );
    // Client holding a pre-reset since token must resync immediately without hanging
    const postResetSync = await api(
      `/_matrix/client/v3/sync?since=${encodeURIComponent(preResetSince)}&timeout=2000`
    );
    assert.equal(postResetSync.status, 200);
    assert.notEqual(postResetSync.body.next_batch, preResetSince);

    await new Promise((r) => setTimeout(r, 350));
    assert.ok(fs.existsSync(statsFile));
    const statLines = fs
      .readFileSync(statsFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(statLines.length >= 1);
    for (const key of ['t', 'target', 'streaming', 'frames', 'edits', 'jobs', 'stuck']) {
      assert.equal(typeof statLines[0][key], 'number');
    }
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server CLI --print-ready emits JSON handshake and shuts down cleanly on SIGTERM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cli-test-'));
  const bundle = makeFixtureBundle();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(bundle.manifest));
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(bundle.snapshot));
  fs.writeFileSync(
    path.join(dir, 'live.jsonl'),
    bundle.liveEntries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  const serverScript = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const child = spawn(
    process.execPath,
    [serverScript, '--capture', dir, '--port', '0', '--multiply-threads', '2', '--print-ready'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  try {
    const readyLine = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('timeout waiting for ready JSON')), 10_000);
      child.stdout.on('data', (c) => {
        buf += c.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          clearTimeout(timer);
          resolve(buf.slice(0, nl));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`exited early with ${code}`));
      });
    });
    const ready = JSON.parse(readyLine);
    assert.ok(ready.url.startsWith('http://127.0.0.1:'));
    assert.equal(ready.userId, VIEWER);
    assert.equal(ready.username, 'viewer');
    assert.equal(ready.roomId, ROOM_ID);
    assert.equal(ready.multiplyThreads, 2);
    assert.equal(typeof ready.password, 'string');
    assert.ok(ready.password.length >= 16);
    assert.equal(typeof ready.accessToken, 'string');
    assert.ok(ready.accessToken.length >= 16);

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
      child.kill('SIGTERM');
    });
    assert.equal(exitCode, 0);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server security: auth gate, loopback-only CORS, Host header check, and login password check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-sec-test-'));
  const blobsDir = path.join(dir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  const mediaPayload = Buffer.from('secret-media-payload');
  const sha = crypto.createHash('sha256').update(mediaPayload).digest('hex');
  fs.writeFileSync(path.join(blobsDir, sha), mediaPayload);

  const bundle = makeFixtureBundle();
  bundle.manifest.blobIndex = {
    'example.test/m1': { file: sha, contentType: 'text/plain', bytes: mediaPayload.length },
  };
  const srv = await startReplayServer({
    bundle,
    blobsDir,
    port: 0,
    multiplyThreads: 1,
    speed: 1,
  });

  const rawHttpRequest = (p, { method = 'GET', headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: srv.port, path: p, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: raw ? JSON.parse(raw) : null,
            });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });

  try {
    // (a) Unauthenticated capture-data & /__replay/* routes return 401 M_UNKNOWN_TOKEN
    const unauthSync = await fetch(`${srv.baseUrl}/_matrix/client/v3/sync?timeout=0`);
    assert.equal(unauthSync.status, 401);
    assert.equal((await unauthSync.json()).errcode, 'M_UNKNOWN_TOKEN');

    const unauthStatus = await fetch(`${srv.baseUrl}/__replay/status`);
    assert.equal(unauthStatus.status, 401);
    assert.equal((await unauthStatus.json()).errcode, 'M_UNKNOWN_TOKEN');

    const unauthMedia = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/media/download/example.test/m1`
    );
    assert.equal(unauthMedia.status, 401);

    // Media also accepts ?access_token= query parameter; /sync does NOT
    const queryMedia = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/media/download/example.test/m1?access_token=${encodeURIComponent(srv.accessToken)}`
    );
    assert.equal(queryMedia.status, 200);
    assert.equal(queryMedia.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await queryMedia.text(), 'secret-media-payload');

    const thumbMedia = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/media/thumbnail/example.test/missing?access_token=${encodeURIComponent(srv.accessToken)}`
    );
    assert.equal(thumbMedia.status, 200);
    assert.equal(thumbMedia.headers.get('x-content-type-options'), 'nosniff');

    const querySync = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/sync?timeout=0&access_token=${encodeURIComponent(srv.accessToken)}`
    );
    assert.equal(querySync.status, 401);

    // Public discovery endpoints remain accessible unauthenticated
    assert.equal((await fetch(`${srv.baseUrl}/.well-known/matrix/client`)).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/_matrix/client/versions`)).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/_matrix/client/v3/login`)).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/_matrix/client/v3/register`)).status, 403);

    // (b) Non-loopback Origin receives NO Access-Control-Allow-Origin; loopback Origins do
    const evilCors = await fetch(`${srv.baseUrl}/_matrix/client/versions`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(evilCors.headers.get('access-control-allow-origin'), null);

    const evilSubdomainCors = await fetch(`${srv.baseUrl}/_matrix/client/versions`, {
      headers: { Origin: 'http://127.0.0.1.evil.example:4200' },
    });
    assert.equal(evilSubdomainCors.headers.get('access-control-allow-origin'), null);

    const loopbackCors = await fetch(`${srv.baseUrl}/_matrix/client/versions`, {
      headers: { Origin: 'http://127.0.0.1:4200' },
    });
    assert.equal(loopbackCors.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4200');

    const localhostCors = await fetch(`${srv.baseUrl}/_matrix/client/versions`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(localhostCors.headers.get('access-control-allow-origin'), 'http://localhost:5173');

    // (c) Non-loopback Host header returns 403 (DNS rebinding protection)
    const badHost = await rawHttpRequest('/_matrix/client/versions', {
      headers: { Host: 'evil.example:8080' },
    });
    assert.equal(badHost.status, 403);
    assert.equal(badHost.body.errcode, 'M_FORBIDDEN');

    const wrongPortHost = await rawHttpRequest('/_matrix/client/versions', {
      headers: { Host: '127.0.0.1:1' },
    });
    assert.equal(wrongPortHost.status, 403);

    const goodLocalhost = await rawHttpRequest('/_matrix/client/versions', {
      headers: { Host: `localhost:${srv.port}` },
    });
    assert.equal(goodLocalhost.status, 200);

    // (d) Wrong login password returns 403 M_FORBIDDEN; valid password returns per-run accessToken
    const badLogin = await fetch(`${srv.baseUrl}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        user: 'viewer',
        password: 'wrong-password',
      }),
    });
    assert.equal(badLogin.status, 403);
    assert.equal((await badLogin.json()).errcode, 'M_FORBIDDEN');

    const goodLogin = await fetch(`${srv.baseUrl}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.password', user: 'viewer', password: srv.password }),
    });
    assert.equal(goodLogin.status, 200);
    const loginBody = await goodLogin.json();
    assert.equal(loginBody.access_token, srv.accessToken);
    assert.equal(loginBody.user_id, VIEWER);

    // Deterministic password/accessToken options override random defaults
    const customSrv = await startReplayServer({
      bundle,
      port: 0,
      password: 'custom-test-password',
      accessToken: 'custom-test-token',
    });
    try {
      assert.equal(customSrv.password, 'custom-test-password');
      assert.equal(customSrv.accessToken, 'custom-test-token');
      const customLogin = await fetch(`${customSrv.baseUrl}/_matrix/client/v3/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'm.login.password',
          user: 'viewer',
          password: 'custom-test-password',
        }),
      });
      assert.equal(customLogin.status, 200);
      assert.equal((await customLogin.json()).access_token, 'custom-test-token');
    } finally {
      await customSrv.close();
    }
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('timeline state events: io.mindroom.active_runs in timeline.events is merged under 2x, persisted in /state, and present in cold /sync past timeline.limit', async () => {
  const bundle = makeFixtureBundle();
  // Remove initial active_runs from state.events so it arrives ONLY via live timeline.events
  bundle.snapshot.initialSync.rooms.join[ROOM_ID].state.events =
    bundle.snapshot.initialSync.rooms.join[ROOM_ID].state.events.filter(
      (ev) => ev.type !== 'io.mindroom.active_runs'
    );
  bundle.manifest.durationMs = 4_000;
  bundle.liveEntries = [
    {
      tauMs: 100,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'io.mindroom.active_runs',
                    event_id: '$tl_ar_1',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    state_key: AGENT,
                    origin_server_ts: BASE_TS + 100,
                    content: {
                      version: 1,
                      updated_at: BASE_TS + 100,
                      ttl_ms: 180_000,
                      threads: [{ thread_id: '$root1' }],
                    },
                  },
                  {
                    type: 'com.mindroom.thread.tags',
                    event_id: '$tl_tag_1',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    state_key: '["$root1","tl-tag"]',
                    origin_server_ts: BASE_TS + 102,
                    content: { set_by: VIEWER, set_at: '2026-11-24T10:00:00.000Z' },
                  },
                  {
                    type: 'm.room.member',
                    event_id: '$tl_mem_1',
                    room_id: ROOM_ID,
                    sender: '@late_joiner:example.test',
                    state_key: '@late_joiner:example.test',
                    origin_server_ts: BASE_TS + 104,
                    content: { membership: 'join', displayname: 'Late Joiner' },
                  },
                  {
                    type: 'm.room.message',
                    event_id: '$tl_pad_1',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 110,
                    content: { msgtype: 'm.text', body: 'Pad message 1' },
                  },
                  {
                    type: 'm.room.message',
                    event_id: '$tl_pad_2',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 120,
                    content: { msgtype: 'm.text', body: 'Pad message 2' },
                  },
                  {
                    type: 'm.room.message',
                    event_id: '$tl_pad_3',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 130,
                    content: { msgtype: 'm.text', body: 'Pad message 3' },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 20,
  });

  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };
  try {
    // Wait until copy 0 has also fired tau=100 (copy 1 fired during warmup at offset=2000ms)
    const deadline = Date.now() + 3_000;
    let mergedAr = null;
    while (Date.now() < deadline) {
      const stateRes = await fetch(
        `${srv.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/state`,
        { headers: authHeaders }
      );
      const stateEvents = await stateRes.json();
      const found = stateEvents.find(
        (ev) => ev.type === 'io.mindroom.active_runs' && ev.state_key === AGENT
      );
      if (found && found.content.threads.length === 2) {
        mergedAr = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    assert.ok(mergedAr, 'expected merged io.mindroom.active_runs from timeline.events in /state');
    assert.deepEqual(
      mergedAr.content.threads.map((t) => t.thread_id).sort(),
      ['$root1', '$root1__r0_k1'].sort()
    );

    // Fresh cold /sync with timeline.limit = 2 pushes $tl_ar_1 outside timeline.events,
    // yet state.events MUST still include the merged io.mindroom.active_runs event!
    const filter = encodeURIComponent(JSON.stringify({ room: { timeline: { limit: 2 } } }));
    const coldRes = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/sync?filter=${filter}&timeout=0`,
      { headers: authHeaders }
    );
    assert.equal(coldRes.status, 200);
    const coldRoom = (await coldRes.json()).rooms.join[ROOM_ID];
    assert.equal(coldRoom.timeline.events.length, 2);
    assert.equal(
      coldRoom.timeline.events.some((ev) => ev.type === 'io.mindroom.active_runs'),
      false,
      'active_runs should have fallen past timeline.limit=2'
    );
    const coldAr = coldRoom.state.events.find(
      (ev) => ev.type === 'io.mindroom.active_runs' && ev.state_key === AGENT
    );
    assert.ok(coldAr, 'expected merged io.mindroom.active_runs in cold /sync state.events');
    assert.deepEqual(
      coldAr.content.threads.map((t) => t.thread_id).sort(),
      ['$root1', '$root1__r0_k1'].sort()
    );
    const coldTags = coldRoom.state.events
      .filter((ev) => ev.type === 'com.mindroom.thread.tags' && ev.state_key.includes('tl-tag'))
      .map((ev) => ev.state_key)
      .sort();
    assert.deepEqual(coldTags, ['["$root1","tl-tag"]', '["$root1__r0_k1","tl-tag"]'].sort());

    const membersRes = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/members`,
      { headers: authHeaders }
    );
    const membersChunk = (await membersRes.json()).chunk;
    assert.ok(membersChunk.some((ev) => ev.state_key === '@late_joiner:example.test'));
  } finally {
    await srv.close();
  }
});

test('server: thread summary seeding preserves captured count=17, participation, and latest reply alongside historical replies', async () => {
  const capturedLatest = {
    type: 'm.room.message',
    event_id: '$rep17',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 50_000,
    content: {
      msgtype: 'm.text',
      body: 'Captured 17th reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root_old' },
    },
  };
  const capturedTitle = {
    type: 'm.room.message',
    event_id: '$title_old',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 60_000,
    content: {
      msgtype: 'm.notice',
      body: 'Captured Thread Title',
      'io.mindroom.thread_summary': { summary: 'Captured Thread Title', version: 1 },
    },
  };
  const oldRoot = {
    type: 'm.room.message',
    event_id: '$root_old',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 200_000,
    content: { msgtype: 'm.text', body: 'Older thread root' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 17,
          current_user_participated: true,
          latest_event: capturedLatest,
          'io.mindroom.latest_reply': capturedLatest,
          'io.mindroom.title': capturedTitle,
        },
      },
    },
  };
  const historicalReply = {
    type: 'm.room.message',
    event_id: '$hist_rep',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 40_000,
    content: {
      msgtype: 'm.text',
      body: 'Historical reply indexed from messagesTail / timeline',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root_old' },
    },
  };

  const bundle = makeFixtureBundle();
  bundle.liveEntries = [];
  bundle.snapshot.initialSync.rooms.join[ROOM_ID].timeline.events = [historicalReply];
  bundle.snapshot.rooms[ROOM_ID] = {
    threads: [oldRoot],
    threadRelations: { $root_old: [historicalReply] },
    messagesTail: [historicalReply],
    members: bundle.snapshot.rooms[ROOM_ID].members,
  };

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 1,
    multiplyRooms: 1,
    speed: 1,
  });
  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };

  try {
    const res = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/threads?limit=10`,
      { headers: authHeaders }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.chunk.length, 1);
    const summary = body.chunk[0].unsigned['m.relations']['m.thread'];
    assert.equal(summary.count, 17);
    assert.equal(summary.current_user_participated, true);
    assert.equal(summary.latest_event.event_id, '$rep17');
    assert.equal(summary['io.mindroom.latest_reply'].event_id, '$rep17');
    assert.equal(summary['io.mindroom.title'].event_id, '$title_old');

    // Sending a genuinely new live reply increments count to 18 and updates latest_event
    const sendRes = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/send/m.room.message/txn_live`,
      {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: 'Brand new live reply',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root_old' },
        }),
      }
    );
    const sent = await sendRes.json();
    const afterRes = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/threads?limit=10`,
      { headers: authHeaders }
    );
    const afterSummary = (await afterRes.json()).chunk[0].unsigned['m.relations']['m.thread'];
    assert.equal(afterSummary.count, 18);
    assert.equal(afterSummary.latest_event.event_id, sent.event_id);
    assert.equal(afterSummary['io.mindroom.latest_reply'].event_id, sent.event_id);
  } finally {
    await srv.close();
  }
});

test('server: mid-stream initial /sync includes valid snapshot frame for active live stream', async () => {
  const bundle = makeFixtureBundle();
  bundle.manifest.durationMs = 10_000;
  bundle.liveEntries = [
    {
      tauMs: 50,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$mid_reply',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 50,
                    content: {
                      msgtype: 'm.text',
                      body: 'Hello',
                      'io.mindroom.stream_status': 'streaming',
                    },
                  },
                ],
              },
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 50,
                    content: {
                      v: 1,
                      reply: '$mid_reply',
                      sid: '1760000000050-11223344',
                      seq: 0,
                      snapshot: {
                        md: 'Hello',
                        reasoning: '',
                        tools: [],
                        status: 'streaming',
                        activity: 'Typing',
                        segments: [],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 150,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 150,
                    content: {
                      v: 1,
                      reply: '$mid_reply',
                      sid: '1760000000050-11223344',
                      seq: 1,
                      delta: {
                        md: { at: 5, del: 0, ins: ' world', len: 11 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 1_200,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_200,
                    content: {
                      v: 1,
                      reply: '$mid_reply',
                      sid: '1760000000050-11223344',
                      seq: 2,
                      delta: {
                        md: { at: 11, del: 0, ins: '!', len: 12 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 1,
    multiplyRooms: 1,
    speed: 1,
  });
  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };

  try {
    // Advance past both the initial snapshot (tau=50ms) and first delta (tau=150ms),
    // leaving a generous window before delta 2 (tau=1200ms).
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && srv.getStatus().stats.totalFrames < 2) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(srv.getStatus().stats.totalFrames >= 2);

    // Connect a fresh client mid-stream via initial /sync
    const initRes = await fetch(`${srv.baseUrl}/_matrix/client/v3/sync?timeout=0`, {
      headers: authHeaders,
    });
    assert.equal(initRes.status, 200);
    const initBody = await initRes.json();
    const ephemeral = initBody.rooms.join[ROOM_ID].ephemeral.events;
    const snapEv = ephemeral.find(
      (e) => e.type === 'io.mindroom.live' && e.content?.reply === '$mid_reply'
    );
    assert.ok(snapEv, 'expected initial /sync ephemeral.events to include active live snapshot');
    assert.equal(snapEv.content.v, 1);
    assert.match(snapEv.content.sid, SID_RE);
    assert.equal(snapEv.content.seq, 1);
    assert.ok(snapEv.content.snapshot, 'mid-stream initial sync frame must carry snapshot');
    assert.equal(snapEv.content.delta, undefined);
    assert.equal(snapEv.content.snapshot.md, 'Hello world');

    // Subsequent incremental /sync delivers delta 2 chaining seamlessly onto that snapshot
    let since = initBody.next_batch;
    let deltaEv = null;
    for (let i = 0; i < 6 && !deltaEv; i += 1) {
      const incRes = await fetch(
        `${srv.baseUrl}/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=1500`,
        { headers: authHeaders }
      );
      const incBody = await incRes.json();
      since = incBody.next_batch;
      const eps = incBody.rooms.join[ROOM_ID]?.ephemeral?.events ?? [];
      deltaEv = eps.find(
        (e) =>
          e.type === 'io.mindroom.live' && e.content?.reply === '$mid_reply' && e.content?.delta
      );
    }
    assert.ok(deltaEv, 'expected incremental /sync to deliver subsequent delta frame');
    assert.equal(deltaEv.content.sid, snapEv.content.sid);
    assert.equal(deltaEv.content.seq, snapEv.content.seq + 1);
    const applied = applyLiveDeltaToDocs(snapEv.content.snapshot, deltaEv.content.delta);
    assert.equal(applied.md, 'Hello world!');
  } finally {
    await srv.close();
  }
});

test('multiplier: chronological Kx interleaving of initialSync.timeline and messagesTail', async () => {
  const bundle = {
    manifest: {
      version: 1,
      capturedAtMs: 101,
      userId: VIEWER,
      viewerDomain: 'example.test',
      primaryRoomId: ROOM_ID,
      primaryRoomName: 'Chrono Room',
      focusedRoomIds: [ROOM_ID],
      durationMs: 10_000,
      blobIndex: {},
    },
    snapshot: {
      initialSync: {
        next_batch: 'b0',
        account_data: { events: [] },
        rooms: {
          join: {
            [ROOM_ID]: {
              state: {
                events: [
                  {
                    type: 'm.room.create',
                    event_id: '$st_c',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    state_key: '',
                    origin_server_ts: 1,
                    content: { room_version: '11' },
                  },
                ],
              },
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$e1',
                    room_id: ROOM_ID,
                    sender: VIEWER,
                    origin_server_ts: 100,
                    content: { msgtype: 'm.text', body: 'first' },
                  },
                  {
                    type: 'm.room.message',
                    event_id: '$e2',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: 101,
                    content: { msgtype: 'm.text', body: 'second' },
                  },
                ],
                limited: true,
                prev_batch: 'pb0',
              },
              ephemeral: { events: [] },
              account_data: { events: [] },
            },
          },
        },
      },
      rooms: {
        [ROOM_ID]: {
          threads: [],
          threadRelations: {},
          // /messages?dir=b stores newest first
          messagesTail: [
            {
              type: 'm.room.message',
              event_id: '$m2',
              room_id: ROOM_ID,
              sender: AGENT,
              origin_server_ts: 51,
              content: { msgtype: 'm.text', body: 'tail-2' },
            },
            {
              type: 'm.room.message',
              event_id: '$m1',
              room_id: ROOM_ID,
              sender: VIEWER,
              origin_server_ts: 50,
              content: { msgtype: 'm.text', body: 'tail-1' },
            },
          ],
          members: [],
        },
      },
    },
    liveEntries: [],
  };

  const mult = createReplayMultiplier(bundle, {
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: 101,
  });
  const room0 = mult.initialState.rooms[ROOM_ID];
  assert.deepEqual(
    room0.timeline.map((e) => e.origin_server_ts),
    [100, 100, 101, 101]
  );
  assert.deepEqual(
    room0.timeline.map((e) => e.event_id),
    ['$e1', '$e1__r0_k1', '$e2', '$e2__r0_k1']
  );

  // messagesTail is stored newest-first; reversing it yields chronological 50, 50, 51, 51
  const tailChrono = [...room0.messagesTail].reverse();
  assert.deepEqual(
    tailChrono.map((e) => e.origin_server_ts),
    [50, 50, 51, 51]
  );
  assert.deepEqual(
    tailChrono.map((e) => e.event_id),
    ['$m1', '$m1__r0_k1', '$m2', '$m2__r0_k1']
  );

  // Server /messages?dir=f exposes the full timeline in monotonically non-decreasing order
  const srv = await startReplayServer({ bundle, port: 0, multiplyThreads: 2 });
  try {
    const res = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/messages?dir=f&limit=20`,
      { headers: { Authorization: `Bearer ${srv.accessToken}` } }
    );
    const body = await res.json();
    const ts = body.chunk.map((e) => e.origin_server_ts);
    assert.equal(ts.length, 8);
    for (let i = 1; i < ts.length; i += 1) {
      assert.ok(ts[i] >= ts[i - 1], `non-monotonic timestamps at ${i}: ${ts.join(',')}`);
    }
    assert.deepEqual(
      body.chunk.map((e) => e.event_id),
      ['$m1', '$m1__r0_k1', '$m2', '$m2__r0_k1', '$e1', '$e1__r0_k1', '$e2', '$e2__r0_k1']
    );
  } finally {
    await srv.close();
  }
});

test('server: K=2 staggered warmup increments /threads count 17->18 and includes live snapshot in initial /sync', async () => {
  const capturedLatest = {
    type: 'm.room.message',
    event_id: '$rep17',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 50_000,
    content: {
      msgtype: 'm.text',
      body: 'Captured 17th reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root_old' },
    },
  };
  const capturedTitle = {
    type: 'm.room.message',
    event_id: '$title_old',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 60_000,
    content: {
      msgtype: 'm.notice',
      body: 'Captured Thread Title',
      'io.mindroom.thread_summary': { summary: 'Captured Thread Title', version: 1 },
    },
  };
  const oldRoot = {
    type: 'm.room.message',
    event_id: '$root_old',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 200_000,
    content: { msgtype: 'm.text', body: 'Older thread root' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 17,
          current_user_participated: true,
          latest_event: capturedLatest,
          'io.mindroom.latest_reply': capturedLatest,
          'io.mindroom.title': capturedTitle,
        },
      },
    },
  };

  const bundle = makeFixtureBundle();
  bundle.manifest.durationMs = 10_000;
  bundle.snapshot.initialSync.rooms.join[ROOM_ID].timeline.events = [oldRoot, capturedLatest];
  bundle.snapshot.rooms[ROOM_ID] = {
    threads: [oldRoot],
    threadRelations: { $root_old: [capturedLatest] },
    messagesTail: [],
    members: bundle.snapshot.rooms[ROOM_ID].members,
  };
  // For K=2, copy k=1 has offset=5000ms -> warms up tau=1500 & tau=2500 before first request,
  // while copy k=0 (offset=0) has not reached tau=1500 yet.
  bundle.liveEntries = [
    {
      tauMs: 1_500,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$warmup_stream',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_000,
                    content: {
                      msgtype: 'm.text',
                      body: 'Warmup stream',
                      'io.mindroom.stream_status': 'streaming',
                      'm.relates_to': {
                        rel_type: 'm.thread',
                        event_id: '$root_old',
                        'm.in_reply_to': { event_id: '$rep17' },
                      },
                    },
                  },
                ],
              },
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 1_000,
                    content: {
                      v: 1,
                      reply: '$warmup_stream',
                      sid: '1760000001000-abcdef01',
                      seq: 0,
                      snapshot: {
                        md: 'Warmup stream',
                        reasoning: '',
                        tools: [],
                        status: 'streaming',
                        activity: 'Working',
                        segments: [],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 2_500,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 2_000,
                    content: {
                      v: 1,
                      reply: '$warmup_stream',
                      sid: '1760000001000-abcdef01',
                      seq: 1,
                      delta: {
                        md: { at: 13, del: 0, ins: ' live!', len: 19 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 5_500,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 5_200,
                    content: {
                      v: 1,
                      reply: '$warmup_stream',
                      sid: '1760000001000-abcdef01',
                      seq: 2,
                      delta: {
                        md: { at: 19, del: 0, ins: '!!', len: 21 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 1,
  });
  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };

  try {
    // Immediately on startup (before k=0 reaches tau=1000):
    // k=1 warmed up through tau=1000 & tau=2000 -> /threads reports count=18 pointing to $warmup_stream__r0_k1_g0
    const threadsRes = await fetch(
      `${srv.baseUrl}/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/threads?limit=10`,
      { headers: authHeaders }
    );
    assert.equal(threadsRes.status, 200);
    const chunk = (await threadsRes.json()).chunk;
    const th0 = chunk.find((ev) => ev.event_id === '$root_old');
    const th1 = chunk.find((ev) => ev.event_id === '$root_old__r0_k1');
    assert.ok(th0 && th1);

    const sum0 = th0.unsigned['m.relations']['m.thread'];
    assert.equal(sum0.count, 17);
    assert.equal(sum0.latest_event.event_id, '$rep17');

    const sum1 = th1.unsigned['m.relations']['m.thread'];
    assert.equal(sum1.count, 18);
    assert.equal(sum1.current_user_participated, true);
    assert.equal(sum1.latest_event.event_id, '$warmup_stream__r0_k1_g0');
    assert.equal(sum1['io.mindroom.latest_reply'].event_id, '$warmup_stream__r0_k1_g0');
    assert.equal(sum1['io.mindroom.title'].event_id, '$title_old__r0_k1');

    // Warmup must not inflate live stats counters
    assert.equal(srv.getStatus().stats.totalFrames, 0);

    // Initial cold /sync includes valid materialized snapshot for k=1's active warmup stream
    const initRes = await fetch(`${srv.baseUrl}/_matrix/client/v3/sync?timeout=0`, {
      headers: authHeaders,
    });
    const initBody = await initRes.json();
    const ephemeral = initBody.rooms.join[ROOM_ID].ephemeral.events;
    const snap = ephemeral.find(
      (e) => e.type === 'io.mindroom.live' && e.content?.reply === '$warmup_stream__r0_k1_g0'
    );
    assert.ok(snap, 'expected initial /sync to include warmup live snapshot for k=1');
    assert.equal(snap.content.v, 1);
    assert.match(snap.content.sid, SID_RE);
    assert.equal(snap.content.seq, 1);
    assert.equal(snap.content.snapshot.md, 'Warmup stream live!');
    assert.equal(snap.content.delta, undefined);

    // Next delta at tau=5500 (500ms past offset=5000) chains seamlessly onto that snapshot
    let since = initBody.next_batch;
    let nextDelta = null;
    for (let i = 0; i < 6 && !nextDelta; i += 1) {
      const incRes = await fetch(
        `${srv.baseUrl}/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=1000`,
        { headers: authHeaders }
      );
      const incBody = await incRes.json();
      since = incBody.next_batch;
      nextDelta = (incBody.rooms.join[ROOM_ID]?.ephemeral?.events ?? []).find(
        (e) =>
          e.type === 'io.mindroom.live' &&
          e.content?.reply === '$warmup_stream__r0_k1_g0' &&
          e.content?.delta
      );
    }
    assert.ok(nextDelta, 'expected incremental /sync delta chaining onto warmup snapshot');
    assert.equal(nextDelta.content.sid, snap.content.sid);
    assert.equal(nextDelta.content.seq, snap.content.seq + 1);
    assert.equal(
      applyLiveDeltaToDocs(snap.content.snapshot, nextDelta.content.delta).md,
      'Warmup stream live!!!'
    );
  } finally {
    await srv.close();
  }
});

test('server: captured initialSync m.receipt is preserved and remapped for cloned threads in cold /sync', async () => {
  const bundle = makeFixtureBundle();
  bundle.liveEntries = [];
  bundle.snapshot.initialSync.rooms.join[ROOM_ID].ephemeral.events = [
    {
      type: 'm.receipt',
      content: {
        $rep2: {
          'm.read': {
            [VIEWER]: { ts: BASE_TS - 10_000, thread_id: '$root1' },
            [AGENT]: { ts: BASE_TS - 10_000, thread_id: 'main' },
          },
        },
      },
    },
  ];

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 1,
  });
  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };

  try {
    const res = await fetch(`${srv.baseUrl}/_matrix/client/v3/sync?timeout=0`, {
      headers: authHeaders,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const receipts = body.rooms.join[ROOM_ID].ephemeral.events.filter(
      (ev) => ev.type === 'm.receipt'
    );
    assert.equal(receipts.length, 2);

    const r0 = receipts.find((ev) => '$rep2' in ev.content);
    const r1 = receipts.find((ev) => '$rep2__r0_k1' in ev.content);
    assert.ok(r0 && r1, 'expected m.receipt for both original and cloned threads');
    assert.equal(r0.content.$rep2['m.read'][VIEWER].thread_id, '$root1');
    assert.equal(r0.content.$rep2['m.read'][AGENT].thread_id, 'main');
    assert.equal(r1.content.$rep2__r0_k1['m.read'][VIEWER].thread_id, '$root1__r0_k1');
    assert.equal(r1.content.$rep2__r0_k1['m.read'][AGENT].thread_id, 'main');
    assert.ok(r0.content.$rep2['m.read'][VIEWER].ts > BASE_TS);
  } finally {
    await srv.close();
  }
});

test('multiplier: unpinning replaces per-copy m.room.pinned_events and io.mindroom.pinned_canvases', () => {
  const bundle = makeFixtureBundle();
  bundle.manifest.durationMs = 4_000;
  bundle.liveEntries = [
    {
      tauMs: 100,
      response: {
        account_data: {
          events: [{ type: 'io.mindroom.pinned_canvases', content: { canvases: [] } }],
        },
        rooms: {
          join: {
            [ROOM_ID]: {
              state: {
                events: [
                  {
                    type: 'm.room.pinned_events',
                    event_id: '$st_unpin',
                    room_id: ROOM_ID,
                    sender: VIEWER,
                    state_key: '',
                    origin_server_ts: BASE_TS + 100,
                    content: { pinned: [] },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];

  // K=1: starting with $root1 pinned, replaying pinned: [] emits pinned: [] and canvases: []
  const startNow = BASE_TS + 100_000;
  const mult1 = createReplayMultiplier(bundle, {
    multiplyThreads: 1,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: startNow,
  });
  const initPins1 = mult1.initialState.rooms[ROOM_ID].state.find(
    (ev) => ev.type === 'm.room.pinned_events'
  );
  assert.deepEqual(initPins1.content.pinned, ['$root1']);

  const delta1 = mult1.advance(200, startNow + 200);
  const unpin1 = delta1.rooms[ROOM_ID].stateEvents.find((ev) => ev.type === 'm.room.pinned_events');
  assert.deepEqual(unpin1.content.pinned, []);
  const unpinCanvas1 = delta1.accountData.find((ev) => ev.type === 'io.mindroom.pinned_canvases');
  assert.deepEqual(unpinCanvas1.content.canvases, []);

  // K=2: warmup unpins copy k=1 (leaving copy k=0 pinned), then advance unpins copy k=0 -> []
  const mult2 = createReplayMultiplier(bundle, {
    multiplyThreads: 2,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: startNow,
  });
  const initPins2 = mult2.initialState.rooms[ROOM_ID].state.find(
    (ev) => ev.type === 'm.room.pinned_events'
  );
  assert.deepEqual(initPins2.content.pinned.sort(), ['$root1', '$root1__r0_k1'].sort());
  const warmupPin = mult2.initialState.warmupDeltas
    .flatMap((d) => d.rooms[ROOM_ID]?.stateEvents ?? [])
    .find((ev) => ev.type === 'm.room.pinned_events');
  assert.deepEqual(warmupPin.content.pinned, ['$root1']);
  const delta2 = mult2.advance(200, startNow + 200);
  const unpin2 = delta2.rooms[ROOM_ID].stateEvents.find((ev) => ev.type === 'm.room.pinned_events');
  assert.deepEqual(unpin2.content.pinned, []);
});

test('server: captured global account_data update arrives in incremental /sync and updates GET /account_data/{type}', async () => {
  const bundle = makeFixtureBundle();
  bundle.manifest.durationMs = 10_000;
  bundle.snapshot.initialSync.account_data.events.push({
    type: 'com.mindroom.preferences',
    content: { theme: 'light' },
  });
  bundle.liveEntries = [
    {
      tauMs: 300,
      response: {
        account_data: {
          events: [
            { type: 'com.mindroom.preferences', content: { theme: 'dark', compact: true } },
            { type: 'io.mindroom.pinned_canvases', content: { canvases: [] } },
          ],
        },
        rooms: { join: {} },
      },
    },
  ];

  const srv = await startReplayServer({
    bundle,
    port: 0,
    multiplyThreads: 2,
    multiplyRooms: 2,
    speed: 1,
  });
  const authHeaders = { Authorization: `Bearer ${srv.accessToken}` };
  const encUser = encodeURIComponent(VIEWER);

  try {
    const initRes = await fetch(`${srv.baseUrl}/_matrix/client/v3/sync?timeout=0`, {
      headers: authHeaders,
    });
    const initBody = await initRes.json();
    const initialPref = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/user/${encUser}/account_data/com.mindroom.preferences`,
      { headers: authHeaders }
    );
    assert.deepEqual(await initialPref.json(), { theme: 'light' });

    let since = initBody.next_batch;
    const receivedAcc = [];
    for (let i = 0; i < 6 && receivedAcc.length === 0; i += 1) {
      const incRes = await fetch(
        `${srv.baseUrl}/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=1000`,
        { headers: authHeaders }
      );
      const incBody = await incRes.json();
      since = incBody.next_batch;
      receivedAcc.push(...(incBody.account_data?.events ?? []));
    }

    const prefEvents = receivedAcc.filter((ev) => ev.type === 'com.mindroom.preferences');
    assert.equal(prefEvents.length, 1, 'expected global account_data emitted once for k=0 only');
    assert.deepEqual(prefEvents[0].content, { theme: 'dark', compact: true });

    const canvasEvents = receivedAcc.filter((ev) => ev.type === 'io.mindroom.pinned_canvases');
    assert.equal(canvasEvents.length, 1);
    assert.deepEqual(canvasEvents[0].content, { canvases: [] });

    // GET /account_data/{type} reflects the live update
    const getPref = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/user/${encUser}/account_data/com.mindroom.preferences`,
      { headers: authHeaders }
    );
    assert.equal(getPref.status, 200);
    assert.deepEqual(await getPref.json(), { theme: 'dark', compact: true });

    const getCanvases = await fetch(
      `${srv.baseUrl}/_matrix/client/v3/user/${encUser}/account_data/io.mindroom.pinned_canvases`,
      { headers: authHeaders }
    );
    assert.equal(getCanvases.status, 200);
    assert.deepEqual(await getCanvases.json(), { canvases: [] });
  } finally {
    await srv.close();
  }
});

test('capture: requires matching --device-id for live capture and refuses --out inside a git repo', async () => {
  const parsed = parseCaptureArgs([
    '--homeserver',
    'http://127.0.0.1:8008',
    '--device-id',
    'DEDICATED_DEV',
    '--out',
    '/tmp/cap',
    '--duration',
    '10',
  ]);
  assert.equal(parsed.deviceId, 'DEDICATED_DEV');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cap-safety-'));
  let syncCalls = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/_matrix/client/v3/account/whoami') {
      return send(200, { user_id: VIEWER, device_id: 'DEDICATED_DEV' });
    }
    if (u.pathname === '/_matrix/client/v3/sync') {
      syncCalls += 1;
      const body = { next_batch: `nb${syncCalls}`, rooms: { join: {} } };
      if (u.searchParams.has('since')) {
        setTimeout(() => send(200, body), 25);
        return;
      }
      return send(200, body);
    }
    return send(404, { errcode: 'M_NOT_FOUND' });
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Live capture (duration > 0) without --device-id fails closed before any /sync
    await assert.rejects(
      () =>
        runCapture({
          homeserver: baseUrl,
          token: 'tok',
          out: path.join(dir, 'no-dev'),
          duration: 0.2,
        }),
      /to-device.*--device-id|--device-id.*to-device/i
    );
    assert.equal(syncCalls, 0);

    // 2. Live capture (duration > 0) with mismatched --device-id fails closed before any /sync
    await assert.rejects(
      () =>
        runCapture({
          homeserver: baseUrl,
          token: 'tok',
          deviceId: 'WRONG_DEV',
          out: path.join(dir, 'wrong-dev'),
          duration: 0.2,
        }),
      /does not match.*DEDICATED_DEV/
    );
    assert.equal(syncCalls, 0);

    // 3. --out inside a git worktree/repo is refused before any network call or mkdir
    const fakeRepo = path.join(dir, 'fake-repo');
    fs.mkdirSync(fakeRepo, { recursive: true });
    fs.writeFileSync(path.join(fakeRepo, '.git'), 'gitdir: /tmp/somewhere\n');
    const repoOut = path.join(fakeRepo, 'nested', 'capture');
    assert.equal(isInsideGitRepo(repoOut), true);
    assert.equal(isInsideGitRepo(path.join(dir, 'outside')), false);
    await assert.rejects(
      () =>
        runCapture({
          homeserver: baseUrl,
          token: 'tok',
          deviceId: 'DEDICATED_DEV',
          out: repoOut,
          duration: 0,
        }),
      /git repository/i
    );
    assert.equal(fs.existsSync(repoOut), false);
    assert.equal(syncCalls, 0);

    // 4. Live capture with matching --device-id outside a git repo succeeds
    const okOut = path.join(dir, 'live-ok');
    const manifest = await runCapture({
      homeserver: baseUrl,
      token: 'tok',
      deviceId: 'DEDICATED_DEV',
      out: okOut,
      duration: 0.08,
    });
    assert.equal(manifest.userId, VIEWER);
    assert.ok(syncCalls >= 2, `expected initial + live /sync calls, got ${syncCalls}`);
  } finally {
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
