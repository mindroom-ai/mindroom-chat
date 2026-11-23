import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FRONT_TIMEOUT_MS,
  HELPER_BINARY_NAME,
  HELPER_TIMEOUT_MS,
  MAX_CAPTURE_BYTES,
  PNG_SIGNATURE,
  createScreenshotHelper,
  formatScreenshotName,
  mapHelperError,
  parseFrontOutput,
  resolveHelperPath,
  type ExecFileFn,
  type ExecFileResult,
} from './helper';

const VALID_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from([0x00, 0x00, 0x00, 0x0d])]);

const okResult = (stdout: Buffer | string): ExecFileResult => ({
  exitCode: 0,
  stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'),
  stderr: '',
  timedOut: false,
});

describe('resolveHelperPath', () => {
  it('picks resourcesPath when packaged, ignoring testOverride', () => {
    expect(
      resolveHelperPath({
        isPackaged: true,
        resourcesPath: '/Applications/MindRoom Chat.app/Contents/Resources',
        unpackagedDir: '/repo/build/electron',
        testOverride: '/tmp/fake-helper',
      })
    ).toBe(path.join('/Applications/MindRoom Chat.app/Contents/Resources', HELPER_BINARY_NAME));
  });

  it('uses testOverride or unpackagedDir when unpackaged', () => {
    expect(
      resolveHelperPath({
        isPackaged: false,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
        testOverride: '/tmp/fake-helper',
      })
    ).toBe(path.resolve('/tmp/fake-helper'));

    expect(
      resolveHelperPath({
        isPackaged: false,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
      })
    ).toBe(path.join('/repo/build/electron', HELPER_BINARY_NAME));
  });

  it('disables unpackaged fallback in isTest unless testOverride is explicitly set', () => {
    expect(
      resolveHelperPath({
        isPackaged: false,
        isTest: true,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
      })
    ).toBeUndefined();

    expect(
      resolveHelperPath({
        isPackaged: false,
        isTest: true,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
        testOverride: '',
      })
    ).toBeUndefined();

    expect(
      resolveHelperPath({
        isPackaged: false,
        isTest: true,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
        testOverride: '/tmp/fake-helper',
      })
    ).toBe(path.resolve('/tmp/fake-helper'));
  });
});

describe('formatScreenshotName', () => {
  it('formats zero-padded local date and time', () => {
    const date = new Date(2026, 2, 5, 7, 4, 9);
    expect(formatScreenshotName(date)).toBe('Screenshot 2026-03-05 07.04.09.png');
  });
});

describe('parseFrontOutput', () => {
  it('accepts valid positive pid with integer or null windowId', () => {
    expect(parseFrontOutput('{"pid":123,"windowId":456}\n')).toEqual({ pid: 123, windowId: 456 });
    expect(parseFrontOutput('{"pid":123,"windowId":0}')).toEqual({ pid: 123, windowId: 0 });
    expect(parseFrontOutput('{"pid":123,"windowId":null}')).toEqual({ pid: 123, windowId: null });
  });

  it('returns undefined when front reports no frontmost app', () => {
    expect(parseFrontOutput('{"pid":null,"windowId":null}')).toBeUndefined();
  });

  it.each([
    '{"pid":0,"windowId":1}',
    '{"pid":-5,"windowId":1}',
    '{"pid":1.5,"windowId":1}',
    '{"pid":123,"windowId":-1}',
    '{"pid":123,"windowId":"456"}',
    '{"pid":123}',
    '[]',
    'null',
    'not-json',
  ])('returns FAILED for malformed front output: %s', (raw) => {
    expect(parseFrontOutput(raw)).toBe('FAILED');
  });
});

describe('mapHelperError', () => {
  it('maps known exit-2 codes from the last line and trims whitespace', () => {
    expect(mapHelperError(2, 'PERMISSION_DENIED\n', false)).toBe('PERMISSION_DENIED');
    expect(mapHelperError(2, 'framework warning\nPERMISSION_DENIED\n', false)).toBe(
      'PERMISSION_DENIED'
    );
    expect(mapHelperError(2, ' NO_WINDOW ', false)).toBe('NO_WINDOW');
    expect(mapHelperError(2, 'UNSUPPORTED', false)).toBe('UNSUPPORTED');
    expect(mapHelperError(2, 'CAPTURE_FAILED', false)).toBe('CAPTURE_FAILED');
  });

  it('falls back to CAPTURE_FAILED for unknown stderr, non-2 exit codes, and timeouts', () => {
    expect(mapHelperError(2, 'SOMETHING_ELSE', false)).toBe('CAPTURE_FAILED');
    expect(mapHelperError(1, 'PERMISSION_DENIED', false)).toBe('CAPTURE_FAILED');
    expect(mapHelperError(null, 'NO_WINDOW', false)).toBe('CAPTURE_FAILED');
    expect(mapHelperError(2, 'PERMISSION_DENIED', true)).toBe('CAPTURE_FAILED');
  });
});

