import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const INCIDENT_ROOM_ID = '!HQkYhf9OpngwJwCWns:mindroom.chat';
export const INCIDENT_THREAD_ROOT_ID = '$hEwF5iZBgs-cWxF13RI35GUFqEm648HbaPCYXvuItig';
export const INCIDENT_VOICE_EVENT_ID = '$IplaneGRjGdo5YW6rk-RJxUZbmTNFxcYZA912XNB_Tc';
export const INCIDENT_TRANSCRIPTION_EVENT_ID = '$4X86tdBhPt0EXLwHd2_4njCqYIGSAZwBU702d4pb9Sk';
export const INCIDENT_PLACEHOLDER_EVENT_ID = '$-VHwjN4oZDJafFl_rvOjMHRaoHbIUJdvF4OTNQkVXWc';
export const INCIDENT_FINAL_EDIT_EVENT_ID = '$bRI9J8GUw-wpFswV1KqDzZbRiLJoaaYcr-05YBJ4BmA';
export const INCIDENT_SUMMARY_EVENT_ID = '$szOpeIl_CM6NoS_z8bHS0rs7f4OFuaZrDHDucCGGt1Q';
export const INCIDENT_TAG_EVENT_IDS = [
  '$9VuEHO8w-DKu2uM-v12kf8guTj6krESAmiZoXjicsww',
  '$TOTTnb8VXuv4s6_KyBh1xdyL29E7Z-J1Uc-QYhJXidc',
] as const;

export const ORIGINAL_SENDERS = {
  user: '@basnijholt:mindroom.chat',
  router: '@mindroom_router:mindroom.chat',
  agent: '@mindroom_openclaw:mindroom.chat',
} as const;

const DEFAULT_ARTIFACT_DIR =
  '/home/basnijholt/.mindroom-chat/mindroom_data/agents/openclaw/workspace/skills/mindroom-dev/references/reports/CINNY-126-artifacts';

const ARTIFACT_HASHES = {
  'incident-window-all-events.json':
    'a0f41c772c3ee221943244daeca1de5c45e926ef7ce1c714b37574a3e327f4b6',
  'edit-events-full.json': '2834620072ae2ec92c9566e53f9dccc048fa8775c14616be0b3e374d15a0ede6',
  'incident-core-events.json': '65cbcd390bfaac8679240854e57cb9c979045df4d273f490d5eaeb3c1a44f2be',
} as const;

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
  artifactHashes: typeof ARTIFACT_HASHES;
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

const requireCondition = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(`CINNY-126 trace validation failed: ${message}`);
};

const relation = (event: TraceEvent): Record<string, unknown> =>
  (event.content['m.relates_to'] as Record<string, unknown> | undefined) ?? {};

const readVerifiedArtifact = async <T>(
  artifactDir: string,
  fileName: keyof typeof ARTIFACT_HASHES
) => {
  const artifactPath = path.join(artifactDir, fileName);
  const bytes = await readFile(artifactPath);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  requireCondition(
    actualHash === ARTIFACT_HASHES[fileName],
    `${fileName} SHA-256 ${actualHash} does not match ${ARTIFACT_HASHES[fileName]}`
  );
  return JSON.parse(bytes.toString('utf8')) as T;
};

const findEvent = (events: TraceEvent[], eventId: string): TraceEvent => {
  const event = events.find((candidate) => candidate.event_id === eventId);
  requireCondition(event, `missing event ${eventId}`);
  return event;
};

