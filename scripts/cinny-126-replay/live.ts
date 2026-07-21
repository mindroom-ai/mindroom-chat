import { randomUUID } from 'node:crypto';
import { loadExactTrace, type TraceEvent } from './trace';
import {
  assertNoForbiddenStrings,
  assertLiveReplayRoomIsolation,
  buildSafeLiveReplayContent,
  buildSafeLiveReplayStateKey,
  buildLiveReplayRoomRequest,
  LIVE_REPLAY_CANARY_TYPE,
  type LiveReplayEventKind,
} from './liveSafety';

type Role = 'user' | 'router' | 'agent';
type Account = { accessToken: string; userId: string };

const homeserver = 'https://mindroom.chat';
const confirmation = process.env.CINNY_126_TEST_ROOM_CONFIRM;
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
const forbiddenPrivateReferences = new Set([
  trace.ids.room,
  trace.ids.threadRoot,
  ...trace.replayEvents.map((event) => event.event_id),
  ...Object.values(trace.senders),
]);
type ReplayDescriptor = {
  channel: 'message' | 'state';
  eventType: 'm.room.message' | 'com.mindroom.thread.tags';
  index: number;
  kind: LiveReplayEventKind;
};
const describeTraceEvent = (event: TraceEvent): ReplayDescriptor => {
  let descriptor: ReplayDescriptor;
  if (event === trace.voice) {
    descriptor = { channel: 'message', eventType: 'm.room.message', index: 0, kind: 'voice' };
  } else if (event === trace.transcription) {
    descriptor = {
      channel: 'message',
      eventType: 'm.room.message',
      index: 0,
      kind: 'transcription',
    };
  } else if (event === trace.placeholder) {
    descriptor = {
      channel: 'message',
      eventType: 'm.room.message',
      index: 0,
      kind: 'placeholder',
    };
  } else {
    const editIndex = trace.edits.indexOf(event);
    const tagIndex = trace.tags.indexOf(event);
    if (editIndex >= 0) {
      descriptor = {
        channel: 'message',
        eventType: 'm.room.message',
        index: editIndex,
        kind: 'edit',
      };
    } else if (tagIndex >= 0) {
      descriptor = {
        channel: 'state',
        eventType: 'com.mindroom.thread.tags',
        index: tagIndex,
        kind: 'tag',
      };
    } else if (event === trace.summary) {
      descriptor = {
        channel: 'message',
        eventType: 'm.room.message',
        index: 0,
        kind: 'summary',
      };
    } else {
      throw new Error('Unknown event in validated trace');
    }
  }
  const sourceChannel = event.state_key === undefined ? 'message' : 'state';
  if (event.type !== descriptor.eventType || sourceChannel !== descriptor.channel) {
    throw new Error('Validated trace kind does not match the synthetic replay plan');
  }
  return descriptor;
};
const replayPlan = trace.replayEvents.map((event) => ({
  descriptor: describeTraceEvent(event),
  event,
}));

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
      if (Object.values(trace.senders).some((userId) => userId === whoami.user_id)) {
        throw new Error('An original trace account is forbidden');
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
if (!roomId || roomId === trace.ids.room) throw new Error('Homeserver returned an invalid room');
await Promise.all(
  ([accounts.router, accounts.agent] as Account[]).map((account) =>
    matrixRequest<{ room_id: string }>(account, 'POST', `/join/${encodeURIComponent(roomId)}`, {})
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
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(LIVE_REPLAY_CANARY_TYPE)}/`
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
  const role = (Object.entries(trace.senders) as Array<[Role, string]>).find(
    ([, originalSender]) => originalSender === sender
  )?.[0];
  if (!role) throw new Error('No test role for trace sender');
  return accounts[role];
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
idMap.set(trace.ids.threadRoot, rootResponse.event_id);
process.stdout.write(`CINNY-126 test thread root: ${rootResponse.event_id}\n`);
process.stdout.write('Place the client-under-test on the test room overview now.\n');
const startDelayMs = Number(process.env.CINNY_126_START_DELAY_MS ?? '10000');
await new Promise<void>((resolve) => {
  setTimeout(resolve, startDelayMs);
});

const replayStartTs = trace.replayEvents[0].origin_server_ts;
const wallStart = Date.now();
for (const [sequence, { descriptor, event }] of replayPlan.entries()) {
  const targetElapsed = event.origin_server_ts - replayStartTs;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, targetElapsed - (Date.now() - wallStart)));
  });
  const account = accountForSender(event.sender);
  const content = buildSafeLiveReplayContent({
    event,
    idMap,
    index: descriptor.index,
    kind: descriptor.kind,
    senderUserId: account.userId,
  });
  assertNoForbiddenStrings(content, forbiddenPrivateReferences);
  let response: { event_id: string };
  if (descriptor.channel === 'state') {
    const stateKey = buildSafeLiveReplayStateKey(event, idMap, descriptor.index);
    assertNoForbiddenStrings(stateKey, forbiddenPrivateReferences);
    response = await sendStateEvent(account, descriptor.eventType, stateKey, content);
  } else {
    response = await sendMessageEvent(account, descriptor.eventType, content);
  }
  idMap.set(event.event_id, response.event_id);
  process.stdout.write(
    `${JSON.stringify({
      kind: descriptor.kind,
      replayEventId: response.event_id,
      scheduledOffsetMs: targetElapsed,
      sequence,
      observedOffsetMs: Date.now() - wallStart,
      senderRole: (Object.entries(accounts) as Array<[Role, Account]>).find(
        ([, candidate]) => candidate === account
      )?.[0],
    })}\n`
  );
}
process.stdout.write(
  `CINNY126_LIVE_REPLAY_COMPLETE room=${roomId} thread=${rootResponse.event_id} events=${trace.replayEvents.length}\n`
);
