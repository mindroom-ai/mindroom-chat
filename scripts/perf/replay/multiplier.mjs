// Pure, deterministic K× thread & R× room time-offset replay multiplier for MindRoom/Matrix.
import crypto from 'node:crypto';

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isEventId = (v) => typeof v === 'string' && v.startsWith('$');
const isRoomId = (v) => typeof v === 'string' && v.startsWith('!');

const STRUCTURAL_STATE_TYPES = new Set([
  'm.room.create',
  'm.room.name',
  'm.room.topic',
  'm.room.avatar',
  'm.room.join_rules',
  'm.room.history_visibility',
  'm.room.guest_access',
  'm.room.power_levels',
  'm.room.canonical_alias',
  'm.room.member',
  'm.room.encryption',
  'm.room.server_acl',
  'm.space.parent',
  'm.space.child',
  'io.mindroom.router',
  'io.mindroom.accounts',
]);

/** Map a room ID for room copy `r` (preserving homeserver domain). */
export function mapRoomId(roomId, r) {
  if (!isRoomId(roomId) || r === 0) return roomId;
  const colon = roomId.indexOf(':');
  return colon > 0 ? `${roomId.slice(0, colon)}__r${r}${roomId.slice(colon)}` : `${roomId}__r${r}`;
}

/** Deterministic suffix for `(r, k, gen)`. Copy `(0, 0)` without gen returns empty string. */
function copyTag(r, k, gen = null) {
  if (gen !== null) return r === 0 && k === 0 && gen === 0 ? '' : `__r${r}_k${k}_g${gen}`;
  return r === 0 && k === 0 ? '' : `__r${r}_k${k}`;
}

/** Map a Matrix event ID deterministically for `(r, k, gen)` using `liveCreatedIds`. */
export function mapEventId(id, r, k, gen, liveCreatedIds) {
  if (!isEventId(id)) return id;
  const tag = liveCreatedIds?.has(id) ? copyTag(r, k, gen) : copyTag(r, k, null);
  return tag ? `${id}${tag}` : id;
}

/** Staggered phase offset in ms for copy `k` of `K` over `durationMs`. */
export const copyOffsetMs = (k, K, durationMs) => Math.floor((k / Math.max(1, K)) * durationMs);

function shiftIsoTimestamp(value, deltaMs) {
  if (typeof value !== 'string' || !value) return value;
  const iso = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;
  const norm = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso;
  const parsed = Date.parse(norm);
  return Number.isFinite(parsed) ? new Date(parsed + deltaMs).toISOString() : value;
}

function makeLiveDocs(raw = {}) {
  return {
    md: typeof raw.md === 'string' ? raw.md : '',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    tools: Array.isArray(raw.tools) ? [...raw.tools] : [],
    status: raw.status === 'pending' || raw.status === 'streaming' ? raw.status : 'streaming',
    activity: typeof raw.activity === 'string' ? raw.activity : '',
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    ...(Array.isArray(raw.compactions) ? { compactions: raw.compactions } : {}),
  };
}

function applySpliceSafe(doc, splice) {
  if (!isRecord(splice) || typeof splice.ins !== 'string') return doc;
  const at = Math.min(Math.max(0, splice.at ?? 0), doc.length);
  const del = Math.min(Math.max(0, splice.del ?? 0), doc.length - at);
  return doc.slice(0, at) + splice.ins + doc.slice(at + del);
}

/** Apply an `io.mindroom.live` delta to materialized `LiveDocs`. */
export function applyLiveDeltaToDocs(docs, delta) {
  if (!isRecord(delta)) return docs;
  let tools = docs.tools;
  if (
    isRecord(delta.tools) &&
    Number.isSafeInteger(delta.tools.len) &&
    Array.isArray(delta.tools.set)
  ) {
    tools = docs.tools.slice(0, delta.tools.len);
    tools.length = delta.tools.len;
    for (const entry of delta.tools.set) {
      if (Array.isArray(entry) && entry.length === 2 && Number.isSafeInteger(entry[0])) {
        tools[entry[0]] = entry[1];
      }
    }
    tools = tools.map((item) => (isRecord(item) ? item : {}));
  }
  const compactions = Array.isArray(delta.compactions) ? delta.compactions : docs.compactions;
  return {
    md: delta.md ? applySpliceSafe(docs.md, delta.md) : docs.md,
    reasoning: delta.reasoning ? applySpliceSafe(docs.reasoning, delta.reasoning) : docs.reasoning,
    tools,
    status: delta.status ?? docs.status,
    activity: delta.activity ?? docs.activity,
    segments: Array.isArray(delta.segments) ? delta.segments : docs.segments,
    ...(compactions ? { compactions } : {}),
  };
}

function remapApprovalObject(obj, mapEv, suffixId) {
  if (!isRecord(obj)) return obj;
  let next = obj;
  const set = (key, val) => {
    if (val === next[key]) return;
    if (next === obj) next = { ...obj };
    next[key] = val;
  };
  if (isEventId(obj.thread_id)) set('thread_id', mapEv(obj.thread_id));
  if (isEventId(obj.grant_card_event_id)) {
    set('grant_card_event_id', mapEv(obj.grant_card_event_id));
  }
  if (isEventId(obj.response_event_id)) set('response_event_id', mapEv(obj.response_event_id));
  if (typeof obj.background_run_id === 'string' && obj.background_run_id) {
    set('background_run_id', suffixId(obj.background_run_id));
  }
  if (isRecord(obj.approval_provenance) && isEventId(obj.approval_provenance.grant_card_event_id)) {
    set('approval_provenance', {
      ...obj.approval_provenance,
      grant_card_event_id: mapEv(obj.approval_provenance.grant_card_event_id),
    });
  }
  return next;
}

