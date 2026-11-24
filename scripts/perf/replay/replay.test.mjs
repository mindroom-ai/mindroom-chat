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
  computeLiveSplice,
  extractMxcReferences,
  parseMxcUri,
  runCapture,
  synthesizeLiveFramesFromEvents,
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
              timeline: { events: [rootEv, rep1, rep2, approvalEv], limited: true, prev_batch: 'pb0' },
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

test('capture helpers: computeLiveSplice and synthesizeLiveFramesFromEvents', () => {
  const splice = computeLiveSplice('Hello world', 'Hello brave world!');
  const applied = applyLiveDeltaToDocs(
    { md: 'Hello world', reasoning: '', tools: [], status: 'streaming', activity: '', segments: [] },
    { md: splice }
  );
  assert.equal(applied.md, 'Hello brave world!');

  const events = [
    {
      type: 'm.room.message',
      event_id: '$msg1',
      room_id: ROOM_ID,
      sender: AGENT,
      origin_server_ts: BASE_TS,
      content: {
        msgtype: 'm.text',
        body: 'Step 1',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root1' },
      },
    },
    {
      type: 'm.room.message',
      event_id: '$edit1',
      room_id: ROOM_ID,
      sender: AGENT,
      origin_server_ts: BASE_TS + 1_000,
      content: {
        msgtype: 'm.text',
        body: '* Step 1 -> Step 2',
        'm.new_content': { msgtype: 'm.text', body: 'Step 1 -> Step 2' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$msg1' },
      },
    },
  ];
  const synth = synthesizeLiveFramesFromEvents(events, { durationMs: 6_000, baseTs: BASE_TS });
  assert.equal(synth.length, 2);
  const f0 = synth[0].response.rooms.join[ROOM_ID].ephemeral.events[0].content;
  const f1 = synth[1].response.rooms.join[ROOM_ID].ephemeral.events[0].content;
  assert.equal(f0.v, 1);
  assert.equal(f0.seq, 0);
  assert.match(f0.sid, SID_RE);
  assert.equal(f0.snapshot.md, 'Step 1');
  assert.equal(f1.seq, 1);
  assert.equal(f1.sid, f0.sid);
  const after = applyLiveDeltaToDocs(f0.snapshot, f1.delta);
  assert.equal(after.md, 'Step 1 -> Step 2');
});

test('runCapture enforces strictly GET-only requests, 0700 perms, and downloads long_text blobs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cap-test-'));
  const methods = [];
  const sidecarJson = JSON.stringify({ msgtype: 'm.text', body: 'Full hydrated long text body' });
  const srv = http.createServer((req, res) => {
    methods.push(req.method);
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code, body, ct = 'application/json') => {
      res.writeHead(code, { 'Content-Type': ct });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (u.pathname === '/_matrix/client/v3/account/whoami') return send(200, { user_id: VIEWER });
    if (u.pathname === '/_matrix/client/v3/sync') {
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
                      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
                    },
                  },
                  {
                    type: 'm.room.message',
                    event_id: '$lt1_edit',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 500,
                    content: {
                      msgtype: 'm.text',
                      body: '* Updated preview',
                      'm.new_content': { msgtype: 'm.text', body: 'Updated preview full' },
                      'm.relates_to': { rel_type: 'm.replace', event_id: '$lt1' },
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
      out: outDir,
      duration: 0,
      synthesizeLive: true,
    });
    assert.ok(methods.length > 0);
    assert.ok(methods.every((m) => m === 'GET'), `Non-GET methods used: ${methods.join(',')}`);
    assert.equal(fs.statSync(outDir).mode & 0o777, 0o700);
    assert.equal(manifest.primaryRoomName, 'Captured Room');
    assert.equal(manifest.stats.blobs, 1);
    assert.ok(manifest.stats.liveEntries >= 2);
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

test('multiplier: mid-stream snapshot synthesis, subagents, receipts, and multi-gen unique IDs', () => {
  const bundle = makeFixtureBundle();
  const startNow = BASE_TS + 1_000_000;
  const mult = createReplayMultiplier(bundle, {
    multiplyThreads: 3,
    multiplyRooms: 1,
    speed: 1,
    startNowMs: startNow,
  });

  // At elapsed = 1500ms:
  // - k=0 (offset 0): virtual=1500 -> tau=1000 fires (snapshot seq 0 + subagents + $live_reply)
  // - k=1 (offset 3000): virtual=4500 -> tau=4000 fires (WAS warmed at tau=1000 -> MUST emit snapshot seq 0 with "Hello world"!)
  // - k=2 (offset 6000): virtual=7500 -> tau=7000 fires (WAS warmed at 1000 & 4000 -> MUST emit snapshot seq 0 with "Hello world!"!)
  const d1 = mult.advance(1_500, startNow + 1_500);
  const live1 = d1[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'io.mindroom.live');
  assert.equal(live1.length, 3);

  const fK0 = live1.find((e) => e.content.reply === '$live_reply');
  const fK1 = live1.find((e) => e.content.reply === '$live_reply__r0_k1_g0');
  const fK2 = live1.find((e) => e.content.reply === '$live_reply__r0_k2_g0');
  assert.equal(fK0.content.seq, 0);
  assert.equal(fK0.content.snapshot.md, 'Hello');
  assert.match(fK0.content.sid, SID_RE);

  // Mid-stream copies receive valid snapshot frames first, NOT raw deltas!
  assert.equal(fK1.content.seq, 0);
  assert.ok(fK1.content.snapshot, 'k=1 mid-stream first frame must be a snapshot');
  assert.equal(fK1.content.snapshot.md, 'Hello world');
  assert.match(fK1.content.sid, SID_RE);

  assert.equal(fK2.content.seq, 0);
  assert.ok(fK2.content.snapshot, 'k=2 mid-stream first frame must be a snapshot');
  assert.equal(fK2.content.snapshot.md, 'Hello world!');

  // Receipt for k=1 remaps thread_id but preserves "main"
  const receipts1 = d1[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'm.receipt');
  assert.equal(receipts1.length, 1);
  const recTarget = receipts1[0].content['$live_reply__r0_k1_g0']['m.read'];
  assert.equal(recTarget[VIEWER].thread_id, '$root1__r0_k1');
  assert.equal(recTarget[AGENT].thread_id, 'main');

  // Subagent frame for k=0 shifted Unix seconds and kept valid sid/seq
  const sub1 = d1[ROOM_ID].ephemeralEvents.filter((e) => e.type === 'io.mindroom.subagents');
  assert.equal(sub1.length, 1);
  assert.match(sub1[0].content.sid, SID_RE);
  assert.ok(sub1[0].content.meta.started_at > Math.floor(BASE_TS / 1000));

  // Next step (elapsed = 4500ms): k=1 hits tau=7000 -> emits DELTA with seq=1!
  const d2 = mult.advance(4_500, startNow + 4_500);
  const fK1Delta = d2[ROOM_ID].ephemeralEvents.find(
    (e) => e.type === 'io.mindroom.live' && e.content.reply === '$live_reply__r0_k1_g0'
  );
  assert.equal(fK1Delta.content.seq, 1);
  assert.equal(fK1Delta.content.sid, fK1.content.sid);
  assert.ok(fK1Delta.content.delta);
  const applied = applyLiveDeltaToDocs(fK1.content.snapshot, fK1Delta.content.delta);
  assert.equal(applied.md, 'Hello world!');

  // Generation wraparound across 2.5 full loops: ZERO duplicate event_ids!
  const allEventIds = new Set(mult.initialState.rooms[ROOM_ID].timeline.map((e) => e.event_id));
  for (const ev of [...d1[ROOM_ID].timelineEvents, ...d2[ROOM_ID].timelineEvents]) {
    assert.equal(allEventIds.has(ev.event_id), false, `duplicate ${ev.event_id}`);
    allEventIds.add(ev.event_id);
  }
  for (let t = 7_500; t <= 24_000; t += 3_000) {
    const step = mult.advance(t, startNow + t);
    for (const ev of step[ROOM_ID]?.timelineEvents ?? []) {
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
  const longTextPayload = JSON.stringify({ msgtype: 'm.text', body: 'Hydrated long_text sidecar!' });
  const sha = crypto.createHash('sha256').update(longTextPayload).digest('hex');
  fs.writeFileSync(path.join(blobsDir, sha), longTextPayload);

  const bundle = makeFixtureBundle();
  bundle.manifest.blobIndex = {
    'example.test/lt_blob': { file: sha, contentType: 'application/json', bytes: longTextPayload.length },
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
    const res = await fetch(`${srv.baseUrl}${p}`, opts);
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      ct,
      body: ct.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()),
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
      body: JSON.stringify({ type: 'm.login.password', user: 'viewer', password: 'x' }),
    });
    assert.equal(login.body.user_id, VIEWER);
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
      const inc = await api(`/_matrix/client/v3/sync?since=${encodeURIComponent(since)}&timeout=1000`);
      since = inc.body.next_batch;
      const eps = inc.body.rooms.join[ROOM_ID]?.ephemeral?.events ?? [];
      if (eps.some((e) => e.type === 'io.mindroom.live')) gotLiveFrame = true;
    }
    assert.equal(gotLiveFrame, true, 'expected incremental /sync to deliver io.mindroom.live frames');

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
    const threads = await api(`/_matrix/client/v1/rooms/${encodeURIComponent(ROOM_ID)}/threads?limit=10`);
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

    const reset = await api('/__replay/reset', { method: 'POST' });
    assert.equal(reset.body.ok, true);
    assert.equal(reset.body.status.stats.totalFrames, 0);

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