describe('createScreenshotHelper', () => {
  it('reads front target with FRONT_TIMEOUT_MS and returns FAILED on lookup error', async () => {
    const exec = vi.fn<ExecFileFn>().mockResolvedValueOnce(okResult('{"pid":42,"windowId":7}\n'));
    const helper = createScreenshotHelper('/bin/helper', exec);

    await expect(helper.readFrontTarget()).resolves.toEqual({ pid: 42, windowId: 7 });
    expect(exec).toHaveBeenCalledWith('/bin/helper', ['front'], {
      timeout: FRONT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });

    exec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: Buffer.alloc(0),
      stderr: '',
      timedOut: false,
    });
    await expect(helper.readFrontTarget()).resolves.toBe('FAILED');

    exec.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(helper.readFrontTarget()).resolves.toBe('FAILED');
  });

  it('returns CAPTURE_FAILED without spawning when front lookup failed', async () => {
    const exec = vi.fn<ExecFileFn>();
    const helper = createScreenshotHelper('/bin/helper', exec);
    await expect(helper.captureWindow('FAILED')).resolves.toEqual({
      ok: false,
      code: 'CAPTURE_FAILED',
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns NO_WINDOW without spawning when captureWindow has no target or null windowId', async () => {
    const exec = vi.fn<ExecFileFn>();
    const helper = createScreenshotHelper('/bin/helper', exec);
    await expect(helper.captureWindow(undefined)).resolves.toEqual({
      ok: false,
      code: 'NO_WINDOW',
    });
    await expect(helper.captureWindow({ pid: 99, windowId: null })).resolves.toEqual({
      ok: false,
      code: 'NO_WINDOW',
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('captures a window PNG with exact pid and window args', async () => {
    const exec = vi.fn<ExecFileFn>().mockResolvedValue(okResult(VALID_PNG));
    const helper = createScreenshotHelper('/bin/helper', exec);

    const res = await helper.captureWindow({ pid: 99, windowId: 501 });
    expect(exec).toHaveBeenCalledWith('/bin/helper', ['window', '--pid', '99', '--window', '501'], {
      timeout: HELPER_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURE_BYTES,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Buffer.from(res.value.bytes)).toEqual(VALID_PNG);
      expect(res.value.name).toMatch(/^Screenshot \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    }
  });

  it.each<[string, ExecFileResult, string]>([
    ['empty stdout', okResult(Buffer.alloc(0)), 'CAPTURE_FAILED'],
    ['non-PNG bytes', okResult(Buffer.from('not a png image')), 'CAPTURE_FAILED'],
    [
      'exit 2 PERMISSION_DENIED',
      { exitCode: 2, stdout: Buffer.alloc(0), stderr: 'PERMISSION_DENIED\n', timedOut: false },
      'PERMISSION_DENIED',
    ],
    [
      'exit 2 NO_WINDOW',
      { exitCode: 2, stdout: Buffer.alloc(0), stderr: 'NO_WINDOW\n', timedOut: false },
      'NO_WINDOW',
    ],
    [
      'exit 2 UNSUPPORTED',
      { exitCode: 2, stdout: Buffer.alloc(0), stderr: 'UNSUPPORTED\n', timedOut: false },
      'UNSUPPORTED',
    ],
    [
      'exit 2 unknown stderr',
      { exitCode: 2, stdout: Buffer.alloc(0), stderr: 'BOOM\n', timedOut: false },
      'CAPTURE_FAILED',
    ],
    [
      'non-2 exit code',
      { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'PERMISSION_DENIED', timedOut: false },
      'CAPTURE_FAILED',
    ],
    [
      'timeout',
      { exitCode: null, stdout: VALID_PNG, stderr: 'PERMISSION_DENIED', timedOut: true },
      'CAPTURE_FAILED',
    ],
  ])('maps captureWindow failure (%s)', async (_label, result, expectedCode) => {
    const exec = vi.fn<ExecFileFn>().mockResolvedValue(result);
    const helper = createScreenshotHelper('/bin/helper', exec);
    await expect(helper.captureWindow({ pid: 10, windowId: 20 })).resolves.toEqual({
      ok: false,
      code: expectedCode,
    });
  });

  it('captures a screen PNG passing --display and --own-pid and validates output', async () => {
    const exec = vi.fn<ExecFileFn>().mockResolvedValueOnce(okResult(VALID_PNG));
    const helper = createScreenshotHelper('/bin/helper', exec);

    const res = await helper.captureScreen(69733248, 12345);
    expect(exec).toHaveBeenCalledWith(
      '/bin/helper',
      ['screen', '--display', '69733248', '--own-pid', '12345'],
      { timeout: HELPER_TIMEOUT_MS, maxBuffer: MAX_CAPTURE_BYTES }
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(Buffer.from(res.value.bytes)).toEqual(VALID_PNG);

    exec.mockResolvedValueOnce({
      exitCode: 2,
      stdout: Buffer.alloc(0),
      stderr: 'PERMISSION_DENIED\n',
      timedOut: false,
    });
    await expect(helper.captureScreen(69733248, 12345)).resolves.toEqual({
      ok: false,
      code: 'PERMISSION_DENIED',
    });

    exec.mockResolvedValueOnce(okResult(Buffer.from('bad')));
    await expect(helper.captureScreen(69733248, 12345)).resolves.toEqual({
      ok: false,
      code: 'CAPTURE_FAILED',
    });
  });
});
