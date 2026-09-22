import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./seed-streaming-stress-room.mjs', import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mindroom-stress-test-'));
  const state = {
    roomId: null,
    events: [],
    transactions: new Map(),
    devices: [],
    requests: [],
    fault: () => undefined,
    incorrectCount: false,
    requireRegistration: false,
    registered: false,
    loseCreateResponse: false,
    deviceOverride: null,
  };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(request.url, 'http://localhost');
    const version = /^\/_matrix\/client\/(v\d+)\//.exec(url.pathname)?.[1];
    const path = decodeURIComponent(url.pathname.replace(/^\/_matrix\/client\/v\d+/, ''));
    state.requests.push({ path, body });
    const reply = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    // Threads were introduced under v1; the homeserver has no v3 thread-list route.
    if (version !== (path.endsWith('/threads') ? 'v1' : 'v3')) {
      return reply(404, { errcode: 'M_UNRECOGNIZED' });
    }
    if (path === '/login') {
      if (state.requireRegistration && !state.registered) {
        return reply(403, { errcode: 'M_FORBIDDEN' });
      }
      state.devices.push(body.device_id);
      return reply(200, {
        user_id: '@mindroom_stress_disposable:test.local',
        access_token: 'secret-test-access-token',
        device_id: state.deviceOverride ?? body.device_id,
      });
    }
    if (path === '/register') {
      if (body.auth?.session !== 'registration-session') {
        return reply(401, {
          session: 'registration-session',
          flows: [{ stages: ['m.login.dummy'] }],
        });
      }
      state.registered = true;
      state.devices.push(body.device_id);
      return reply(200, {
        user_id: '@mindroom_stress_disposable:test.local',
        access_token: 'secret-test-access-token',
        device_id: body.device_id,
      });
    }
    if (path.startsWith('/directory/room/')) {
      return state.roomId
        ? reply(200, { room_id: state.roomId })
        : reply(404, { errcode: 'M_NOT_FOUND' });
    }
    if (path === '/createRoom') {
      state.roomId = '!stress:test.local';
      if (state.loseCreateResponse) return request.socket.destroy();
      return reply(200, { room_id: state.roomId });
    }
    if (path.includes('/send/m.room.message/')) {
      const transaction = path.split('/').at(-1);
      const failure = state.fault({ transaction, body, state });
      if (failure?.status) return reply(failure.status, failure.body ?? {});
      let event = state.transactions.get(transaction);
      if (!event) {
        event = {
          event_id: `$event-${state.events.length}`,
          type: 'm.room.message',
          content: body,
        };
        state.transactions.set(transaction, event);
        state.events.push(event);
      }
      if (failure?.disconnect) return request.socket.destroy();
      return reply(200, { event_id: event.event_id });
    }
    if (path.endsWith('/threads')) {
      const roots = state.events.filter((event) => !event.content['m.relates_to']);
      const offset = Number(url.searchParams.get('from') ?? 0);
      const chunk = roots.slice(offset, offset + 1).map((event) => {
        const replies = state.events.filter(
          (candidate) =>
            candidate.content['m.relates_to']?.rel_type === 'm.thread' &&
            candidate.content['m.relates_to'].event_id === event.event_id
        );
        return {
          ...event,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: state.incorrectCount ? replies.length + 1 : replies.length,
                latest_event: replies.at(-1),
              },
            },
          },
        };
      });
      return reply(200, {
        chunk,
        ...(offset + 1 < roots.length ? { next_batch: String(offset + 1) } : {}),
      });
    }
    return reply(404, { errcode: 'M_NOT_FOUND' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const manifest = join(directory, 'manifest.json');
  const homeserver = `http://127.0.0.1:${server.address().port}`;
  const run = (args = [], onSpawn) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          script,
          '--manifest',
          manifest,
          '--homeserver',
          homeserver,
          '--threads',
          '2',
          '--replies',
          '2',
          '--edits',
          '3',
          '--concurrency',
          '2',
          ...args,
        ],
        {
          env: {
            ...process.env,
            STRESS_USERNAME: 'mindroom_stress_disposable',
            STRESS_PASSWORD: 'secret-test-password',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('close', (code) => resolve({ code, output }));
      onSpawn?.(child);
    });
  return { state, run, manifest };
}

