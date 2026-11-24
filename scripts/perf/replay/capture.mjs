#!/usr/bin/env node
// Read-only (GET-only) Matrix CS-API capture CLI for MindRoom Chat replay performance benchmarks.
//
// IMPORTANT — DEVICE SAFETY:
// Calling GET /_matrix/client/v3/sync?since=... advances the homeserver's sync cursor (and
// to-device delivery position) for the access token's device. Operators MUST use a fresh,
// dedicated capture device/login and NEVER reuse an active MindRoom Chat session token.
// All /sync requests pass set_presence=offline so the capture device never flips user presence.
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

function makeBlobTooLargeError(message) {
  const err = new Error(message);
  err.code = 'BLOB_TOO_LARGE';
  return err;
}

/**
 * Strict GET-only Matrix CS-API fetch wrapper. Never issues POST, PUT, or DELETE.
 * In binary mode, enforces `maxBytes` via Content-Length and incremental stream reads
 * so oversized responses are aborted without buffering the full body.
 */
export async function matrixGet(
  homeserver,
  token,
  pathAndQuery,
  { binary = false, maxBytes = Infinity, fetchFn = fetch } = {}
) {
  const controller = new AbortController();
  const res = await fetchFn(`${trimSlash(homeserver)}${pathAndQuery}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  if (!res.ok) {
    const err = new Error(`GET ${pathAndQuery} failed with HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!binary) return res.json();

  const contentType = res.headers?.get?.('content-type') || 'application/octet-stream';
  const rawLen = res.headers?.get?.('content-length');
  const contentLength =
    rawLen !== null && rawLen !== undefined && rawLen !== '' ? Number(rawLen) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await res.body?.cancel?.().catch(() => {});
    controller.abort();
    throw makeBlobTooLargeError(
      `GET ${pathAndQuery} Content-Length ${contentLength} exceeds maxBytes ${maxBytes}`
    );
  }

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (let step = await reader.read(); !step.done; step = await reader.read()) {
        const value = step.value;
        const buf = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        total += buf.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          controller.abort();
          throw makeBlobTooLargeError(`GET ${pathAndQuery} stream exceeded maxBytes ${maxBytes}`);
        }
        chunks.push(buf);
      }
    } finally {
      reader.releaseLock?.();
    }
    return { buffer: Buffer.concat(chunks, total), contentType };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw makeBlobTooLargeError(
      `GET ${pathAndQuery} body ${buffer.length} exceeds maxBytes ${maxBytes}`
    );
  }
  return { buffer, contentType };
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

/** Return true if `targetPath` lies inside a git repository or worktree. */
export function isInsideGitRepo(targetPath) {
  let cur = path.resolve(targetPath);
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  let dir = cur;
  try {
    if (fs.existsSync(cur)) dir = fs.realpathSync(cur);
  } catch (_err) {
    dir = cur;
  }
  let prev = '';
  while (dir !== prev) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    prev = dir;
    dir = path.dirname(dir);
  }
  return false;
}

/** Parse CLI arguments for capture.mjs. */
export function parseCaptureArgs(argv) {
  const opts = {
    homeserver: '',
    tokenFile: '',
    deviceId: '',
    out: '',
    rooms: [],
    duration: 60,
    maxThreads: 600,
    heavyThreads: 25,
    maxBlobs: 500,
    maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[++i] ?? '';
    if (arg === '--homeserver') opts.homeserver = next;
    else if (arg === '--token-file') opts.tokenFile = next;
    else if (arg === '--device-id') opts.deviceId = next;
    else if (arg === '--out') opts.out = next;
    else if (arg === '--rooms') {
      opts.rooms = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--duration') opts.duration = Number(next);
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
    deviceId = '',
    out,
    allowInRepo = false,
    rooms: requestedRooms = [],
    duration = 60,
    maxThreads = 600,
    heavyThreads = 25,
    maxBlobs = 500,
    maxBlobBytes = DEFAULT_MAX_BLOB_BYTES,
    fetchFn = fetch,
  } = options;
  if (!homeserver) throw new Error('Missing --homeserver');
  if (!token) throw new Error('Missing token (--token-file or MINDROOM_CAPTURE_TOKEN)');
  if (!out) throw new Error('Missing --out');
  if (!allowInRepo && isInsideGitRepo(out)) {
    throw new Error(
      `Refusing to write private capture inside a git repository (${path.resolve(out)}). ` +
        'Choose an --out directory outside any git worktree (e.g. /tmp or ~/.cache).'
    );
  }
  const durationMs = Number.isFinite(duration) ? Math.max(0, Math.floor(duration * 1000)) : 0;
  if (durationMs > 0 && !deviceId) {
    throw new Error(
      'Live capture (--duration > 0) calls GET /sync?since=..., which advances the sync cursor ' +
        "and acknowledges to-device messages on the access token's device. " +
        'Pass --device-id <id> matching a fresh, dedicated capture device (from /account/whoami), ' +
        'or pass --duration 0 for a snapshot-only capture.'
    );
  }

  const whoami = await matrixGet(homeserver, token, '/_matrix/client/v3/account/whoami', {
    fetchFn,
  });
  if (durationMs > 0) {
    const actualDeviceId = typeof whoami.device_id === 'string' ? whoami.device_id : '';
    if (!actualDeviceId || actualDeviceId !== deviceId) {
      throw new Error(
        `--device-id "${deviceId}" does not match token's /account/whoami device_id "${actualDeviceId || '(none)'}". ` +
          'Live capture (--duration > 0) calls GET /sync?since=..., which acknowledges to-device messages ' +
          'on that device. Use a fresh, dedicated capture device (or pass --duration 0 for snapshot-only).'
      );
    }
  }

  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.chmodSync(out, 0o700);
  const blobsDir = path.join(out, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true, mode: 0o700 });

  const userId = whoami.user_id;
  const viewerDomain = userId.includes(':') ? userId.slice(userId.indexOf(':') + 1) : 'localhost';
  const filterParam = encodeURIComponent(JSON.stringify(buildCaptureSyncFilter(50)));
  const initialSync = await matrixGet(
    homeserver,
    token,
    `/_matrix/client/v3/sync?filter=${filterParam}&set_presence=offline&timeout=0`,
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
  if (durationMs > 0 && initialSync.next_batch) {
    let since = initialSync.next_batch;
    const startMs = Date.now();
    const endMs = startMs + durationMs;
    while (Date.now() < endMs) {
      const timeout = Math.max(100, Math.min(15_000, endMs - Date.now()));
      const res = await matrixGet(
        homeserver,
        token,
        `/_matrix/client/v3/sync?filter=${filterParam}&set_presence=offline` +
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

  const snapshot = { initialSync, rooms: roomsCapture };
  const blobIndex = {};
  for (const ref of extractMxcReferences(snapshot, liveEntries).slice(0, maxBlobs)) {
    const encS = encodeURIComponent(ref.server);
    const encM = encodeURIComponent(ref.mediaId);
    let dl;
    try {
      dl = await matrixGet(homeserver, token, `/_matrix/client/v1/media/download/${encS}/${encM}`, {
        binary: true,
        maxBytes: maxBlobBytes,
        fetchFn,
      });
    } catch (err) {
      if (err?.code === 'BLOB_TOO_LARGE') continue;
      try {
        dl = await matrixGet(homeserver, token, `/_matrix/media/v3/download/${encS}/${encM}`, {
          binary: true,
          maxBytes: maxBlobBytes,
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
        (a, b) => (roomsCapture[b]?.threads?.length ?? 0) - (roomsCapture[a]?.threads?.length ?? 0)
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
    durationMs: durationMs || 60_000,
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
