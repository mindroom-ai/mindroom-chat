import { randomUUID } from 'node:crypto';
import {
  cloneTraceEvent,
  INCIDENT_ROOM_ID,
  INCIDENT_THREAD_ROOT_ID,
  loadExactTrace,
  ORIGINAL_SENDERS,
  type TraceEvent,
} from './trace';
import {
  assertNoIncidentMediaReferences,
  assertLiveReplayRoomIsolation,
  buildLiveReplayRoomRequest,
  collectIncidentAttachmentIds,
  LIVE_REPLAY_CANARY_TYPE,
  parseReplacementAttachmentIds,
  rewriteReplayAttachmentIds,
  validateLiveReplayMedia,
} from './liveSafety';

type Role = keyof typeof ORIGINAL_SENDERS;
type Account = { accessToken: string; userId: string };

const homeserver = 'https://mindroom.chat';
const confirmation = process.env.CINNY_126_TEST_ROOM_CONFIRM;
const testAudioMxc = process.env.CINNY_126_TEST_AUDIO_MXC;
const replacementAttachmentIds = parseReplacementAttachmentIds(
  process.env.CINNY_126_TEST_ATTACHMENT_IDS
);
const roleTokens: Record<Role, string | undefined> = {
  user: process.env.CINNY_126_USER_ACCESS_TOKEN,
  router: process.env.CINNY_126_ROUTER_ACCESS_TOKEN,
  agent: process.env.CINNY_126_AGENT_ACCESS_TOKEN,
};

if (confirmation !== 'TEST_ONLY') {
  throw new Error('Set CINNY_126_TEST_ROOM_CONFIRM=TEST_ONLY');
}
if (Object.values(roleTokens).some((token) => !token)) {
  throw new Error('Three explicit test-account access tokens are required');
}

const trace = await loadExactTrace();
const incidentAttachmentIds = collectIncidentAttachmentIds(trace.replayEvents);
const {
  attachmentMap,
  forbiddenIncidentMedia,
  testAudioMxc: safeTestAudioMxc,
} = validateLiveReplayMedia({
  incidentAttachmentIds,
  incidentAudioMxc: trace.voice.content.url,
  replacementAttachmentIds,
  testAudioMxc,
});

