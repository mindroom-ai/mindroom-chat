#!/usr/bin/env node

// Synthetic historical traffic, not a claim that a browser consumed every edit live.
// Keep the manifest and its stable Matrix device for idempotent interrupted-run recovery.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const HELP = `Seed a disposable loopback Matrix room with streamed thread replies.

Usage: node scripts/seed-streaming-stress-room.mjs --manifest PATH [options]

  --homeserver URL   Loopback origin (default E2E_HOMESERVER or http://127.0.0.1:28008)
  --threads N        Thread roots (default 1000)
  --replies N        Logical replies per root, excluding the root (default 100)
  --edits N          Edits per reply, including its terminal edit (default 3)
  --concurrency N    Concurrent threads (default 16, maximum 64)
  --verify          Verify an existing manifest without sending messages
  --help            Show this help

Credentials: STRESS_USERNAME/STRESS_PASSWORD, then E2E_USERNAME/E2E_PASSWORD.
Defaults: mindroom_stress_disposable / mindroom-stress-disposable-local-only.
The account is registered with dummy auth when absent; only disposable local servers are allowed.
Save PATH in a durable worktree/artifact directory and rerun the same command to resume.
Resume reuses its device and transaction IDs; do not delete that server-side device.
An interrupted thread is replayed; completed threads are checkpointed and skipped.
Each reply is pending, then streaming, then completed. Three edits produce four events.
Defaults create 401000 message events: 1000 roots + 100000 replies + 300000 edits.
Verification checks every root and reply count, not every historical edit or browser rendering.
`;

function parseArguments() {
  const options = {};
  const valueFlags = new Set([
    'manifest',
    'homeserver',
    'threads',
    'replies',
    'edits',
    'concurrency',
  ]);
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index].replace(/^--/, '');
    if (args[index] === '--help' || args[index] === '--verify') options[name] = true;
    else if (args[index].startsWith('--') && valueFlags.has(name) && args[index + 1]) {
      options[name] = args[++index];
    } else throw new Error('Unknown or incomplete option; use --help.');
  }
  if (!options.help && !options.manifest) throw new Error('--manifest PATH is required.');
  return options;
}

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid loopback homeserver URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !(['localhost', '[::1]'].includes(url.hostname) || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Homeserver must be a loopback HTTP(S) origin without credentials or a path.');
  }
  return url.origin;
}

function positiveInteger(value, name, maximum = 1_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`--${name} must be an integer between 1 and ${maximum}.`);
  }
  return number;
}

class MatrixError extends Error {
  constructor(status, data) {
    // Never echo server error text: it can contain submitted credentials or bodies.
    super(`Matrix request failed with HTTP ${status}.`);
    this.status = status;
    this.errcode = data?.errcode;
    this.data = data;
  }
}

function matrixClient(homeserver, signal) {
  let accessToken;
  return {
    setToken(token) {
      accessToken = token;
    },
    async request(
      path,
      { method = 'GET', body, version = 'v3', retry = method === 'GET' || method === 'PUT' } = {}
    ) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        signal.throwIfAborted();
        let response;
        let data;
        try {
          response = await fetch(`${homeserver}/_matrix/client/${version}${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          });
          data = await response.json();
        } catch {
          signal.throwIfAborted();
          if (!retry || attempt === 4)
            throw new Error('Matrix transport failed or returned invalid JSON.');
          await sleep(100 * 2 ** attempt, undefined, { signal });
          continue;
        }
        if (response.ok) return data;
        if (retry && [429, 502, 503, 504].includes(response.status) && attempt < 4) {
          const advertisedDelay = Number(
            data?.retry_after_ms ?? response.headers.get('retry-after') * 1000
          );
          const delay =
            Number.isFinite(advertisedDelay) && advertisedDelay > 0
              ? Math.min(advertisedDelay, 30_000)
              : 100 * 2 ** attempt;
          await sleep(delay, undefined, { signal });
          continue;
        }
        throw new MatrixError(response.status, data);
      }
      throw new Error('Matrix retries exhausted.');
    },
  };
}

async function authenticate(client, manifest, password, verifyOnly) {
  const login = () =>
    client.request('/login', {
      method: 'POST',
      body: {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: manifest.username },
        password,
        device_id: manifest.deviceId,
        initial_device_display_name: 'Disposable MindRoom streaming stress fixture',
      },
    });
  let session;
  try {
    session = await login();
  } catch (error) {
    if (verifyOnly || error.status !== 403) throw error;
    const registration = {
      username: manifest.username,
      password,
      device_id: manifest.deviceId,
      initial_device_display_name: 'Disposable MindRoom streaming stress fixture',
      auth: { type: 'm.login.dummy' },
    };
    try {
      session = await client.request('/register', { method: 'POST', body: registration });
    } catch (registrationError) {
      if (registrationError.errcode === 'M_USER_IN_USE') session = await login();
      else if (
        registrationError.status === 401 &&
        typeof registrationError.data?.session === 'string' &&
        registrationError.data?.flows?.some(
          (flow) =>
            Array.isArray(flow.stages) &&
            flow.stages.length === 1 &&
            flow.stages[0] === 'm.login.dummy'
        )
      ) {
        session = await client.request('/register', {
          method: 'POST',
          body: {
            ...registration,
            auth: {
              type: 'm.login.dummy',
              session: registrationError.data.session,
            },
          },
        });
      } else throw registrationError;
    }
  }
  if (
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    typeof session.user_id !== 'string' ||
    !/^@[^:]+:.+$/.test(session.user_id) ||
    session.device_id !== manifest.deviceId ||
    (manifest.userId && manifest.userId !== session.user_id)
  ) {
    throw new Error('Matrix session does not match the manifest user/device.');
  }
  client.setToken(session.access_token);
  manifest.userId = session.user_id;
}

