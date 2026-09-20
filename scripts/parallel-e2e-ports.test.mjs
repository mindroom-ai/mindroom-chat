import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { bindCollisionError, waitForServer, withAvailablePort } from './parallel-e2e-ports.mjs';

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

test('does not accept an already-live wrong server before the spawned process announces its URL', async () => {
  let requests = 0;
  const wrongServer = createHttpServer((_request, response) => {
    requests += 1;
    response.end('wrong process');
  });
  const stdout = new PassThrough();
  await listen(wrongServer, 0);
  const { port } = wrongServer.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    await assert.rejects(
      waitForServer(
        url,
        { child: { stdout }, exited: Promise.resolve() },
        new AbortController().signal
      ),
      /exited before becoming ready/
    );
    assert.equal(requests, 0);
  } finally {
    stdout.end();
    await close(wrongServer);
  }
});

test('accepts HTTP readiness after the spawned process announces the expected URL', async () => {
  const server = createHttpServer((_request, response) => response.end('ready'));
  const stdout = new PassThrough();
  await listen(server, 0);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    const ready = waitForServer(
      url,
      { child: { stdout }, exited: new Promise(() => {}) },
      new AbortController().signal
    );
    stdout.write(`VITE ready at ${url}`);
    await ready;
  } finally {
    stdout.end();
    await close(server);
  }
});

test('stops readiness polling when cancelled', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled');
  controller.abort(reason);
  await assert.rejects(
    waitForServer('http://127.0.0.1:1', null, controller.signal),
    (error) => error === reason
  );
});

test('retries when a reservation is stolen before the startup callback can bind it', async () => {
  const ports = [];
  let thief;
  try {
    const result = await withAvailablePort(async (port, attemptIndex) => {
      ports.push(port);
      if (attemptIndex === 0) {
        thief = createServer();
        await listen(thief, port);
      }
      const service = createServer();
      try {
        await listen(service, port);
      } finally {
        if (service.listening) await close(service);
      }
      return { port, attemptIndex };
    });

    assert.deepEqual(result, { port: ports[1], attemptIndex: 1 });
    assert.equal(ports.length, 2);
    assert.notEqual(ports[0], ports[1]);
  } finally {
    if (thief?.listening) await close(thief);
  }
});

test('stops after bounded address collisions and returns the final collision', async () => {
  const attempts = [];
  const finalError = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' });
  await assert.rejects(
    withAvailablePort(
      async (_port, attemptIndex) => {
        attempts.push(attemptIndex);
        throw finalError;
      },
      { attempts: 3 }
    ),
    (error) => error === finalError
  );
  assert.deepEqual(attempts, [0, 1, 2]);
});

test('does not retry unrelated startup errors', async () => {
  const expected = new Error('startup configuration rejected');
  let calls = 0;
  await assert.rejects(
    withAvailablePort(async () => {
      calls += 1;
      throw expected;
    }),
    (error) => error === expected
  );
  assert.equal(calls, 1);
});

test('normalizes only recognizable address collision diagnostics', () => {
  for (const diagnostic of [
    'EADDRINUSE',
    'address already in use',
    'port is already allocated',
    'Port 4188 is already in use',
  ]) {
    const original = new Error('service exited');
    const normalized = bindCollisionError(original, diagnostic);
    assert.equal(normalized.code, 'EADDRINUSE');
    assert.equal(normalized.cause, original);
  }

  const alreadyNormalized = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  assert.equal(bindCollisionError(alreadyNormalized, ''), alreadyNormalized);

  const unrelated = new Error('bind failed after configuration validation');
  assert.equal(bindCollisionError(unrelated, 'bind failed'), unrelated);
  assert.equal(bindCollisionError(unrelated, 'address could not be resolved'), unrelated);
});
