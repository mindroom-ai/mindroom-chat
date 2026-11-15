import { isRecord } from '../../lib/isRecord';

/**
 * Key of the card an agent posts when it needs the person to type a secret, an `m.notice` with
 * the request under this key. The backend edits the notice (`m.replace`) to set the final status.
 */
export const MINDROOM_SECRET_REQUEST_KEY = 'io.mindroom.secret_request';

export type SecretRequestStatus = 'pending' | 'saved' | 'declined' | 'expired';

export type SecretRequest = {
  requestId: string;
  /** The person the agent asked; only they can answer. */
  requesterId: string;
  service: string;
  displayName: string;
  /** Hosts the key may be sent to. */
  hosts: string[];
  reason: string;
  status: SecretRequestStatus;
  /** Milliseconds since the epoch. */
  expiresAt: number;
};

const STATUSES: readonly string[] = ['pending', 'saved', 'declined', 'expired'];

// The backend's IDs are URL-safe tokens. One of dots alone would turn the answer's path into another.
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

const isStatus = (value: unknown): value is SecretRequestStatus =>
  typeof value === 'string' && STATUSES.includes(value);

const readRequest = (value: unknown): SecretRequest | null => {
  if (!isRecord(value)) return null;
  const {
    request_id: requestId,
    requester_id: requesterId,
    service,
    display_name: displayName,
    hosts,
    reason,
    status,
    expires_at: expiresAt,
  } = value;
  if (
    typeof requestId !== 'string' ||
    !REQUEST_ID.test(requestId) ||
    typeof requesterId !== 'string' ||
    typeof service !== 'string' ||
    typeof displayName !== 'string' ||
    !Array.isArray(hosts) ||
    !hosts.every((host): host is string => typeof host === 'string') ||
    typeof reason !== 'string' ||
    !isStatus(status) ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return { requestId, requesterId, service, displayName, hosts, reason, status, expiresAt };
};

/** The request an event's content carries, as its latest edit has it; null for any other content. */
export const parseSecretRequestContent = (content: unknown): SecretRequest | null => {
  if (!isRecord(content)) return null;
  const newContent = content['m.new_content'];
  const source = isRecord(newContent) ? newContent : content;
  return readRequest(source[MINDROOM_SECRET_REQUEST_KEY]);
};

/** The status to show: a pending request at or past its expiry counts as expired. */
export const effectiveSecretRequestStatus = (
  request: SecretRequest,
  now: number
): SecretRequestStatus =>
  request.status === 'pending' && now >= request.expiresAt ? 'expired' : request.status;

/** The route on the room's MindRoom server that answers a request. */
export const secretRequestPath = (roomId: string, requestId: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/secret-requests/${encodeURIComponent(requestId)}`;
