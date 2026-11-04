#!/usr/bin/env node
/**
 * Seeds the App Store screenshot room on a local homeserver: Sam Rivera's household, where Sam
 * talks to three MindRoom agents (Hearth for the house, Pantry for meals, Atlas for plans).
 *
 * Usage (normally through scripts/appstore-fixture-up.sh):
 *   E2E_HOMESERVER=http://127.0.0.1:28008 E2E_USERNAME=... E2E_PASSWORD=... \
 *   E2E_FIXTURE_ROOM_ALIAS='#mindroom-app-store-personal-showcase-<run>:matrix.localhost' \
 *   node scripts/seed-appstore-screenshot-room.mjs
 *
 * The account must exist. The agents are registered here, one set per room alias. Everyone gets
 * the fictional household's avatar from scripts/fixtures/appstore/avatars/, so nothing private or
 * downloaded ends up in a screenshot. Every thread has a summary notice like the ones MindRoom
 * posts; e2e/app-store-screenshots.spec.ts finds the threads by those titles. Prints the room ID
 * as `Room: <id>`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const homeserver = (process.env.E2E_HOMESERVER ?? '').replace(/\/$/, '');
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const roomAlias = process.env.E2E_FIXTURE_ROOM_ALIAS;

if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(homeserver)) {
  console.error(`Refusing to seed ${homeserver || '(no E2E_HOMESERVER)'}: only local homeservers.`);
  process.exit(64);
}
if (!username || !password || !roomAlias) {
  console.error('E2E_USERNAME, E2E_PASSWORD and E2E_FIXTURE_ROOM_ALIAS must be set.');
  process.exit(64);
}
const aliasName = /^#([^:]+):/.exec(roomAlias)?.[1];
if (!aliasName) {
  console.error(`E2E_FIXTURE_ROOM_ALIAS is not a room alias: ${roomAlias}`);
  process.exit(64);
}
// Agent accounts are per room, so two runs never share an agent.
const agentSuffix = aliasName
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase()
  .slice(-24);

const matrix = async (method, path, { token, json, bytes, contentType } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (bytes) headers['Content-Type'] = contentType;
  const response = await fetch(`${homeserver}/_matrix${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : bytes,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(`${method} ${path}: ${response.status} ${payload.errcode ?? ''}`);
    failure.errcode = payload.errcode;
    throw failure;
  }
  return payload;
};
const enc = encodeURIComponent;

// ── Avatars ─────────────────────────────────────────────────────────────────────────────────────
// 256 px copies of the Rivera household's portraits in mindroom-ai/demo at commit
// fc39fb8a9e4af01c3c848e191f32c25b7da694a2 (world/home/avatars/people/sam.png and
// world/home/avatars/agents/{hearth,pantry,atlas}.png; the agents' are MindRoom's painted stock
// avatars home, general and helper). Made with
// `magick <source> -resize 256x256 -strip -define png:exclude-chunks=date,time,tIME <copy>`.

const readAvatar = (name) =>
  readFileSync(new URL(`./fixtures/appstore/avatars/${name}.png`, import.meta.url));

const setProfile = async (account, displayName, avatarName) => {
  const id = enc(account.userId);
  await matrix('PUT', `/client/v3/profile/${id}/displayname`, {
    token: account.token,
    json: { displayname: displayName },
  });
  const { content_uri: avatarUrl } = await matrix(
    'POST',
    `/media/v3/upload?filename=${enc(`${avatarName}.png`)}`,
    { token: account.token, bytes: readAvatar(avatarName), contentType: 'image/png' }
  );
  await matrix('PUT', `/client/v3/profile/${id}/avatar_url`, {
    token: account.token,
    json: { avatar_url: avatarUrl },
  });
  return { ...account, name: displayName };
};

const login = async (user) => {
  const session = await matrix('POST', '/client/v3/login', {
    json: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
      initial_device_display_name: 'App Store fixture seeding',
    },
  });
  return { userId: session.user_id, token: session.access_token };
};

const registerAgent = async (localpart) => {
  try {
    const created = await matrix('POST', '/client/v3/register', {
      json: { username: localpart, password, auth: { type: 'm.login.dummy' } },
    });
    return { userId: created.user_id, token: created.access_token };
  } catch (error) {
    if (error.errcode !== 'M_USER_IN_USE') throw error;
    return login(localpart);
  }
};

// ── Messages in MindRoom's shapes ─────────────────────────────────────────────────────────────

const send = async (account, roomId, content) =>
  (
    await matrix('PUT', `/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`, {
      token: account.token,
      json: content,
    })
  ).event_id;

const threadRelation = (rootId, previousId) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: previousId },
});

const ask = (sam, roomId, agent, text) =>
  send(sam, roomId, {
    msgtype: 'm.text',
    body: `@${agent.name} ${text}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<a href="https://matrix.to/#/${agent.userId}">${agent.name}</a> ${text}`,
    'm.mentions': { user_ids: [agent.userId] },
  });

const MODEL = {
  config: 'sonnet',
  display_name: 'Claude Sonnet 5.5',
  id: 'claude-sonnet-5-5',
  provider: 'anthropic',
};

/**
 * An agent's finished reply; `tools` are [name, arguments, result] rows shown above the text. Each
 * tool marker is a paragraph of its own, as MindRoom sends them, so the client groups them.
 */
