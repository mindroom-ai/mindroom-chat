#!/usr/bin/env node

const HOMESERVER = process.env.E2E_HOMESERVER || 'http://127.0.0.1:28008';
const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS || '#mindroom-app-store-screenshots:matrix.localhost';
const ROOM_ALIAS_LOCAL = /^#([^:]+):.+$/.exec(ROOM_ALIAS)?.[1] ?? 'mindroom-app-store-screenshots';
const ROOM_NAME = 'MindRoom Agent Lab';
const ROOM_TOPIC = 'Threads, tool calls, and summaries in one Matrix workspace.';
const DISPLAY_NAME = 'MindRoom Release';
const ROOT_BODY = 'Can you prepare the iOS release checklist for today?';
const SUMMARY_TEXT =
  'iOS release plan: screenshots, TestFlight, and reviewer access are ready to review.';

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: E2E_USERNAME and E2E_PASSWORD must be set');
  process.exit(1);
}

async function matrixFetch(path, accessToken, options = {}) {
  const url = `${HOMESERVER}/_matrix/client/v3${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok && body.errcode) {
    const error = new Error(`Matrix API error: ${body.errcode} - ${body.error}`);
    error.errcode = body.errcode;
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function login() {
  console.log(`Logging in as ${USERNAME}...`);
  const body = await matrixFetch('/login', null, {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: USERNAME },
      password: PASSWORD,
    }),
  });
  return body;
}

async function setDisplayName(accessToken, userId) {
  await matrixFetch(`/profile/${encodeURIComponent(userId)}/displayname`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({ displayname: DISPLAY_NAME }),
  });
}

async function resolveOrCreateRoom(accessToken) {
  try {
    const resolved = await matrixFetch(
      `/directory/room/${encodeURIComponent(ROOM_ALIAS)}`,
      accessToken
    );
    console.log(`Room alias exists: ${resolved.room_id}`);
    await matrixFetch(`/join/${encodeURIComponent(resolved.room_id)}`, accessToken, {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch((error) => {
      if (error.errcode !== 'M_ALREADY_JOINED') throw error;
    });
    return resolved.room_id;
  } catch (error) {
    if (error.errcode !== 'M_NOT_FOUND') throw error;
  }

  console.log(`Creating App Store screenshot room with alias ${ROOM_ALIAS_LOCAL}...`);
  const created = await matrixFetch('/createRoom', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      room_alias_name: ROOM_ALIAS_LOCAL,
      name: ROOM_NAME,
      topic: ROOM_TOPIC,
      preset: 'public_chat',
    }),
  });
  console.log(`Created room: ${created.room_id}`);
  return created.room_id;
}

async function getMessages(accessToken, roomId, limit = 100) {
  const params = new URLSearchParams({ dir: 'b', limit: String(limit) });
  const result = await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    accessToken
  );
  return result.chunk || [];
}

function findMessageByBody(messages, body) {
  return messages.find(
    (event) =>
      event.type === 'm.room.message' &&
      typeof event.content?.body === 'string' &&
      event.content.body.includes(body)
  );
}

async function sendEvent(accessToken, roomId, eventType, content) {
  const txnId = `appstore-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await matrixFetch(
    `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${txnId}`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(content),
    }
  );
  return result.event_id;
}

async function sendMessage(accessToken, roomId, content) {
  return sendEvent(accessToken, roomId, 'm.room.message', content);
}

async function seedReleaseThread(accessToken, roomId, messages) {
  const existingRoot = findMessageByBody(messages, ROOT_BODY);
  if (existingRoot) {
    console.log(`App Store screenshot thread already seeded (${existingRoot.event_id}).`);
    return existingRoot.event_id;
  }

  console.log('Sending App Store screenshot thread...');
  const rootId = await sendMessage(accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT_BODY,
  });

  const replies = [
    'Screenshots: capture iPhone 6.9 and iPad 13 views.',
    'Fastlane: upload metadata first, then the complete screenshot set.',
    'Review: add temporary reviewer credentials before submission.',
  ];

  for (const [index, body] of replies.entries()) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await sendMessage(accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    console.log(`  Reply ${index + 1}: ${body}`);
  }

  return rootId;
}

async function seedSummary(accessToken, roomId, messages, rootId) {
  if (findMessageByBody(messages, SUMMARY_TEXT)) {
    console.log('App Store screenshot summary already seeded.');
    return;
  }

  console.log('Sending App Store screenshot summary...');
  await sendMessage(accessToken, roomId, {
    msgtype: 'm.notice',
    body: SUMMARY_TEXT,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>${SUMMARY_TEXT}</p>`,
    'io.mindroom.thread_summary': {
      version: 1,
      topic: 'iOS Release',
      summary: SUMMARY_TEXT,
      message_count: 4,
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
}

async function main() {
  const session = await login();
  await setDisplayName(session.access_token, session.user_id);
  const roomId = await resolveOrCreateRoom(session.access_token);
  const messages = await getMessages(session.access_token, roomId);
  const rootId = await seedReleaseThread(session.access_token, roomId, messages);
  await seedSummary(session.access_token, roomId, messages, rootId);

  console.log('\nApp Store screenshot fixture ready.');
  console.log(`  Room: ${roomId}`);
  console.log(`  Alias: ${ROOM_ALIAS}`);
  console.log(`  Summary: ${SUMMARY_TEXT}`);
}

main().catch((error) => {
  console.error('App Store screenshot fixture seeding failed:', error.message);
  process.exit(1);
});
