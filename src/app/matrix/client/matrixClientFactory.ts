import {
  calculateRetryBackoff,
  createClient,
  EventType,
  MatrixScheduler,
  type ICreateClientOpts,
  type ISendEventResponse,
  type MatrixEvent,
} from 'matrix-js-sdk';
import { traceDeepDiagnosticFetch } from '../../diagnostics/deepTrace';
import { matchesEnum } from '../../lib/matchesEnum';
import { bindHomeserverReachability, createHomeserverReachability } from './homeserverReachability';
import { bindSyncStallWatch, createSyncStallWatch } from './syncStall';
import { getCloudflareAccessToken } from '../../native/cloudflareAccess';

type CreateClientOpts = ICreateClientOpts & {
  threadSupport?: boolean;
};

type RuntimeLocation = {
  origin: string;
};

const getRuntimeOrigin = (): string | undefined => {
  if (typeof globalThis === 'undefined') return undefined;
  const { location } = globalThis as { location?: RuntimeLocation };
  if (!location?.origin) return undefined;
  return location.origin;
};

const resolveRequestUrl = (input: Parameters<typeof fetch>[0]): URL | null => {
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(String(input), getRuntimeOrigin());
  } catch {
    return null;
  }
};

const isSameOriginRequest = (input: Parameters<typeof fetch>[0]): boolean => {
  const origin = getRuntimeOrigin();
  if (!origin) return false;
  const url = resolveRequestUrl(input);
  if (!url) return false;
  return url.origin === origin;
};

// A server behind Cloudflare Access needs its Access token on every request. Fetch would
// carry this header across a redirect to another origin, so such requests do not follow one.
const withCloudflareAccessToken = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): RequestInit | undefined => {
  const url = resolveRequestUrl(input);
  const token = url ? getCloudflareAccessToken(url) : undefined;
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set('cf-access-token', token);
  return { ...init, headers, redirect: 'error' };
};

export const createMatrixFetchFn =
  (baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch =>
  (input, init) => {
    const requestInit = withCloudflareAccessToken(input, init);
    return !isSameOriginRequest(input)
      ? traceDeepDiagnosticFetch(baseFetch, input, requestInit)
      : traceDeepDiagnosticFetch(baseFetch, input, {
          ...requestInit,
          credentials: 'include',
        });
  };

const MESSAGE_RETRY_WINDOW_MS = 60_000;
const DEFAULT_RING_RETRY_WINDOW_MS = 30_000;
const RING_QUEUE_NAME = 'call-ring';
const queuedAt = new WeakMap<MatrixEvent, number>();

const isRingNotification = (event: MatrixEvent): boolean =>
  matchesEnum(event.getType(), EventType.RTCNotification) &&
  event.getContent().notification_type === 'ring';

const ringRetryBounds = (
  event: MatrixEvent,
  startedAt: number
): { startMs: number; windowMs: number; ring: boolean } => {
  if (!isRingNotification(event)) {
    return { startMs: startedAt, windowMs: MESSAGE_RETRY_WINDOW_MS, ring: false };
  }
  const content = event.getContent();
  const lifetime = content.lifetime;
  const windowMs =
    typeof lifetime === 'number' && Number.isFinite(lifetime) && lifetime > 0
      ? Math.min(lifetime, MESSAGE_RETRY_WINDOW_MS)
      : DEFAULT_RING_RETRY_WINDOW_MS;
  const senderTs = content.sender_ts;
  const startMs =
    typeof senderTs === 'number' && Number.isFinite(senderTs)
      ? Math.min(senderTs, startedAt)
      : startedAt;
  return { startMs, windowMs, ring: true };
};

const isPastRetryWindow = (event: MatrixEvent | null, delayMs = 0): boolean => {
  const startedAt = event ? queuedAt.get(event) : undefined;
  if (startedAt === undefined || !event) return false;
  const { startMs, windowMs, ring } = ringRetryBounds(event, startedAt);
  const elapsed = Date.now() + delayMs - startMs;
  return ring ? elapsed >= windowMs : elapsed > windowMs;
};

const retryMessageSend: MatrixScheduler['retryAlgorithm'] = (event, attempts, err) => {
  const delayMs = calculateRetryBackoff(err, attempts, true);
  return delayMs >= 0 && !isPastRetryWindow(event, delayMs) ? delayMs : -1;
};

const ringQueueName = (event: MatrixEvent): string => {
  const key = event.getTxnId() ?? event.getId();
  return key ? `${RING_QUEUE_NAME}:${key}` : RING_QUEUE_NAME;
};

// Give each call ring its own queue so an expired ring's clearQueue rejects only that ring and
// never unrelated queued text messages or a later redial's ring; everything else matches main.
const queueMessageSend: MatrixScheduler['queueAlgorithm'] = (event) =>
  isRingNotification(event) ? ringQueueName(event) : MatrixScheduler.QUEUE_MESSAGES(event);

// Receiving the server's copy through /sync clears the local echo's status.
const isConfirmedBySync = (event: MatrixEvent): boolean => event.status === null;

/**
 * The SDK's default scheduler retries server errors but marks a message unsent on its
 * first network error, so a brief connection drop failed it for good. This one also retries
 * connection errors with the same backoff (2, 4, 8 and 16 s, same transaction ID), but a
 * message is only sent within a minute of being queued, also behind a slow message or when
 * iOS suspends the app: a message such as "stop" must not reach an agent long after it
 * was sent.
 */
class MessageSendScheduler extends MatrixScheduler {
  public constructor() {
    super(retryMessageSend, queueMessageSend);
  }

  // Runs once for each send and each user retry; automatic retries do not queue again.
  public override queueEvent(event: MatrixEvent): Promise<ISendEventResponse> | null {
    const queued = super.queueEvent(event);
    if (queued) queuedAt.set(event, Date.now());
    return queued;
  }

  public override setProcessFunction(
    send: (event: MatrixEvent) => Promise<ISendEventResponse>
  ): void {
    super.setProcessFunction(async (event) => {
      // The server's copy can arrive through /sync while a retry waits or a request is in
      // flight, when an earlier attempt arrived but its response was lost. Treat the event as
      // sent: the SDK would otherwise fail to mark it as sending again, or give up on it and
      // reject the messages queued behind it.
      if (isConfirmedBySync(event)) return { event_id: event.getId()! };
      if (isPastRetryWindow(event)) throw new Error('The message retry window has passed.');
      try {
        return await send(event);
      } catch (error) {
        if (isConfirmedBySync(event)) return { event_id: event.getId()! };
        throw error;
      }
    });
  }
}

export const createMatrixClient = (options: CreateClientOpts) => {
  const syncStall = createSyncStallWatch(createMatrixFetchFn(options.fetchFn ?? globalThis.fetch));
  const reachability = createHomeserverReachability(syncStall.fetchFn, options.baseUrl);
  const mx = createClient({
    ...options,
    fetchFn: reachability.fetchFn,
    scheduler: options.scheduler ?? new MessageSendScheduler(),
  });
  bindHomeserverReachability(mx, reachability);
  bindSyncStallWatch(mx, syncStall);
  return mx;
};