test('seeds real Matrix lifecycle payloads and verifies all paginated thread counts', async (t) => {
  const { state, run, manifest } = await fixture(t);
  state.requireRegistration = true;
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.equal(state.events.length, 18);
  const roots = state.events.filter((event) => !event.content['m.relates_to']);
  assert.equal(roots.length, 2);
  for (const root of roots) {
    const replies = state.events.filter(
      (event) =>
        event.content['m.relates_to']?.rel_type === 'm.thread' &&
        event.content['m.relates_to'].event_id === root.event_id
    );
    assert.equal(replies.length, 2);
    assert.equal(replies[0].content['m.relates_to']['m.in_reply_to'].event_id, root.event_id);
    assert.equal(replies[1].content['m.relates_to']['m.in_reply_to'].event_id, replies[0].event_id);
    for (const original of replies) {
      const edits = state.events.filter(
        (event) =>
          event.content['m.relates_to']?.rel_type === 'm.replace' &&
          event.content['m.relates_to'].event_id === original.event_id
      );
      assert.equal(original.content.msgtype, 'm.notice');
      assert.equal(original.content['io.mindroom.stream_status'], 'pending');
      assert.equal(original.content['m.relates_to'].is_falling_back, true);
      assert.deepEqual(
        edits.map((event) => event.content['m.new_content'].msgtype),
        ['m.notice', 'm.notice', 'm.text']
      );
      assert.deepEqual(
        edits.map((event) => event.content['io.mindroom.stream_status']),
        ['streaming', 'streaming', 'completed']
      );
      for (const edit of edits) {
        const content = edit.content['m.new_content'];
        assert.equal(content['m.relates_to'], undefined);
        assert.equal(
          content['io.mindroom.stream_status'],
          edit.content['io.mindroom.stream_status']
        );
        assert.equal(content.format, 'org.matrix.custom.html');
        assert.match(content.formatted_body, /<strong>/);
        assert.equal(edit.content.body, `* ${content.body}`);
      }
    }
  }
  const saved = JSON.parse(await readFile(manifest, 'utf8'));
  assert.equal(saved.verified.threadCount, 2);
  assert.equal(saved.verified.replyCount, 4);
  assert.equal(saved.threads.filter((thread) => thread.complete).length, 2);
  assert.doesNotMatch(
    JSON.stringify(saved) + result.output,
    /secret-test-password|secret-test-access-token/
  );
});

test('retries a lost send acknowledgement and 429 without duplicating Matrix events', async (t) => {
  const { state, run } = await fixture(t);
  const failed = new Set();
  state.fault = ({ transaction, body }) => {
    const status = body['io.mindroom.stream_status'];
    if (status === 'pending' && !failed.has('transport')) {
      failed.add('transport');
      return { disconnect: true };
    }
    if (status === 'streaming' && !failed.has('rate')) {
      failed.add('rate');
      failed.add(transaction);
      return { status: 429, body: { errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 1 } };
    }
    return undefined;
  };
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.equal(state.events.length, 18);
  assert.ok(failed.has('transport') && failed.has('rate'));
});

test('resumes failed threads with the same Matrix device and transaction identities', async (t) => {
  const { state, run, manifest } = await fixture(t);
  state.fault = ({ body }) =>
    body['io.mindroom.stream_status'] === 'streaming'
      ? { status: 403, body: { errcode: 'M_FORBIDDEN', error: 'secret-test-password' } }
      : undefined;
  const failed = await run(['--concurrency', '1']);
  assert.equal(failed.code, 1);
  assert.doesNotMatch(failed.output, /secret-test-password/);
  assert.equal(state.events.length, 2);
  const before = state.events.map((event) => event.event_id);
  state.fault = () => undefined;
  const resumed = await run(['--concurrency', '1']);
  assert.equal(resumed.code, 0, resumed.output);
  assert.deepEqual(
    state.events.slice(0, 2).map((event) => event.event_id),
    before
  );
  assert.equal(state.events.length, 18);
  const saved = JSON.parse(await readFile(manifest, 'utf8'));
  assert.deepEqual(state.devices, [saved.deviceId, saved.deviceId]);
});

test('verify mode never sends messages and rejects an incorrect server reply count', async (t) => {
  const { state, run, manifest } = await fixture(t);
  const seeded = await run();
  assert.equal(seeded.code, 0, seeded.output);
  state.incorrectCount = true;
  const before = state.requests.filter(({ path }) => path.includes('/send/')).length;
  const result = await run(['--verify']);
  assert.equal(result.code, 1);
  assert.match(result.output, /reply count/i);
  assert.equal(state.requests.filter(({ path }) => path.includes('/send/')).length, before);
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).verified, undefined);
});

