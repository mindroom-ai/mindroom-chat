import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Result } from './ipc';

export type FrontTarget = { pid: number; windowId: number | null };
export type FrontTargetLookup = FrontTarget | 'FAILED' | undefined;
export type ScreenshotTarget = 'window' | 'screen';
export type ScreenshotErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_WINDOW'
  | 'UNSUPPORTED'
  | 'CAPTURE_FAILED';
export type ScreenshotPayload = { bytes: Uint8Array; name: string };

export const HELPER_BINARY_NAME = 'mindroom-screenshot-helper';
export const HELPER_TIMEOUT_MS = 10_000;
export const FRONT_TIMEOUT_MS = 2_000;
export const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ERROR_CODES: readonly ScreenshotErrorCode[] = [
  'PERMISSION_DENIED',
  'NO_WINDOW',
  'UNSUPPORTED',
  'CAPTURE_FAILED',
];

export type ExecFileResult = {
  exitCode: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
};

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<ExecFileResult>;

export type ScreenshotHelper = {
  readFrontTarget(): Promise<FrontTargetLookup>;
  captureWindow(target: FrontTargetLookup): Promise<Result<ScreenshotPayload>>;
  captureScreen(displayId: number, ownPid: number): Promise<Result<ScreenshotPayload>>;
};

export const resolveHelperPath = (options: {
  isPackaged: boolean;
  isTest?: boolean;
  resourcesPath: string;
  unpackagedDir: string;
  testOverride?: string;
}): string | undefined => {
  if (options.isPackaged) return path.join(options.resourcesPath, HELPER_BINARY_NAME);
  if (options.testOverride) return path.resolve(options.testOverride);
  if (options.isTest) return undefined;
  return path.join(options.unpackagedDir, HELPER_BINARY_NAME);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const formatScreenshotName = (date = new Date()): string => {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `Screenshot ${year}-${month}-${day} ${hour}.${minute}.${second}.png`;
};

export const parseFrontOutput = (stdout: string): FrontTargetLookup => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return 'FAILED';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'FAILED';
  const { pid, windowId } = parsed as { pid?: unknown; windowId?: unknown };
  if (pid === null && windowId === null) return undefined;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return 'FAILED';
  if (
    windowId !== null &&
    (typeof windowId !== 'number' || !Number.isInteger(windowId) || windowId < 0)
  ) {
    return 'FAILED';
  }
  return { pid, windowId };
};

export const mapHelperError = (
  exitCode: number | null,
  stderr: string,
  timedOut: boolean
): ScreenshotErrorCode => {
  if (timedOut || exitCode !== 2) return 'CAPTURE_FAILED';
  const lastLine = stderr.trim().split(/\r?\n/).pop()?.trim() ?? '';
  return ERROR_CODES.find((code) => code === lastLine) ?? 'CAPTURE_FAILED';
};

const defaultExecFile: ExecFileFn = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', timeout: options.timeout, maxBuffer: options.maxBuffer },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '');
        const err = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '');
        if (!error) {
          resolve({ exitCode: 0, stdout: out, stderr: err, timedOut: false });
          return;
        }
        const meta = error as NodeJS.ErrnoException & {
          code?: number | string;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        };
        const timedOut = Boolean(meta.killed && meta.signal === 'SIGTERM');
        const exitCode = typeof meta.code === 'number' ? meta.code : null;
        resolve({ exitCode, stdout: out, stderr: err, timedOut });
      }
    );
  });

const isValidPng = (buf: Buffer): boolean =>
  buf.length > PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

export const createScreenshotHelper = (
  helperPath: string,
  exec: ExecFileFn = defaultExecFile
): ScreenshotHelper => {
  const capture = async (args: readonly string[]): Promise<Result<ScreenshotPayload>> => {
    let res: ExecFileResult;
    try {
      res = await exec(helperPath, args, {
        timeout: HELPER_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
      });
    } catch {
      return { ok: false, code: 'CAPTURE_FAILED' };
    }
    if (res.timedOut || res.exitCode !== 0) {
      return { ok: false, code: mapHelperError(res.exitCode, res.stderr, res.timedOut) };
    }
    if (!isValidPng(res.stdout)) return { ok: false, code: 'CAPTURE_FAILED' };
    return {
      ok: true,
      value: { bytes: new Uint8Array(res.stdout), name: formatScreenshotName() },
    };
  };

  return {
    async readFrontTarget(): Promise<FrontTargetLookup> {
      try {
        const res = await exec(helperPath, ['front'], {
          timeout: FRONT_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
        });
        if (res.timedOut || res.exitCode !== 0) return 'FAILED';
        return parseFrontOutput(res.stdout.toString('utf8'));
      } catch {
        return 'FAILED';
      }
    },
    async captureWindow(target: FrontTargetLookup): Promise<Result<ScreenshotPayload>> {
      if (target === 'FAILED') return { ok: false, code: 'CAPTURE_FAILED' };
      if (!target || target.windowId === null) return { ok: false, code: 'NO_WINDOW' };
      return capture(['window', '--pid', String(target.pid), '--window', String(target.windowId)]);
    },
    captureScreen(displayId: number, ownPid: number): Promise<Result<ScreenshotPayload>> {
      return capture(['screen', '--display', String(displayId), '--own-pid', String(ownPid)]);
    },
  };
};