async function ensureRoom(client, manifest) {
  if (manifest.roomId) return;
  const alias = `#${manifest.roomAliasLocal}:${manifest.userId.slice(
    manifest.userId.indexOf(':') + 1
  )}`;
  const lookup = () => client.request(`/directory/room/${encodeURIComponent(alias)}`);
  let room;
  try {
    room = await lookup();
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      room = await client.request('/createRoom', {
        method: 'POST',
        body: {
          preset: 'private_chat',
          visibility: 'private',
          room_alias_name: manifest.roomAliasLocal,
          name: `Streaming stress: ${manifest.config.threads} threads × ${manifest.config.replies} replies`,
          topic: `Disposable deterministic streaming fixture ${manifest.runId}.`,
        },
      });
    } catch (createError) {
      // A response can disappear after creation. The deterministic alias recovers that room.
      try {
        room = await lookup();
      } catch {
        throw createError;
      }
    }
  }
  if (typeof room.room_id !== 'string' || !room.room_id.startsWith('!')) {
    throw new Error('Matrix did not return a room ID.');
  }
  manifest.roomId = room.room_id;
}

function replyContent(thread, reply, revision, edits) {
  const marker = `STRESS-T${String(thread + 1).padStart(4, '0')}-R${String(reply + 1).padStart(
    3,
    '0'
  )}-V${revision}`;
  const status = revision === 0 ? 'pending' : revision === edits ? 'completed' : 'streaming';
  const paragraphs = Array.from(
    { length: revision + 1 },
    (_, index) =>
      `Step ${index + 1}: deterministic streamed response with useful details and inline code.`
  );
  return {
    msgtype: status === 'completed' ? 'm.text' : 'm.notice',
    body: `${marker}\n\n${paragraphs.join('\n\n')}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p><strong>${marker}</strong></p>${paragraphs
      .map((text) => `<p>${text} <code>thread_${thread + 1}</code></p>`)
      .join('')}`,
    'io.mindroom.stream_status': status,
  };
}

