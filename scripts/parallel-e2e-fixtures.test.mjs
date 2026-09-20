import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import { provisionSpec } from './parallel-e2e-fixtures.mjs';

const response = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
};

const startMatrixStub = async ({
  registration = 'direct',
  failPath,
  hangPath,
  serverName = 'stub.test',
} = {}) => {
  const calls = [];
  const registrations = [];
  let event = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://matrix.test');
    const body = await readBody(req);
    calls.push({
      method: req.method,
      path: url.pathname,
      body,
      authorization: req.headers.authorization,
    });

    if (hangPath && url.pathname.startsWith(hangPath)) return;

    if (failPath && url.pathname.startsWith(failPath)) {
      response(res, 503, { errcode: 'M_UNKNOWN', error: 'unavailable' });
      return;
    }

    if (url.pathname === '/_matrix/client/v3/register') {
      if (registration !== 'direct' && !body.auth) {
        response(res, 401, {
          session: 'dummy-session',
          flows: [
            { stages: [registration === 'unsupported' ? 'm.login.password' : 'm.login.dummy'] },
          ],
        });
        return;
      }
      registrations.push(body);
      response(res, 200, {
        access_token: `token-${body.username}`,
        user_id: `@${body.username}:${serverName}`,
      });
      return;
    }

    if (url.pathname.startsWith('/_matrix/client/v3/directory/room/')) {
      response(res, 200, { room_id: '!fixture:stub.test' });
      return;
    }
    if (url.pathname === '/_matrix/client/v3/createRoom') {
      response(res, 200, { room_id: '!minimap:stub.test' });
      return;
    }
    if (url.pathname.includes('/send/m.room.message/')) {
      event += 1;
      response(res, 200, { event_id: `$event${event}` });
      return;
    }
    response(res, 200, {});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    calls,
    registrations,
    homeserver: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};

const optionsFor = (stub, overrides = {}) => ({
  file: 'e2e/account-storage.spec.ts',
  homeserver: stub.homeserver,
  runId: 'run-42',
  index: 1,
  productionURL: 'http://127.0.0.1:28204',
  developmentURL: 'http://127.0.0.1:4188',
  runSeed: async () => {},
  ...overrides,
});

const registrationFor = (stub, username) =>
  stub.registrations.find((registration) => registration.username === username);

test('provisions distinct role credentials, aliases, and shot prefixes for each job', async () => {
  const stub = await startMatrixStub();
  const seeds = [];
  try {
    const runSeed = async (script, env) => {
      seeds.push({ script, env });
    };
    const first = await provisionSpec(optionsFor(stub, { index: 1, runSeed }));
    const second = await provisionSpec(optionsFor(stub, { index: 2, runSeed }));

    assert.equal(stub.registrations.length, 10);
    assert.notEqual(first.E2E_USERNAME, second.E2E_USERNAME);
    assert.notEqual(first.E2E_FIXTURE_ROOM_ALIAS, second.E2E_FIXTURE_ROOM_ALIAS);
    assert.notEqual(first.SHOT_PREFIX, second.SHOT_PREFIX);
    assert.match(first.E2E_FIXTURE_ROOM_ALIAS, /:stub\.test$/);
    assert.equal(first.E2E_BASE_URL, 'http://127.0.0.1:28204');
    assert.equal(first.E2E_DEPLOYED_BASE_URL, 'http://127.0.0.1:28204');
    assert.equal(first.E2E_HOMESERVER, stub.homeserver);
    assert.equal(first.E2E_DEPLOYED_HOMESERVER, stub.homeserver);
    assert.equal(first.E2E_FIXTURE_ROOM_ID, '!fixture:stub.test');
    assert.equal(first.E2E_ROOM_ID, '!fixture:stub.test');
    assert.equal(first.E2E_NO_WEB_SERVER, '1');
    assert.equal(Object.hasOwn(first, 'CI'), false);

    for (const [usernameKey, passwordKey] of [
      ['E2E_USERNAME', 'E2E_PASSWORD'],
      ['E2E_SECOND_USERNAME', 'E2E_SECOND_PASSWORD'],
      ['E2E_THIRD_USERNAME', 'E2E_THIRD_PASSWORD'],
      ['E2E_DEACTIVATE_USERNAME', 'E2E_DEACTIVATE_PASSWORD'],
      ['E2E_AGENT_USERNAME', 'E2E_AGENT_PASSWORD'],
    ]) {
      const registration = registrationFor(stub, first[usernameKey]);
      assert.ok(registration, `${usernameKey} was registered`);
      assert.equal(first[passwordKey], registration.password);
      assert.notEqual(registration.password, 'PwLiveValidation123!');
    }
    assert.match(first.E2E_AGENT_USERNAME, /^mindroom_/);
    assert.equal(first.E2E_AGENT_USER_ID, `@${first.E2E_AGENT_USERNAME}:stub.test`);

    const portStub = await startMatrixStub({ serverName: 'stub.test:8448' });
    try {
      const portEnv = await provisionSpec(optionsFor(portStub));
      assert.match(portEnv.E2E_FIXTURE_ROOM_ALIAS, /:stub\.test:8448$/);
    } finally {
      await portStub.close();
    }
    assert.equal(first.E2E_DEPLOYED_USERNAME, first.E2E_USERNAME);
    assert.equal(first.E2E_DEPLOYED_PASSWORD, first.E2E_PASSWORD);
    assert.deepEqual(
      seeds.map(({ script }) => script),
      ['e2e/live/seed-fixture-room.mjs', 'e2e/live/seed-fixture-room.mjs']
    );
  } finally {
    await stub.close();
  }
});

