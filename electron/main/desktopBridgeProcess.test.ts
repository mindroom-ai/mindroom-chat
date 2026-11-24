import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopAccessHelperStatus } from '../../src/app/lib/desktopBridge';
import {
  DesktopBridgeProcess,
  DesktopHelperError,
  resolveDesktopHelperBinary,
} from './desktopBridgeProcess';

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-bridge-proc-'));
  tempDirs.push(dir);
  return dir;
};

const writeFakeHelper = (dir: string): string => {
  const scriptPath = path.join(dir, 'fake-helper.mjs');
  const script = `#!/usr/bin/env node
import readline from 'node:readline';

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const args = process.argv.slice(2);
const baseStatus = {
  config: {
    state: 'ready',
    revision: 1,
    enabled: false,
    controllers: [],
    allowed_app_ids: [],
    file_roots: [],
    shell_enabled: false,
  },
  pairing: { state: 'unpaired', session_state: 'missing', homeserver: null, user_id: null, device_id: null },
  helper: { state: 'running', version: '2026.11.568' },
  bridge: { state: 'stopped', active_action: null, last_error: null },
  authority: { control_available: false, lease_remaining_seconds: 0, control_scope: 'saved_apps', controllers: {} },
  permissions: {
    accessibility: { state: 'granted', can_request: true, recovery: null },
    screen_recording: { state: 'missing', can_request: true, recovery: 'Grant Screen Recording.' },
    gui_permissions_ready: false,
  },
  shell: {
    enabled: false,
    ready: false,
    pending: null,
    auto_approve_remaining_seconds: 0,
    auto_approve_until_revoked: false,
    active_request_id: null,
    handles: [],
    controllers: {},
  },
};

write({ v: 1, type: 'hello', helper_version: '2026.11.568' });
write({ v: 1, type: 'status', sequence: 1, status: baseStatus });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set(['v', 'request_id', 'action', 'parameters']);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  const keys = Object.keys(req);
  if (
    keys.some((k) => !ALLOWED_KEYS.has(k)) ||
    req.v !== 1 ||
    typeof req.request_id !== 'string' ||
    !UUID_RE.test(req.request_id) ||
    typeof req.action !== 'string' ||
    typeof req.parameters !== 'object' ||
    req.parameters === null ||
    Array.isArray(req.parameters)
  ) {
    write({
      v: 1,
      type: 'response',
      request_id: typeof req.request_id === 'string' ? req.request_id : null,
      ok: false,
      error: { code: 'invalid_request', message: 'Expected strict v1 UUID request frame.' },
    });
    return;
  }
  if (req.action === 'echo_args') {
    write({
      request_id: req.request_id,
      ok: true,
      result: { args, v: req.v, request_id: req.request_id, parameters: req.parameters },
    });
    return;
  }
  if (req.action === 'delayed') {
    setTimeout(() => {
      write({
        type: 'response',
        request_id: req.request_id,
        ok: true,
        result: { tag: req.parameters.tag },
      });
    }, req.parameters.ms);
    return;
  }
  if (req.action === 'fail_me') {
    write({
      type: 'response',
      request_id: req.request_id,
      ok: false,
      error: { code: 'host_locked', message: 'Another helper holds the lock.', recovery: 'Close MindRoom.app.', retryable: true },
    });
    return;
  }
  if (req.action === 'hang') {
    return;
  }
  if (req.action === 'crash') {
    process.exit(2);
  }
  write({ type: 'response', request_id: req.request_id, ok: true, result: { status: baseStatus } });
});
rl.on('close', () => process.exit(0));
`;
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o755 });
  return scriptPath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveDesktopHelperBinary', () => {
  it('resolves packaged darwin arm64 helper and rejects unsupported platform, arch, or missing binary', () => {
    const packagedPath =
      '/Applications/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS/MindRoom Desktop Helper';
    expect(
      resolveDesktopHelperBinary({
        platform: 'darwin',
        arch: 'arm64',
        isPackaged: true,
        resourcesPath: '/Applications/MindRoom Chat.app/Contents/Resources',
        unpackagedRoot: '/repo',
        envOverride: '/ignored-when-packaged',
        existsSync: (p) => p === packagedPath,
      })
    ).toEqual({ availability: 'available', binaryPath: packagedPath });

    expect(
      resolveDesktopHelperBinary({
        platform: 'linux',
        arch: 'arm64',
        isPackaged: true,
        resourcesPath: '/opt/resources',
        unpackagedRoot: '/repo',
        existsSync: () => true,
      })
    ).toEqual({ availability: 'unsupported_platform' });

    expect(
      resolveDesktopHelperBinary({
        platform: 'darwin',
        arch: 'x64',
        isPackaged: true,
        resourcesPath: '/Applications/MindRoom Chat.app/Contents/Resources',
        unpackagedRoot: '/repo',
        existsSync: () => true,
      })
    ).toEqual({ availability: 'unsupported_arch' });

    expect(
      resolveDesktopHelperBinary({
        platform: 'darwin',
        arch: 'arm64',
        isPackaged: true,
        resourcesPath: '/Applications/MindRoom Chat.app/Contents/Resources',
        unpackagedRoot: '/repo',
        existsSync: () => false,
      })
    ).toEqual({ availability: 'helper_missing' });
  });

  it('supports MINDROOM_DESKTOP_HELPER_BIN override when unpackaged', () => {
    const dir = makeTempDir();
    const bin = path.join(dir, 'helper');
    fs.writeFileSync(bin, '', 'utf8');

    expect(
      resolveDesktopHelperBinary({
        platform: 'linux',
        arch: 'x64',
        isPackaged: false,
        resourcesPath: '/none',
        unpackagedRoot: dir,
        envOverride: bin,
      })
    ).toEqual({ availability: 'available', binaryPath: path.resolve(bin) });

    expect(
      resolveDesktopHelperBinary({
        platform: 'linux',
        arch: 'x64',
        isPackaged: false,
        resourcesPath: '/none',
        unpackagedRoot: dir,
        envOverride: path.join(dir, 'does-not-exist'),
      })
    ).toEqual({ availability: 'helper_missing' });
  });
});

