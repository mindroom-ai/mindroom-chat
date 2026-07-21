type ReplayEventContent = { content: Record<string, unknown> };

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
    throw new Error(`Disposable replay room topic must be ${JSON.stringify(LIVE_REPLAY_ROOM_TOPIC)}`);
  }
  if (canary.nonce !== canaryNonce || canary.purpose !== LIVE_REPLAY_CANARY_PURPOSE) {
    throw new Error('Disposable replay room canary does not match this invocation');
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const parseReplacementAttachmentIds = (raw: string | undefined): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? 'null') as unknown;
  } catch {
    throw new Error(
      'CINNY_126_TEST_ATTACHMENT_IDS must be a JSON array of three test attachment IDs'
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    !parsed.every(isNonEmptyString) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('CINNY_126_TEST_ATTACHMENT_IDS must contain three distinct non-empty strings');
  }
  return parsed;
};

const attachmentIdsFromContent = (content: Record<string, unknown>): string[] => {
  const ids: string[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) value.forEach((item) => isNonEmptyString(item) && ids.push(item));
  };
  append(content['com.mindroom.attachment_ids']);
  const newContent = content['m.new_content'] as Record<string, unknown> | undefined;
  append(newContent?.['com.mindroom.attachment_ids']);
  return ids;
};

export const collectIncidentAttachmentIds = (events: ReplayEventContent[]): string[] =>
  Array.from(new Set(events.flatMap((event) => attachmentIdsFromContent(event.content))));

export const validateLiveReplayMedia = ({
  incidentAttachmentIds,
  incidentAudioMxc,
  replacementAttachmentIds,
  testAudioMxc,
}: {
  incidentAttachmentIds: string[];
  incidentAudioMxc: unknown;
  replacementAttachmentIds: string[];
  testAudioMxc: string | undefined;
}): {
  attachmentMap: Map<string, string>;
  forbiddenIncidentMedia: Set<string>;
  testAudioMxc: string;
} => {
  if (!isNonEmptyString(incidentAudioMxc) || !incidentAudioMxc.startsWith('mxc://')) {
    throw new Error('Verified incident trace has no voice MXC');
  }
  if (!testAudioMxc || !/^mxc:\/\/[^/\s]+\/[^/\s]+$/.test(testAudioMxc)) {
    throw new Error('Set CINNY_126_TEST_AUDIO_MXC to a valid non-sensitive test audio upload');
  }
  if (testAudioMxc === incidentAudioMxc) {
    throw new Error('The incident voice MXC is forbidden in live replay');
  }
  if (
    incidentAttachmentIds.length !== 3 ||
    !incidentAttachmentIds.every(isNonEmptyString) ||
    new Set(incidentAttachmentIds).size !== incidentAttachmentIds.length
  ) {
    throw new Error('Verified incident trace must contain three distinct attachment IDs');
  }
  const incidentAttachmentSet = new Set(incidentAttachmentIds);
  if (replacementAttachmentIds.some((attachmentId) => incidentAttachmentSet.has(attachmentId))) {
    throw new Error('Incident attachment IDs are forbidden in live replay');
  }
  return {
    attachmentMap: new Map(
      incidentAttachmentIds.map((attachmentId, index) => [
        attachmentId,
        replacementAttachmentIds[index],
      ])
    ),
    forbiddenIncidentMedia: new Set([incidentAudioMxc, ...incidentAttachmentIds]),
    testAudioMxc,
  };
};

export const rewriteReplayAttachmentIds = (
  attachmentIds: unknown,
  attachmentMap: ReadonlyMap<string, string>
): string[] => {
  if (!Array.isArray(attachmentIds) || !attachmentIds.every(isNonEmptyString)) {
    throw new Error('Replay attachment field is not an array of non-empty strings');
  }
  return attachmentIds.map((attachmentId) => {
    const replacement = attachmentMap.get(attachmentId);
    if (!replacement) throw new Error(`No safe attachment replacement for ${attachmentId}`);
    return replacement;
  });
};

export const assertNoIncidentMediaReferences = (
  value: unknown,
  forbiddenIncidentMedia: ReadonlySet<string>
): void => {
  if (typeof value === 'string') {
    if (forbiddenIncidentMedia.has(value)) {
      throw new Error('Rewritten live event still contains an incident media reference');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoIncidentMediaReferences(item, forbiddenIncidentMedia));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) =>
      assertNoIncidentMediaReferences(item, forbiddenIncidentMedia)
    );
  }
};
