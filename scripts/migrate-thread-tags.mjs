// @ts-check
// Migrates a room's legacy thread tags (one `com.mindroom.thread.tags` state event per thread,
// state key = thread root, content `{ tags: { <tag>: metadata } }`) to the canonical per-tag
// format (state key `["<root>","<tag>"]`, content = metadata), then tombstones the legacy
// event. The parsing and attribution rules match src/app/event-store/threads/threadTags.ts: a tag
// names its sender unless the sender is the person it names or a MindRoom agent (a `mindroom_`
// account) on the viewer's homeserver. The migration writes as the account it runs as, so it
// refuses to write when the tags that the members of any joined homeserver see would change.
//
// Usage: MATRIX_HOMESERVER=... MATRIX_ACCESS_TOKEN=... node scripts/migrate-thread-tags.mjs <room id> [--apply]
// Use the access token of a MindRoom agent on the room's homeserver, so the tags keep their names.
import { pathToFileURL } from 'node:url';

export const THREAD_TAGS_EVENT = 'com.mindroom.thread.tags';
const TAG_NAME = /^[a-z0-9-]{1,50}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** @typedef {{ set_by: string; set_at: string; note?: string; data?: Record<string, unknown> }} TagMetadata */
/** @typedef {{ type?: string; state_key?: string; sender?: string; content?: unknown }} RawStateEvent */
/** @typedef {{ sender?: string; content: unknown }} TagState */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value */
const nonEmpty = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** @param {unknown} value */
const tagName = (value) => {
  const name = nonEmpty(value)?.toLowerCase();
  return name && TAG_NAME.test(name) ? name : undefined;
};

/** @param {unknown} value */
const setAt = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return typeof value === 'string' && ISO_8601.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
};

/**
 * @param {unknown} value
 * @returns {TagMetadata | undefined}
 */
const tagMetadata = (value) => {
  if (!isRecord(value)) return undefined;
  const by = nonEmpty(value.set_by);
  const at = setAt(value.set_at);
  if (!by || !at) return undefined;
  if (value.note != null && typeof value.note !== 'string') return undefined;
  if (value.data != null && !isRecord(value.data)) return undefined;
  const note = typeof value.note === 'string' && value.note.trim() ? value.note.trim() : undefined;
  return {
    set_by: by,
    set_at: at,
    ...(note ? { note } : {}),
    ...(isRecord(value.data) ? { data: { ...value.data } } : {}),
  };
};

/** @param {string} stateKey */
const parsePerTagStateKey = (stateKey) => {
  try {
    const parsed = JSON.parse(stateKey);
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const root = nonEmpty(parsed[0]);
    const tag = tagName(parsed[1]);
    return root && root.startsWith('$') && tag ? { threadRootId: root, tagName: tag } : undefined;
  } catch {
    return undefined;
  }
};

/** @param {string} threadRootId @param {string} tag */
export const perTagStateKey = (threadRootId, tag) => JSON.stringify([threadRootId, tag]);

/** @param {string} userId */
const serverOf = (userId) => userId.slice(userId.indexOf(':') + 1);

/**
 * The merged tags per thread, as the client shows them to a viewer on `server`: legacy tags,
 * minus per-tag tombstones, plus per-tag records, each naming its sender unless the sender is a
 * MindRoom agent on that homeserver; a state event without a sender counts for nothing.
 * @param {Map<string, TagState>} stateByKey
 * @param {string} server
 * @returns {Map<string, { tags: Record<string, TagMetadata> }>}
 */
const aggregate = (stateByKey, server) => {
  /** @type {Map<string, Record<string, TagMetadata>>} */
  const legacy = new Map();
  /** @type {Map<string, Record<string, TagMetadata>>} */
  const records = new Map();
  /** @type {Map<string, Set<string>>} */
  const tombstones = new Map();

  stateByKey.forEach(({ sender, content }, stateKey) => {
    if (!sender) return;
    const agent =
      sender.slice(1).toLowerCase().startsWith('mindroom_') && serverOf(sender) === server;
    /** @param {TagMetadata} metadata @returns {TagMetadata} */
    const attribute = (metadata) => (agent ? metadata : { ...metadata, set_by: sender });
    const perTag = parsePerTagStateKey(stateKey);
    if (!perTag) {
      /** @type {Record<string, TagMetadata>} */
      const tags = {};
      if (isRecord(content) && isRecord(content.tags)) {
        Object.entries(content.tags).forEach(([name, value]) => {
          const normalized = tagName(name);
          const metadata = tagMetadata(value);
          if (normalized && metadata) tags[normalized] = attribute(metadata);
        });
      }
      if (Object.keys(tags).length > 0) legacy.set(stateKey, tags);
      return;
    }
    if (isRecord(content) && Object.keys(content).length === 0) {
      const set = tombstones.get(perTag.threadRootId) ?? new Set();
      set.add(perTag.tagName);
      tombstones.set(perTag.threadRootId, set);
      return;
    }
    const metadata = tagMetadata(content);
    if (!metadata) return;
    const threadRecords = records.get(perTag.threadRootId) ?? {};
    threadRecords[perTag.tagName] = attribute(metadata);
    records.set(perTag.threadRootId, threadRecords);
  });

  /** @type {Map<string, { tags: Record<string, TagMetadata> }>} */
  const merged = new Map();
  [...new Set([...legacy.keys(), ...records.keys(), ...tombstones.keys()])]
    .sort()
    .forEach((root) => {
      const tags = { ...(legacy.get(root) ?? {}) };
      tombstones.get(root)?.forEach((tag) => delete tags[tag]);
      Object.assign(tags, records.get(root));
      if (Object.keys(tags).length > 0) {
        merged.set(root, {
          tags: Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))),
        });
      }
    });
  return merged;
};