describe('DesktopBridgeProcess', () => {
  it('speaks NDJSON over stdio with real args, correlates concurrent requests, normalizes pushed status, and stops cleanly', async () => {
    const dir = makeTempDir();
    const helperBin = writeFakeHelper(dir);
    const configPath = path.join(dir, 'config.yaml');
    const storagePath = path.join(dir, 'mindroom_data');
    const statuses: DesktopAccessHelperStatus[] = [];

    const proc = new DesktopBridgeProcess({
      binaryPath: helperBin,
      configPath,
      storagePath,
      onStatus: (status) => statuses.push(status),
    });

    await proc.start();
    expect(proc.isRunning()).toBe(true);

    const echoed = await proc.request<{
      args: string[];
      v: number;
      request_id: string;
      parameters: Record<string, unknown>;
    }>('echo_args', { probe: true });
    expect(echoed.args).toEqual(['--config', configPath, '--storage-path', storagePath]);
    expect(echoed.v).toBe(1);
    expect(echoed.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(echoed.parameters).toEqual({ probe: true });

    // Status push normalized Python's object-shaped permissions into flat permission states.
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0]?.permissions).toEqual({
      accessibility: 'granted',
      screen_recording: 'missing',
      gui_permissions_ready: false,
    });

    const [slow, fast] = await Promise.all([
      proc.request<{ tag: string }>('delayed', { ms: 60, tag: 'slow' }),
      proc.request<{ tag: string }>('delayed', { ms: 5, tag: 'fast' }),
    ]);
    expect(slow.tag).toBe('slow');
    expect(fast.tag).toBe('fast');

    await expect(proc.request('fail_me')).rejects.toMatchObject({
      name: 'DesktopHelperError',
      code: 'host_locked',
      message: 'Another helper holds the lock.',
      recovery: 'Close MindRoom.app.',
      retryable: true,
    });

    await expect(proc.request('hang', {}, 60)).rejects.toBeInstanceOf(DesktopHelperError);
    await expect(proc.request('hang', {}, 60)).rejects.toMatchObject({ code: 'timeout' });

    await proc.stop();
    expect(proc.isRunning()).toBe(false);
  });

  it('rejects in-flight requests and emits unexpected exit when helper crashes', async () => {
    const dir = makeTempDir();
    const helperBin = writeFakeHelper(dir);
    const exits: Array<{ code: number | null; unexpected: boolean }> = [];

    const proc = new DesktopBridgeProcess({
      binaryPath: helperBin,
      configPath: path.join(dir, 'config.yaml'),
      storagePath: path.join(dir, 'data'),
      onExit: ({ code, unexpected }) => exits.push({ code, unexpected }),
    });

    await proc.start();
    const pending = proc.request('crash');
    await expect(pending).rejects.toMatchObject({ code: 'helper_exited' });
    expect(proc.isRunning()).toBe(false);
    expect(exits).toEqual([{ code: 2, unexpected: true }]);
  });
});
