import type { TraceEvent } from './trace';

export const LIVE_REPLAY_ROOM_NAME = 'CINNY-126 disposable replay';
export const LIVE_REPLAY_ROOM_TOPIC = 'CINNY-126 TEST ONLY';
export const LIVE_REPLAY_CANARY_TYPE = 'io.mindroom.cinny_126_replay';
export const LIVE_REPLAY_CANARY_PURPOSE = 'CINNY-126 exact-trace test replay';

export const buildLiveReplayRoomRequest = (inviteUserIds: string[], canaryNonce: string) => ({
  initial_state: [
    {
      content: { topic: LIVE_REPLAY_ROOM_TOPIC },
      state_key: '',
      type: 'm.room.topic',
    },
    {
      content: { history_visibility: 'joined' },
      state_key: '',
      type: 'm.room.history_visibility',
    },
    {
      content: { nonce: canaryNonce, purpose: LIVE_REPLAY_CANARY_PURPOSE },
      state_key: '',
      type: LIVE_REPLAY_CANARY_TYPE,
    },
  ],
  invite: inviteUserIds,
  is_direct: false,
  name: LIVE_REPLAY_ROOM_NAME,
  power_level_content_override: {
    events: { 'com.mindroom.thread.tags': 0 },
  },
  preset: 'private_chat',
});

export const assertLiveReplayRoomIsolation = ({
  canary,
  canaryNonce,
  historyVisibility,
  joinedUserIds,
  joinRule,
  tagStatePowerLevel,
  topic,
  expectedUserIds,
}: {
  canary: Record<string, unknown>;
  canaryNonce: string;
  historyVisibility: unknown;
  joinedUserIds: string[];
  joinRule: unknown;
  tagStatePowerLevel: unknown;
  topic: unknown;
  expectedUserIds: string[];
}): void => {
  const actualMembers = [...joinedUserIds].sort();
  const expectedMembers = [...expectedUserIds].sort();
  if (JSON.stringify(actualMembers) !== JSON.stringify(expectedMembers)) {
    throw new Error('Disposable replay room must contain exactly the three test accounts');
  }
  if (joinRule !== 'invite') throw new Error('Disposable replay room must be invite-only');
  if (historyVisibility !== 'joined') {
    throw new Error('Disposable replay room history must be visible to joined members only');
  }
  if (tagStatePowerLevel !== 0) {
    throw new Error('Disposable replay room must allow test accounts to write thread tags');
  }
  if (topic !== LIVE_REPLAY_ROOM_TOPIC) {
    throw new Error(
      `Disposable replay room topic must be ${JSON.stringify(LIVE_REPLAY_ROOM_TOPIC)}`
    );
  }
  if (canary.nonce !== canaryNonce || canary.purpose !== LIVE_REPLAY_CANARY_PURPOSE) {
    throw new Error('Disposable replay room canary does not match this invocation');
  }
};

export type LiveReplayEventKind =
  | 'voice'
  | 'transcription'
  | 'placeholder'
  | 'edit'
  | 'tag'
  | 'summary';