function remapScheduledFields(obj, mapEv, deltaMs) {
  if (!isRecord(obj)) return obj;
  let next = obj;
  const set = (key, val) => {
    if (val === next[key]) return;
    if (next === obj) next = { ...obj };
    next[key] = val;
  };
  if (isEventId(obj.thread_id)) set('thread_id', mapEv(obj.thread_id));
  if (isEventId(obj.source_event_id)) set('source_event_id', mapEv(obj.source_event_id));
  if (typeof obj.execute_at === 'string') {
    set('execute_at', shiftIsoTimestamp(obj.execute_at, deltaMs));
  }
  if (typeof obj.scheduled_at === 'string') {
    set('scheduled_at', shiftIsoTimestamp(obj.scheduled_at, deltaMs));
  }
  return next;
}

/** Copy-on-write content remapper preserving heavy payloads (body/tool_trace/reasoning) by ref. */
function remapContent(content, eventType, ctx) {
  if (!isRecord(content)) return content;
  const { mapEv, mapRm, suffixId, deltaMs } = ctx;
  let next = content;
  const set = (key, val) => {
    if (val === next[key]) return;
    if (next === content) next = { ...content };
    next[key] = val;
  };

  if (isRecord(content['m.relates_to'])) {
    const rel = content['m.relates_to'];
    const replyTo = rel['m.in_reply_to'];
    const newEv = isEventId(rel.event_id) ? mapEv(rel.event_id) : rel.event_id;
    const newReply =
      isRecord(replyTo) && isEventId(replyTo.event_id)
        ? { ...replyTo, event_id: mapEv(replyTo.event_id) }
        : replyTo;
    if (newEv !== rel.event_id || newReply !== replyTo) {
      set('m.relates_to', {
        ...rel,
        ...(newEv !== undefined ? { event_id: newEv } : {}),
        ...(newReply !== undefined ? { 'm.in_reply_to': newReply } : {}),
      });
    }
  }
  if (isRecord(content['m.new_content'])) {
    set('m.new_content', remapContent(content['m.new_content'], eventType, ctx));
  }
  if (isRecord(content['io.mindroom.fork'])) {
    const f = content['io.mindroom.fork'];
    const nt = isEventId(f.thread_id) ? mapEv(f.thread_id) : f.thread_id;
    const ne = isEventId(f.event_id) ? mapEv(f.event_id) : f.event_id;
    if (nt !== f.thread_id || ne !== f.event_id) {
      set('io.mindroom.fork', { ...f, thread_id: nt, event_id: ne });
    }
  }
  if (isRecord(content['io.mindroom.ui_action'])) {
    const a = content['io.mindroom.ui_action'];
    const nr = isRoomId(a.room_id) ? mapRm(a.room_id) : a.room_id;
    const nt = isEventId(a.thread_id) ? mapEv(a.thread_id) : a.thread_id;
    if (nr !== a.room_id || nt !== a.thread_id) {
      set('io.mindroom.ui_action', { ...a, room_id: nr, thread_id: nt });
    }
  }
  if (isRecord(content['io.mindroom.tool_approval'])) {
    set(
      'io.mindroom.tool_approval',
      remapApprovalObject(content['io.mindroom.tool_approval'], mapEv, suffixId)
    );
  }
  if (eventType === 'io.mindroom.tool_approval') {
    next = remapApprovalObject(next, mapEv, suffixId);
  }
  if (isEventId(content['com.mindroom.voice_source_event_id'])) {
    set('com.mindroom.voice_source_event_id', mapEv(content['com.mindroom.voice_source_event_id']));
  }
  if (eventType === 'm.room.pinned_events' && Array.isArray(content.pinned)) {
    set(
      'pinned',
      content.pinned.map((id) => mapEv(id))
    );
  }
  if (eventType === 'io.mindroom.thread_summary' && isEventId(content.event_id)) {
    set('event_id', mapEv(content.event_id));
  }
  if (eventType === 'com.mindroom.scheduled.task') {
    next = remapScheduledFields(next, mapEv, deltaMs);
    if (typeof content.workflow === 'string') {
      try {
        const parsed = JSON.parse(content.workflow);
        const remapped = remapScheduledFields(parsed, mapEv, deltaMs);
        if (remapped !== parsed) set('workflow', JSON.stringify(remapped));
      } catch (_err) {
        // Leave unparseable workflow string intact.
      }
    } else if (isRecord(content.workflow)) {
      set('workflow', remapScheduledFields(content.workflow, mapEv, deltaMs));
    }
  }
  return next;
}

function remapStateKey(event, ctx) {
  const { state_key: key, type } = event;
  if (typeof key !== 'string') return key;
  if (type === 'com.mindroom.thread.tags') {
    if (key.startsWith('[')) {
      try {
        const parsed = JSON.parse(key);
        if (Array.isArray(parsed) && parsed.length === 2 && isEventId(parsed[0])) {
          return JSON.stringify([ctx.mapEv(parsed[0]), parsed[1]]);
        }
      } catch (_err) {
        // Fall through to plain key check.
      }
    }
    return isEventId(key) ? ctx.mapEv(key) : key;
  }
  if (type === 'io.mindroom.thread_summary' && isEventId(key)) return ctx.mapEv(key);
  if (type === 'com.mindroom.scheduled.task' && key) return ctx.suffixId(key);
  return key;
}