/**
 * Reads the thread tag state of a room (the `/rooms/{roomId}/state` response or a list of state
 * events), with the homeservers of `viewer`, the account running the migration, and of each
 * joined member.
 * @param {RawStateEvent[]} events
 * @param {string} viewer
 */
export const collectRoomState = (events, viewer) => {
  /** @type {Map<string, TagState>} */
  const stateByKey = new Map();
  const servers = new Set([serverOf(viewer)]);
  events.forEach((event) => {
    if (event?.type === THREAD_TAGS_EVENT && typeof event.state_key === 'string') {
      stateByKey.set(event.state_key, { sender: event.sender, content: event.content ?? {} });
    } else if (
      event?.type === 'm.room.member' &&
      typeof event.state_key === 'string' &&
      isRecord(event.content) &&
      event.content.membership === 'join'
    ) {
      servers.add(serverOf(event.state_key));
    }
  });

  /** @type {string[]} */
  const legacyStateKeys = [];
  /** @type {Array<{ threadRootId: string; tags: Record<string, TagMetadata> }>} */
  const legacyStates = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, TagMetadata>} */
  const perTagRecords = new Map();
  /** @type {Set<string>} */
  const perTagTombstones = new Set();

  [...stateByKey.keys()].sort().forEach((stateKey) => {
    const content = stateByKey.get(stateKey)?.content;
    const perTag = parsePerTagStateKey(stateKey);
    if (perTag) {
      const key = perTagStateKey(perTag.threadRootId, perTag.tagName);
      if (isRecord(content) && Object.keys(content).length === 0) perTagTombstones.add(key);
      else {
        const metadata = tagMetadata(content);
        if (metadata) perTagRecords.set(key, metadata);
      }
      return;
    }
    // Empty legacy content is already a tombstone.
    if (!isRecord(content) || !isRecord(content.tags) || Object.keys(content.tags).length === 0) {
      return;
    }
    legacyStateKeys.push(stateKey);
    /** @type {Record<string, TagMetadata>} */
    const tags = {};
    Object.entries(content.tags).forEach(([name, value]) => {
      const normalized = tagName(name);
      if (!normalized) {
        warnings.push(`Skipping invalid tag name "${name}" in legacy state "${stateKey}".`);
        return;
      }
      const metadata = tagMetadata(value);
      if (!metadata) {
        warnings.push(`Skipping invalid ${name} payload in legacy state "${stateKey}".`);
        return;
      }
      tags[normalized] = metadata;
    });
    if (Object.keys(tags).length > 0) legacyStates.push({ threadRootId: stateKey, tags });
  });

  return {
    stateByKey,
    legacyStateKeys,
    legacyStates,
    perTagRecords,
    perTagTombstones,
    warnings,
    viewer,
    servers,
    merged: aggregate(stateByKey, serverOf(viewer)),
  };
};

/**
 * One plan per legacy state event: a per-tag write for each legacy tag that has no canonical
 * record or tombstone yet, then a tombstone for the legacy event.
 * @param {ReturnType<typeof collectRoomState>} collected
 */
export const buildMigrationPlans = (collected) => {
  const legacyByRoot = new Map(
    collected.legacyStates.map((state) => [state.threadRootId, state.tags])
  );
  const plans = collected.legacyStateKeys.map((threadRootId) => {
    /** @type {Array<{ stateKey: string; content: TagMetadata }>} */
    const writes = [];
    /** @type {Array<{ tagName: string; reason: string }>} */
    const skipped = [];
    Object.entries(legacyByRoot.get(threadRootId) ?? {}).forEach(([tag, metadata]) => {
      const stateKey = perTagStateKey(threadRootId, tag);
      if (collected.perTagRecords.has(stateKey)) {
        skipped.push({ tagName: tag, reason: 'canonical record exists' });
      } else if (collected.perTagTombstones.has(stateKey)) {
        skipped.push({ tagName: tag, reason: 'canonical tombstone exists' });
      } else {
        writes.push({ stateKey, content: metadata });
      }
    });
    return { threadRootId, writes, tombstoneLegacy: true, skipped };
  });
  return {
    plans,
    totalWrites: plans.reduce((total, plan) => total + plan.writes.length, 0),
    totalLegacyTombstones: plans.filter((plan) => plan.tombstoneLegacy).length,
  };
};