const answer = (agent, roomId, rootId, { body, html, tools = [] }) => {
  const markers = tools.map(([name], index) => `🔧 \`${name}\` [${index + 1}]\n\n`);
  const markerHtml = tools.map(([name], index) => `<p>🔧 <code>${name}</code> [${index + 1}]</p>`);
  return send(agent, roomId, {
    msgtype: 'm.text',
    body: `${markers.join('')}${body}`,
    format: 'org.matrix.custom.html',
    formatted_body: `${markerHtml.join('')}${html}`,
    'm.relates_to': threadRelation(rootId, rootId),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.ai_run': {
      version: 1,
      run_id: randomUUID(),
      session_id: randomUUID(),
      status: 'completed',
      model: MODEL,
    },
    ...(tools.length > 0
      ? {
          'io.mindroom.tool_trace': {
            version: 2,
            events: tools.map(([name, args, result]) => ({
              type: 'tool_call_completed',
              tool_name: name,
              args_preview: args,
              result_preview: result,
            })),
          },
        }
      : {}),
  });
};

const summarize = (agent, roomId, rootId, lastId, title, messageCount) =>
  send(agent, roomId, {
    msgtype: 'm.notice',
    body: title,
    'm.relates_to': threadRelation(rootId, lastId),
    'io.mindroom.thread_summary': {
      version: 1,
      summary: title,
      message_count: messageCount,
      generated_at: new Date().toISOString(),
      model: 'haiku',
    },
  });

