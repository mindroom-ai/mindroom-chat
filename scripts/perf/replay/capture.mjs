#!/usr/bin/env node
// Read-only (GET-only) Matrix CS-API capture CLI for MindRoom Chat replay performance benchmarks.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EPHEMERAL_TYPES = ['m.typing', 'm.receipt', 'io.mindroom.live', 'io.mindroom.subagents'];
const DEFAULT_MAX_BLOB_BYTES = 2 * 1024 * 1024;
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const trimSlash = (url) => url.replace(/\/+$/, '');

/** Inline JSON filter passed via GET /_matrix/client/v3/sync?filter=... (strictly GET-only). */
export function buildCaptureSyncFilter(timelineLimit = 50) {
  return {
    room: {
      timeline: { limit: timelineLimit },
      state: { lazy_load_members: false },
      ephemeral: { types: [...EPHEMERAL_TYPES] },
    },
    presence: { types: [] },
  };
}

/** Parse `mxc://server/mediaId` into `{ mxcUri, server, mediaId }`, or null when invalid. */
export function parseMxcUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('mxc://')) return null;
  const rest = uri.slice(6);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const server = rest.slice(0, slash);
  const mediaId = rest.slice(slash + 1).split(/[/?#]/)[0];
  return server && mediaId ? { mxcUri: `mxc://${server}/${mediaId}`, server, mediaId } : null;
}

/** Collect deduplicated `mxc://` refs, prioritizing `io.mindroom.long_text` sidecars over media. */
export function extractMxcReferences(snapshot, liveEntries = []) {
  const byKey = new Map();
  const add = (uri, priority) => {
    const parsed = parseMxcUri(uri);
    if (!parsed) return;
    const key = `${parsed.server}/${parsed.mediaId}`;
    const prev = byKey.get(key);
    if (!prev || priority < prev.priority) byKey.set(key, { ...parsed, key, priority });
  };
  const visitContent = (c) => {
    if (!isRecord(c)) return;
    const p = isRecord(c['io.mindroom.long_text']) ? 1 : 2;
    add(c.url, p);
    add(c.file?.url, p);
    add(c.avatar_url, 2);
    add(c.info?.thumbnail_url, 2);
    add(c.info?.thumbnail_file?.url, 2);
    add(c.full_arguments_url, 1);
    add(c.full_arguments_file?.url, 1);
    const doc = c['io.mindroom.ui_action']?.canvas?.document;
    if (isRecord(doc)) {
      add(doc.mxc_url, 1);
      add(doc.mxcUrl, 1);
    }
    if (isRecord(c['m.new_content'])) visitContent(c['m.new_content']);
  };
  const visitEvent = (ev) => {
    if (!isRecord(ev)) return;
    visitContent(ev.content);
    const rels = ev.unsigned?.['m.relations'];
    if (!isRecord(rels)) return;
    visitEvent(rels['m.replace']);
    const th = rels['m.thread'];
    if (isRecord(th)) {
      visitEvent(th.latest_event);
      visitEvent(th['io.mindroom.latest_reply']);
      visitEvent(th['io.mindroom.title']);
    }
  };
  const visitSection = (r) => {
    for (const ev of r?.state?.events ?? []) visitEvent(ev);
    for (const ev of r?.timeline?.events ?? []) visitEvent(ev);
  };
  for (const r of Object.values(snapshot?.initialSync?.rooms?.join ?? {})) visitSection(r);
  for (const r of Object.values(snapshot?.rooms ?? {})) {
    for (const ev of [...(r?.threads ?? []), ...(r?.messagesTail ?? []), ...(r?.members ?? [])]) {
      visitEvent(ev);
    }
    for (const list of Object.values(r?.threadRelations ?? {})) {
      for (const ev of list ?? []) visitEvent(ev);
    }
  }
  for (const e of liveEntries) {
    for (const r of Object.values(e?.response?.rooms?.join ?? {})) visitSection(r);
  }
  return [...byKey.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

/** Minimal UTF-16 splice matching `src/app/matrix/protocol/liveFrame.ts` `applyLiveDelta`. */
export function computeLiveSplice(prev, next) {
  const maxPrefix = Math.min(prev.length, next.length);
  let at = 0;
  while (at < maxPrefix && prev.charCodeAt(at) === next.charCodeAt(at)) at += 1;
  const maxSuffix = Math.min(prev.length - at, next.length - at);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return {
    at,
    del: prev.length - at - suffix,
    ins: next.slice(at, next.length - suffix),
    len: next.length,
  };
}

const makeSid = (baseMs, key) => {
  const ms = String(Math.max(1_000_000_000_000, Math.floor(baseMs)))
    .padStart(13, '0')
    .slice(0, 13);
  return `${ms}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
};

const extractDocs = (content) => {
  const src = isRecord(content?.['m.new_content']) ? content['m.new_content'] : (content ?? {});
  const trace = src['io.mindroom.tool_trace'];
  const tools = Array.isArray(trace?.events)
    ? trace.events.filter(isRecord)
    : Array.isArray(trace)
      ? trace.filter(isRecord)
      : [];
  const rawSegs = src['io.mindroom.live_reasoning_segments'];
  const segments = Array.isArray(rawSegs)
    ? rawSegs.filter(
        (s) =>
          isRecord(s) &&
          Number.isSafeInteger(s.start) &&
          s.start >= 0 &&
          Number.isSafeInteger(s.after_tool) &&
          s.after_tool >= 0
      )
    : [];
  return {
    md: typeof src.body === 'string' ? src.body : '',
    reasoning:
      typeof src['io.mindroom.reasoning'] === 'string'
        ? src['io.mindroom.reasoning']
        : typeof src['io.mindroom.live_reasoning'] === 'string'
          ? src['io.mindroom.live_reasoning']
          : '',
    tools,
    status: 'streaming',
    activity:
      typeof src['io.mindroom.live_activity'] === 'string' ? src['io.mindroom.live_activity'] : '',
    segments,
  };
};

/** Synthesize `{ tauMs, response }` live `io.mindroom.live` frames from `m.replace` edit chains. */
export function synthesizeLiveFramesFromEvents(events, options = {}) {
  const durationMs = Math.max(2_000, options.durationMs ?? 15_000);
  const baseTs = options.baseTs ?? Date.now();
  const byId = new Map();
  const editsByTarget = new Map();
  for (const ev of events) {
    if (!isRecord(ev) || typeof ev.event_id !== 'string') continue;
    byId.set(ev.event_id, ev);
    const rel = ev.content?.['m.relates_to'];
    if (rel?.rel_type === 'm.replace' && typeof rel.event_id === 'string') {
      const list = editsByTarget.get(rel.event_id) ?? [];
      list.push(ev);
      editsByTarget.set(rel.event_id, list);
    }
  }
  const out = [];
  let chainIdx = 0;
  for (const [targetId, edits] of editsByTarget.entries()) {
    edits.sort((a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0));
    const base = byId.get(targetId);
    const roomId = base?.room_id ?? edits[0]?.room_id;
    const sender = base?.sender ?? edits[0]?.sender;
    if (!roomId || !sender) continue;
    const threadRel = base?.content?.['m.relates_to'];
    const threadId = threadRel?.rel_type === 'm.thread' ? threadRel.event_id : null;
    const versions = [
      ...(base ? [extractDocs(base.content)] : []),
      ...edits.map((e) => extractDocs(e.content)),
    ];
    if (versions.length === 0) continue;
    const sid = makeSid(baseTs + chainIdx, `${roomId}:${targetId}`);
    const stepMs = Math.max(100, Math.floor((durationMs * 0.85) / Math.max(1, versions.length)));
    const offset = Math.floor(((chainIdx % 5) / 5) * Math.min(2_000, durationMs * 0.15));
    chainIdx += 1;

    let prev = null;
    versions.forEach((docs, seq) => {
      const tauMs = Math.min(durationMs - 100, offset + seq * stepMs);
      const isFirst = seq === 0 || !prev;
      const content = isFirst
        ? { v: 1, reply: targetId, sid, seq: 0, snapshot: docs }
        : {
            v: 1,
            reply: targetId,
            sid,
            seq,
            delta: {
              ...(docs.md !== prev.md ? { md: computeLiveSplice(prev.md, docs.md) } : {}),
              ...(docs.reasoning !== prev.reasoning
                ? { reasoning: computeLiveSplice(prev.reasoning, docs.reasoning) }
                : {}),
              ...(docs.activity !== prev.activity ? { activity: docs.activity } : {}),
              status: 'streaming',
            },
          };
      prev = docs;
      const roomDelta = {
        ephemeral: {
          events: [{ type: 'io.mindroom.live', sender, origin_server_ts: baseTs + tauMs, content }],
        },
      };
      if (isFirst) {
        roomDelta.state = {
          events: [
            {
              type: 'io.mindroom.active_runs',
              event_id: `$synth_ar_${chainIdx}_${seq}`,
              sender,
              state_key: sender,
              room_id: roomId,
              origin_server_ts: baseTs + tauMs,
              content: {
                version: 1,
                updated_at: baseTs + tauMs,
                ttl_ms: 180_000,
                threads: [{ thread_id: threadId }],
              },
            },
          ],
        };
      }
      out.push({ tauMs, response: { rooms: { join: { [roomId]: roomDelta } } } });
    });
  }
  return out.sort((a, b) => a.tauMs - b.tauMs);
}

/** Strict GET-only Matrix CS-API fetch wrapper. Never issues POST, PUT, or DELETE. */
async function matrixGet(
  homeserver,
  token,
  pathAndQuery,
  { binary = false, fetchFn = fetch } = {}
) {
  const res = await fetchFn(`${trimSlash(homeserver)}${pathAndQuery}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = new Error(`GET ${pathAndQuery} failed with HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!binary) return res.json();
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function paginateGet(
  homeserver,
  token,
  buildPath,
  { maxPages, maxItems, tokenField, fetchFn }
) {
  const items = [];
  let cursor = '';
  for (let i = 0; i < maxPages && items.length < maxItems; i += 1) {
    let page;
    try {
      const limit = Math.min(100, maxItems - items.length);
      page = await matrixGet(homeserver, token, buildPath(cursor, limit), { fetchFn });
    } catch (_err) {
      break;
    }
    const chunk = Array.isArray(page.chunk) ? page.chunk : [];
    items.push(...chunk);
    const next = page[tokenField];
    if (!next || next === cursor || chunk.length === 0) break;
    cursor = next;
  }
  return items.slice(0, maxItems);
}

/** Parse CLI arguments for capture.mjs. */
export function parseCaptureArgs(argv) {
  const opts = {
    homeserver: '',
    tokenFile: '',
    out: '',
    rooms: [],
    duration: 60,
    maxThreads: 600,
    heavyThreads: 25,
    maxBlobs: 500,
    maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
    synthesizeLive: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--synthesize-live') {
      opts.synthesizeLive = true;
      continue;
    }
    const next = argv[++i] ?? '';
    if (arg === '--homeserver') opts.homeserver = next;
    else if (arg === '--token-file') opts.tokenFile = next;
    else if (arg === '--out') opts.out = next;
    else if (arg === '--rooms') opts.rooms = next.split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--duration') opts.duration = Number(next);
    else if (arg === '--max-threads') opts.maxThreads = Number(next);
    else if (arg === '--heavy-threads') opts.heavyThreads = Number(next);
    else if (arg === '--max-blobs') opts.maxBlobs = Number(next);
    else if (arg === '--max-blob-bytes') opts.maxBlobBytes = Number(next);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

/** Execute a full GET-only capture and write manifest.json, snapshot.json, live.jsonl, blobs/. */
export async function runCapture(options) {
  const {
    homeserver,
    token,
    out,
    rooms: requestedRooms = [],
    duration = 60,
    maxThreads = 600,
    heavyThreads = 25,
    maxBlobs = 500,
    maxBlobBytes = DEFAULT_MAX_BLOB_BYTES,
    synthesizeLive = false,
    fetchFn = fetch,
  } = options;
  if (!homeserver) throw new Error('Missing --homeserver');
  if (!token) throw new Error('Missing token (--token-file or MINDROOM_CAPTURE_TOKEN)');
  if (!out) throw new Error('Missing --out');

  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.chmodSync(out, 0o700);
  const blobsDir = path.join(out, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true, mode: 0o700 });

  const whoami = await matrixGet(homeserver, token, '/_matrix/client/v3/account/whoami', {
    fetchFn,
  });
  const userId = whoami.user_id;
  const viewerDomain = userId.includes(':') ? userId.slice(userId.indexOf(':') + 1) : 'localhost';
  const filterParam = encodeURIComponent(JSON.stringify(buildCaptureSyncFilter(50)));
  const initialSync = await matrixGet(
    homeserver,
    token,
    `/_matrix/client/v3/sync?filter=${filterParam}&timeout=0`,
    { fetchFn }
  );
  const joined = initialSync.rooms?.join ?? {};
  const allRoomIds = Object.keys(joined);
  const isSpace = (id) =>
    (joined[id]?.state?.events ?? []).some(
      (e) => e.type === 'm.room.create' && e.content?.type === 'm.space'
    );
  const focusedRoomIds = requestedRooms.length
    ? requestedRooms.filter((id) => id in joined)
    : allRoomIds.filter((id) => !isSpace(id));

  const roomsCapture = {};
  const allEvents = [];
  for (const roomId of focusedRoomIds) {
    const encR = encodeURIComponent(roomId);
    const threads = await paginateGet(
      homeserver,
      token,
      (from, lim) =>
        `/_matrix/client/v1/rooms/${encR}/threads?limit=${lim}` +
        (from ? `&from=${encodeURIComponent(from)}` : ''),
      { maxPages: 50, maxItems: maxThreads, tokenField: 'next_batch', fetchFn }
    );
    const score = (e) => e?.unsigned?.['m.relations']?.['m.thread']?.count ?? 0;
    const latestTs = (e) =>
      e?.unsigned?.['m.relations']?.['m.thread']?.latest_event?.origin_server_ts ??
      e?.origin_server_ts ??
      0;
    const threadRelations = {};
    for (const root of [...threads]
      .sort((a, b) => score(b) - score(a) || latestTs(b) - latestTs(a))
      .slice(0, heavyThreads)) {
      if (!root?.event_id) continue;
      const encEv = encodeURIComponent(root.event_id);
      const rels = await paginateGet(
        homeserver,
        token,
        (from, lim) =>
          `/_matrix/client/v1/rooms/${encR}/relations/${encEv}/m.thread?dir=b&limit=${lim}` +
          (from ? `&from=${encodeURIComponent(from)}` : ''),
        { maxPages: 10, maxItems: 1000, tokenField: 'next_batch', fetchFn }
      );
      threadRelations[root.event_id] = rels;
      allEvents.push(root, ...rels);
    }
    const prevBatch = joined[roomId]?.timeline?.prev_batch ?? '';
    const messagesTail = prevBatch
      ? await paginateGet(
          homeserver,
          token,
          (from, lim) =>
            `/_matrix/client/v3/rooms/${encR}/messages?dir=b` +
            `&from=${encodeURIComponent(from || prevBatch)}&limit=${lim}`,
          { maxPages: 5, maxItems: 500, tokenField: 'end', fetchFn }
        )
      : [];
    allEvents.push(...messagesTail);
    let members = [];
    try {
      const mRes = await matrixGet(homeserver, token, `/_matrix/client/v3/rooms/${encR}/members`, {
        fetchFn,
      });
      if (Array.isArray(mRes.chunk)) members = mRes.chunk;
    } catch (_err) {
      // Initial sync state already holds member events.
    }
    roomsCapture[roomId] = { threads, threadRelations, messagesTail, members };
  }

  const liveEntries = [];
  const durationMs = Math.max(0, Math.floor(duration * 1000));
  if (durationMs > 0 && initialSync.next_batch) {
    let since = initialSync.next_batch;
    const startMs = Date.now();
    const endMs = startMs + durationMs;
    while (Date.now() < endMs) {
      const timeout = Math.max(100, Math.min(15_000, endMs - Date.now()));
      const res = await matrixGet(
        homeserver,
        token,
        `/_matrix/client/v3/sync?filter=${filterParam}` +
          `&since=${encodeURIComponent(since)}&timeout=${timeout}`,
        { fetchFn }
      );
      const tauMs = Math.max(0, Date.now() - startMs);
      if (res.next_batch) since = res.next_batch;
      const hasRooms = isRecord(res.rooms?.join) && Object.keys(res.rooms.join).length > 0;
      const hasAcc = Array.isArray(res.account_data?.events) && res.account_data.events.length > 0;
      if (hasRooms || hasAcc) liveEntries.push({ tauMs, response: res });
    }
  }

  let effectiveDurationMs = durationMs;
  if (synthesizeLive) {
    const hasLive = liveEntries.some((entry) =>
      Object.values(entry.response?.rooms?.join ?? {}).some((r) =>
        (r?.ephemeral?.events ?? []).some((e) => e.type === 'io.mindroom.live')
      )
    );
    if (!hasLive) {
      for (const room of Object.values(joined)) allEvents.push(...(room?.timeline?.events ?? []));
      effectiveDurationMs = Math.max(durationMs, 15_000);
      liveEntries.push(
        ...synthesizeLiveFramesFromEvents(allEvents, { durationMs: effectiveDurationMs })
      );
      liveEntries.sort((a, b) => a.tauMs - b.tauMs);
    }
  }

  const snapshot = { initialSync, rooms: roomsCapture };
  const blobIndex = {};
  for (const ref of extractMxcReferences(snapshot, liveEntries).slice(0, maxBlobs)) {
    const encS = encodeURIComponent(ref.server);
    const encM = encodeURIComponent(ref.mediaId);
    let dl;
    try {
      dl = await matrixGet(homeserver, token, `/_matrix/client/v1/media/download/${encS}/${encM}`, {
        binary: true,
        fetchFn,
      });
    } catch (_err) {
      try {
        dl = await matrixGet(homeserver, token, `/_matrix/media/v3/download/${encS}/${encM}`, {
          binary: true,
          fetchFn,
        });
      } catch (_fallbackErr) {
        continue;
      }
    }
    if (!dl || dl.buffer.length > maxBlobBytes) continue;
    const sha = crypto.createHash('sha256').update(dl.buffer).digest('hex');
    const blobPath = path.join(blobsDir, sha);
    if (!fs.existsSync(blobPath)) fs.writeFileSync(blobPath, dl.buffer, { mode: 0o600 });
    blobIndex[ref.key] = { file: sha, contentType: dl.contentType, bytes: dl.buffer.length };
  }

  const primaryRoomId =
    focusedRoomIds
      .slice()
      .sort(
        (a, b) =>
          (roomsCapture[b]?.threads?.length ?? 0) - (roomsCapture[a]?.threads?.length ?? 0)
      )[0] ??
    allRoomIds[0] ??
    '';
  const nameEv = (joined[primaryRoomId]?.state?.events ?? []).find((e) => e.type === 'm.room.name');
  const primaryRoomName =
    typeof nameEv?.content?.name === 'string' && nameEv.content.name
      ? nameEv.content.name
      : primaryRoomId;
  const manifest = {
    version: 1,
    capturedAt: new Date().toISOString(),
    capturedAtMs: Date.now(),
    homeserver: trimSlash(homeserver),
    userId,
    viewerDomain,
    primaryRoomId,
    primaryRoomName,
    focusedRoomIds,
    durationMs: effectiveDurationMs || 60_000,
    stats: {
      rooms: allRoomIds.length,
      threads: Object.values(roomsCapture).reduce((n, r) => n + r.threads.length, 0),
      liveEntries: liveEntries.length,
      blobs: Object.keys(blobIndex).length,
    },
    blobIndex,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(out, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`, {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(out, 'live.jsonl'),
    liveEntries.map((e) => JSON.stringify(e)).join('\n') + (liveEntries.length ? '\n' : ''),
    { mode: 0o600 }
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseCaptureArgs(process.argv.slice(2));
  const token = args.tokenFile
    ? fs.readFileSync(args.tokenFile, 'utf8').trim()
    : (process.env.MINDROOM_CAPTURE_TOKEN ?? '').trim();
  runCapture({ ...args, token })
    .then((manifest) => console.log(JSON.stringify(manifest.stats)))
    .catch((err) => {
      console.error(`capture.mjs: ${err.message}`);
      process.exit(1);
    });
}
