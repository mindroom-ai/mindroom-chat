import {
  CAPTURE_CHANNEL_NAME,
  isCaptureMessage,
  newCaptureId,
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
  /** Listens, and says hello now and every 10 s while the page shows (every 1.5 s while absent). */
  start(): void;
  stop(): void;
  /**
   * Whether the page shows. Hidden, the client says no hello and counts no silence: the snapshot
   * stays as it is. Shown, it says hello at once and counts both again from there, also when it
   * showed already (the window got the focus).
   */
  setVisible(visible: boolean): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CaptureClientSnapshot;
  request(action: CaptureAction): Promise<CaptureResult>;
};

const HELLO_INTERVAL_MS = 10_000;
/** How often a widget no host answers says hello, so a host that comes back is found soon. */
const ABSENT_HELLO_INTERVAL_MS = 1_500;
const FIRST_STATE_WAIT_MS = 1_500;
const HOST_SILENCE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_WITH_IMAGES_TIMEOUT_MS = 60_000;

const TIMED_OUT: CaptureResult = { ok: false, error: 'timeout' };

export const createCaptureClient = (channel: CaptureChannel): CaptureClient => {
  let snapshot: CaptureClientSnapshot = { status: 'connecting' };
  let hostId: string | undefined;
  let stopListening: (() => void) | undefined;
  let visible = true;
  let helloTimer: ReturnType<typeof setInterval> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const pending = new Map<string, (result: CaptureResult) => void>();

  const setSnapshot = (next: CaptureClientSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  /** Started and shown: only then does the client say hello and count silence. */
  const running = (): boolean => stopListening !== undefined && visible;
  const sayHello = () => channel.post({ v: 1, type: 'hello' });

  /** Repeats hello at the pace of the status while running. */
  const paceHello = () => {
    clearInterval(helloTimer);
    helloTimer = undefined;
    if (!running()) return;
    const interval = snapshot.status === 'absent' ? ABSENT_HELLO_INTERVAL_MS : HELLO_INTERVAL_MS;
    helloTimer = setInterval(sayHello, interval);
  };

  /** Says hello now while running, and repeats it from here. */
  const greet = () => {
    if (running()) sayHello();
    paceHello();
  };

  /** Counts the silence the status allows while running: the wait for a first state, or a next one. */
  const countSilence = () => {
    clearTimeout(silenceTimer);
    silenceTimer = undefined;
    if (!running() || snapshot.status === 'absent') return;
    const wait = snapshot.status === 'connecting' ? FIRST_STATE_WAIT_MS : HOST_SILENCE_MS;
    silenceTimer = setTimeout(goAbsent, wait);
  };

  /** No host answers: follow any host that does, and ask for one at once. */
  function goAbsent() {
    hostId = undefined;
    if (snapshot.status !== 'absent') setSnapshot({ status: 'absent' });
    countSilence();
    greet();
  }

  const onMessage = (message: CaptureMessage) => {
    if (message.type === 'state') {
      if (hostId !== undefined && hostId !== message.hostId) return;
      const wasAbsent = snapshot.status === 'absent';
      hostId = message.hostId;
      setSnapshot({ status: 'connected', state: message.state });
      countSilence();
      if (wasAbsent) paceHello();
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
      greet();
      countSilence();
    },
    stop() {
      stopListening?.();
      stopListening = undefined;
      paceHello();
      countSilence();
    },
    setVisible(next) {
      visible = next;
      if (next) greet();
      else paceHello();
      countSilence();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    request(action) {
      if (snapshot.status !== 'connected' || hostId === undefined)
        return Promise.resolve(TIMED_OUT);
      const id = newCaptureId();
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