const RELATION_KEYS = new Set(['event_id', 'is_falling_back', 'm.in_reply_to', 'rel_type']);
const RELATION_TYPES = new Set(['m.annotation', 'm.reference', 'm.replace', 'm.thread']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const requireMappedEventId = (
  eventId: unknown,
  idMap: ReadonlyMap<string, string>,
  label: string
): string => {
  if (typeof eventId !== 'string') throw new Error(`${label} is not an event ID`);
  const mappedEventId = idMap.get(eventId);
  if (!mappedEventId) throw new Error(`No safe event-ID mapping for ${label}`);
  return mappedEventId;
};

const buildSafeRelation = (
  sourceContent: Record<string, unknown>,
  idMap: ReadonlyMap<string, string>
): Record<string, unknown> | undefined => {
  const sourceRelation = sourceContent['m.relates_to'];
  if (sourceRelation === undefined) return undefined;
  if (!isRecord(sourceRelation)) throw new Error('Source m.relates_to is not an object');
  const unexpectedKey = Object.keys(sourceRelation).find((key) => !RELATION_KEYS.has(key));
  if (unexpectedKey) throw new Error(`Unhandled source relation field ${unexpectedKey}`);
  if (typeof sourceRelation.rel_type !== 'string' || !RELATION_TYPES.has(sourceRelation.rel_type)) {
    throw new Error('Source relation type is unsupported');
  }
  const safeRelation: Record<string, unknown> = {
    event_id: requireMappedEventId(sourceRelation.event_id, idMap, 'm.relates_to.event_id'),
    rel_type: sourceRelation.rel_type,
  };
  if (sourceRelation.is_falling_back !== undefined) {
    if (typeof sourceRelation.is_falling_back !== 'boolean') {
      throw new Error('Source is_falling_back is not boolean');
    }
    safeRelation.is_falling_back = sourceRelation.is_falling_back;
  }
  if (sourceRelation['m.in_reply_to'] !== undefined) {
    const sourceReply = sourceRelation['m.in_reply_to'];
    if (!isRecord(sourceReply) || Object.keys(sourceReply).some((key) => key !== 'event_id')) {
      throw new Error('Source m.in_reply_to has unsupported fields');
    }
    safeRelation['m.in_reply_to'] = {
      event_id: requireMappedEventId(
        sourceReply.event_id,
        idMap,
        'm.relates_to.m.in_reply_to.event_id'
      ),
    };
  }
  return safeRelation;
};

export const buildSafeLiveReplayContent = ({
  event,
  idMap,
  index,
  kind,
  senderUserId,
}: {
  event: TraceEvent;
  idMap: ReadonlyMap<string, string>;
  index: number;
  kind: LiveReplayEventKind;
  senderUserId: string;
}): Record<string, unknown> => {
  if (kind === 'tag') {
    return {
      set_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      set_by: senderUserId,
    };
  }

  const relation = buildSafeRelation(event.content, idMap);
  const withRelation = relation ? { 'm.relates_to': relation } : {};
  if (kind === 'edit') {
    const final = index === 16;
    const body = final
      ? 'CINNY-126 synthetic final answer'
      : `CINNY-126 synthetic stream update ${index + 1}`;
    const msgtype = final ? 'm.text' : 'm.notice';
    const streamStatus = final ? 'completed' : 'streaming';
    return {
      body: `* ${body}`,
      'io.mindroom.stream_status': streamStatus,
      'm.new_content': {
        body,
        'io.mindroom.stream_status': streamStatus,
        msgtype,
      },
      ...withRelation,
      msgtype,
    };
  }

  const safeBodies: Record<Exclude<LiveReplayEventKind, 'edit' | 'tag'>, string> = {
    voice: 'CINNY-126 synthetic voice marker',
    transcription: 'CINNY-126 synthetic transcription',
    placeholder: 'CINNY-126 synthetic placeholder',
    summary: 'CINNY-126 synthetic completion summary',
  };
  return {
    body: safeBodies[kind],
    ...(kind === 'placeholder' ? { 'io.mindroom.stream_status': 'pending' } : {}),
    ...withRelation,
    msgtype: kind === 'placeholder' || kind === 'summary' ? 'm.notice' : 'm.text',
  };
};

export const buildSafeLiveReplayStateKey = (
  event: TraceEvent,
  idMap: ReadonlyMap<string, string>,
  tagIndex: number
): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.state_key ?? 'null') as unknown;
  } catch {
    throw new Error('Source tag state key is not JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    parsed[1].length === 0
  ) {
    throw new Error('Source tag state key has unsupported shape');
  }
  return JSON.stringify([
    requireMappedEventId(parsed[0], idMap, 'tag state thread root'),
    `cinny-126-test-${tagIndex + 1}`,
  ]);
};

export const assertNoForbiddenStrings = (
  value: unknown,
  forbiddenValues: ReadonlySet<string>
): void => {
  if (typeof value === 'string') {
    if (forbiddenValues.has(value)) {
      throw new Error('Synthetic live event still contains a private trace reference');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForbiddenStrings(item, forbiddenValues));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => assertNoForbiddenStrings(item, forbiddenValues));
  }
};
