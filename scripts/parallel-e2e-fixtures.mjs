import { randomBytes } from 'node:crypto';

const CLIENT_API = '/_matrix/client/v3';
const REQUEST_TIMEOUT_MS = 10_000;

const isSuccess = (status) => status >= 200 && status < 300;

const jobPart = (value) => {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return normalized.slice(0, 20) || 'run';
};

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw new Error('Matrix fixture provisioning was cancelled.');
};

const request = async ({ homeserver, path, method = 'POST', accessToken, body, signal }) => {
  throwIfCancelled(signal);
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response;
  try {
    response = await fetch(`${homeserver}${CLIENT_API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error('Matrix fixture provisioning was cancelled.');
    if (error?.name === 'TimeoutError') throw new Error('Matrix request timed out.');
    throw new Error('Matrix request could not be completed.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Matrix request returned invalid JSON (${response.status}).`);
  }
  return { status: response.status, data };
};

const expectSuccess = ({ status, data }, operation) => {
  if (!isSuccess(status)) throw new Error(`${operation} failed (${status}).`);
  return data;
};

const registrationResult = (data) => {
  if (
    !data ||
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    typeof data.user_id !== 'string' ||
    !data.user_id
  )
    throw new Error('Matrix registration response is missing session credentials.');
  return data;
};

const supportsDummyAuth = (data) =>
  typeof data?.session === 'string' &&
  Array.isArray(data.flows) &&
  data.flows.some((flow) => Array.isArray(flow?.stages) && flow.stages.includes('m.login.dummy'));

const register = async (homeserver, username, signal) => {
  const password = `Pw${randomBytes(18).toString('base64url')}`;
  const initial = await request({
    homeserver,
    path: '/register',
    body: { username, password },
    signal,
  });
  if (isSuccess(initial.status)) {
    return { username, password, ...registrationResult(initial.data) };
  }
  if (initial.status !== 401) expectSuccess(initial, 'Matrix registration');
  if (!supportsDummyAuth(initial.data)) throw new Error('Unsupported Matrix registration flow.');

  const completed = await request({
    homeserver,
    path: '/register',
    body: {
      username,
      password,
      auth: { type: 'm.login.dummy', session: initial.data.session },
    },
    signal,
  });
  return {
    username,
    password,
    ...registrationResult(expectSuccess(completed, 'Matrix registration')),
  };
};

const serverNameFromUserId = (userId) => {
  const separator = userId.indexOf(':', 1);
  if (!userId.startsWith('@') || separator < 2 || separator === userId.length - 1) {
    throw new Error('Matrix registration returned an invalid user ID.');
  }
  return userId.slice(separator + 1);
};

const requireRoomId = (data, operation) => {
  if (!data || typeof data.room_id !== 'string' || !data.room_id) {
    throw new Error(`${operation} response is missing a room ID.`);
  }
  return data.room_id;
};

const requireEventId = (data) => {
  if (!data || typeof data.event_id !== 'string' || !data.event_id) {
    throw new Error('Matrix send response is missing an event ID.');
  }
  return data.event_id;
};

const prepareNarrowToolbar = async (homeserver, roomId, primary, agent, signal) => {
  await expectSuccess(
    await request({
      homeserver,
      path: `/rooms/${encodeURIComponent(roomId)}/invite`,
      accessToken: primary.access_token,
      body: { user_id: agent.user_id },
      signal,
    }),
    'Matrix fixture invite'
  );
  await expectSuccess(
    await request({
      homeserver,
      path: `/join/${encodeURIComponent(roomId)}`,
      accessToken: agent.access_token,
      body: {},
      signal,
    }),
    'Matrix fixture join'
  );
};

