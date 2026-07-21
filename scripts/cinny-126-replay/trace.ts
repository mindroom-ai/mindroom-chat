import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ContentFingerprint } from './exactReplayOracle';

const ARTIFACT_NAMES = [
  'incident-window-all-events.json',
  'edit-events-full.json',
  'incident-core-events.json',
] as const;

type ArtifactName = typeof ARTIFACT_NAMES[number];
type ArtifactHashes = Record<ArtifactName, string>;

export type TraceSenders = {
  user: string;
  router: string;
  agent: string;
};

export type TraceEventIds = {
  room: string;
  threadRoot: string;
  voice: string;
  transcription: string;
  placeholder: string;
  finalEdit: string;
  summary: string;
  tags: [string, string];
};

export type ExactReplayFingerprints = {
  compactCard: ContentFingerprint;
  effectiveBody: ContentFingerprint;
  globalThreads: ContentFingerprint;
  overviewTags: ContentFingerprint;
  presentation: ContentFingerprint;
};

type PrivateTraceManifest = {
  schemaVersion: 1;
  artifactHashes: ArtifactHashes;
  eventIds: TraceEventIds;
  expectedFingerprints: ExactReplayFingerprints;
  senders: TraceSenders;
};

export type TraceEvent = {
  content: Record<string, unknown>;
  event_id: string;
  origin_server_ts: number;
  room_id?: string;
  sender: string;
  state_key?: string;
  type: string;
  unsigned?: Record<string, unknown>;
};

export type ExactTrace = {
  artifactDir: string;
  artifactHashes: ArtifactHashes;
  ids: TraceEventIds;
  senders: TraceSenders;
  expectedFingerprints: ExactReplayFingerprints;
  voice: TraceEvent;
  transcription: TraceEvent;
  placeholder: TraceEvent;
  edits: TraceEvent[];
  tags: TraceEvent[];
  summary: TraceEvent;
  replayEvents: TraceEvent[];
};

const exactInterEditDelays = [
  160, 777, 158, 782, 162, 788, 944, 1983, 166, 164, 164, 1302, 174, 1236, 316, 188,
];

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CINNY-126 trace validation failed: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isMatrixEventId = (value: unknown): value is string =>
  typeof value === 'string' && /^\$\S+$/.test(value);
const isMatrixRoomId = (value: unknown): value is string =>
  typeof value === 'string' && /^!\S+:\S+$/.test(value);
const isMatrixUserId = (value: unknown): value is string =>
  typeof value === 'string' && /^@\S+:\S+$/.test(value);

const requireStringRecord = <T extends Record<string, string>>(
  value: unknown,
  keys: readonly (keyof T)[],
  label: string
): T => {
  requireCondition(isRecord(value), `${label} must be an object`);
  requireCondition(
    Object.keys(value).length === keys.length &&
      keys.every((key) => isNonEmptyString(value[String(key)])),
    `${label} has invalid fields`
  );
  return value as T;
};

const parseFingerprint = (value: unknown, label: string): ContentFingerprint => {
  requireCondition(isRecord(value), `${label} must be an object`);
  requireCondition(
    Object.keys(value).length === 2 &&
      Number.isInteger(value.length) &&
      (value.length as number) >= 0 &&
      typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.sha256),
    `${label} is invalid`
  );
  return { length: value.length as number, sha256: value.sha256 };
};

