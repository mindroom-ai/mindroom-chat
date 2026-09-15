import { MatrixClient } from 'matrix-js-sdk';
import { ModelRuntime, signedModelDevices } from './modelDeviceTrust';
import { MODEL_REQUEST } from './modelProtocol';

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
const recipientKey = (r: { userId: string; deviceId: string }): string =>
  JSON.stringify([r.userId, r.deviceId]);

/** Retry only missing recipients; never queue plaintext or broaden an encrypted batch. */
const sendBatch = async (
  mx: MatrixClient,
  devices: ModelRuntime[],
  content: Record<string, unknown>,
  signal: AbortSignal
): Promise<void> => {
  const crypto = mx.getCrypto();
  if (!crypto) return;
  let remaining = devices;
  for (const delay of [0, 250, 1000]) {
    if (signal.aborted || remaining.length === 0) return;
    if (delay) await pause(delay, signal);
    if (signal.aborted) return;
    try {
      const current = await signedModelDevices(mx, [...new Set(remaining.map((d) => d.userId))]);
      if (signal.aborted) return;
      remaining = remaining.filter((d) => current.some((known) => known.id === d.id));
      if (!remaining.length) return;
      const encrypted = await crypto.encryptToDeviceMessages(MODEL_REQUEST, remaining, content);
      if (signal.aborted || encrypted.eventType !== 'm.room.encrypted') continue;
      const wanted = new Set(remaining.map(recipientKey));
      const seen = new Set<string>();
      const batch = encrypted.batch.filter((r) => {
        const key = recipientKey(r);
        if (!wanted.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (batch.length === 0) continue;
      await mx.queueToDevice({ eventType: encrypted.eventType, batch });
      remaining = remaining.filter((r) => !seen.has(recipientKey(r)));
    } catch {
      // Olm session creation or transport may race device discovery. The deadline owns failure.
    }
  }
};

/** A queued Olm message can arrive before the receiver knows a new sender device. */
export const sendModelRequest = async (
  mx: MatrixClient,
  devices: ModelRuntime[],
  content: Record<string, unknown>,
  signal: AbortSignal,
  answered: (runtimeId: string) => boolean
): Promise<void> => {
  await sendBatch(mx, devices, content, signal);
  for (const delay of [2000, 3000]) {
    if (signal.aborted || devices.every((device) => answered(device.id))) return;
    await pause(delay, signal);
    if (signal.aborted) return;
    const unanswered = devices.filter((device) => !answered(device.id));
    if (!unanswered.length) return;
    await sendBatch(mx, unanswered, content, signal);
  }
};
