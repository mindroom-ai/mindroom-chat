#!/usr/bin/env node
// Standalone zero-dep Matrix CS-API v1.11 replay HTTP server (strictly 127.0.0.1).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReplayMultiplier } from './multiplier.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const MAX_SYNC_LOG = 4000;
const TICK_MS = 50;
const ACTIVE_RUN_REFRESH_MS = 60_000;
const REPLY_STALE_MS = 10_000;

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const dec = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (_err) {
    return s;
  }
};
const localpartOf = (mxid) => {
  if (typeof mxid !== 'string') return 'replay';
  const body = mxid.startsWith('@') ? mxid.slice(1) : mxid;
  const colon = body.indexOf(':');
  return colon > 0 ? body.slice(0, colon) : body;
};

/** Load manifest.json, snapshot.json, live.jsonl from a capture directory. */
export function loadCaptureDir(captureDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(captureDir, 'manifest.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(captureDir, 'snapshot.json'), 'utf8'));
  const livePath = path.join(captureDir, 'live.jsonl');
  const liveEntries = fs.existsSync(livePath)
    ? fs
        .readFileSync(livePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { manifest, snapshot, liveEntries, blobsDir: path.join(captureDir, 'blobs') };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_err) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function createRoomStore(initRoom, userId) {
  const stateMap = new Map();
  const eventsById = new Map();
  const timeline = [];
  const timelineIds = new Set();
  const threads = new Map();
  const editsByTarget = new Map();
  const relationsByTarget = new Map();
  const accountData = new Map();
  const members = new Map();
  const initialEphemeral = [];

  const indexRelation = (ev) => {
    const rel = ev?.content?.['m.relates_to'];
    if (!isRecord(rel) || typeof rel.event_id !== 'string') return;
    let list = relationsByTarget.get(rel.event_id);
    if (!list) relationsByTarget.set(rel.event_id, (list = []));
    if (!list.some((x) => x.event_id === ev.event_id)) list.push(ev);
    if (rel.rel_type === 'm.replace') {
      const prev = editsByTarget.get(rel.event_id);
      if (!prev || (ev.origin_server_ts ?? 0) >= (prev.origin_server_ts ?? 0)) {
        editsByTarget.set(rel.event_id, ev);
      }
    }
  };

  const ensureThread = (rootId, rootEv) => {
    let rec = threads.get(rootId);
    if (!rec) {
      const bundled = rootEv?.unsigned?.['m.relations']?.['m.thread'];
      const latestEv = bundled?.latest_event ?? null;
      rec = {
        rootId,
        rootEvent: rootEv ?? eventsById.get(rootId) ?? null,
        replies: [],
        replyIds: new Set(),
        latestEvent: latestEv,
        latestReply: bundled?.['io.mindroom.latest_reply'] ?? null,
        latestTitle: bundled?.['io.mindroom.title'] ?? null,
        replyCount: typeof bundled?.count === 'number' ? bundled.count : 0,
        participated: Boolean(bundled?.current_user_participated),
        lastActivityTs: latestEv?.origin_server_ts ?? rootEv?.origin_server_ts ?? 0,
      };
      threads.set(rootId, rec);
    } else if (rootEv && !rec.rootEvent) {
      rec.rootEvent = rootEv;
      if (rec.lastActivityTs === 0) rec.lastActivityTs = rootEv.origin_server_ts ?? 0;
    }
    return rec;
  };

  const recordThreadReply = (ev) => {
    const rel = ev?.content?.['m.relates_to'];
    if (rel?.rel_type !== 'm.thread' || typeof rel.event_id !== 'string') return;
    const rec = ensureThread(rel.event_id, eventsById.get(rel.event_id));
    if (!rec.replyIds.has(ev.event_id)) {
      rec.replyIds.add(ev.event_id);
      rec.replies.push(ev);
      if (rec.replies.length > rec.replyCount) rec.replyCount = rec.replies.length;
    }
    const ts = ev.origin_server_ts ?? 0;
    if (ts >= rec.lastActivityTs) {
      rec.lastActivityTs = ts;
      rec.latestEvent = ev;
    }
    if (ev.sender === userId) rec.participated = true;
    const isTitle =
      ev.content?.msgtype === 'm.notice' && isRecord(ev.content?.['io.mindroom.thread_summary']);
    if (isTitle) {
      if (!rec.latestTitle || ts >= (rec.latestTitle.origin_server_ts ?? 0)) rec.latestTitle = ev;
    } else if (!rec.latestReply || ts >= (rec.latestReply.origin_server_ts ?? 0)) {
      rec.latestReply = ev;
    }
  };

  const ingestEvent = (ev, { addToTimeline = false } = {}) => {
    if (!isRecord(ev) || typeof ev.event_id !== 'string') return;
    eventsById.set(ev.event_id, ev);
    if (addToTimeline && !timelineIds.has(ev.event_id)) {
      timelineIds.add(ev.event_id);
      timeline.push(ev);
    }
    indexRelation(ev);
    if (isRecord(ev.unsigned?.['m.relations']?.['m.thread'])) ensureThread(ev.event_id, ev);
    recordThreadReply(ev);
    if (ev.content?.['m.relates_to']?.rel_type === 'm.replace') {
      const targetId = ev.content['m.relates_to'].event_id;
      for (const rec of threads.values()) {
        if (
          rec.latestEvent?.event_id === targetId ||
          rec.latestReply?.event_id === targetId ||
          rec.latestTitle?.event_id === targetId
        ) {
          rec.lastActivityTs = Math.max(rec.lastActivityTs, ev.origin_server_ts ?? 0);
        }
      }
    }
  };

  const ingestState = (ev) => {
    if (!isRecord(ev) || typeof ev.type !== 'string') return;
    stateMap.set(`${ev.type}\0${ev.state_key ?? ''}`, ev);
    if (ev.type === 'm.room.member' && ev.state_key) members.set(ev.state_key, ev);
    if (ev.event_id) eventsById.set(ev.event_id, ev);
  };

  for (const ev of initRoom.state ?? []) ingestState(ev);
  for (const ev of initRoom.members ?? []) {
    if (ev.type === 'm.room.member' && ev.state_key) members.set(ev.state_key, ev);
  }
  for (const acc of initRoom.accountData ?? []) {
    if (acc?.type) accountData.set(acc.type, acc);
  }
  for (const ev of [...(initRoom.messagesTail ?? [])].reverse()) {
    ingestEvent(ev, { addToTimeline: true });
  }
  for (const ev of initRoom.timeline ?? []) ingestEvent(ev, { addToTimeline: true });
  for (const root of initRoom.threads ?? []) {
    ingestEvent(root, { addToTimeline: false });
    ensureThread(root.event_id, root);
  }
  for (const [rootId, rels] of Object.entries(initRoom.threadRelations ?? {})) {
    const rec = ensureThread(rootId, eventsById.get(rootId));
    for (const ev of [...rels].reverse()) {
      ingestEvent(ev, { addToTimeline: false });
      if (!rec.replyIds.has(ev.event_id) && ev.content?.['m.relates_to']?.rel_type === 'm.thread') {
        rec.replyIds.add(ev.event_id);
        rec.replies.push(ev);
      }
    }
    rec.replies.sort((a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0));
    if (rec.replies.length > rec.replyCount) rec.replyCount = rec.replies.length;
  }

  const withEditBundle = (ev) => {
    if (!isRecord(ev) || !ev.event_id) return ev;
    const edit = editsByTarget.get(ev.event_id);
    if (!edit) return ev;
    const rels = ev.unsigned?.['m.relations'] ?? {};
    if (rels['m.replace']?.event_id === edit.event_id) return ev;
    return {
      ...ev,
      unsigned: { ...(ev.unsigned ?? {}), 'm.relations': { ...rels, 'm.replace': edit } },
    };
  };

  const decorateEvent = (ev) => {
    if (!isRecord(ev) || !ev.event_id) return ev;
    let out = withEditBundle(ev);
    const rec = threads.get(ev.event_id);
    if (rec && rec.rootEvent) {
      const rels = out.unsigned?.['m.relations'] ?? {};
      const summary = {
        ...(rels['m.thread'] ?? {}),
        ...(rec.latestEvent ? { latest_event: withEditBundle(rec.latestEvent) } : {}),
        count: rec.replyCount,
        current_user_participated: rec.participated,
        ...(rec.latestReply ? { 'io.mindroom.latest_reply': withEditBundle(rec.latestReply) } : {}),
        ...(rec.latestTitle ? { 'io.mindroom.title': withEditBundle(rec.latestTitle) } : {}),
      };
      out = {
        ...out,
        unsigned: { ...(out.unsigned ?? {}), 'm.relations': { ...rels, 'm.thread': summary } },
      };
    }
    return out;
  };

  return {
    roomId: initRoom.roomId,
    stateMap,
    eventsById,
    timeline,
    threads,
    relationsByTarget,
    accountData,
    members,
    initialEphemeral,
    unreadNotifications: initRoom.unreadNotifications ?? {
      highlight_count: 0,
      notification_count: 0,
    },
    unreadThreadNotifications: initRoom.unreadThreadNotifications ?? {},
    ingestEvent,
    ingestState,
    decorateEvent,
  };
}

/**
 * @typedef {object} ReplayServerOptions
 * @property {string} [capture]
 * @property {{
 *   manifest: Record<string, unknown>,
 *   snapshot: Record<string, unknown>,
 *   liveEntries?: unknown[],
 *   blobsDir?: string
 * }} [bundle]
 * @property {string} [blobsDir]
 * @property {number} [port]
 * @property {number} [multiplyThreads]
 * @property {number} [multiplyRooms]
 * @property {number} [speed]
 * @property {string} [targetRoomId]
 * @property {string} [statsFile]
 * @property {number} [statsIntervalMs]
 */
/**
 * Start a loopback-only Matrix CS-API replay server.
 * @param {ReplayServerOptions} [options]
 * @returns {Promise<{
 *   baseUrl: string,
 *   port: number,
 *   userId: string,
 *   username: string,
 *   roomId: string,
 *   roomName: string,
 *   getStatus: () => Record<string, unknown>,
 *   close: () => Promise<void>
 * }>}
 */
export async function startReplayServer(options = {}) {
  const loaded = options.bundle ?? loadCaptureDir(options.capture);
  const blobsDir = options.blobsDir ?? loaded.blobsDir ?? '';
  const blobIndex = loaded.manifest?.blobIndex ?? {};
  const port = options.port ?? 0;
  const multiplyThreads = options.multiplyThreads ?? 1;
  const multiplyRooms = options.multiplyRooms ?? 1;
  const speed = options.speed ?? 1;
  const targetRoomId = options.targetRoomId || undefined;
  const statsFile = options.statsFile || '';
  const statsIntervalMs = Math.max(200, options.statsIntervalMs ?? 5_000);

  let multiplier;
  let rooms;
  let globalAccountData;
  let savedFilters;
  let syncSeq;
  let syncLog;
  let startRealMs;
  let lastRefreshMs;
  let localCounter = 0;
  let activeReplies;
  let windowStats;
  let totals;
  let windowStartMs;
  let lastTickMs;
  let liveSeconds;
  const waiters = [];
  const sockets = new Set();

  const notifyWaiters = () => {
    for (const wake of waiters.splice(0)) wake();
  };

  function initEngine() {
    startRealMs = Date.now();
    lastRefreshMs = startRealMs;
    multiplier = createReplayMultiplier(loaded, {
      multiplyThreads,
      multiplyRooms,
      speed,
      targetRoomId,
      startNowMs: startRealMs,
    });
    rooms = new Map();
    for (const [roomId, initRoom] of Object.entries(multiplier.initialState.rooms)) {
      rooms.set(roomId, createRoomStore(initRoom, multiplier.meta.userId));
    }
    globalAccountData = new Map();
    for (const acc of multiplier.initialState.accountData) {
      if (acc?.type) globalAccountData.set(acc.type, acc);
    }
    savedFilters = new Map();
    syncSeq = 1;
    syncLog = [];
    activeReplies = new Map();
    windowStats = { frames: 0, edits: 0, jobs: 0, stuck: 0 };
    totals = { frames: 0, edits: 0, jobs: 0, events: 0 };
    windowStartMs = startRealMs;
    lastTickMs = startRealMs;
    liveSeconds = 0;
  }

  initEngine();

  function pruneActiveReplies(nowMs) {
    for (const [replyId, ts] of activeReplies.entries()) {
      if (nowMs - ts > REPLY_STALE_MS) activeReplies.delete(replyId);
    }
  }

  function commitDeltas(roomDeltas, accUpdates = [], nowMs = Date.now()) {
    let any = accUpdates.length > 0;
    const logRooms = {};
    for (const [roomId, delta] of Object.entries(roomDeltas)) {
      const store = rooms.get(roomId);
      if (!store) continue;
      const st = delta.stateEvents ?? [];
      const tl = delta.timelineEvents ?? [];
      const ep = delta.ephemeralEvents ?? [];
      if (!st.length && !tl.length && !ep.length) continue;
      any = true;
      for (const ev of st) {
        store.ingestState(ev);
        if (ev.type === 'io.mindroom.background_jobs') {
          windowStats.jobs += 1;
          totals.jobs += 1;
        }
      }
      for (const ev of tl) {
        store.ingestEvent(ev, { addToTimeline: true });
        totals.events += 1;
        if (ev.content?.['m.relates_to']?.rel_type === 'm.replace') {
          windowStats.edits += 1;
          totals.edits += 1;
          const status = ev.content?.['m.new_content']?.['io.mindroom.stream_status'];
          if (status === 'completed' || status === 'error') {
            activeReplies.delete(ev.content['m.relates_to'].event_id);
          }
        }
      }
      for (const ev of ep) {
        if (ev.type === 'io.mindroom.live' && typeof ev.content?.reply === 'string') {
          windowStats.frames += 1;
          totals.frames += 1;
          activeReplies.set(ev.content.reply, nowMs);
        }
      }
      logRooms[roomId] = { stateEvents: st, timelineEvents: tl, ephemeralEvents: ep };
    }
    if (!any) return;
    syncSeq += 1;
    syncLog.push({ seq: syncSeq, roomDeltas: logRooms, accountData: accUpdates });
    if (syncLog.length > MAX_SYNC_LOG) syncLog.splice(0, syncLog.length - MAX_SYNC_LOG);
    notifyWaiters();
  }

  function flushStatsWindow(nowMs) {
    if (!statsFile) return;
    const elapsedSec = Math.max(0.001, (nowMs - windowStartMs) / 1000);
    const streaming = Math.round((liveSeconds / elapsedSec) * 100) / 100;
    const line = {
      t: Math.round(nowMs / 1000),
      target: 0,
      streaming,
      frames: windowStats.frames,
      edits: windowStats.edits,
      jobs: windowStats.jobs,
      stuck: windowStats.stuck,
    };
    fs.mkdirSync(path.dirname(statsFile), { recursive: true });
    fs.appendFileSync(statsFile, `${JSON.stringify(line)}\n`);
    windowStats = { frames: 0, edits: 0, jobs: 0, stuck: 0 };
    windowStartMs = nowMs;
    liveSeconds = 0;
  }

  function tick() {
    const nowMs = Date.now();
    pruneActiveReplies(nowMs);
    liveSeconds += activeReplies.size * ((nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;

    const deltas = multiplier.advance(nowMs - startRealMs, nowMs);
    commitDeltas(deltas, [], nowMs);

    if (nowMs - lastRefreshMs >= ACTIVE_RUN_REFRESH_MS) {
      lastRefreshMs = nowMs;
      commitDeltas(multiplier.refreshActiveRuns(nowMs), [], nowMs);
    }
    if (statsFile && nowMs - windowStartMs >= statsIntervalMs) {
      flushStatsWindow(nowMs);
    }
  }

  const tickTimer = setInterval(tick, TICK_MS);
  tickTimer.unref?.();

  function parseTimelineLimit(filterParam) {
    if (!filterParam) return 50;
    let def = savedFilters.get(filterParam);
    if (!def && filterParam.startsWith('{')) {
      try {
        def = JSON.parse(filterParam);
      } catch (_err) {
        def = null;
      }
    }
    const lim = def?.room?.timeline?.limit;
    return Number.isSafeInteger(lim) && lim > 0 ? lim : 50;
  }

  function buildInitialSync(limit) {
    const join = {};
    for (const [roomId, store] of rooms.entries()) {
      const start = Math.max(0, store.timeline.length - limit);
      const events = store.timeline.slice(start).map((e) => store.decorateEvent(e));
      join[roomId] = {
        state: { events: [...store.stateMap.values()] },
        timeline: {
          events,
          limited: start > 0,
          prev_batch: `m${start}`,
        },
        ephemeral: { events: store.initialEphemeral },
        account_data: { events: [...store.accountData.values()] },
        unread_notifications: store.unreadNotifications,
        unread_thread_notifications: store.unreadThreadNotifications,
      };
    }
    return {
      next_batch: `s${syncSeq}`,
      account_data: { events: [...globalAccountData.values()] },
      to_device: { events: [] },
      device_one_time_keys_count: { signed_curve25519: 50 },
      device_unused_fallback_key_types: ['signed_curve25519'],
      rooms: { join, invite: {}, leave: {} },
    };
  }

  function buildIncrementalSync(sinceSeq, limit) {
    if (syncLog.length > 0 && sinceSeq < syncLog[0].seq - 1) {
      const full = buildInitialSync(limit);
      for (const room of Object.values(full.rooms.join)) room.timeline.limited = true;
      return full;
    }
    const perRoom = new Map();
    const accEvents = [];
    for (const entry of syncLog) {
      if (entry.seq <= sinceSeq) continue;
      accEvents.push(...entry.accountData);
      for (const [roomId, d] of Object.entries(entry.roomDeltas)) {
        let agg = perRoom.get(roomId);
        if (!agg) {
          agg = { stateByKey: new Map(), timeline: [], ephemeral: [] };
          perRoom.set(roomId, agg);
        }
        for (const ev of d.stateEvents) agg.stateByKey.set(`${ev.type}\0${ev.state_key ?? ''}`, ev);
        agg.timeline.push(...d.timelineEvents);
        agg.ephemeral.push(...d.ephemeralEvents);
      }
    }
    const join = {};
    for (const [roomId, agg] of perRoom.entries()) {
      const store = rooms.get(roomId);
      const limited = agg.timeline.length > limit;
      const sliced = limited ? agg.timeline.slice(-limit) : agg.timeline;
      const prevIdx = Math.max(0, (store?.timeline.length ?? 0) - sliced.length);
      join[roomId] = {
        state: { events: [...agg.stateByKey.values()] },
        timeline: {
          events: store ? sliced.map((e) => store.decorateEvent(e)) : sliced,
          limited,
          prev_batch: `m${prevIdx}`,
        },
        ephemeral: { events: agg.ephemeral },
        account_data: { events: [] },
      };
    }
    return {
      next_batch: `s${syncSeq}`,
      device_one_time_keys_count: { signed_curve25519: 50 },
      device_unused_fallback_key_types: ['signed_curve25519'],
      ...(accEvents.length ? { account_data: { events: accEvents } } : {}),
      rooms: { join },
    };
  }

  function getStatus() {
    let threadCount = 0;
    for (const store of rooms.values()) threadCount += store.threads.size;
    return {
      running: true,
      elapsedMs: Date.now() - startRealMs,
      speed,
      multiplyThreads,
      multiplyRooms,
      syncSeq,
      roomCount: rooms.size,
      threadCount,
      primaryRoomId: multiplier.meta.primaryRoomId,
      primaryRoomName: multiplier.meta.primaryRoomName,
      userId: multiplier.meta.userId,
      stats: {
        streaming: activeReplies.size,
        totalFrames: totals.frames,
        totalEdits: totals.edits,
        totalJobs: totals.jobs,
        totalEvents: totals.events,
      },
    };
  }

  let baseUrl = '';
  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;
    const json = (status, body) => {
      if (res.writableEnded) return;
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
    if (p === '/__replay/status') return json(200, getStatus());
    if (p === '/__replay/reset' && req.method === 'POST') {
      initEngine();
      notifyWaiters();
      return json(200, { ok: true, status: getStatus() });
    }
    if (p === '/.well-known/matrix/client') {
      return json(200, { 'm.homeserver': { base_url: baseUrl } });
    }
    if (p === '/_matrix/client/v3/register') {
      return json(403, { errcode: 'M_FORBIDDEN', error: 'Registration disabled' });
    }
    if (p === '/_matrix/client/versions') {
      return json(200, {
        versions: [
          'r0.6.1',
          'v1.1',
          'v1.2',
          'v1.3',
          'v1.4',
          'v1.5',
          'v1.6',
          'v1.7',
          'v1.8',
          'v1.9',
          'v1.10',
          'v1.11',
        ],
        unstable_features: {
          'org.matrix.e2e_cross_signing': true,
          'org.matrix.msc3440.stable': true,
          'org.matrix.msc3771': true,
          'org.matrix.msc3773': true,
          'org.matrix.msc3916.stable': true,
        },
      });
    }
    if (p === '/_matrix/client/v3/login') {
      if (req.method === 'GET') return json(200, { flows: [{ type: 'm.login.password' }] });
      await readJsonBody(req);
      return json(200, {
        user_id: multiplier.meta.userId,
        access_token: 'replay_access_token',
        device_id: 'REPLAY_DEVICE',
        home_server: multiplier.meta.viewerDomain,
      });
    }
    if (p === '/_matrix/client/v3/logout') return json(200, {});
    if (p === '/_matrix/client/v3/account/whoami') {
      return json(200, { user_id: multiplier.meta.userId, device_id: 'REPLAY_DEVICE' });
    }
    if (p === '/_matrix/client/v3/capabilities') {
      return json(200, {
        capabilities: {
          'm.change_password': { enabled: false },
          'm.room_versions': { default: '11', available: { 11: 'stable' } },
        },
      });
    }
    if (p === '/_matrix/client/v1/media/config' || p === '/_matrix/media/v3/config') {
      return json(200, { 'm.upload.size': 52428800 });
    }
    if (p === '/_matrix/client/v3/pushrules/' || p === '/_matrix/client/v3/pushrules') {
      return json(200, {
        global: { content: [], override: [], room: [], sender: [], underride: [] },
      });
    }
    if (p === '/_matrix/client/v3/joined_rooms') {
      return json(200, { joined_rooms: [...rooms.keys()] });
    }
    if (p === '/_matrix/client/v3/keys/upload') {
      await readJsonBody(req);
      return json(200, { one_time_key_counts: { signed_curve25519: 50 } });
    }
    if (p === '/_matrix/client/v3/keys/query') return json(200, { device_keys: {}, failures: {} });
    if (p === '/_matrix/client/v3/keys/claim') {
      return json(200, { one_time_keys: {}, failures: {} });
    }
    if (p === '/_matrix/client/v3/room_keys/version') {
      return json(404, { errcode: 'M_NOT_FOUND', error: 'No backup' });
    }
    if (p.startsWith('/_matrix/client/v3/sendToDevice/')) {
      await readJsonBody(req);
      return json(200, {});
    }

    // Media download & thumbnail (v1 authenticated + v3 legacy alias)
    const mediaMatch = p.match(
      /^\/_matrix\/(?:client\/v[13]\/media|media\/v[13])\/(download|thumbnail)\/([^/]+)\/([^/]+)/
    );
    if (mediaMatch) {
      const kind = mediaMatch[1];
      const key = `${dec(mediaMatch[2])}/${dec(mediaMatch[3])}`;
      const entry = blobIndex[key];
      const filePath = entry && blobsDir ? path.join(blobsDir, entry.file) : '';
      if (entry && filePath && fs.existsSync(filePath)) {
        res.writeHead(200, {
          ...cors,
          'Content-Type': entry.contentType || 'application/octet-stream',
        });
        res.end(fs.readFileSync(filePath));
        return;
      }
      if (kind === 'thumbnail') {
        res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
        res.end(TINY_PNG);
        return;
      }
      return json(404, { errcode: 'M_NOT_FOUND', error: 'Media not found' });
    }

    // User filters & account_data
    const filterMatch = p.match(/^\/_matrix\/client\/v3\/user\/[^/]+\/filter(?:\/([^/]+))?$/);
    if (filterMatch) {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const id = `f${savedFilters.size + 1}`;
        savedFilters.set(id, body);
        return json(200, { filter_id: id });
      }
      const found = savedFilters.get(dec(filterMatch[1] ?? ''));
      return found ? json(200, found) : json(404, { errcode: 'M_NOT_FOUND', error: 'No filter' });
    }
    const accMatch = p.match(
      /^\/_matrix\/client\/v3\/user\/[^/]+(?:\/rooms\/([^/]+))?\/account_data\/([^/]+)$/
    );
    if (accMatch) {
      const rId = accMatch[1] ? dec(accMatch[1]) : null;
      const type = dec(accMatch[2]);
      const map = rId ? rooms.get(rId)?.accountData : globalAccountData;
      if (req.method === 'PUT') {
        const content = await readJsonBody(req);
        if (map) map.set(type, { type, content });
        if (!rId) commitDeltas({}, [{ type, content }]);
        return json(200, {});
      }
      const ev = map?.get(type);
      return ev ? json(200, ev.content) : json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
    }

    // User profile
    const profMatch = p.match(
      /^\/_matrix\/client\/v3\/profile\/([^/]+)(?:\/(displayname|avatar_url))?$/
    );
    if (profMatch) {
      const uId = dec(profMatch[1]);
      let profile = { displayname: localpartOf(uId) };
      for (const store of rooms.values()) {
        const m = store.members.get(uId);
        if (m?.content) {
          profile = {
            ...(m.content.displayname ? { displayname: m.content.displayname } : {}),
            ...(m.content.avatar_url ? { avatar_url: m.content.avatar_url } : {}),
          };
          break;
        }
      }
      if (profMatch[2]) return json(200, { [profMatch[2]]: profile[profMatch[2]] });
      return json(200, profile);
    }

    // /v3/sync
    if (p === '/_matrix/client/v3/sync') {
      const since = url.searchParams.get('since');
      const limit = parseTimelineLimit(url.searchParams.get('filter'));
      if (!since) return json(200, buildInitialSync(limit));
      const sinceSeq = since.startsWith('s') ? Number.parseInt(since.slice(1), 10) : 0;
      const timeoutMs = Math.min(30_000, Math.max(0, Number(url.searchParams.get('timeout') ?? 0)));
      if (syncSeq > sinceSeq || timeoutMs === 0) {
        return json(200, buildIncrementalSync(sinceSeq, limit));
      }
      let done = false;
      const respond = () => {
        if (done) return;
        done = true;
        json(200, buildIncrementalSync(sinceSeq, limit));
      };
      const timer = setTimeout(respond, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        respond();
      };
      waiters.push(wake);
      req.on('close', () => {
        done = true;
        clearTimeout(timer);
        const idx = waiters.indexOf(wake);
        if (idx >= 0) waiters.splice(idx, 1);
      });
      return;
    }

    // Room-scoped endpoints
    const roomMatch = p.match(/^\/_matrix\/client\/v[13]\/rooms\/([^/]+)\/(.+)$/);
    if (roomMatch) {
      const roomId = dec(roomMatch[1]);
      const rest = roomMatch[2];
      const store = rooms.get(roomId);
      if (!store) return json(404, { errcode: 'M_NOT_FOUND', error: `Unknown room ${roomId}` });

      if (rest === 'threads') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        const include = url.searchParams.get('include') ?? 'all';
        const from = url.searchParams.get('from') ?? '';
        const offset = from.startsWith('th:') ? Number.parseInt(from.slice(3), 10) || 0 : 0;
        const list = [...store.threads.values()]
          .filter((r) => r.rootEvent && (include !== 'participated' || r.participated))
          .sort((a, b) => b.lastActivityTs - a.lastActivityTs || a.rootId.localeCompare(b.rootId));
        const chunk = list
          .slice(offset, offset + limit)
          .map((r) => store.decorateEvent(r.rootEvent));
        const next = offset + limit < list.length ? `th:${offset + limit}` : undefined;
        return json(200, { chunk, ...(next ? { next_batch: next } : {}) });
      }

      if (rest === 'messages') {
        const dir = url.searchParams.get('dir') === 'f' ? 'f' : 'b';
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        const from = url.searchParams.get('from') ?? '';
        const total = store.timeline.length;
        const rawIdx = from.startsWith('m')
          ? Number.parseInt(from.slice(1), 10)
          : dir === 'b'
            ? total
            : 0;
        const idx = Math.min(total, Math.max(0, Number.isFinite(rawIdx) ? rawIdx : 0));
        if (dir === 'b') {
          const startIdx = Math.max(0, idx - limit);
          const chunk = store.timeline
            .slice(startIdx, idx)
            .reverse()
            .map((e) => store.decorateEvent(e));
          return json(200, {
            chunk,
            start: `m${idx}`,
            ...(startIdx > 0 ? { end: `m${startIdx}` } : {}),
          });
        }
        const endIdx = Math.min(total, idx + limit);
        const chunk = store.timeline.slice(idx, endIdx).map((e) => store.decorateEvent(e));
        return json(200, {
          chunk,
          start: `m${idx}`,
          ...(endIdx < total ? { end: `m${endIdx}` } : {}),
        });
      }

      if (rest.startsWith('relations/')) {
        const parts = rest.slice('relations/'.length).split('/').map(dec);
        const targetId = parts[0] ?? '';
        const relType = parts[1] || null;
        const evType = parts[2] || null;
        const dir = url.searchParams.get('dir') === 'f' ? 'f' : 'b';
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        const recurse = url.searchParams.get('recurse') === 'true';
        const from = url.searchParams.get('from') ?? '';

        const seen = new Set();
        const collected = [];
        const add = (ev) => {
          if (!ev || seen.has(ev.event_id)) return;
          seen.add(ev.event_id);
          collected.push(ev);
        };
        for (const ev of store.relationsByTarget.get(targetId) ?? []) add(ev);
        const th = store.threads.get(targetId);
        if (th && (!relType || relType === 'm.thread')) {
          for (const ev of th.replies) {
            add(ev);
            if (recurse || !relType) {
              for (const sub of store.relationsByTarget.get(ev.event_id) ?? []) add(sub);
            }
          }
        }
        const filtered = collected
          .filter((ev) => {
            const rel = ev.content?.['m.relates_to'];
            if (relType && rel?.rel_type !== relType) return false;
            if (evType && ev.type !== evType) return false;
            return true;
          })
          .sort((a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0));

        const ordered = dir === 'b' ? filtered.slice().reverse() : filtered;
        let offset = from.startsWith('rel:') ? Number.parseInt(from.slice(4), 10) || 0 : 0;
        if (from.startsWith('m') && store.timeline.length > 0) {
          const mIdx = Number.parseInt(from.slice(1), 10);
          if (Number.isFinite(mIdx) && mIdx > 0 && mIdx < store.timeline.length) {
            const boundTs = store.timeline[mIdx - 1]?.origin_server_ts ?? 0;
            const found = ordered.findIndex((e) =>
              dir === 'b'
                ? (e.origin_server_ts ?? 0) <= boundTs
                : (e.origin_server_ts ?? 0) >= boundTs
            );
            offset = found >= 0 ? found : ordered.length;
          }
        }
        const chunk = ordered.slice(offset, offset + limit).map((e) => store.decorateEvent(e));
        const nextBatch = offset + limit < ordered.length ? `rel:${offset + limit}` : undefined;
        const prevBatch = offset > 0 ? `rel:${Math.max(0, offset - limit)}` : undefined;
        return json(200, {
          chunk,
          ...(nextBatch ? { next_batch: nextBatch } : {}),
          ...(prevBatch ? { prev_batch: prevBatch } : {}),
        });
      }

      if (rest.startsWith('event/')) {
        const ev = store.eventsById.get(dec(rest.slice('event/'.length)));
        return ev
          ? json(200, store.decorateEvent(ev))
          : json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
      }
      if (rest.startsWith('context/')) {
        const id = dec(rest.slice('context/'.length));
        const idx = store.timeline.findIndex((e) => e.event_id === id);
        const ev = store.eventsById.get(id);
        if (!ev) return json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10)));
        let seq = store.timeline;
        let pos = idx;
        if (pos < 0) {
          const rel = ev.content?.['m.relates_to'];
          const th = rel?.rel_type === 'm.thread' ? store.threads.get(rel.event_id) : undefined;
          if (th) {
            seq = th.replies;
            pos = seq.findIndex((e) => e.event_id === id);
          }
        }
        const before = pos > 0 ? seq.slice(Math.max(0, pos - limit), pos).reverse() : [];
        const after = pos >= 0 ? seq.slice(pos + 1, pos + 1 + limit) : [];
        return json(200, {
          event: store.decorateEvent(ev),
          events_before: before.map((e) => store.decorateEvent(e)),
          events_after: after.map((e) => store.decorateEvent(e)),
          start: `m${Math.max(0, idx - before.length)}`,
          end: `m${Math.max(0, idx + 1 + after.length)}`,
          state: [...store.stateMap.values()],
        });
      }
      if (rest === 'members') return json(200, { chunk: [...store.members.values()] });
      if (rest === 'joined_members') {
        const joined = {};
        for (const [uId, ev] of store.members.entries()) {
          if (ev.content?.membership === 'join') {
            joined[uId] = { display_name: ev.content.displayname, avatar_url: ev.content.avatar_url };
          }
        }
        return json(200, { joined });
      }
      if (rest === 'state') return json(200, [...store.stateMap.values()]);
      if (rest.startsWith('state/')) {
        const parts = rest.slice('state/'.length).split('/');
        const type = dec(parts[0] ?? '');
        const key = parts.length > 1 ? dec(parts.slice(1).join('/')) : '';
        if (req.method === 'PUT') {
          const content = await readJsonBody(req);
          const ev = {
            type,
            state_key: key,
            event_id: `$local_st_${(localCounter += 1)}`,
            room_id: roomId,
            sender: multiplier.meta.userId,
            origin_server_ts: Date.now(),
            content,
          };
          commitDeltas({ [roomId]: { stateEvents: [ev], timelineEvents: [], ephemeralEvents: [] } });
          return json(200, { event_id: ev.event_id });
        }
        const ev = store.stateMap.get(`${type}\0${key}`);
        return ev ? json(200, ev.content) : json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
      }
      if (rest.startsWith('send/')) {
        const parts = rest.slice('send/'.length).split('/');
        const type = dec(parts[0] ?? 'm.room.message');
        const content = await readJsonBody(req);
        const ev = {
          type,
          event_id: `$local_msg_${(localCounter += 1)}`,
          room_id: roomId,
          sender: multiplier.meta.userId,
          origin_server_ts: Date.now(),
          content,
        };
        commitDeltas({ [roomId]: { stateEvents: [], timelineEvents: [ev], ephemeralEvents: [] } });
        return json(200, { event_id: ev.event_id });
      }
      if (rest.startsWith('redact/')) {
        const targetId = dec(rest.slice('redact/'.length).split('/')[0] ?? '');
        const content = await readJsonBody(req);
        const ev = {
          type: 'm.room.redaction',
          event_id: `$local_red_${(localCounter += 1)}`,
          room_id: roomId,
          sender: multiplier.meta.userId,
          redacts: targetId,
          origin_server_ts: Date.now(),
          content,
        };
        commitDeltas({ [roomId]: { stateEvents: [], timelineEvents: [ev], ephemeralEvents: [] } });
        return json(200, { event_id: ev.event_id });
      }
      if (rest.startsWith('receipt/')) {
        const parts = rest.slice('receipt/'.length).split('/').map(dec);
        const body = await readJsonBody(req);
        const ep = {
          type: 'm.receipt',
          content: {
            [parts[1]]: {
              [parts[0]]: {
                [multiplier.meta.userId]: {
                  ts: Date.now(),
                  ...(body.thread_id ? { thread_id: body.thread_id } : {}),
                },
              },
            },
          },
        };
        commitDeltas({ [roomId]: { stateEvents: [], timelineEvents: [], ephemeralEvents: [ep] } });
        return json(200, {});
      }
      if (rest.startsWith('typing/') || rest === 'read_markers') {
        await readJsonBody(req);
        return json(200, {});
      }
    }

    return json(200, {});
    } catch (err) {
      return json(500, { errcode: 'M_UNKNOWN', error: String(err?.message ?? err) });
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  baseUrl = `http://127.0.0.1:${actualPort}`;

  let closed = false;
  const close = () => {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve) => {
      clearInterval(tickTimer);
      notifyWaiters();
      if (statsFile) flushStatsWindow(Date.now());
      for (const s of sockets) s.destroy();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  };

  return {
    baseUrl,
    port: actualPort,
    userId: multiplier.meta.userId,
    username: localpartOf(multiplier.meta.userId),
    roomId: multiplier.meta.primaryRoomId,
    roomName: multiplier.meta.primaryRoomName,
    getStatus,
    close,
  };
}

