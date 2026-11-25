import { spawn, type ChildProcessByStdio } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type {
  DesktopAccessAvailability,
  DesktopAccessHelperStatus,
} from '../../src/app/lib/desktopBridge';
import { asNullableString, asString, isRecord, normalizeHelperStatus } from './desktopBridgeStatus';

export { normalizeHelperStatus };

const HELPER_APP_NAME = 'MindRoom Desktop Helper.app';
const HELPER_EXEC_REL = path.join('Contents', 'MacOS', 'MindRoom Desktop Helper');
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const KILL_GRACE_MS = 1_500;

export type DesktopHelperResolution =
  | { availability: 'available'; binaryPath: string }
  | { availability: Exclude<DesktopAccessAvailability, 'available'> };

export type ResolveDesktopHelperOptions = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  resourcesPath: string;
  unpackagedRoot: string;
  envOverride?: string;
  existsSync?: (filePath: string) => boolean;
};

export const resolveDesktopHelperBinary = (
  options: ResolveDesktopHelperOptions
): DesktopHelperResolution => {
  const exists = options.existsSync ?? fs.existsSync;
  if (!options.isPackaged && options.envOverride?.trim()) {
    const resolved = path.resolve(options.envOverride.trim());
    return exists(resolved)
      ? { availability: 'available', binaryPath: resolved }
      : { availability: 'helper_missing' };
  }
  if (options.platform !== 'darwin') return { availability: 'unsupported_platform' };
  if (options.arch !== 'arm64') return { availability: 'unsupported_arch' };

  const candidate = options.isPackaged
    ? path.resolve(options.resourcesPath, '..', 'Helpers', HELPER_APP_NAME, HELPER_EXEC_REL)
    : path.resolve(options.unpackagedRoot, 'build', 'electron', HELPER_APP_NAME, HELPER_EXEC_REL);
  return exists(candidate)
    ? { availability: 'available', binaryPath: candidate }
    : { availability: 'helper_missing' };
};

export class DesktopHelperError extends Error {
  readonly code: string;
  readonly recovery: string | null;
  readonly retryable: boolean;

  constructor(code: string, message: string, recovery?: string | null, retryable = false) {
    super(message);
    this.name = 'DesktopHelperError';
    this.code = code;
    this.recovery = recovery ?? null;
    this.retryable = retryable;
  }
}

export type DesktopBridgeProcessOptions = {
  binaryPath: string;
  configPath?: string;
  storagePath?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  onStatus?: (status: DesktopAccessHelperStatus) => void;
  onExit?: (info: {
    code: number | null;
    signal: NodeJS.Signals | null;
    unexpected: boolean;
  }) => void;
};