export const parsePrivateTraceManifest = (value: unknown): PrivateTraceManifest => {
  requireCondition(isRecord(value), 'manifest must be an object');
  requireCondition(Object.keys(value).length === 5, 'manifest has unexpected fields');
  requireCondition(value.schemaVersion === 1, 'manifest schemaVersion must be 1');

  const artifactHashes = requireStringRecord<ArtifactHashes>(
    value.artifactHashes,
    ARTIFACT_NAMES,
    'manifest artifactHashes'
  );
  Object.entries(artifactHashes).forEach(([fileName, hash]) => {
    requireCondition(/^[a-f0-9]{64}$/.test(hash), `${fileName} SHA-256 is invalid`);
  });

  requireCondition(isRecord(value.eventIds), 'manifest eventIds must be an object');
  const rawEventIds = value.eventIds;
  const eventIdKeys = [
    'room',
    'threadRoot',
    'voice',
    'transcription',
    'placeholder',
    'finalEdit',
    'summary',
  ] as const;
  requireCondition(
    Object.keys(rawEventIds).length === eventIdKeys.length + 1 &&
      eventIdKeys.every((key) => isNonEmptyString(rawEventIds[key])) &&
      Array.isArray(rawEventIds.tags) &&
      rawEventIds.tags.length === 2 &&
      rawEventIds.tags.every(isNonEmptyString),
    'manifest eventIds has invalid fields'
  );
  const eventIds: TraceEventIds = {
    room: rawEventIds.room as string,
    threadRoot: rawEventIds.threadRoot as string,
    voice: rawEventIds.voice as string,
    transcription: rawEventIds.transcription as string,
    placeholder: rawEventIds.placeholder as string,
    finalEdit: rawEventIds.finalEdit as string,
    summary: rawEventIds.summary as string,
    tags: [rawEventIds.tags[0], rawEventIds.tags[1]],
  };
  requireCondition(isMatrixRoomId(eventIds.room), 'manifest room ID is invalid');
  const selectedEventIds = [
    eventIds.threadRoot,
    eventIds.voice,
    eventIds.transcription,
    eventIds.placeholder,
    eventIds.finalEdit,
    eventIds.summary,
    ...eventIds.tags,
  ];
  requireCondition(
    selectedEventIds.every(isMatrixEventId) &&
      new Set(selectedEventIds).size === selectedEventIds.length,
    'manifest event IDs must be valid and distinct'
  );

  const senders = requireStringRecord<TraceSenders>(
    value.senders,
    ['user', 'router', 'agent'],
    'manifest senders'
  );
  requireCondition(new Set(Object.values(senders)).size === 3, 'manifest senders must be distinct');
  requireCondition(
    Object.values(senders).every(isMatrixUserId),
    'manifest senders must be valid Matrix user IDs'
  );

  requireCondition(
    isRecord(value.expectedFingerprints),
    'manifest expectedFingerprints must be an object'
  );
  requireCondition(
    Object.keys(value.expectedFingerprints).length === 5,
    'manifest expectedFingerprints has unexpected fields'
  );
  const expectedFingerprints: ExactReplayFingerprints = {
    compactCard: parseFingerprint(
      value.expectedFingerprints.compactCard,
      'compact-card fingerprint'
    ),
    effectiveBody: parseFingerprint(
      value.expectedFingerprints.effectiveBody,
      'effective-body fingerprint'
    ),
    globalThreads: parseFingerprint(
      value.expectedFingerprints.globalThreads,
      'global-Threads fingerprint'
    ),
    overviewTags: parseFingerprint(
      value.expectedFingerprints.overviewTags,
      'overview-tags fingerprint'
    ),
    presentation: parseFingerprint(
      value.expectedFingerprints.presentation,
      'presentation fingerprint'
    ),
  };

  return { schemaVersion: 1, artifactHashes, eventIds, expectedFingerprints, senders };
};