/** Parse CLI arguments for server.mjs. */
export function parseServerArgs(argv) {
  const opts = {
    capture: '',
    port: 0,
    multiplyThreads: 1,
    multiplyRooms: 1,
    speed: 1,
    statsFile: '',
    targetRoomId: '',
    printReady: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--print-ready') {
      opts.printReady = true;
      continue;
    }
    const next = argv[++i] ?? '';
    if (arg === '--capture') opts.capture = next;
    else if (arg === '--port') opts.port = Number(next);
    else if (arg === '--multiply-threads') opts.multiplyThreads = Number(next);
    else if (arg === '--multiply-rooms') opts.multiplyRooms = Number(next);
    else if (arg === '--speed') opts.speed = Number(next);
    else if (arg === '--stats-file') opts.statsFile = next;
    else if (arg === '--target-room') opts.targetRoomId = next;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseServerArgs(process.argv.slice(2));
  if (!args.capture) {
    console.error('server.mjs: missing --capture <dir>');
    process.exit(2);
  }
  startReplayServer(args)
    .then((srv) => {
      const ready = {
        url: srv.baseUrl,
        userId: srv.userId,
        username: srv.username,
        roomId: srv.roomId,
        roomName: srv.roomName,
        multiplyThreads: args.multiplyThreads,
        multiplyRooms: args.multiplyRooms,
        speed: args.speed,
        statsFile: args.statsFile,
      };
      if (args.printReady) console.log(JSON.stringify(ready));
      else console.error(`Replay server listening on ${srv.baseUrl}`);
      const shutdown = () => {
        srv.close().then(() => process.exit(0));
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error(`server.mjs: ${err.message}`);
      process.exit(1);
    });
}