const matrixRequest = async <T>(
  account: Pick<Account, 'accessToken'>,
  method: string,
  matrixPath: string,
  body?: unknown
): Promise<T> => {
  const response = await fetch(`${homeserver}/_matrix/client/v3${matrixPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${matrixPath} failed with ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const accounts = Object.fromEntries(
  await Promise.all(
    (Object.entries(roleTokens) as Array<[Role, string]>).map(async ([role, accessToken]) => {
      const whoami = await matrixRequest<{ user_id: string }>(
        { accessToken },
        'GET',
        '/account/whoami'
      );
      if (Object.values(ORIGINAL_SENDERS).some((userId) => userId === whoami.user_id)) {
        throw new Error(`Original account ${whoami.user_id} is forbidden`);
      }
      return [role, { accessToken, userId: whoami.user_id }] as const;
    })
  )
) as Record<Role, Account>;
if (new Set(Object.values(accounts).map(({ userId }) => userId)).size !== 3) {
  throw new Error('The user, router, and agent roles must use distinct test accounts');
}
const canaryNonce = randomUUID();
const createRoomResponse = await matrixRequest<{ room_id: string }>(
  accounts.user,
  'POST',
  '/createRoom',
  buildLiveReplayRoomRequest([accounts.router.userId, accounts.agent.userId], canaryNonce)
);
const roomId = createRoomResponse.room_id;
if (!roomId || roomId === INCIDENT_ROOM_ID) throw new Error('Homeserver returned an invalid room');
await Promise.all(
  ([accounts.router, accounts.agent] as Account[]).map((account) =>
    matrixRequest<{ room_id: string }>(
      account,
      'POST',
      `/join/${encodeURIComponent(roomId)}`,
      {}
    )
  )
);
const [joinedMembers, joinRules, history, powerLevels, roomTopic, canary] = await Promise.all([
  matrixRequest<{ joined: Record<string, unknown> }>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/joined_members`
  ),
  matrixRequest<{ join_rule?: string }>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.join_rules/`
  ),
  matrixRequest<{ history_visibility?: string }>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.history_visibility/`
  ),
  matrixRequest<{ events?: Record<string, number> }>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`
  ),
  matrixRequest<{ topic?: string }>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.topic/`
  ),
  matrixRequest<Record<string, unknown>>(
    accounts.user,
    'GET',
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      LIVE_REPLAY_CANARY_TYPE
    )}/`
  ),
]);
assertLiveReplayRoomIsolation({
  canary,
  canaryNonce,
  expectedUserIds: Object.values(accounts).map(({ userId }) => userId),
  historyVisibility: history.history_visibility,
  joinedUserIds: Object.keys(joinedMembers.joined),
  joinRule: joinRules.join_rule,
  tagStatePowerLevel: powerLevels.events?.['com.mindroom.thread.tags'],
  topic: roomTopic.topic,
});
process.stdout.write(`CINNY-126 disposable test room: ${roomId}\n`);

const idMap = new Map<string, string>();
const accountForSender = (sender: string): Account => {
  const role = (Object.entries(ORIGINAL_SENDERS) as Array<[Role, string]>).find(
    ([, originalSender]) => originalSender === sender
  )?.[0];
  if (!role) throw new Error(`No test role for ${sender}`);
  return accounts[role];
};
const rewriteReference = (eventId: unknown): unknown =>
  typeof eventId === 'string' ? idMap.get(eventId) ?? eventId : eventId;
const rewriteContent = (event: TraceEvent): Record<string, unknown> => {
  const content = structuredClone(event.content);
  const eventRelation = content['m.relates_to'] as Record<string, unknown> | undefined;
  if (eventRelation) {
    eventRelation.event_id = rewriteReference(eventRelation.event_id);
    const reply = eventRelation['m.in_reply_to'] as Record<string, unknown> | undefined;
    if (reply) reply.event_id = rewriteReference(reply.event_id);
  }
  if (event.sender === ORIGINAL_SENDERS.user && content.url) content.url = safeTestAudioMxc;
  if (content.set_by === ORIGINAL_SENDERS.agent) content.set_by = accounts.agent.userId;
  const attachmentIds = content['com.mindroom.attachment_ids'] as string[] | undefined;
  if (attachmentIds) {
    content['com.mindroom.attachment_ids'] = rewriteReplayAttachmentIds(
      attachmentIds,
      attachmentMap
    );
  }
  const newContent = content['m.new_content'] as Record<string, unknown> | undefined;
  const newAttachmentIds = newContent?.['com.mindroom.attachment_ids'] as string[] | undefined;
  if (newContent && newAttachmentIds) {
    newContent['com.mindroom.attachment_ids'] = rewriteReplayAttachmentIds(
      newAttachmentIds,
      attachmentMap
    );
  }
  assertNoIncidentMediaReferences(content, forbiddenIncidentMedia);
  return content;
};
const sendMessageEvent = async (account: Account, eventType: string, content: unknown) =>
  matrixRequest<{ event_id: string }>(
    account,
    'PUT',
    `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${randomUUID()}`,
    content
  );
const sendStateEvent = async (
  account: Account,
  eventType: string,
  stateKey: string,
  content: unknown
) =>
  matrixRequest<{ event_id: string }>(
    account,
    'PUT',
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      eventType
    )}/${encodeURIComponent(stateKey)}`,
    content
  );

const rootResponse = await sendMessageEvent(accounts.user, 'm.room.message', {
  body: 'CINNY-126 exact-trace replay root',
  msgtype: 'm.text',
});
idMap.set(INCIDENT_THREAD_ROOT_ID, rootResponse.event_id);
process.stdout.write(`CINNY-126 test thread root: ${rootResponse.event_id}\n`);
process.stdout.write('Place the client-under-test on the test room overview now.\n');
const startDelayMs = Number(process.env.CINNY_126_START_DELAY_MS ?? '10000');
await new Promise<void>((resolve) => {
  setTimeout(resolve, startDelayMs);
});

const replayStartTs = trace.replayEvents[0].origin_server_ts;
const wallStart = Date.now();
for (const event of trace.replayEvents) {
  const targetElapsed = event.origin_server_ts - replayStartTs;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, targetElapsed - (Date.now() - wallStart)));
  });
  const account = accountForSender(event.sender);
  const content = rewriteContent(cloneTraceEvent(event, roomId));
  let response: { event_id: string };
  if (event.state_key !== undefined) {
    const parsedStateKey = JSON.parse(event.state_key) as [string, string];
    parsedStateKey[0] = idMap.get(parsedStateKey[0]) ?? parsedStateKey[0];
    response = await sendStateEvent(account, event.type, JSON.stringify(parsedStateKey), content);
  } else {
    response = await sendMessageEvent(account, event.type, content);
  }
  idMap.set(event.event_id, response.event_id);
  process.stdout.write(
    `${JSON.stringify({
      originalEventId: event.event_id,
      replayEventId: response.event_id,
      scheduledOffsetMs: targetElapsed,
      observedOffsetMs: Date.now() - wallStart,
      senderRole: event.sender,
    })}\n`
  );
}
process.stdout.write(
  `CINNY126_LIVE_REPLAY_COMPLETE room=${roomId} thread=${rootResponse.event_id} events=${trace.replayEvents.length}\n`
);