/**
 * The merged tags the room will show to a viewer on `server` (default: the homeserver of the
 * account running the migration) once the plans are applied, written as that account.
 * @param {ReturnType<typeof collectRoomState>} collected
 * @param {ReturnType<typeof buildMigrationPlans>} migration
 * @param {string} [server]
 */
export const predictMergedStateAfterMigration = (
  collected,
  migration,
  server = serverOf(collected.viewer)
) => {
  const next = new Map(collected.stateByKey);
  const sender = collected.viewer;
  migration.plans.forEach((plan) => {
    plan.writes.forEach(({ stateKey, content }) => next.set(stateKey, { sender, content }));
    if (plan.tombstoneLegacy) next.set(plan.threadRootId, { sender, content: {} });
  });
  return aggregate(next, server);
};

/**
 * The threads whose tags the plans would change for the members of any of the room's homeservers.
 * @param {ReturnType<typeof collectRoomState>} collected
 * @param {ReturnType<typeof buildMigrationPlans>} migration
 * @returns {string[]}
 */
export const changedThreads = (collected, migration) => {
  /** @type {Set<string>} */
  const changed = new Set();
  collected.servers.forEach((server) => {
    const before = aggregate(collected.stateByKey, server);
    const after = predictMergedStateAfterMigration(collected, migration, server);
    new Set([...before.keys(), ...after.keys()]).forEach((root) => {
      if (JSON.stringify(before.get(root)) !== JSON.stringify(after.get(root))) changed.add(root);
    });
  });
  return [...changed].sort();
};

/**
 * @param {string} homeserver
 * @param {string} accessToken
 * @param {string} roomId
 * @param {boolean} apply
 */
const migrateRoom = async (homeserver, accessToken, roomId, apply) => {
  const base = `${homeserver.replace(/\/+$/, '')}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId
  )}`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const whoami = await fetch(`${homeserver.replace(/\/+$/, '')}/_matrix/client/v3/account/whoami`, {
    headers,
  });
  if (!whoami.ok) throw new Error(`Reading the account failed: HTTP ${whoami.status}`);
  const { user_id: viewer } = /** @type {{ user_id: string }} */ (await whoami.json());
  const response = await fetch(`${base}/state`, { headers });
  if (!response.ok) throw new Error(`Reading room state failed: HTTP ${response.status}`);
  const collected = collectRoomState(
    /** @type {RawStateEvent[]} */ (await response.json()),
    viewer
  );
  collected.warnings.forEach((warning) => console.warn(warning));
  const migration = buildMigrationPlans(collected);
  const changed = changedThreads(collected, migration);
  if (changed.length > 0) {
    throw new Error(
      `The migration would change whom the tags of ${changed.join(', ')} name; nothing was ` +
        'written. A tag names its sender unless the sender is the person it names or a MindRoom ' +
        `agent on the viewer's homeserver, and the migration writes as ${viewer}.`
    );
  }
  console.log(JSON.stringify(migration, null, 2));
  if (!apply) {
    console.log('Dry run. Pass --apply to write.');
    return;
  }
  const put = async (/** @type {string} */ stateKey, /** @type {unknown} */ content) => {
    const url = `${base}/state/${encodeURIComponent(THREAD_TAGS_EVENT)}/${encodeURIComponent(
      stateKey
    )}`;
    const result = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(content) });
    if (!result.ok) throw new Error(`Writing ${stateKey} failed: HTTP ${result.status}`);
  };
  for (const plan of migration.plans) {
    for (const write of plan.writes) await put(write.stateKey, write.content);
    if (plan.tombstoneLegacy) await put(plan.threadRootId, {});
  }
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [roomId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const { MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN } = process.env;
  if (!roomId || !MATRIX_HOMESERVER || !MATRIX_ACCESS_TOKEN) {
    console.error(
      'Usage: MATRIX_HOMESERVER=... MATRIX_ACCESS_TOKEN=... node scripts/migrate-thread-tags.mjs <room id> [--apply]'
    );
    process.exit(2);
  }
  await migrateRoom(
    MATRIX_HOMESERVER,
    MATRIX_ACCESS_TOKEN,
    roomId,
    process.argv.includes('--apply')
  );
}