const prepareMinimap = async (homeserver, primary, agent, signal) => {
  const roomId = requireRoomId(
    expectSuccess(
      await request({
        homeserver,
        path: '/createRoom',
        accessToken: primary.access_token,
        body: {
          name: 'Minimap Long Room',
          preset: 'private_chat',
          invite: [agent.user_id],
        },
        signal,
      }),
      'Matrix minimap room creation'
    ),
    'Matrix minimap room creation'
  );
  await expectSuccess(
    await request({
      homeserver,
      path: `/join/${encodeURIComponent(roomId)}`,
      accessToken: agent.access_token,
      body: {},
      signal,
    }),
    'Matrix minimap agent join'
  );

  const longMessage =
    'This is a deliberately long explanatory paragraph so the thread overflows the viewport. It repeats detail about configuration, environments, ports, tokens, fixtures, pagination, caching, rendering, and scroll behavior so that every reply occupies substantial vertical space in the timeline for scrolling checks. It keeps going with more filler about timelines, threads, edits, streams, tool traces, and message previews to be extra sure.';
  let transaction = 0;
  const send = async (accessToken, body, extra = {}) =>
    requireEventId(
      expectSuccess(
        await request({
          homeserver,
          method: 'PUT',
          path: `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/m${transaction++}`,
          accessToken,
          body: { msgtype: 'm.text', body, ...extra },
          signal,
        }),
        'Matrix minimap message'
      )
    );
  const rootId = await send(
    primary.access_token,
    `Root question: how does the whole local stack fit together? ${longMessage}`
  );
  const relation = { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } };
  for (let reply = 1; reply <= 5; reply += 1) {
    await send(agent.access_token, `Answer number ${reply}. ${longMessage} ${longMessage}`, {
      ...relation,
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    await send(primary.access_token, `Question number ${reply} about the setup?`, relation);
  }
  await send(agent.access_token, `Final answer wrapping everything up. ${longMessage}`, {
    ...relation,
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
  });
};

export const provisionSpec = async ({
  file,
  homeserver,
  runId,
  index,
  productionURL,
  developmentURL,
  runSeed,
  signal,
}) => {
  if (typeof runSeed !== 'function') throw new Error('A fixture seed callback is required.');
  void developmentURL;
  throwIfCancelled(signal);

  const unique = `${jobPart(runId)}${jobPart(index)}${randomBytes(6).toString('hex')}`;
  const usernames = {
    primary: `lv${unique}p`,
    second: `lv${unique}s`,
    third: `lv${unique}t`,
    deactivate: `lv${unique}d`,
    agent: `mindroom_lv${unique}a`,
  };
  const primary = await register(homeserver, usernames.primary, signal);
  const second = await register(homeserver, usernames.second, signal);
  const third = await register(homeserver, usernames.third, signal);
  const deactivate = await register(homeserver, usernames.deactivate, signal);
  const agent = await register(homeserver, usernames.agent, signal);
  const serverName = serverNameFromUserId(primary.user_id);
  const alias = `#lv${unique}:${serverName}`;
  const shotPrefix = `${jobPart(file.split('/').pop() ?? 'spec')}-${jobPart(runId)}-${jobPart(
    index
  )}-${randomBytes(5).toString('hex')}`;

  const env = {
    E2E_UI_ACTIONS_HOMESERVER: homeserver,
    E2E_HOMESERVER: homeserver,
    E2E_BASE_URL: productionURL,
    E2E_NO_WEB_SERVER: '1',
    E2E_USERNAME: primary.username,
    E2E_PASSWORD: primary.password,
    E2E_SECOND_USERNAME: second.username,
    E2E_SECOND_PASSWORD: second.password,
    E2E_THIRD_USERNAME: third.username,
    E2E_THIRD_PASSWORD: third.password,
    E2E_DEACTIVATE_USERNAME: deactivate.username,
    E2E_DEACTIVATE_PASSWORD: deactivate.password,
    E2E_AGENT_USERNAME: agent.username,
    E2E_AGENT_PASSWORD: agent.password,
    E2E_AGENT_USER_ID: agent.user_id,
    E2E_FIXTURE_ROOM_ALIAS: alias,
    E2E_DEPLOYED_BASE_URL: productionURL,
    E2E_DEPLOYED_HOMESERVER: homeserver,
    E2E_DEPLOYED_USERNAME: primary.username,
    E2E_DEPLOYED_PASSWORD: primary.password,
    SHOT_PREFIX: shotPrefix,
  };

  const seedScript = file.includes('app-store-screenshots')
    ? 'scripts/seed-appstore-screenshot-room.mjs'
    : 'e2e/live/seed-fixture-room.mjs';
  await runSeed(seedScript, env);
  throwIfCancelled(signal);

  const roomId = requireRoomId(
    expectSuccess(
      await request({
        homeserver,
        method: 'GET',
        path: `/directory/room/${encodeURIComponent(alias)}`,
        accessToken: primary.access_token,
        signal,
      }),
      'Matrix fixture room lookup'
    ),
    'Matrix fixture room lookup'
  );
  env.E2E_FIXTURE_ROOM_ID = roomId;
  env.E2E_ROOM_ID = roomId;

  if (file.includes('narrow-toolbar'))
    await prepareNarrowToolbar(homeserver, roomId, primary, agent, signal);
  if (file.includes('minimap-verify')) await prepareMinimap(homeserver, primary, agent, signal);
  return env;
};
