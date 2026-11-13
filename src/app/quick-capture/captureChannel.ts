import {
  CAPTURE_CHANNEL_NAME,
  isCaptureMessage,
  type CaptureAction,
  type CaptureMessage,
  type CaptureResult,
  type CaptureState,
} from './captureProtocol';

export type CaptureChannel = {
  post(message: CaptureMessage): void;
  listen(onMessage: (message: CaptureMessage) => void): () => void;
  close(): void;
};

/** The page's channel, or undefined where `BroadcastChannel` is missing. Drops invalid messages. */
export const openCaptureChannel = (): CaptureChannel | undefined => {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  const channel = new BroadcastChannel(CAPTURE_CHANNEL_NAME);
  return {
    post: (message) => channel.postMessage(message),
    listen: (onMessage) => {
      const handler = (event: MessageEvent<unknown>) => {
        if (isCaptureMessage(event.data)) onMessage(event.data);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
    close: () => channel.close(),
  };
};

export type CaptureClientSnapshot = {
  status: 'connecting' | 'connected' | 'absent';
  state?: CaptureState;
};

export type CaptureClient = {
  /** Says hello now and every 10 s. */
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CaptureClientSnapshot;
  request(action: CaptureAction): Promise<CaptureResult>;
};

const HELLO_INTERVAL_MS = 10_000;
const FIRST_STATE_WAIT_MS = 1_500;
const HOST_SILENCE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_WITH_IMAGES_TIMEOUT_MS = 60_000;

const TIMED_OUT: CaptureResult = { ok: false, error: 'timeout' };

export const createCaptureClient = (channel: CaptureChannel): CaptureClient => {
  let snapshot: CaptureClientSnapshot = { status: 'connecting' };
  let hostId: string | undefined;
  let stopListening: (() => void) | undefined;
  let helloTimer: ReturnType<typeof setInterval> | undefined;
  let firstStateTimer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const pending = new Map<string, (result: CaptureResult) => void>();

  const setSnapshot = (next: CaptureClientSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const goAbsent = () => {
    clearTimeout(silenceTimer);
    hostId = undefined;
    if (snapshot.status !== 'absent') setSnapshot({ status: 'absent' });
  };

  const onMessage = (message: CaptureMessage) => {
    if (message.type === 'state') {
      if (hostId !== undefined && hostId !== message.hostId) return;
      hostId = message.hostId;
      clearTimeout(firstStateTimer);
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(goAbsent, HOST_SILENCE_MS);
      setSnapshot({ status: 'connected', state: message.state });
    } else if (message.type === 'gone') {
      if (message.hostId === hostId) goAbsent();
    } else if (message.type === 'response') {
      if (message.hostId !== hostId) return;
      const settle = pending.get(message.id);
      if (settle) settle(message.result);
    }
  };

  return {
    start() {
      if (stopListening) return;
      stopListening = channel.listen(onMessage);
      channel.post({ v: 1, type: 'hello' });
      helloTimer = setInterval(() => channel.post({ v: 1, type: 'hello' }), HELLO_INTERVAL_MS);
      firstStateTimer = setTimeout(() => {
        if (snapshot.status === 'connecting') setSnapshot({ status: 'absent' });
      }, FIRST_STATE_WAIT_MS);
    },
    stop() {
      stopListening?.();
      stopListening = undefined;
      clearInterval(helloTimer);
      clearTimeout(firstStateTimer);
      clearTimeout(silenceTimer);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    request(action) {
      if (snapshot.status !== 'connected' || hostId === undefined)
        return Promise.resolve(TIMED_OUT);
      const id = crypto.randomUUID();
      const timeoutMs =
        action.kind === 'send' && action.images.length > 0
          ? REQUEST_WITH_IMAGES_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS;
      return new Promise<CaptureResult>((resolve) => {
        const timer = setTimeout(() => settle(TIMED_OUT), timeoutMs);
        const settle = (result: CaptureResult) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(result);
        };
        pending.set(id, settle);
        channel.post({ v: 1, type: 'request', id, hostId: hostId as string, action });
      });
    },
  };
};
