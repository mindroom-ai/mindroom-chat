import { createServer } from 'node:net';

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const reserveLoopbackPort = async () => {
  const reservation = createServer();
  try {
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', () => {
        reservation.off('error', reject);
        resolve();
      });
    });
    const address = reservation.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not reserve a loopback port.');
    return address.port;
  } finally {
    if (reservation.listening) await close(reservation);
  }
};

const collisionDiagnostic = (diagnosticText) => {
  if (typeof diagnosticText !== 'string') return false;
  return (
    /\bEADDRINUSE\b/.test(diagnosticText) ||
    /address already in use/i.test(diagnosticText) ||
    /port is already allocated/i.test(diagnosticText) ||
    /\bport \d+ is already in use\b/i.test(diagnosticText)
  );
};

export const bindCollisionError = (error, diagnosticText) => {
  if (error?.code === 'EADDRINUSE' || !collisionDiagnostic(diagnosticText)) return error;
  const collision = new Error(error instanceof Error ? error.message : 'Service start failed.');
  collision.code = 'EADDRINUSE';
  collision.cause = error;
  return collision;
};

export const withAvailablePort = async (start, { attempts = 3 } = {}) => {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Port attempts must be a positive integer.');
  }

  let lastCollision;
  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    const port = await reserveLoopbackPort();
    try {
      return await start(port, attemptIndex);
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      lastCollision = error;
    }
  }
  throw lastCollision;
};

export const waitForServer = async (url, handle, signal) => {
  let exited = false;
  let announced = !handle;
  let output = '';
  const onOutput = (chunk) => {
    output = (output + chunk.toString()).slice(-16_384);
    announced ||= output.includes(url);
  };
  handle?.child.stdout.on('data', onOutput);
  handle?.exited.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    }
  );
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (exited) throw new Error(`Server exited before becoming ready: ${url}`);
      // A different process may have stolen the selected port. Wait for our Vite
      // process to announce its listener before accepting any HTTP response.
      if (announced) {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          });
          await response.body?.cancel();
          if (response.ok) return;
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
      await new Promise((done) => {
        setTimeout(done, 250);
      });
    }
    throw new Error(`Server did not become ready: ${url}`);
  } finally {
    handle?.child.stdout.off('data', onOutput);
  }
};