test('rejects external homeservers and invalid workload sizes before network access', async (t) => {
  const { state, run } = await fixture(t);
  const external = await run(['--homeserver', 'https://matrix.org']);
  assert.equal(external.code, 1);
  assert.match(external.output, /loopback/i);
  const invalid = await run(['--threads', '0']);
  assert.equal(invalid.code, 1);
  assert.match(invalid.output, /threads/i);
  assert.equal(state.requests.length, 0);
});

test('stops after bounded retries instead of finishing a partial room', async (t) => {
  const { state, run } = await fixture(t);
  state.fault = () => ({ status: 429, body: { retry_after_ms: 1 } });
  const result = await run(['--concurrency', '1']);
  assert.equal(result.code, 1);
  assert.match(result.output, /429/);
  const sends = state.requests.filter(({ path }) => path.includes('/send/'));
  assert.ok(sends.length > 1 && sends.length <= 6);
  assert.equal(new Set(sends.map(({ path }) => path)).size, 1);
  assert.equal(state.events.length, 0);
});

test('recovers a lost create-room response through its stable alias', async (t) => {
  const { state, run } = await fixture(t);
  state.loseCreateResponse = true;
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.equal(state.requests.filter(({ path }) => path === '/createRoom').length, 1);
  assert.equal(state.events.length, 18);
});

test('resuming a partially seeded room skips completed thread checkpoints', async (t) => {
  const { state, run, manifest } = await fixture(t);
  state.fault = ({ body }) =>
    body['m.new_content']?.body.startsWith('STRESS-T0002-R001-V1') ? { status: 403 } : undefined;
  assert.equal((await run(['--concurrency', '1'])).code, 1);
  const saved = JSON.parse(await readFile(manifest, 'utf8'));
  assert.deepEqual(
    saved.threads.map((thread) => thread.complete),
    [true, false]
  );
  const requestCount = state.requests.length;
  state.fault = () => undefined;
  const result = await run(['--concurrency', '1']);
  assert.equal(result.code, 0, result.output);
  const resumedSends = state.requests
    .slice(requestCount)
    .filter(({ path }) => path.includes('/send/'));
  assert.ok(resumedSends.every(({ path }) => path.includes('-t1-')));
  assert.equal(state.events.length, 18);
});

test('rejects changed manifest settings before authenticating', async (t) => {
  const { state, run } = await fixture(t);
  assert.equal((await run()).code, 0);
  const requestCount = state.requests.length;
  const changed = await run(['--replies', '3']);
  assert.equal(changed.code, 1);
  assert.match(changed.output, /manifest/i);
  assert.equal(state.requests.length, requestCount);
});

test('refuses to seed when login changes the persisted Matrix device identity', async (t) => {
  const { state, run } = await fixture(t);
  state.deviceOverride = 'UNEXPECTED_DEVICE';
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.output, /device/i);
  assert.equal(state.events.length, 0);
  assert.equal(state.roomId, null);
});

test('rejects a null checkpoint without overwriting it or creating a new fixture', async (t) => {
  const { state, run, manifest } = await fixture(t);
  await writeFile(manifest, 'null\n');
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.output, /manifest/i);
  assert.equal(await readFile(manifest, 'utf8'), 'null\n');
  assert.equal(state.requests.length, 0);
});

test(
  'SIGTERM aborts a retry wait, releases the lock, and leaves a resumable checkpoint',
  { timeout: 10_000 },
  async (t) => {
    const { state, run, manifest } = await fixture(t);
    let child;
    state.fault = ({ body }) => {
      if (body['io.mindroom.stream_status'] !== 'pending') return undefined;
      setTimeout(() => child.kill('SIGTERM'), 25);
      return { status: 429, body: { retry_after_ms: 30_000 } };
    };
    const interrupted = await run(['--concurrency', '1'], (process) => {
      child = process;
    });
    assert.equal(interrupted.code, 1, interrupted.output);
    assert.equal(JSON.parse(await readFile(manifest, 'utf8')).threads[0].complete, false);
    await assert.rejects(readFile(`${manifest}.lock`, 'utf8'), { code: 'ENOENT' });
    state.fault = () => undefined;
    const resumed = await run(['--concurrency', '1']);
    assert.equal(resumed.code, 0, resumed.output);
    assert.equal(state.events.length, 18);
  }
);