// Oldest first: the overview lists the newest reply on top, so the week overview leads.
const threads = [
  {
    agent: 'hearth',
    ask: 'remind me to call Rosa tomorrow at four.',
    title: 'Call Rosa at four: reminder scheduled in this thread.',
    tools: [['schedule_task', 'tomorrow 16:00 · Call Rosa', 'Scheduled for tomorrow at 4:00 PM.']],
    body: "One less thing to remember. I'll post here tomorrow at 4:00 PM to call Rosa, with her number and your note about Sunday lunch.",
    html: "<p><strong>One less thing to remember.</strong> I'll post here tomorrow at 4:00 PM to call Rosa, with her number and your note about Sunday lunch.</p>",
  },
  {
    agent: 'atlas',
    ask: 'plan a Lisbon weekend for two, under €900 with flights.',
    title: 'Lisbon weekend for two: old town, by the sea, or a long weekend.',
    body: [
      'Three ways to do it under €900 for two, flights from Amsterdam included.',
      'Old town · €842\nTwo nights in an Alfama guesthouse, tram 28 to the castle, and fado on Saturday night.',
      'By the sea · €876\nAn apartment in Cascais, forty minutes by train from the center, with beach mornings and seafood at the harbor.',
      'Long weekend · €898\nThree nights in Príncipe Real, a day trip to Sintra, and pastries in Belém on the way back.',
      'Shall I hold the old town option? Prices hold until Thursday.',
    ].join('\n\n'),
    html:
      '<p><strong>Three ways to do it under €900</strong> for two, flights from Amsterdam included.</p>' +
      '<h3>Old town · €842</h3><p>Two nights in an Alfama guesthouse, tram 28 to the castle, and fado on Saturday night.</p>' +
      '<h3>By the sea · €876</h3><p>An apartment in Cascais, forty minutes by train from the center, with beach mornings and seafood at the harbor.</p>' +
      '<h3>Long weekend · €898</h3><p>Three nights in Príncipe Real, a day trip to Sintra, and pastries in Belém on the way back.</p>' +
      '<p>Shall I hold the old town option? Prices hold until Thursday.</p>',
  },
  {
    agent: 'hearth',
    ask: "I'm heading out. Lights off, lock the front door, and turn the heating down.",
    title: 'Heading out: lights off, front door locked, heating set to 17°C.',
    tools: [
      ['turn_off', 'light.turn_off · all lights', 'All lights are off.'],
      ['call_service', 'lock.lock · front door', 'Front door is locked.'],
      ['set_temperature', 'climate.set_temperature · 17°C', 'Heating is set to 17°C.'],
    ],
    body: "All set. Have a lovely evening! I'll warm the house back to 20°C half an hour before you're home.",
    html: "<p>All set. Have a lovely evening! I'll warm the house back to 20°C half an hour before you're home.</p>",
  },
  {
    agent: 'pantry',
    ask: 'five quick vegetarian dinners for this week, and one grocery list please.',
    title: 'Vegetarian weeknight dinners: five quick meals and one grocery list.',
    body: [
      'Dinner, sorted. Five vegetarian weeknight meals, each on the table in about 30 minutes:',
      '1. Monday: chickpea and spinach curry with rice\n2. Tuesday: lemony orzo with peas and feta\n3. Wednesday: black bean tacos with quick-pickled onions\n4. Thursday: miso noodle soup with tofu and greens\n5. Friday: sheet-pan gnocchi with cherry tomatoes and mozzarella',
      'Groceries',
      '- Produce: spinach, peas, red onion, limes, cherry tomatoes, bok choy, garlic, ginger, lemon\n- Pantry: chickpeas, black beans, coconut milk, orzo, rice, gnocchi, miso paste, noodles\n- Fridge: feta, mozzarella, firm tofu, Greek yogurt\n- Extras: corn tortillas, curry paste, chili crisp',
      "Cook extra rice on Monday and it becomes Thursday's side.",
    ].join('\n\n'),
    html:
      '<p><strong>Dinner, sorted.</strong> Five vegetarian weeknight meals, each on the table in about 30 minutes:</p>' +
      '<ol><li><strong>Monday</strong>: chickpea and spinach curry with rice</li><li><strong>Tuesday</strong>: lemony orzo with peas and feta</li>' +
      '<li><strong>Wednesday</strong>: black bean tacos with quick-pickled onions</li><li><strong>Thursday</strong>: miso noodle soup with tofu and greens</li>' +
      '<li><strong>Friday</strong>: sheet-pan gnocchi with cherry tomatoes and mozzarella</li></ol>' +
      '<h3>Groceries</h3><ul><li><strong>Produce</strong>: spinach, peas, red onion, limes, cherry tomatoes, bok choy, garlic, ginger, lemon</li>' +
      '<li><strong>Pantry</strong>: chickpeas, black beans, coconut milk, orzo, rice, gnocchi, miso paste, noodles</li>' +
      '<li><strong>Fridge</strong>: feta, mozzarella, firm tofu, Greek yogurt</li><li><strong>Extras</strong>: corn tortillas, curry paste, chili crisp</li></ul>' +
      "<p>Cook extra rice on Monday and it becomes Thursday's side.</p>",
  },
  {
    agent: 'atlas',
    ask: 'what does my week look like?',
    title: 'Your week: Lisbon plans, quick dinners, a cozy home, and one timely reminder.',
    body: "Your week, together: Lisbon options are ready to book, Pantry has five dinners planned, Hearth keeps the house warm, and Rosa's call is set for tomorrow at four.",
    html: "<p><strong>Your week, together:</strong> Lisbon options are ready to book, Pantry has five dinners planned, Hearth keeps the house warm, and Rosa's call is set for tomorrow at four.</p>",
  },
];

const main = async () => {
  const sam = await setProfile(await login(username), 'Sam Rivera', 'sam');
  const addAgent = async (name, displayName) =>
    setProfile(await registerAgent(`mindroom_${name}_${agentSuffix}`), displayName, name);
  const agents = {
    hearth: await addAgent('hearth', 'Hearth'),
    pantry: await addAgent('pantry', 'Pantry'),
    atlas: await addAgent('atlas', 'Atlas'),
  };

  const { room_id: roomId } = await matrix('POST', '/client/v3/createRoom', {
    token: sam.token,
    json: {
      name: 'Rivera Home',
      topic: 'Sam with Hearth, Pantry, and Atlas',
      preset: 'private_chat',
      room_alias_name: aliasName,
      invite: Object.values(agents).map((agent) => agent.userId),
    },
  });
  await Promise.all(
    Object.values(agents).map((agent) =>
      matrix('POST', `/client/v3/join/${enc(roomId)}`, { token: agent.token, json: {} })
    )
  );

  for (const thread of threads) {
    const agent = agents[thread.agent];
    const rootId = await ask(sam, roomId, agent, thread.ask);
    const replyId = await answer(agent, roomId, rootId, thread);
    await summarize(agent, roomId, rootId, replyId, thread.title, 2);
  }
  console.log(`Room: ${roomId}`);
};

await main();