/** Copy-on-write remapper for a full Matrix event (including bundled `unsigned.m.relations`). */
export function remapEvent(event, ctx, { stampTs } = {}) {
  if (!isRecord(event)) return event;
  const nextId = isEventId(event.event_id) ? ctx.mapEv(event.event_id) : event.event_id;
  const nextRoom = isRoomId(event.room_id) ? ctx.mapRm(event.room_id) : event.room_id;
  const nextRedacts = isEventId(event.redacts) ? ctx.mapEv(event.redacts) : event.redacts;
  const nextContent = remapContent(event.content, event.type, ctx);
  const nextStateKey = remapStateKey(event, ctx);
  const nextTs =
    stampTs !== undefined
      ? stampTs
      : typeof event.origin_server_ts === 'number'
        ? event.origin_server_ts + ctx.deltaMs
        : event.origin_server_ts;

  let nextUnsigned = event.unsigned;
  const rels = event.unsigned?.['m.relations'];
  if (isRecord(rels)) {
    let nextRels = rels;
    const setRel = (k, v) => {
      if (v === nextRels[k]) return;
      if (nextRels === rels) nextRels = { ...rels };
      nextRels[k] = v;
    };
    if (isRecord(rels['m.replace'])) setRel('m.replace', remapEvent(rels['m.replace'], ctx));
    if (isRecord(rels['m.thread'])) {
      const th = rels['m.thread'];
      const nextTh = { ...th };
      if (isRecord(th.latest_event)) nextTh.latest_event = remapEvent(th.latest_event, ctx);
      if (isRecord(th['io.mindroom.latest_reply'])) {
        nextTh['io.mindroom.latest_reply'] = remapEvent(th['io.mindroom.latest_reply'], ctx);
      }
      if (isRecord(th['io.mindroom.title'])) {
        nextTh['io.mindroom.title'] = remapEvent(th['io.mindroom.title'], ctx);
      }
      setRel('m.thread', nextTh);
    }
    if (nextRels !== rels) nextUnsigned = { ...event.unsigned, 'm.relations': nextRels };
  }

  return {
    ...event,
    ...(nextId !== undefined ? { event_id: nextId } : {}),
    ...(nextRoom !== undefined ? { room_id: nextRoom } : {}),
    ...(nextRedacts !== undefined ? { redacts: nextRedacts } : {}),
    ...(nextStateKey !== undefined ? { state_key: nextStateKey } : {}),
    ...(nextTs !== undefined ? { origin_server_ts: nextTs } : {}),
    content: nextContent,
    ...(nextUnsigned !== undefined ? { unsigned: nextUnsigned } : {}),
  };
}

function collectEventIdsFromSnapshot(snapshot) {
  const ids = new Set();
  const add = (ev) => {
    if (isRecord(ev) && isEventId(ev.event_id)) ids.add(ev.event_id);
  };
  for (const r of Object.values(snapshot?.initialSync?.rooms?.join ?? {})) {
    for (const ev of r?.state?.events ?? []) add(ev);
    for (const ev of r?.timeline?.events ?? []) add(ev);
  }
  for (const r of Object.values(snapshot?.rooms ?? {})) {
    for (const ev of [...(r?.threads ?? []), ...(r?.messagesTail ?? []), ...(r?.members ?? [])]) {
      add(ev);
    }
    for (const list of Object.values(r?.threadRelations ?? {})) {
      for (const ev of list ?? []) add(ev);
    }
  }
  return ids;
}

function collectLiveCreatedIds(liveEntries, snapshotIds) {
  const ids = new Set();
  const add = (ev) => {
    if (isRecord(ev) && isEventId(ev.event_id) && !snapshotIds.has(ev.event_id)) {
      ids.add(ev.event_id);
    }
  };
  for (const entry of liveEntries) {
    for (const r of Object.values(entry?.response?.rooms?.join ?? {})) {
      for (const ev of r?.state?.events ?? []) add(ev);
      for (const ev of r?.timeline?.events ?? []) add(ev);
    }
  }
  return ids;
}

function maxSnapshotTimestamp(snapshot, manifest) {
  let maxTs = typeof manifest?.capturedAtMs === 'number' ? manifest.capturedAtMs : 0;
  const check = (ev) => {
    if (typeof ev?.origin_server_ts === 'number' && ev.origin_server_ts > maxTs) {
      maxTs = ev.origin_server_ts;
    }
  };
  for (const r of Object.values(snapshot?.initialSync?.rooms?.join ?? {})) {
    for (const ev of r?.state?.events ?? []) check(ev);
    for (const ev of r?.timeline?.events ?? []) check(ev);
  }
  for (const r of Object.values(snapshot?.rooms ?? {})) {
    for (const ev of [...(r?.threads ?? []), ...(r?.messagesTail ?? [])]) check(ev);
  }
  return maxTs || Date.now();
}

/**
 * Create a deterministic replay & K×/R× multiplier engine from a loaded capture bundle.
 *
 * Returns `{ meta, initialState, advance(elapsedMs, nowMs), refreshActiveRuns(nowMs) }`.
 */