async function seedThread(client, manifest, index) {
  const send = async (suffix, content) => {
    const txnId = `${manifest.runId}-t${index}-${suffix}`;
    const result = await client.request(
      `/rooms/${encodeURIComponent(manifest.roomId)}/send/m.room.message/${txnId}`,
      { method: 'PUT', body: content }
    );
    if (typeof result.event_id !== 'string' || !result.event_id.startsWith('$')) {
      throw new Error('Matrix send did not return an event ID.');
    }
    return result.event_id;
  };
  const rootId = await send('root', {
    msgtype: 'm.text',
    body: `Streaming stress thread ${index + 1}: deterministic agent responses`,
  });
  let latestReplyId = rootId;
  for (let reply = 0; reply < manifest.config.replies; reply += 1) {
    const original = replyContent(index, reply, 0, manifest.config.edits);
    const replyId = await send(`r${reply}`, {
      ...original,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: latestReplyId },
      },
    });
    for (let revision = 1; revision <= manifest.config.edits; revision += 1) {
      const content = replyContent(index, reply, revision, manifest.config.edits);
      await send(`r${reply}-e${revision}`, {
        ...content,
        body: `* ${content.body}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
      });
    }
    latestReplyId = replyId;
  }
  manifest.threads[index] = { index, rootId, latestReplyId, complete: true };
}

async function verifyRoom(client, manifest) {
  const expected = new Map(manifest.threads.map((thread) => [thread.rootId, thread]));
  if (
    expected.size !== manifest.config.threads ||
    manifest.threads.some((thread) => !thread.complete)
  ) {
    throw new Error('Manifest has unfinished threads; resume seeding first.');
  }
  const seen = new Set();
  const tokens = new Set();
  let token;
  do {
    const query = new URLSearchParams({ limit: '100', include: 'all' });
    if (token) query.set('from', token);
    const page = await client.request(
      `/rooms/${encodeURIComponent(manifest.roomId)}/threads?${query}`,
      { version: 'v1' }
    );
    if (!Array.isArray(page.chunk)) throw new Error('Matrix threads response omitted chunk.');
    for (const root of page.chunk) {
      if (!expected.has(root.event_id) || seen.has(root.event_id)) {
        throw new Error('Server thread roots differ from the manifest.');
      }
      seen.add(root.event_id);
      const count = root.unsigned?.['m.relations']?.['m.thread']?.count;
      if (count !== manifest.config.replies) {
        throw new Error(
          `Server reply count differs from ${manifest.config.replies} for a fixture thread.`
        );
      }
    }
    token = page.next_batch;
    if (token !== undefined && (typeof token !== 'string' || !token || tokens.has(token))) {
      throw new Error('Matrix threads pagination returned an invalid/repeated token.');
    }
    if (token) tokens.add(token);
  } while (token);
  if (seen.size !== manifest.config.threads)
    throw new Error('Server thread count differs from the manifest.');
  return {
    checkedAt: new Date().toISOString(),
    threadCount: seen.size,
    replyCount: seen.size * manifest.config.replies,
    method: 'threads-bundled-counts',
  };
}

async function run(options, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Manifest must contain an object.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the manifest as JSON.');
  }
  if (options.verify && !manifest) throw new Error('--verify requires an existing manifest.');
  const homeserver = loopbackOrigin(
    options.homeserver ??
      manifest?.homeserver ??
      process.env.E2E_HOMESERVER ??
      'http://127.0.0.1:28008'
  );
  const username =
    process.env.STRESS_USERNAME ??
    process.env.E2E_USERNAME ??
    manifest?.username ??
    'mindroom_stress_disposable';
  const password =
    process.env.STRESS_PASSWORD ??
    process.env.E2E_PASSWORD ??
    'mindroom-stress-disposable-local-only';
  const config = Object.fromEntries(
    Object.entries({ threads: 1000, replies: 100, edits: 3 }).map(([key, fallback]) => [
      key,
      positiveInteger(options[key] ?? manifest?.config?.[key] ?? fallback, key),
    ])
  );
  const concurrency = positiveInteger(options.concurrency ?? 16, 'concurrency', 64);
  if (manifest) {
    if (
      manifest.version !== 1 ||
      manifest.homeserver !== homeserver ||
      manifest.username !== username ||
      !/^[a-f0-9-]{36}$/.test(manifest.runId ?? '') ||
      manifest.deviceId !== `STRESS_${manifest.runId}` ||
      manifest.roomAliasLocal !== `mindroom-streaming-stress-${manifest.runId}` ||
      JSON.stringify(manifest.config) !== JSON.stringify(config) ||
      !Array.isArray(manifest.threads) ||
      manifest.threads.length !== config.threads ||
      manifest.threads.some(
        (thread, index) =>
          thread.index !== index ||
          (thread.complete &&
            (!thread.rootId?.startsWith('$') || !thread.latestReplyId?.startsWith('$')))
      )
    ) {
      throw new Error(
        'Manifest identity or workload differs; use the original settings or a new manifest.'
      );
    }
  } else {
    const runId = randomUUID();
    manifest = {
      version: 1,
      runId,
      homeserver,
      username,
      deviceId: `STRESS_${runId}`,
      roomAliasLocal: `mindroom-streaming-stress-${runId}`,
      config,
      threads: Array.from({ length: config.threads }, (_, index) => ({ index, complete: false })),
    };
  }
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new Error('Seeding interrupted; rerun with the same manifest to resume.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let writes = Promise.resolve();
  const save = () => {
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    writes = writes.then(async () => {
      await writeFile(`${manifestPath}.writing`, serialized, { mode: 0o600 });
      await rename(`${manifestPath}.writing`, manifestPath);
    });
    return writes;
  };
  try {
    await save();
    const client = matrixClient(homeserver, controller.signal);
    await authenticate(client, manifest, password, options.verify);
    if (!options.verify) await ensureRoom(client, manifest);
    if (!manifest.roomId) throw new Error('Manifest does not contain a room ID.');
    delete manifest.verified;
    await save();
    if (!options.verify) {
      let next = 0;
      let failure;
      const workers = Array.from({ length: Math.min(concurrency, config.threads) }, async () => {
        try {
          while (next < config.threads) {
            controller.signal.throwIfAborted();
            const index = next++;
            if (manifest.threads[index].complete) continue;
            await seedThread(client, manifest, index);
            await save();
            const completed = manifest.threads.filter((thread) => thread.complete).length;
            if (completed % 25 === 0 || completed === config.threads) {
              console.error(`Completed ${completed}/${config.threads} threads.`);
            }
          }
        } catch (error) {
          failure ??= error;
          controller.abort(error);
        }
      });
      await Promise.all(workers);
      if (failure) throw failure;
    }
    manifest.verified = await verifyRoom(client, manifest);
    await save();
    console.log(
      JSON.stringify({
        manifest: manifestPath,
        roomId: manifest.roomId,
        ...manifest.verified,
        expectedMessageEvents: config.threads * (1 + config.replies * (1 + config.edits)),
      })
    );
  } finally {
    await writes.catch(() => {});
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function main() {
  const options = parseArguments();
  if (options.help) {
    console.log(HELP);
    return;
  }
  const manifestPath = resolve(options.manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  const lockPath = `${manifestPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Manifest is locked; check its running process before removing the .lock file.'
      );
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    // Read only after locking, so another process cannot replace an initially absent manifest.
    await run(options, manifestPath);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