type PendingRequest = {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class DesktopBridgeProcess {
  private readonly binaryPath: string;
  private readonly configPath: string;
  private readonly storagePath: string;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly onStatus?: (status: DesktopAccessHelperStatus) => void;
  private readonly onExit?: DesktopBridgeProcessOptions['onExit'];

  private child: ChildProcessByStdio<Writable, Readable, Readable> | undefined;
  private rl: readline.Interface | undefined;
  private startPromise: Promise<void> | undefined;
  private ready = false;
  private stopping = false;
  private cachedStatus: DesktopAccessHelperStatus | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: DesktopBridgeProcessOptions) {
    this.binaryPath = options.binaryPath;
    this.configPath = options.configPath ?? path.join(os.homedir(), '.mindroom', 'config.yaml');
    this.storagePath = options.storagePath ?? path.join(os.homedir(), '.mindroom', 'mindroom_data');
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.onStatus = options.onStatus;
    this.onExit = options.onExit;
  }

  isRunning(): boolean {
    return this.child !== undefined && this.ready && !this.stopping;
  }

  lastStatus(): DesktopAccessHelperStatus | null {
    return this.cachedStatus;
  }

  start(): Promise<void> {
    if (this.isRunning()) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    this.stopping = false;
    this.ready = false;

    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishStart = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        if (error) {
          this.startPromise = undefined;
          reject(error);
        } else {
          this.ready = true;
          resolve();
        }
      };

      const child = spawn(
        this.binaryPath,
        ['--config', this.configPath, '--storage-path', this.storagePath],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this.child = child;
      child.stdin.on('error', () => undefined);
      child.stderr.resume();

      const startupTimer = setTimeout(() => {
        child.kill('SIGTERM');
        finishStart(new DesktopHelperError('startup_timeout', 'Desktop helper did not say hello.'));
      }, this.startupTimeoutMs);

      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      this.rl = rl;
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let frame: unknown;
        try {
          frame = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (!isRecord(frame)) return;
        if (frame.type === 'hello') {
          finishStart();
          return;
        }
        if (frame.type === 'status') {
          this.applyStatus(frame.status);
          return;
        }
        if (frame.type === 'response' || typeof frame.request_id === 'string') {
          this.handleResponse(frame);
        }
      });

      child.once('error', (error) => {
        finishStart(
          new DesktopHelperError('spawn_failed', error.message || 'Failed to spawn desktop helper.')
        );
      });

      child.once('exit', (code, signal) => {
        const unexpected = !this.stopping;
        this.cleanupChild(child);
        finishStart(
          new DesktopHelperError(
            'helper_exited',
            `Desktop helper exited before ready (code=${String(code)}, signal=${String(signal)}).`
          )
        );
        this.rejectAllPending(
          new DesktopHelperError(
            unexpected ? 'helper_exited' : 'helper_stopped',
            unexpected ? 'Desktop helper exited unexpectedly.' : 'Desktop helper stopped.'
          )
        );
        this.onExit?.({ code, signal, unexpected });
      });
    });

    return this.startPromise;
  }

  request<T = Record<string, unknown>>(
    action: string,
    parameters: Record<string, unknown> = {},
    timeoutMs = this.requestTimeoutMs
  ): Promise<T> {
    const child = this.child;
    if (!child || !this.ready || this.stopping) {
      return Promise.reject(
        new DesktopHelperError('helper_not_running', 'Desktop helper is not running.')
      );
    }
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopHelperError('timeout', `Desktop helper timed out on ${action}.`));
      }, timeoutMs);
      this.pending.set(requestId, {
        action,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      const payload = `${JSON.stringify({ v: 1, request_id: requestId, action, parameters })}\n`;
      child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return;
        const entry = this.pending.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        entry.reject(new DesktopHelperError('write_failed', error.message));
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.ready = false;
    this.rejectAllPending(new DesktopHelperError('helper_stopped', 'Desktop helper stopped.'));

    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        this.cleanupChild(child);
        resolve();
        return;
      }
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const termTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL');
            }
          }, KILL_GRACE_MS);
        }
      }, this.stopTimeoutMs);
      const done = (): void => {
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        this.cleanupChild(child);
        resolve();
      };
      child.once('exit', done);
      try {
        child.stdin.end();
      } catch {
        // Ignore broken pipe during shutdown.
      }
    });
  }

  private applyStatus(raw: unknown): DesktopAccessHelperStatus | null {
    const normalized = normalizeHelperStatus(raw);
    if (!normalized) return null;
    this.cachedStatus = normalized;
    this.onStatus?.(normalized);
    return normalized;
  }

  private handleResponse(frame: Record<string, unknown>): void {
    const requestId = typeof frame.request_id === 'string' ? frame.request_id : undefined;
    if (!requestId) return;
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);

    if (frame.ok === true) {
      const result = isRecord(frame.result) ? frame.result : {};
      if ('status' in result) {
        const normalized = this.applyStatus(result.status);
        entry.resolve(normalized ? { ...result, status: normalized } : result);
        return;
      }
      if (entry.action === 'status') {
        const normalized = this.applyStatus(result);
        entry.resolve(normalized ?? result);
        return;
      }
      entry.resolve(result);
      return;
    }

    const err = isRecord(frame.error) ? frame.error : {};
    entry.reject(
      new DesktopHelperError(
        asString(err.code, 'helper_error'),
        asString(err.message, 'Desktop helper request failed.'),
        asNullableString(err.recovery),
        Boolean(err.retryable)
      )
    );
  }

  private rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
  }

  private cleanupChild(child: ChildProcessByStdio<Writable, Readable, Readable>): void {
    if (this.child !== child) return;
    this.rl?.close();
    this.rl = undefined;
    this.child = undefined;
    this.startPromise = undefined;
    this.ready = false;
  }
}