export function createReplayMultiplier(bundle, options = {}) {
  const manifest = bundle.manifest ?? {};
  const snapshot = bundle.snapshot ?? { initialSync: { rooms: { join: {} } }, rooms: {} };
  const liveEntries = [...(bundle.liveEntries ?? [])].sort(
    (a, b) => (a.tauMs ?? 0) - (b.tauMs ?? 0)
  );

  const rawK = Number(options.multiplyThreads ?? 1);
  const rawR = Number(options.multiplyRooms ?? 1);
  const rawSpeed = Number(options.speed ?? 1);
  const K = Number.isFinite(rawK) ? Math.max(1, Math.floor(rawK)) : 1;
  const R = Number.isFinite(rawR) ? Math.max(1, Math.floor(rawR)) : 1;
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.01, rawSpeed) : 1;
  const startNowMs = options.startNowMs ?? Date.now();
  const maxTau = liveEntries.length ? liveEntries[liveEntries.length - 1].tauMs : 0;
  const durationMs = Math.max(1_000, manifest.durationMs || 60_000, maxTau + 1);
  const captureBaseTs = maxSnapshotTimestamp(snapshot, manifest);
  const snapshotDeltaMs = startNowMs - captureBaseTs;

  const joined = snapshot.initialSync?.rooms?.join ?? {};
  const origRoomIds = Object.keys(joined);
  const primaryOrigRoomId = options.targetRoomId || manifest.primaryRoomId || origRoomIds[0] || '';
  const isSpaceRoom = (id) =>
    (joined[id]?.state?.events ?? []).some(
      (e) => e.type === 'm.room.create' && e.content?.type === 'm.space'
    );
  const cloneableNonSpace = new Set(origRoomIds.filter((id) => !isSpaceRoom(id)));

  const snapshotIds = collectEventIdsFromSnapshot(snapshot);
  const liveCreatedIds = collectLiveCreatedIds(liveEntries, snapshotIds);

  let syntheticSeq = 0;
  const nextSynthId = (prefix) => `$replay_${prefix}_${(syntheticSeq += 1)}`;
  const lastSidByTarget = new Map();
  const mintSid = (targetKey, nowMs) => {
    const prev = lastSidByTarget.get(targetKey) ?? 0;
    const ms = Math.max(1_000_000_000_000, prev + 1, Math.floor(nowMs));
    lastSidByTarget.set(targetKey, ms);
    const hex = crypto.createHash('sha256').update(`${targetKey}:${ms}`).digest('hex').slice(0, 8);
    return `${String(ms).padStart(13, '0').slice(0, 13)}-${hex}`;
  };

  // Merged agent-keyed room state: Map<remappedRoomId, Map<agentId, Map<copyKey, contribution>>>
  const jobsState = new Map();
  const activeRunsState = new Map();
  const pinnedByRoom = new Map();
  // Materialized live/subagent streams: Map<streamKey, { sid, seq, docs, emittedSnapshot }>
  const liveStreams = new Map();
  const subagentStreams = new Map();

  const makeCtx = (r, k, gen, deltaMs) => ({
    r,
    k,
    gen,
    deltaMs,
    mapEv: (id) => mapEventId(id, r, k, gen, liveCreatedIds),
    mapRm: (id) => mapRoomId(id, r),
    suffixId: (id) => {
      const tag = copyTag(r, k, gen > 0 ? gen : null);
      return tag ? `${id}${tag}` : id;
    },
  });

  function updateJobsState(roomId, agentId, copyKey, event, ctx, nowMs) {
    let byAgent = jobsState.get(roomId);
    if (!byAgent) jobsState.set(roomId, (byAgent = new Map()));
    let byCopy = byAgent.get(agentId);
    if (!byCopy) byAgent.set(agentId, (byCopy = new Map()));

    const rawJobs = Array.isArray(event.content?.jobs) ? event.content.jobs : [];
    const jobs = rawJobs.filter(isRecord).map((job) => ({
      ...job,
      job_id: typeof job.job_id === 'string' ? ctx.suffixId(job.job_id) : job.job_id,
      thread_id: isEventId(job.thread_id) ? ctx.mapEv(job.thread_id) : (job.thread_id ?? null),
      ...(typeof job.run === 'string' ? { run: ctx.suffixId(job.run) } : {}),
      ...(typeof job.subagent === 'string' ? { subagent: ctx.suffixId(job.subagent) } : {}),
      ...(typeof job.started_at === 'string'
        ? { started_at: shiftIsoTimestamp(job.started_at, ctx.deltaMs) }
        : {}),
    }));
    const stated = event.content?.total;
    const unlisted =
      Number.isSafeInteger(stated) && stated >= jobs.length ? stated - jobs.length : 0;
    byCopy.set(copyKey, { jobs, unlisted });

    const mergedMap = new Map();
    let extraTotal = 0;
    for (const contrib of byCopy.values()) {
      extraTotal += contrib.unlisted;
      for (const j of contrib.jobs) mergedMap.set(j.job_id, j);
    }
    const mergedJobs = [...mergedMap.values()].sort(
      (a, b) =>
        String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')) ||
        String(a.job_id ?? '').localeCompare(String(b.job_id ?? ''))
    );
    return {
      type: 'io.mindroom.background_jobs',
      event_id: nextSynthId('jobs'),
      room_id: roomId,
      sender: agentId,
      state_key: agentId,
      origin_server_ts: nowMs,
      content: { jobs: mergedJobs, total: mergedJobs.length + extraTotal },
    };
  }

  function buildMergedActiveRunsEvent(roomId, agentId, byCopy, nowMs) {
    const byThread = new Map();
    let ttlMs = 180_000;
    for (const contrib of byCopy.values()) {
      if (contrib.ttlMs > ttlMs) ttlMs = contrib.ttlMs;
      for (const entry of contrib.threads) {
        byThread.set(entry.thread_id ?? '__main__', entry);
      }
    }
    return {
      type: 'io.mindroom.active_runs',
      event_id: nextSynthId('ar'),
      room_id: roomId,
      sender: agentId,
      state_key: agentId,
      origin_server_ts: nowMs,
      content: {
        version: 1,
        updated_at: nowMs,
        ttl_ms: ttlMs,
        threads: [...byThread.values()],
      },
    };
  }

  function updateActiveRunsState(roomId, agentId, copyKey, event, ctx, nowMs) {
    let byAgent = activeRunsState.get(roomId);
    if (!byAgent) activeRunsState.set(roomId, (byAgent = new Map()));
    let byCopy = byAgent.get(agentId);
    if (!byCopy) byAgent.set(agentId, (byCopy = new Map()));

    const rawThreads = Array.isArray(event.content?.threads) ? event.content.threads : [];
    const threads = rawThreads.filter(isRecord).map((entry) => ({
      ...entry,
      thread_id: isEventId(entry.thread_id)
        ? ctx.mapEv(entry.thread_id)
        : (entry.thread_id ?? null),
    }));
    const rawTtl = event.content?.ttl_ms;
    const ttlMs = typeof rawTtl === 'number' && Number.isFinite(rawTtl) ? rawTtl : 180_000;
    byCopy.set(copyKey, { threads, ttlMs });
    return buildMergedActiveRunsEvent(roomId, agentId, byCopy, nowMs);
  }

  function processLiveFrame(roomId, ev, ctx, nowMs) {
    const c = ev.content;
    if (!isRecord(c) || c.v !== 1 || typeof c.reply !== 'string') return null;
    const reply = ctx.mapEv(c.reply);
    const key = `${roomId}:${ctx.r}:${ctx.k}:${ctx.gen}:${reply}`;
    let state = liveStreams.get(key);
    if (!state) {
      state = {
        sid: mintSid(`${roomId}:${reply}`, nowMs),
        seq: 0,
        docs: makeLiveDocs(),
        emitted: false,
      };
      liveStreams.set(key, state);
    }
    const isSourceSnapshot = isRecord(c.snapshot);
    const prevDocs = state.docs;
    const spliceFits = (doc, s) =>
      !s || (s.at + s.del <= doc.length && doc.length - s.del + s.ins.length === s.len);
    const deltaFits =
      !isSourceSnapshot &&
      isRecord(c.delta) &&
      spliceFits(prevDocs.md, c.delta.md) &&
      spliceFits(prevDocs.reasoning, c.delta.reasoning);
    state.docs = isSourceSnapshot
      ? makeLiveDocs(c.snapshot)
      : applyLiveDeltaToDocs(prevDocs, c.delta);

    const sendSnapshot = !state.emitted || isSourceSnapshot || !deltaFits;
    const seq = state.seq;
    state.seq += 1;
    state.emitted = true;
    return {
      type: 'io.mindroom.live',
      sender: ev.sender,
      origin_server_ts: nowMs,
      content: sendSnapshot
        ? { v: 1, reply, sid: state.sid, seq, snapshot: state.docs }
        : { v: 1, reply, sid: state.sid, seq, delta: c.delta },
    };
  }

  function processSubagentFrame(roomId, ev, ctx, nowMs) {
    const c = ev.content;
    if (!isRecord(c) || c.v !== 1 || typeof c.run !== 'string' || !isRecord(c.meta)) return null;
    const run = ctx.suffixId(c.run);
    const key = `${roomId}:${ctx.r}:${ctx.k}:${ctx.gen}:${run}`;
    let state = subagentStreams.get(key);
    if (!state) {
      state = {
        sid: mintSid(`sub:${roomId}:${run}`, nowMs),
        seq: 0,
        docs: makeLiveDocs(),
        emitted: false,
      };
      subagentStreams.set(key, state);
    }
    const deltaSec = ctx.deltaMs / 1000;
    const shiftToolTs = (tool) =>
      isRecord(tool) && typeof tool.started_at === 'number'
        ? { ...tool, started_at: tool.started_at + deltaSec }
        : tool;
    const rawMeta = c.meta;
    const meta = {
      ...rawMeta,
      subagent: typeof rawMeta.subagent === 'string' ? ctx.suffixId(rawMeta.subagent) : run,
      root: typeof rawMeta.root === 'string' ? ctx.suffixId(rawMeta.root) : rawMeta.root,
      parent: typeof rawMeta.parent === 'string' ? ctx.suffixId(rawMeta.parent) : rawMeta.parent,
      thread_id: isEventId(rawMeta.thread_id) ? ctx.mapEv(rawMeta.thread_id) : rawMeta.thread_id,
      started_at:
        typeof rawMeta.started_at === 'number' ? rawMeta.started_at + deltaSec : rawMeta.started_at,
      ended_at:
        typeof rawMeta.ended_at === 'number' ? rawMeta.ended_at + deltaSec : rawMeta.ended_at,
    };
    const isSourceSnapshot = isRecord(c.snapshot);
    let outDelta = c.delta;
    if (isSourceSnapshot) {
      const snap = makeLiveDocs(c.snapshot);
      state.docs = { ...snap, tools: snap.tools.map(shiftToolTs) };
    } else if (isRecord(c.delta)) {
      const shiftedDelta = isRecord(c.delta.tools)
        ? {
            ...c.delta,
            tools: {
              ...c.delta.tools,
              set: (c.delta.tools.set ?? []).map(([i, t]) => [i, shiftToolTs(t)]),
            },
          }
        : c.delta;
      outDelta = shiftedDelta;
      state.docs = applyLiveDeltaToDocs(state.docs, shiftedDelta);
    }
    const sendSnapshot = !state.emitted || isSourceSnapshot;
    const seq = state.seq;
    state.seq += 1;
    state.emitted = true;
    return {
      type: 'io.mindroom.subagents',
      sender: ev.sender,
      origin_server_ts: nowMs,
      content: sendSnapshot
        ? { v: 1, run, sid: state.sid, seq, meta, snapshot: state.docs }
        : { v: 1, run, sid: state.sid, seq, meta, delta: outDelta },
    };
  }

  function remapReceipt(ev, ctx, nowMs) {
    if (!isRecord(ev.content)) return ev;
    const out = {};
    for (const [evId, types] of Object.entries(ev.content)) {
      const mappedEvId = isEventId(evId) ? ctx.mapEv(evId) : evId;
      if (!isRecord(types)) {
        out[mappedEvId] = types;
        continue;
      }
      const nextTypes = {};
      for (const [rType, users] of Object.entries(types)) {
        if (!isRecord(users)) {
          nextTypes[rType] = users;
          continue;
        }
        const nextUsers = {};
        for (const [uId, data] of Object.entries(users)) {
          if (!isRecord(data)) {
            nextUsers[uId] = data;
            continue;
          }
          const th = data.thread_id;
          nextUsers[uId] = {
            ...data,
            ...(typeof data.ts === 'number' ? { ts: Math.min(nowMs, data.ts + ctx.deltaMs) } : {}),
            ...(th !== undefined ? { thread_id: th === 'main' ? 'main' : ctx.mapEv(th) } : {}),
          };
        }
        nextTypes[rType] = nextUsers;
      }
      out[mappedEvId] = nextTypes;
    }
    return { ...ev, content: out };
  }

  function transformStateEvent(roomId, ev, ctx, copyKey, { nowMs, stampTs, isSpace }) {
    if (ctx.k > 0 && STRUCTURAL_STATE_TYPES.has(ev.type)) return [];
    if (ev.type === 'io.mindroom.background_jobs' && ev.state_key) {
      return [updateJobsState(roomId, ev.state_key, copyKey, ev, ctx, nowMs)];
    }
    if (ev.type === 'io.mindroom.active_runs' && ev.state_key) {
      return [updateActiveRunsState(roomId, ev.state_key, copyKey, ev, ctx, nowMs)];
    }
    const tsOpts = stampTs !== undefined ? { stampTs } : undefined;
    if (ev.type === 'm.room.pinned_events') {
      let byCopy = pinnedByRoom.get(roomId);
      if (!byCopy) pinnedByRoom.set(roomId, (byCopy = new Map()));
      const current = Array.isArray(ev.content?.pinned)
        ? ev.content.pinned.filter((id) => typeof id === 'string').map((id) => ctx.mapEv(id))
        : [];
      byCopy.set(copyKey, current);
      const merged = [];
      const seen = new Set();
      for (const list of byCopy.values()) {
        for (const id of list) {
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(id);
          }
        }
      }
      return [{ ...remapEvent(ev, ctx, tsOpts), content: { pinned: merged } }];
    }
    let remapped = remapEvent(ev, ctx, tsOpts);
    if (ev.type === 'm.room.name' && ctx.r > 0 && typeof remapped.content?.name === 'string') {
      remapped = {
        ...remapped,
        content: { ...remapped.content, name: `${remapped.content.name} (Copy ${ctx.r + 1})` },
      };
    }
    const out = [remapped];
    if (isSpace && ev.type === 'm.space.child' && cloneableNonSpace.has(ev.state_key)) {
      for (let cr = 1; cr < R; cr += 1) {
        out.push({
          ...remapped,
          event_id: `${remapped.event_id}__sc${cr}`,
          state_key: mapRoomId(ev.state_key, cr),
        });
      }
    }
    return out;
  }

  function remapEphemeralEvent(roomId, ev, ctx, nowMs) {
    if (!isRecord(ev)) return null;
    if (ev.type === 'io.mindroom.live') return processLiveFrame(roomId, ev, ctx, nowMs);
    if (ev.type === 'io.mindroom.subagents') return processSubagentFrame(roomId, ev, ctx, nowMs);
    if (ev.type === 'm.receipt') return remapReceipt(ev, ctx, nowMs);
    return ctx.k === 0 ? ev : null;
  }

  function remapGlobalAccountDataEvent(acc, gen) {
    if (!isRecord(acc)) return acc;
    if (acc.type === 'io.mindroom.pinned_canvases' && Array.isArray(acc.content?.canvases)) {
      const canvases = [];
      const seen = new Set();
      for (const pin of acc.content.canvases) {
        if (!isRecord(pin)) continue;
        const isPrimary = pin.room_id === primaryOrigRoomId;
        const rMax = cloneableNonSpace.has(pin.room_id) ? R : 1;
        const kMax = isPrimary ? K : 1;
        for (let r = 0; r < rMax; r += 1) {
          for (let k = 0; k < kMax; k += 1) {
            const room_id = mapRoomId(pin.room_id, r);
            const event_id = mapEventId(pin.event_id, r, k, gen, liveCreatedIds);
            const key = `${room_id}:${event_id}`;
            if (!seen.has(key)) {
              seen.add(key);
              canvases.push({ ...pin, room_id, event_id });
            }
          }
        }
      }
      return { ...acc, content: { ...acc.content, canvases } };
    }
    return acc;
  }

  function applyLiveResponse(response, r, k, gen, nowMs) {
    const outRooms = {};
    const outAccountData = [];
    const deltaMs = nowMs - captureBaseTs;
    const ctx = makeCtx(r, k, gen, deltaMs);
    const copyKey = `${r}:${k}`;
    const join = response?.rooms?.join ?? {};

    for (const [origRoomId, roomData] of Object.entries(join)) {
      const isPrimary = origRoomId === primaryOrigRoomId;
      if (k > 0 && !isPrimary) continue;
      if (r > 0 && isSpaceRoom(origRoomId)) continue;
      const roomId = mapRoomId(origRoomId, r);
      const isSpace = isSpaceRoom(origRoomId);
      const stateEvents = [];
      const timelineEvents = [];
      const ephemeralEvents = [];

      for (const ev of roomData?.state?.events ?? []) {
        stateEvents.push(
          ...transformStateEvent(roomId, ev, ctx, copyKey, { nowMs, stampTs: nowMs, isSpace })
        );
      }
      for (const ev of roomData?.timeline?.events ?? []) {
        if (typeof ev?.state_key === 'string') {
          timelineEvents.push(
            ...transformStateEvent(roomId, ev, ctx, copyKey, { nowMs, stampTs: nowMs, isSpace })
          );
        } else {
          timelineEvents.push(remapEvent(ev, ctx, { stampTs: nowMs }));
        }
      }
      for (const ev of roomData?.ephemeral?.events ?? []) {
        const out = remapEphemeralEvent(roomId, ev, ctx, nowMs);
        if (out) ephemeralEvents.push(out);
      }
      if (stateEvents.length || timelineEvents.length || ephemeralEvents.length) {
        outRooms[roomId] = { stateEvents, timelineEvents, ephemeralEvents };
      }
    }
    if (r === 0 && k === 0) {
      for (const acc of response?.account_data?.events ?? []) {
        if (isRecord(acc) && typeof acc.type === 'string') {
          outAccountData.push(remapGlobalAccountDataEvent(acc, gen));
        }
      }
    }
    return { rooms: outRooms, accountData: outAccountData };
  }

  // Build initial state across R room copies and K thread copies (inside primary room).
  const initialRooms = {};
  const globalAccountData = [];

  for (const origRoomId of origRoomIds) {
    const roomSync = joined[origRoomId];
    const roomExtra = snapshot.rooms?.[origRoomId] ?? {};
    const space = isSpaceRoom(origRoomId);
    const roomCopies = space ? 1 : R;
    const threadCopies = origRoomId === primaryOrigRoomId ? K : 1;

    for (let r = 0; r < roomCopies; r += 1) {
      const roomId = mapRoomId(origRoomId, r);
      const stateByKey = new Map();
      const timeline = [];
      const threads = [];
      const threadRelations = {};
      const messagesTail = [];
      const members = [];
      const initialEphemeral = [];

      const putState = (ev) => stateByKey.set(`${ev.type}\0${ev.state_key ?? ''}`, ev);
      const ctxByK = Array.from({ length: threadCopies }, (_, k) =>
        makeCtx(r, k, 0, snapshotDeltaMs)
      );

      for (let k = 0; k < threadCopies; k += 1) {
        const ctx = ctxByK[k];
        const copyKey = `${r}:${k}`;

        for (const ev of roomSync?.state?.events ?? []) {
          for (const stEv of transformStateEvent(roomId, ev, ctx, copyKey, {
            nowMs: startNowMs,
            isSpace: space,
          })) {
            putState(stEv);
          }
        }
        for (const ev of roomSync?.ephemeral?.events ?? []) {
          const out = remapEphemeralEvent(roomId, ev, ctx, startNowMs);
          if (out) initialEphemeral.push(out);
        }
        for (const ev of roomExtra.threads ?? []) threads.push(remapEvent(ev, ctx));
        for (const [rootId, rels] of Object.entries(roomExtra.threadRelations ?? {})) {
          threadRelations[ctx.mapEv(rootId)] = rels.map((ev) => remapEvent(ev, ctx));
        }
        if (k === 0) {
          for (const ev of roomExtra.members ?? []) members.push(remapEvent(ev, ctx));
        }
      }

      // Chronologically interleave K copies of initialSync.timeline.events
      // (origin_server_ts ascending, tiebreaking by original index then copy index).
      const rawInitialTimeline = roomSync?.timeline?.events ?? [];
      const timelineEntries = [];
      for (let origIdx = 0; origIdx < rawInitialTimeline.length; origIdx += 1) {
        const ev = rawInitialTimeline[origIdx];
        const ts = typeof ev?.origin_server_ts === 'number' ? ev.origin_server_ts : 0;
        for (let k = 0; k < threadCopies; k += 1) {
          timelineEntries.push({ ev, ts, origIdx, k });
        }
      }
      timelineEntries.sort((a, b) => a.ts - b.ts || a.origIdx - b.origIdx || a.k - b.k);
      for (const { ev, k } of timelineEntries) {
        const ctx = ctxByK[k];
        if (typeof ev?.state_key === 'string') {
          for (const stEv of transformStateEvent(roomId, ev, ctx, `${r}:${k}`, {
            nowMs: startNowMs,
            isSpace: space,
          })) {
            putState(stEv);
            timeline.push(stEv);
          }
        } else {
          timeline.push(remapEvent(ev, ctx));
        }
      }

      // Chronologically interleave K copies of messagesTail (newest-first per /messages?dir=b).
      const rawTailChrono = [...(roomExtra.messagesTail ?? [])].reverse();
      const tailEntries = [];
      for (let origIdx = 0; origIdx < rawTailChrono.length; origIdx += 1) {
        const ev = rawTailChrono[origIdx];
        const ts = typeof ev?.origin_server_ts === 'number' ? ev.origin_server_ts : 0;
        for (let k = 0; k < threadCopies; k += 1) {
          tailEntries.push({ ev, ts, origIdx, k });
        }
      }
      tailEntries.sort((a, b) => a.ts - b.ts || a.origIdx - b.origIdx || a.k - b.k);
      const tailChrono = [];
      for (const { ev, k } of tailEntries) {
        if (typeof ev?.state_key === 'string' && k > 0 && STRUCTURAL_STATE_TYPES.has(ev.type)) {
          continue;
        }
        tailChrono.push(remapEvent(ev, ctxByK[k]));
      }
      messagesTail.push(...tailChrono.reverse());

      initialRooms[roomId] = {
        roomId,
        origRoomId,
        state: [...stateByKey.values()],
        timeline,
        threads,
        threadRelations,
        messagesTail,
        members,
        initialEphemeral,
        accountData: roomSync?.account_data?.events ?? [],
        unreadNotifications: roomSync?.unread_notifications ?? {
          highlight_count: 0,
          notification_count: 0,
        },
        unreadThreadNotifications: roomSync?.unread_thread_notifications ?? {},
      };
    }
  }

  for (const acc of snapshot.initialSync?.account_data?.events ?? []) {
    globalAccountData.push(remapGlobalAccountDataEvent(acc, 0));
  }

  // Ordered warmup deltas for staggered copies (k > 0) during [0, offset_k],
  // including live/subagent ephemeral frames so the server ingests them through the live path.
  const warmupJobs = [];
  for (let r = 0; r < R; r += 1) {
    for (let k = 1; k < K; k += 1) {
      const offsetMs = copyOffsetMs(k, K, durationMs);
      for (let idx = 0; idx < liveEntries.length; idx += 1) {
        const entry = liveEntries[idx];
        if (entry.tauMs > offsetMs) break;
        warmupJobs.push({ relMs: entry.tauMs - offsetMs, r, k, idx, entry });
      }
    }
  }
  warmupJobs.sort((a, b) => a.relMs - b.relMs || a.r - b.r || a.k - b.k || a.idx - b.idx);
  const warmupDeltas = [];
  for (const { r, k, entry } of warmupJobs) {
    const delta = applyLiveResponse(entry.response, r, k, 0, startNowMs);
    if (Object.keys(delta.rooms).length || delta.accountData.length) {
      warmupDeltas.push(delta);
    }
  }

  // Cursors per `(r, k)` tracking the last virtualMs already dispatched.
  const cursors = [];
  for (let r = 0; r < R; r += 1) {
    for (let k = 0; k < K; k += 1) {
      cursors.push({ r, k, virtualMs: copyOffsetMs(k, K, durationMs), started: k > 0 });
    }
  }

  /** Advance replay to `elapsedMs` (relative to start) and return merged room & account-data deltas. */
  function advance(elapsedMs, nowMs = startNowMs + elapsedMs) {
    const rooms = {};
    const accountData = [];
    const addRoom = (roomId, delta) => {
      let dest = rooms[roomId];
      if (!dest) {
        dest = { stateEvents: [], timelineEvents: [], ephemeralEvents: [] };
        rooms[roomId] = dest;
      }
      dest.stateEvents.push(...delta.stateEvents);
      dest.timelineEvents.push(...delta.timelineEvents);
      dest.ephemeralEvents.push(...delta.ephemeralEvents);
    };

    if (liveEntries.length === 0) return { rooms, accountData };
    for (const cursor of cursors) {
      const targetVirtual = Math.max(
        cursor.virtualMs,
        elapsedMs * speed + copyOffsetMs(cursor.k, K, durationMs)
      );
      if (cursor.started && targetVirtual <= cursor.virtualMs) continue;
      const startGen = Math.floor(cursor.virtualMs / durationMs);
      const endGen = Math.floor(targetVirtual / durationMs);

      for (let gen = startGen; gen <= endGen; gen += 1) {
        const genStart = gen * durationMs;
        const lo = gen === startGen ? (cursor.started ? cursor.virtualMs - genStart : -1) : -1;
        const hi = gen === endGen ? targetVirtual - genStart : durationMs;
        for (const entry of liveEntries) {
          if (entry.tauMs > lo && entry.tauMs <= hi) {
            const delta = applyLiveResponse(entry.response, cursor.r, cursor.k, gen, nowMs);
            for (const [roomId, roomDelta] of Object.entries(delta.rooms)) {
              addRoom(roomId, roomDelta);
            }
            if (delta.accountData.length) accountData.push(...delta.accountData);
          }
        }
      }
      cursor.virtualMs = targetVirtual;
      cursor.started = true;
    }
    return { rooms, accountData };
  }

  /** Re-stamp all active `io.mindroom.active_runs` state events to `nowMs` so TTL never expires. */
  function refreshActiveRuns(nowMs = Date.now()) {
    const out = {};
    for (const [roomId, byAgent] of activeRunsState.entries()) {
      const stateEvents = [];
      for (const [agentId, byCopy] of byAgent.entries()) {
        const ev = buildMergedActiveRunsEvent(roomId, agentId, byCopy, nowMs);
        if (ev.content.threads.length > 0) stateEvents.push(ev);
      }
      if (stateEvents.length) {
        out[roomId] = { stateEvents, timelineEvents: [], ephemeralEvents: [] };
      }
    }
    return out;
  }

  return {
    meta: {
      userId: manifest.userId || '@replay:localhost',
      viewerDomain: manifest.viewerDomain || 'localhost',
      primaryRoomId: primaryOrigRoomId,
      primaryRoomName: manifest.primaryRoomName || primaryOrigRoomId,
      multiplyThreads: K,
      multiplyRooms: R,
      speed,
      durationMs,
    },
    initialState: { rooms: initialRooms, accountData: globalAccountData, warmupDeltas },
    advance,
    refreshActiveRuns,
  };
}
