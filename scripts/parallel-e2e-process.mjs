import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const STOP_GRACE_MS = 2_000;

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const settleLog = (stream) => {
  if (!stream || stream.closed || stream.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      stream.off('close', done);
      stream.off('error', done);
      resolve();
    };
    stream.once('close', done);
    stream.once('error', done);
    try {
      stream.end();
    } catch {
      done();
    }
  });
};

export const createProcessManager = ({ cwd = process.cwd(), signal } = {}) => {
  const handles = new Set();
  let aborted = signal?.aborted ?? false;
  const onAbort = () => {
    aborted = true;
    void stopAll().catch(() => {});
  };

  const stopAll = async () => {
    await Promise.all([...handles].map((handle) => handle.stop()));
    handles.clear();
    signal?.removeEventListener('abort', onAbort);
  };

  signal?.addEventListener('abort', onAbort, { once: true });

  const start = (command, args = [], { env = {}, logFile } = {}) => {
    if (aborted || signal?.aborted)
      throw new Error('Process manager is aborted and cannot start another process.');

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        detached: process.platform !== 'win32',
        env: { ...process.env, ...env },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Failed to start ${command}: ${error.message}`);
    }

    const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : undefined;
    let logError;
    log?.on('error', (error) => {
      logError ??= error;
    });
    child.stdout?.on('data', (chunk) => log?.write(chunk));
    child.stderr?.on('data', (chunk) => log?.write(chunk));

    let settled = false;
    let resolveExited;
    let rejectExited;
    const exited = new Promise((resolve, reject) => {
      resolveExited = resolve;
      rejectExited = reject;
    });
    let handle;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      await settleLog(log);
      if (logError) rejectExited(new Error(`Unable to write process log: ${logError.message}`));
      else if (error) rejectExited(new Error(`Failed to start ${command}: ${error.message}`));
      else resolveExited(result);
    };

    child.once('error', (error) => {
      void finish(error);
    });
    child.once('close', (code, childSignal) => {
      void finish(undefined, { code, signal: childSignal });
    });

    const groupAlive = () => {
      if (process.platform === 'win32' || !child.pid) return !settled;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    };

    const signalChild = (childSignal) => {
      try {
        if (process.platform === 'win32') child.kill(childSignal);
        else if (child.pid) process.kill(-child.pid, childSignal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };

    const waitForGroup = async () => {
      const deadline = Date.now() + STOP_GRACE_MS;
      while (groupAlive() && Date.now() < deadline) await sleep(25);
      return !groupAlive();
    };

    let stopping;
    const stop = () => {
      stopping ??= (async () => {
        if (!groupAlive()) {
          handles.delete(handle);
          return;
        }
        signalChild('SIGTERM');
        if (process.platform === 'win32') {
          let timer;
          try {
            const stopped = await Promise.race([
              exited.then(
                () => true,
                () => true
              ),
              new Promise((resolve) => {
                timer = setTimeout(() => resolve(false), STOP_GRACE_MS);
              }),
            ]);
            if (!stopped) signalChild('SIGKILL');
          } finally {
            clearTimeout(timer);
          }
        } else if (!(await waitForGroup())) {
          signalChild('SIGKILL');
        }
        await exited.catch(() => {});
        handles.delete(handle);
      })();
      return stopping;
    };

    handle = { child, exited, stop };
    handles.add(handle);
    return handle;
  };

  const run = async (
    command,
    args = [],
    { env = {}, logFile, capture = false, timeoutMs = 600_000 } = {}
  ) => {
    const handle = start(command, args, { env, logFile });
    const chunks = [];
    let capturedBytes = 0;
    let captureError;
    if (capture)
      handle.child.stdout?.on('data', (chunk) => {
        if (captureError) return;
        const available = MAX_CAPTURE_BYTES - capturedBytes;
        const captured = chunk.byteLength > available ? chunk.subarray(0, available) : chunk;
        chunks.push(captured);
        capturedBytes += captured.byteLength;
        if (chunk.byteLength > available) {
          captureError = new Error(
            `${command} wrote more than the 16 MiB stdout capture limit and was stopped.`
          );
          void handle.stop();
        }
      });

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    let outcome;
    try {
      outcome = await Promise.race([
        handle.exited.then((result) => ({ result })),
        timeout.then(() => ({ timedOut: true })),
      ]);
    } catch (error) {
      await handle.stop();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (outcome.timedOut) {
      await handle.stop();
      throw new Error(
        `${command} timed out after ${timeoutMs}ms and its process group was stopped.`
      );
    }
    await handle.stop();
    if (captureError) throw captureError;
    return { ...outcome.result, stdout: capture ? Buffer.concat(chunks).toString() : '' };
  };

  return { run, start, stopAll };
};