test('uses dummy UIA only after the Matrix challenge and also accepts direct registration', async () => {
  const uia = await startMatrixStub({ registration: 'uia' });
  try {
    await provisionSpec(optionsFor(uia));
    const registerCalls = uia.calls.filter(({ path }) => path.endsWith('/register'));
    assert.equal(registerCalls.length, 10);
    for (let index = 0; index < registerCalls.length; index += 2) {
      assert.equal(registerCalls[index].body.auth, undefined);
      assert.deepEqual(registerCalls[index + 1].body.auth, {
        type: 'm.login.dummy',
        session: 'dummy-session',
      });
    }
  } finally {
    await uia.close();
  }

  const direct = await startMatrixStub();
  try {
    await provisionSpec(optionsFor(direct));
    assert.equal(direct.calls.filter(({ path }) => path.endsWith('/register')).length, 5);
  } finally {
    await direct.close();
  }
});

test('rejects Matrix UIA flows other than dummy registration', async () => {
  const stub = await startMatrixStub({ registration: 'unsupported' });
  try {
    await assert.rejects(provisionSpec(optionsFor(stub)), /Unsupported Matrix registration flow/);
    assert.equal(stub.registrations.length, 0);
  } finally {
    await stub.close();
  }
});

test('uses the app store seed without suppressing its expected primary profile', async () => {
  const stub = await startMatrixStub();
  const seeds = [];
  try {
    await provisionSpec(
      optionsFor(stub, {
        file: 'e2e/live/app-store-screenshots.spec.ts',
        runSeed: async (script, env) => {
          seeds.push({ script, env });
        },
      })
    );
    assert.equal(seeds.length, 1);
    assert.equal(seeds[0].script, 'scripts/seed-appstore-screenshot-room.mjs');
    assert.equal(seeds[0].env.APPSTORE_FIXTURE_SET_PRIMARY_PROFILE, undefined);
  } finally {
    await stub.close();
  }
});

test('prepares the narrow-toolbar room by inviting and joining the fixture agent', async () => {
  const stub = await startMatrixStub();
  try {
    const env = await provisionSpec(
      optionsFor(stub, {
        file: 'e2e/live/narrow-toolbar.spec.ts',
      })
    );
    const invite = stub.calls.find(({ path }) =>
      path.endsWith('/rooms/!fixture%3Astub.test/invite')
    );
    assert.deepEqual(invite?.body, { user_id: env.E2E_AGENT_USER_ID });
    const join = stub.calls.find(({ path }) => path.endsWith('/join/!fixture%3Astub.test'));
    assert.equal(join?.authorization, `Bearer token-${env.E2E_AGENT_USERNAME}`);
  } finally {
    await stub.close();
  }
});

test('prepares the minimap long room with the complete agent thread', async () => {
  const stub = await startMatrixStub();
  try {
    const env = await provisionSpec(
      optionsFor(stub, {
        file: 'e2e/live/minimap-verify.spec.ts',
      })
    );
    assert.ok(stub.calls.some(({ path }) => path.endsWith('/createRoom')));
    assert.ok(
      stub.calls.some(
        ({ path, authorization }) =>
          path.endsWith('/join/!minimap%3Astub.test') &&
          authorization === `Bearer token-${env.E2E_AGENT_USERNAME}`
      )
    );
    const messages = stub.calls.filter(({ path }) => path.includes('/send/m.room.message/'));
    assert.equal(messages.length, 12);
    assert.equal(
      messages.filter(({ body }) => body['io.mindroom.ai_run']?.status === 'completed').length,
      6
    );
    assert.ok(
      messages.some(({ body }) =>
        body.body.startsWith('Root question: how does the whole local stack fit together?')
      )
    );
    assert.ok(
      messages.some(({ body }) => /^Question number \d about the setup\?$/.test(body.body))
    );
    assert.ok(messages.some(({ body }) => /^Answer number \d\./.test(body.body)));
  } finally {
    await stub.close();
  }
});

test('does not register a user when cancellation was already requested', async () => {
  const stub = await startMatrixStub();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      provisionSpec(optionsFor(stub, { signal: controller.signal })),
      /cancelled/
    );
    assert.equal(stub.registrations.length, 0);
    assert.equal(stub.calls.length, 0);
  } finally {
    await stub.close();
  }
});

test('cancels a hanging Matrix request promptly', async () => {
  const stub = await startMatrixStub({ hangPath: '/_matrix/client/v3/register' });
  const controller = new AbortController();
  const started = Date.now();
  let deadline;
  try {
    setTimeout(() => controller.abort(), 20);
    await Promise.race([
      assert.rejects(provisionSpec(optionsFor(stub, { signal: controller.signal })), /cancelled/),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Cancellation did not stop the request.')),
          750
        );
      }),
    ]);
    assert.ok(Date.now() - started < 500);
  } finally {
    clearTimeout(deadline);
    await stub.close();
  }
});

test('a Matrix status failure rejects instead of returning a usable environment', async () => {
  const stub = await startMatrixStub({ failPath: '/_matrix/client/v3/directory/room/' });
  let seeded = false;
  try {
    await assert.rejects(
      provisionSpec(
        optionsFor(stub, {
          runSeed: async () => {
            seeded = true;
          },
        })
      ),
      /Matrix fixture room lookup failed \(503\)/
    );
    assert.equal(seeded, true);
  } finally {
    await stub.close();
  }
});
