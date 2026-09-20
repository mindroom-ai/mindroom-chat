import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createProcessManager } from './parallel-e2e-process.mjs';

const artifactRoot = join(process.cwd(), 'test-results', `parallel-e2e-process-${process.pid}`);
const managers = [];

const child = (source) => [process.execPath, ['-e', source]];

const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const stubbornDescendant = () =>
  [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', \"const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(process.env.PROCESS_MANAGER_MARKER + '.ready', 'ready'); setTimeout(() => fs.writeFileSync(process.env.PROCESS_MANAGER_MARKER, 'alive'), 2_500);\"], { stdio: 'ignore', env: process.env });",
    'child.unref();',
    "const waitForReady = setInterval(() => { if (fs.existsSync(process.env.PROCESS_MANAGER_MARKER + '.ready')) clearInterval(waitForReady); }, 5);",
  ].join(' ');

const withDeadline = async (promise, milliseconds = 1_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('test deadline exceeded')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const manager = () => {
  const value = createProcessManager({ cwd: process.cwd() });
  managers.push(value);
  return value;
};

afterEach(async () => {
  await Promise.all(managers.splice(0).map((value) => value.stopAll()));
  await rm(artifactRoot, { recursive: true, force: true });
});

test('captures a nonzero exit without treating it as a spawn error', async () => {
  const processes = manager();
  const [command, args] = child("process.stdout.write('stdout'); process.exit(7);");

  const result = await processes.run(command, args, { capture: true });

  assert.deepEqual(result, { code: 7, signal: null, stdout: 'stdout' });
});

test('rejects an unavailable executable promptly', async () => {
  const processes = manager();

  await assert.rejects(
    withDeadline(processes.run('parallel-e2e-command-that-does-not-exist', [])),
    /spawn|ENOENT|failed to start/i
  );
});

test('writes both output streams to the requested log while capturing stdout', async () => {
  const processes = manager();
  await mkdir(artifactRoot, { recursive: true });
  const logFile = join(artifactRoot, 'process.log');
  const [command, args] = child("process.stdout.write('out\\n'); process.stderr.write('err\\n');");

  const result = await processes.run(command, args, { capture: true, logFile });

  assert.equal(result.stdout, 'out\n');
  const log = await readFile(logFile, 'utf8');
  assert.match(log, /out/);
  assert.match(log, /err/);
});

test('rejects oversized captured stdout instead of silently truncating discovery output', async () => {
  const processes = manager();
  const [command, args] = child("process.stdout.write('x'.repeat(17 * 1024 * 1024));");

  await assert.rejects(
    processes.run(command, args, { capture: true }),
    /16 MiB stdout capture limit/i
  );
});

test('timeout terminates the detached process group, including a descendant', async () => {
  const processes = manager();
  await mkdir(artifactRoot, { recursive: true });
  const marker = join(artifactRoot, 'descendant-survived');
  const source = [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', \"const fs = require('node:fs'); setTimeout(() => fs.writeFileSync(process.env.PROCESS_MANAGER_MARKER, 'alive'), 500);\"], { stdio: 'ignore', env: process.env });",
    'setInterval(() => {}, 1_000);',
  ].join(' ');
  const [command, args] = child(source);

  await assert.rejects(
    processes.run(command, args, { env: { PROCESS_MANAGER_MARKER: marker }, timeoutMs: 100 }),
    /timed out/i
  );
  await wait(650);
  assert.equal(existsSync(marker), false);
});

test(
  'stopAll terminates a detached descendant after its parent has exited',
  { skip: process.platform === 'win32' },
  async () => {
    const processes = manager();
    await mkdir(artifactRoot, { recursive: true });
    const marker = join(artifactRoot, 'orphan-descendant-survived');
    const source = stubbornDescendant();
    const [command, args] = child(source);
    const handle = processes.start(command, args, { env: { PROCESS_MANAGER_MARKER: marker } });

    await handle.exited;
    await processes.stopAll();
    await wait(2_600);
    assert.equal(existsSync(marker), false);
  }
);

test(
  'run cleans a descendant process group before returning its parent result',
  { skip: process.platform === 'win32' },
  async () => {
    const processes = manager();
    await mkdir(artifactRoot, { recursive: true });
    const marker = join(artifactRoot, 'run-descendant-survived');
    const [command, args] = child(stubbornDescendant());

    const result = await processes.run(command, args, { env: { PROCESS_MANAGER_MARKER: marker } });

    assert.deepEqual(result, { code: 0, signal: null, stdout: '' });
    await wait(2_600);
    assert.equal(existsSync(marker), false);
  }
);

test('an inherited abort signal stops active children and refuses another spawn', async () => {
  const controller = new AbortController();
  const processes = createProcessManager({ cwd: process.cwd(), signal: controller.signal });
  managers.push(processes);
  const [command, args] = child('setInterval(() => {}, 1_000);');
  const handle = processes.start(command, args);

  controller.abort();
  const result = await withDeadline(handle.exited);

  assert.equal(result.code, null);
  assert.match(result.signal ?? '', /SIGTERM|SIGKILL/);
  assert.throws(() => processes.start(command, args), /abort/i);
});