const validateTrace = (trace: Omit<ExactTrace, 'replayEvents'>): ExactTrace => {
  const { voice, transcription, placeholder, edits, tags, summary } = trace;
  requireCondition(voice.sender === ORIGINAL_SENDERS.user, 'voice sender changed');
  requireCondition(
    transcription.sender === ORIGINAL_SENDERS.router,
    'transcription sender changed'
  );
  requireCondition(placeholder.sender === ORIGINAL_SENDERS.agent, 'placeholder sender changed');
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
    const newContent = event.content['m.new_content'] as Record<string, unknown> | undefined;
    requireCondition(event.sender === ORIGINAL_SENDERS.agent, `edit ${index + 1} sender changed`);
    requireCondition(event.type === 'm.room.message', `edit ${index + 1} type changed`);
    requireCondition(eventRelation.rel_type === 'm.replace', `edit ${index + 1} is not m.replace`);
    requireCondition(
      eventRelation.event_id === INCIDENT_PLACEHOLDER_EVENT_ID,
      `edit ${index + 1} target changed`
    );
    requireCondition(newContent, `edit ${index + 1} has no m.new_content`);
    const expectedMsgtype = index === edits.length - 1 ? 'm.text' : 'm.notice';
    const expectedStatus = index === edits.length - 1 ? 'completed' : 'streaming';
    requireCondition(newContent.msgtype === expectedMsgtype, `edit ${index + 1} msgtype changed`);
    requireCondition(
      newContent['io.mindroom.stream_status'] === expectedStatus,
      `edit ${index + 1} stream status changed`
    );
  });
  requireCondition(
    edits.at(-1)?.event_id === INCIDENT_FINAL_EDIT_EVENT_ID,
    'final edit identity changed'
  );
  requireCondition(
    Array.from((edits.at(-1)?.content['m.new_content'] as Record<string, unknown>).body as string)
      .length === 1466,
    'final effective body is not 1,466 characters'
  );
  tags.forEach((event, index) => {
    requireCondition(event.type === 'com.mindroom.thread.tags', `tag ${index + 1} type changed`);
    requireCondition(event.sender === ORIGINAL_SENDERS.agent, `tag ${index + 1} sender changed`);
    const parsedStateKey = JSON.parse(event.state_key ?? 'null') as unknown;
    requireCondition(
      Array.isArray(parsedStateKey) && parsedStateKey[0] === INCIDENT_THREAD_ROOT_ID,
      `tag ${index + 1} no longer targets the incident thread`
    );
  });
  const summaryRelation = relation(summary);
  const reply = summaryRelation['m.in_reply_to'] as Record<string, unknown> | undefined;
  requireCondition(summary.content.msgtype === 'm.notice', 'summary msgtype changed');
  requireCondition(summaryRelation.rel_type === 'm.thread', 'summary is not a thread reply');
  requireCondition(
    summaryRelation.event_id === INCIDENT_THREAD_ROOT_ID,
    'summary thread target changed'
  );
  requireCondition(
    reply?.event_id === INCIDENT_FINAL_EDIT_EVENT_ID,
    'summary reply-to does not target the final m.replace event'
  );

  const replayEvents = [voice, transcription, placeholder, ...edits, ...tags, summary].sort(
    (left, right) => left.origin_server_ts - right.origin_server_ts
  );
  return { ...trace, replayEvents };
};

export const loadExactTrace = async (
  artifactDir = process.env.CINNY_126_ARTIFACT_DIR ?? DEFAULT_ARTIFACT_DIR
): Promise<ExactTrace> => {
  const [coreRows, edits, windowEvents] = await Promise.all([
    readVerifiedArtifact<Array<{ event_json: string }>>(artifactDir, 'incident-core-events.json'),
    readVerifiedArtifact<TraceEvent[]>(artifactDir, 'edit-events-full.json'),
    readVerifiedArtifact<TraceEvent[]>(artifactDir, 'incident-window-all-events.json'),
  ]);
  const coreEvents = coreRows.map(({ event_json }) => JSON.parse(event_json) as TraceEvent);
  return validateTrace({
    artifactDir,
    artifactHashes: ARTIFACT_HASHES,
    voice: findEvent(coreEvents, INCIDENT_VOICE_EVENT_ID),
    transcription: findEvent(coreEvents, INCIDENT_TRANSCRIPTION_EVENT_ID),
    placeholder: findEvent(coreEvents, INCIDENT_PLACEHOLDER_EVENT_ID),
    edits,
    tags: INCIDENT_TAG_EVENT_IDS.map((eventId) => findEvent(windowEvents, eventId)),
    summary: findEvent(windowEvents, INCIDENT_SUMMARY_EVENT_ID),
  });
};

export const cloneTraceEvent = (event: TraceEvent, roomId: string): TraceEvent =>
  JSON.parse(JSON.stringify({ ...event, room_id: roomId })) as TraceEvent;