export const parseVerifiedPrivateTraceManifest = (
  bytes: Uint8Array,
  expectedSha256: string
): PrivateTraceManifest => {
  requireCondition(/^[a-f0-9]{64}$/.test(expectedSha256), 'manifest SHA-256 is invalid');
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  requireCondition(actualSha256 === expectedSha256, 'private manifest SHA-256 does not match');
  return parsePrivateTraceManifest(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
};

const relation = (event: TraceEvent): Record<string, unknown> =>
  (event.content['m.relates_to'] as Record<string, unknown> | undefined) ?? {};

const readVerifiedArtifact = async <T>(
  artifactDir: string,
  fileName: ArtifactName,
  expectedHash: string
) => {
  const artifactPath = path.join(artifactDir, fileName);
  const bytes = await readFile(artifactPath);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  requireCondition(
    actualHash === expectedHash,
    `${fileName} SHA-256 does not match private manifest`
  );
  return JSON.parse(bytes.toString('utf8')) as T;
};

const findEvent = (events: TraceEvent[], eventId: string): TraceEvent => {
  const event = events.find((candidate) => candidate.event_id === eventId);
  requireCondition(event, 'required event is missing');
  return event;
};

export const validateExactTrace = (trace: Omit<ExactTrace, 'replayEvents'>): ExactTrace => {
  const { ids, senders, voice, transcription, placeholder, edits, tags, summary } = trace;
  const requireThreadRelation = (event: TraceEvent, label: string) => {
    const eventRelation = relation(event);
    requireCondition(eventRelation.rel_type === 'm.thread', `${label} is not a thread reply`);
    requireCondition(eventRelation.event_id === ids.threadRoot, `${label} thread target changed`);
  };
  requireCondition(voice.sender === senders.user, 'voice sender changed');
  requireCondition(transcription.sender === senders.router, 'transcription sender changed');
  requireCondition(placeholder.sender === senders.agent, 'placeholder sender changed');
  requireCondition(
    voice.type === 'm.room.message' && voice.state_key === undefined,
    'voice kind changed'
  );
  requireCondition(voice.content.msgtype === 'm.audio', 'voice msgtype changed');
  requireCondition(
    transcription.type === 'm.room.message' && transcription.state_key === undefined,
    'transcription kind changed'
  );
  requireCondition(transcription.content.msgtype === 'm.text', 'transcription msgtype changed');
  requireCondition(
    placeholder.type === 'm.room.message' && placeholder.state_key === undefined,
    'placeholder kind changed'
  );
  requireCondition(placeholder.content.msgtype === 'm.text', 'placeholder msgtype changed');
  requireThreadRelation(voice, 'voice');
  requireThreadRelation(transcription, 'transcription');
  requireThreadRelation(placeholder, 'placeholder');
  requireCondition(edits.length === 17, `expected 17 edits, received ${edits.length}`);
  requireCondition(tags.length === 2, `expected two tag events, received ${tags.length}`);
  requireCondition(
    placeholder.origin_server_ts - transcription.origin_server_ts === 254,
    'transcription-to-placeholder cadence changed'
  );
  requireCondition(
    edits[0].origin_server_ts - placeholder.origin_server_ts === 14789,
    'placeholder-to-first-edit cadence changed'
  );
  requireCondition(
    JSON.stringify(
      edits.slice(1).map((event, index) => event.origin_server_ts - edits[index].origin_server_ts)
    ) === JSON.stringify(exactInterEditDelays),
    'inter-edit delay vector changed'
  );
  edits.forEach((event, index) => {
    const eventRelation = relation(event);
    const newContent = event.content['m.new_content'];
    requireCondition(isRecord(newContent), `edit ${index + 1} has no m.new_content`);
    requireCondition(event.sender === senders.agent, `edit ${index + 1} sender changed`);
    requireCondition(
      event.type === 'm.room.message' && event.state_key === undefined,
      `edit ${index + 1} kind changed`
    );
    requireCondition(eventRelation.rel_type === 'm.replace', `edit ${index + 1} is not m.replace`);
    requireCondition(
      eventRelation.event_id === ids.placeholder,
      `edit ${index + 1} target changed`
    );
    const expectedMsgtype = index === edits.length - 1 ? 'm.text' : 'm.notice';
    const expectedStatus = index === edits.length - 1 ? 'completed' : 'streaming';
    requireCondition(newContent.msgtype === expectedMsgtype, `edit ${index + 1} msgtype changed`);
    requireCondition(
      newContent['io.mindroom.stream_status'] === expectedStatus,
      `edit ${index + 1} stream status changed`
    );
  });
  requireCondition(edits.at(-1)?.event_id === ids.finalEdit, 'final edit identity changed');
  const finalNewContent = edits.at(-1)?.content['m.new_content'];
  requireCondition(isRecord(finalNewContent), 'final edit has no m.new_content');
  requireCondition(typeof finalNewContent.body === 'string', 'final effective body is not text');
  requireCondition(
    Array.from(finalNewContent.body).length === 1466,
    'final effective body is not 1,466 characters'
  );
  tags.forEach((event, index) => {
    requireCondition(
      event.type === 'com.mindroom.thread.tags' && event.state_key !== undefined,
      `tag ${index + 1} kind changed`
    );
    requireCondition(event.sender === senders.agent, `tag ${index + 1} sender changed`);
    const parsedStateKey = JSON.parse(event.state_key ?? 'null') as unknown;
    requireCondition(
      Array.isArray(parsedStateKey) &&
        parsedStateKey.length === 2 &&
        parsedStateKey[0] === ids.threadRoot &&
        isNonEmptyString(parsedStateKey[1]),
      `tag ${index + 1} no longer targets the incident thread`
    );
  });
  requireCondition(tags[0].state_key !== tags[1].state_key, 'tag state keys must be distinct');
  const summaryRelation = relation(summary);
  const reply = summaryRelation['m.in_reply_to'];
  requireCondition(isRecord(reply), 'summary has no reply target');
  requireCondition(summary.content.msgtype === 'm.notice', 'summary msgtype changed');
  requireCondition(summary.sender === senders.agent, 'summary sender changed');
  requireCondition(
    summary.type === 'm.room.message' && summary.state_key === undefined,
    'summary kind changed'
  );
  requireCondition(summaryRelation.rel_type === 'm.thread', 'summary is not a thread reply');
  requireCondition(summaryRelation.event_id === ids.threadRoot, 'summary thread target changed');
  requireCondition(
    reply.event_id === ids.finalEdit,
    'summary reply-to does not target the final m.replace event'
  );

  const replayEvents = [voice, transcription, placeholder, ...edits, ...tags, summary].sort(
    (left, right) => left.origin_server_ts - right.origin_server_ts
  );
  const replayEventIds = replayEvents.map((event) => event.event_id);
  requireCondition(
    replayEventIds.every(isMatrixEventId) && new Set(replayEventIds).size === replayEventIds.length,
    'replay event IDs must be valid and distinct'
  );
  replayEvents.forEach((event) => {
    requireCondition(
      event.room_id === undefined || event.room_id === ids.room,
      'replay event room changed'
    );
  });
  return { ...trace, replayEvents };
};

export const loadExactTrace = async (
  artifactDir?: string,
  manifestSha256?: string
): Promise<ExactTrace> => {
  const configuredArtifactDir = artifactDir ?? process.env.CINNY_126_ARTIFACT_DIR;
  requireCondition(
    isNonEmptyString(configuredArtifactDir),
    'set CINNY_126_ARTIFACT_DIR to the private artifact directory'
  );
  const configuredManifestSha256 = manifestSha256 ?? process.env.CINNY_126_MANIFEST_SHA256;
  requireCondition(
    isNonEmptyString(configuredManifestSha256),
    'set CINNY_126_MANIFEST_SHA256 to the trusted private manifest digest'
  );
  const resolvedArtifactDir = path.resolve(configuredArtifactDir);
  const manifest = parseVerifiedPrivateTraceManifest(
    await readFile(path.join(resolvedArtifactDir, 'manifest.json')),
    configuredManifestSha256
  );
  const [coreRows, edits, windowEvents] = await Promise.all([
    readVerifiedArtifact<Array<{ event_json: string }>>(
      resolvedArtifactDir,
      'incident-core-events.json',
      manifest.artifactHashes['incident-core-events.json']
    ),
    readVerifiedArtifact<TraceEvent[]>(
      resolvedArtifactDir,
      'edit-events-full.json',
      manifest.artifactHashes['edit-events-full.json']
    ),
    readVerifiedArtifact<TraceEvent[]>(
      resolvedArtifactDir,
      'incident-window-all-events.json',
      manifest.artifactHashes['incident-window-all-events.json']
    ),
  ]);
  const coreEvents = coreRows.map((row) => {
    // eslint-disable-next-line camelcase -- authoritative artifact field name
    const { event_json: eventJson } = row;
    return JSON.parse(eventJson) as TraceEvent;
  });
  const { eventIds: ids } = manifest;
  return validateExactTrace({
    artifactDir: resolvedArtifactDir,
    artifactHashes: manifest.artifactHashes,
    ids,
    senders: manifest.senders,
    expectedFingerprints: manifest.expectedFingerprints,
    voice: findEvent(coreEvents, ids.voice),
    transcription: findEvent(coreEvents, ids.transcription),
    placeholder: findEvent(coreEvents, ids.placeholder),
    edits,
    tags: ids.tags.map((eventId) => findEvent(windowEvents, eventId)),
    summary: findEvent(windowEvents, ids.summary),
  });
};

export const cloneTraceEvent = (event: TraceEvent, roomId: string): TraceEvent =>
  JSON.parse(JSON.stringify({ ...event, room_id: roomId })) as TraceEvent;
