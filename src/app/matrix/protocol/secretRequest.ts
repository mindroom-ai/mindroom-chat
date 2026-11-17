import { isRecord } from '../../lib/isRecord';

/**
 * Key of the card an agent posts when it needs the person to type a secret, an `m.notice` with
 * the request under this key. The backend edits the notice (`m.replace`) to set the final status.
 * The request is for a service's key, or for a temporary secret, which names a variable instead.
 */
export const MINDROOM_SECRET_REQUEST_KEY = 'io.mindroom.secret_request';

export type SecretRequestStatus = 'pending' | 'saved' | 'declined' | 'expired';

/** Where the person lets MindRoom keep a temporary secret, which sets how long it lives. */
export type SecretKeep = 'memory' | 'disk';

type SecretRequestBase = {
  requestId: string;
  /** The person the agent asked; only they can answer. */
  requesterId: string;
  reason: string;
  status: SecretRequestStatus;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** The page the agent says gives the secret: an http or https URL, as the browser writes it. */
  url?: string;
  /** The agent's hint for the empty field, one short line. */
  placeholder?: string;
  /**
   * The agent reply whose tool call asked, and that call's ID in the reply's tool trace: where
   * the reply draws the request instead of a row of its own. Both or neither.
   */
  anchor?: { responseEventId: string; toolCallId: string };
};

/** A request for a service's API key, which MindRoom stores for the agent. */
export type KeySecretRequest = SecretRequestBase & {
  kind: 'key';
  service: string;
  displayName: string;
  /** Hosts the key may be sent to. */
  hosts: string[];
  /** The service already has a key, which an answer replaces. */
  replaces: boolean;
};

/** A request for a secret the agent's shell commands receive for a limited time. */
export type TemporarySecretRequest = SecretRequestBase & {
  kind: 'temporary';
  /** The environment variable the commands receive. */
  env: string;
  /** What the agent calls the secret, one short line. */
  label?: string;
  /** The keeps the person chooses from, each with its lifetime in seconds. */
  keep: Partial<Record<SecretKeep, number>>;
  /** The keep the person chose, once answered. */
  kept: SecretKeep | null;
};

export type SecretRequest = KeySecretRequest | TemporarySecretRequest;

const STATUSES: readonly string[] = ['pending', 'saved', 'declined', 'expired'];
const KEEPS: readonly SecretKeep[] = ['memory', 'disk'];

// The backend's IDs are URL-safe tokens. One of dots alone would turn the answer's path into another.
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
// A name every shell takes as a variable.
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// What the backend cuts a label or a field hint to, and the longest link it posts.
const MAX_LINE_LENGTH = 80;
const MAX_LINK_LENGTH = 2000;
// Longer than any event ID or provider call ID.
const MAX_ID_LENGTH = 512;

/** A label or a field hint as the card shows it: one line, cut to its limit; undefined without text. */
const readLine = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // By character, so that the cut never splits one.
  const line = [...value.replace(/\s+/g, ' ').trim()].slice(0, MAX_LINE_LENGTH).join('');
  return line || undefined;
};

/**
 * The page a card's button opens: an http or https URL that names no account to sign in with.
 * Anything else is no link, and the card shows without one.
 */
const readLink = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > MAX_LINK_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  return web && !url.username && !url.password ? url.href : undefined;
};

/** What the agent chose to show on either kind of card, each only when the card has it. */
const readShown = (value: Record<string, unknown>): Pick<SecretRequestBase, 'url' | 'placeholder'> => {
  const url = readLink(value.url);
  const placeholder = readLine(value.placeholder);
  return { ...(url && { url }), ...(placeholder && { placeholder }) };
};

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH;

/** The reply and tool call that asked, when the card names both. */
const readAnchor = (value: Record<string, unknown>): Pick<SecretRequestBase, 'anchor'> => {
  const { response_event_id: responseEventId, tool_call_id: toolCallId } = value;
  return isId(responseEventId) && isId(toolCallId)
    ? { anchor: { responseEventId, toolCallId } }
    : {};
};

const isStatus = (value: unknown): value is SecretRequestStatus =>
  typeof value === 'string' && STATUSES.includes(value);

const isKeep = (value: unknown): value is SecretKeep =>
  typeof value === 'string' && (KEEPS as readonly string[]).includes(value);

/** The keeps this client knows that have a lifetime, or null when the card offers none of them. */
const readKeep = (value: unknown): TemporarySecretRequest['keep'] | null => {
  if (!isRecord(value)) return null;
  const keep: TemporarySecretRequest['keep'] = {};
  KEEPS.forEach((name) => {
    const seconds = value[name];
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      keep[name] = seconds;
    }
  });
  return Object.keys(keep).length > 0 ? keep : null;
};

const readRequest = (value: unknown): SecretRequest | null => {
  if (!isRecord(value)) return null;
  const {
    request_id: requestId,
    requester_id: requesterId,
    service,
    display_name: displayName,
    hosts,
    env,
    reason,
    status,
    expires_at: expiresAt,
  } = value;
  if (
    typeof requestId !== 'string' ||
    !REQUEST_ID.test(requestId) ||
    typeof requesterId !== 'string' ||
    typeof reason !== 'string' ||
    !isStatus(status) ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  const base = {
    requestId,
    requesterId,
    reason,
    status,
    expiresAt,
    ...readShown(value),
    ...readAnchor(value),
  };
  if (env !== undefined) {
    // A temporary secret names no service: a card with both is neither kind.
    const keep = readKeep(value.keep);
    if (
      typeof env !== 'string' ||
      !ENV_NAME.test(env) ||
      keep === null ||
      service !== undefined ||
      displayName !== undefined ||
      hosts !== undefined
    ) {
      return null;
    }
    const label = readLine(value.label);
    return {
      ...base,
      kind: 'temporary',
      env,
      keep,
      kept: isKeep(value.kept) ? value.kept : null,
      ...(label && { label }),
    };
  }
  if (
    typeof service !== 'string' ||
    typeof displayName !== 'string' ||
    !Array.isArray(hosts) ||
    !hosts.every((host): host is string => typeof host === 'string')
  ) {
    return null;
  }
  return { ...base, kind: 'key', service, displayName, hosts, replaces: value.replaces === true };
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
