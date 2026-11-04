import type { TFunction } from 'i18next';

// Errors are read by their fields and names rather than with `instanceof`, so this module
// imports nothing from matrix-js-sdk and stays usable on the startup screens before the SDK loads.

/** What a thrown value may carry: an SDK `MatrixError`/`HTTPError` or a plain `Error`. */
type ErrorFields = {
  name?: unknown;
  message?: unknown;
  errcode?: unknown;
  httpStatus?: unknown;
  httpHeaders?: unknown;
  data?: { errcode?: unknown; error?: unknown; retry_after_ms?: unknown };
};

const fieldsOf = (error: unknown): ErrorFields | undefined =>
  typeof error === 'object' && error !== null ? (error as ErrorFields) : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const errcodeOf = (fields: ErrorFields): string | undefined =>
  text(fields.errcode) ?? text(fields.data?.errcode);

const statusOf = (fields: ErrorFields): number | undefined =>
  typeof fields.httpStatus === 'number' ? fields.httpStatus : undefined;

// Browsers reject `fetch` with a TypeError whose text depends on the engine.
const FETCH_FAILURE =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

// A module of a dynamic import that did not load, in the words of Chromium, Firefox and WebKit,
// or a style sheet Vite's preload helper could not load for one.
const BUILD_FILE_FAILURE =
  /dynamically imported module|importing a module script failed|unable to preload css/i;

const UNFINISHED_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError']);

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A file of this build that did not load while the browser is online: a deployment removed it
 * while the page still ran the old build, so a new version is waiting. Offline, the same failure
 * is a dropped connection.
 */
export const isMissingBuildFile = (error: unknown): boolean => {
  const message = text(fieldsOf(error)?.message);
  return message !== undefined && BUILD_FILE_FAILURE.test(message) && !isOffline();
};

/** A request that never got an answer: no network, a refused connection, or a blocked fetch. */
const isNoConnection = (fields: ErrorFields): boolean => {
  const name = text(fields.name);
  if (name === 'ConnectionError') return true;
  return name === 'TypeError' && FETCH_FAILURE.test(text(fields.message) ?? '');
};

/**
 * A token refresh that failed without ending the session keeps only its cause's text: a dropped
 * connection, but also a server error or a rate limit at the token endpoint.
 */
const isRefreshWithoutConnection = (fields: ErrorFields): boolean =>
  text(fields.name) === 'TokenRefreshError' && FETCH_FAILURE.test(text(fields.message) ?? '');

const isUnfinished = (fields: ErrorFields): boolean => {
  const name = text(fields.name);
  return name !== undefined && UNFINISHED_NAMES.has(name);
};

type MessageKey =
  | 'forbidden'
  | 'signedOut'
  | 'accountDeactivated'
  | 'accountSuspended'
  | 'accountLocked'
  | 'weakPassword'
  | 'cannotLeaveNoticeRoom'
  | 'notFound'
  | 'unsupported'
  | 'tooLarge'
  | 'unsupportedRoomVersion'
  | 'addressTaken'
  | 'invalidRequest'
  | 'serverLimit'
  | 'serverProblem'
  | 'serverRefused'
  | 'storageBlocked';

// Matrix specification error codes ("Common error codes" and "Other error codes").
const BY_ERRCODE: Readonly<Record<string, MessageKey>> = {
  M_FORBIDDEN: 'forbidden',
  M_GUEST_ACCESS_FORBIDDEN: 'forbidden',
  M_UNKNOWN_TOKEN: 'signedOut',
  M_MISSING_TOKEN: 'signedOut',
  M_USER_DEACTIVATED: 'accountDeactivated',
  M_USER_SUSPENDED: 'accountSuspended',
  M_USER_LOCKED: 'accountLocked',
  M_WEAK_PASSWORD: 'weakPassword',
  M_CANNOT_LEAVE_SERVER_NOTICE_ROOM: 'cannotLeaveNoticeRoom',
  M_NOT_FOUND: 'notFound',
  M_UNRECOGNIZED: 'unsupported',
  M_TOO_LARGE: 'tooLarge',
  M_UNSUPPORTED_ROOM_VERSION: 'unsupportedRoomVersion',
  M_INCOMPATIBLE_ROOM_VERSION: 'unsupportedRoomVersion',
  M_ROOM_IN_USE: 'addressTaken',
  M_USER_IN_USE: 'addressTaken',
  M_THREEPID_IN_USE: 'addressTaken',
  // An application service reserved the room address or user ID.
  M_EXCLUSIVE: 'addressTaken',
  M_BAD_JSON: 'invalidRequest',
  M_NOT_JSON: 'invalidRequest',
  M_INVALID_PARAM: 'invalidRequest',
  M_MISSING_PARAM: 'invalidRequest',
  M_BAD_STATE: 'invalidRequest',
  M_INVALID_ROOM_STATE: 'invalidRequest',
  M_RESOURCE_LIMIT_EXCEEDED: 'serverLimit',
};

const byStatus = (status: number): MessageKey | undefined => {
  if (status >= 500) return 'serverProblem';
  if (status === 400) return 'invalidRequest';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 405) return 'unsupported';
  if (status === 413) return 'tooLarge';
  return undefined;
};

const isRateLimited = (fields: ErrorFields): boolean => {
  const errcode = errcodeOf(fields);
  if (errcode === 'M_LIMIT_EXCEEDED') return true;
  return statusOf(fields) === 429 && (errcode === undefined || errcode === 'M_UNKNOWN');
};

/** How long the server asked to wait: the `Retry-After` header, else the older body field. */
const retryAfterMs = (fields: ErrorFields): number | undefined => {
  const headers = fields.httpHeaders;
  const header =
    typeof Headers !== 'undefined' && headers instanceof Headers
      ? headers.get('Retry-After')
      : null;
  if (header !== null && /^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const fromBody = fields.data?.retry_after_ms;
  return typeof fromBody === 'number' && Number.isInteger(fromBody) && fromBody > 0
    ? fromBody
    : undefined;
};

const SECOND_MS = 1000;
const MINUTE_S = 60;

const rateLimitMessage = (t: TFunction, waitMs: number | undefined): string => {
  if (waitMs === undefined || waitMs <= 0) return t('errors.rateLimited');
  const seconds = Math.ceil(waitMs / SECOND_MS);
  if (seconds < MINUTE_S) return t('errors.rateLimitedSeconds', { count: seconds });
  return t('errors.rateLimitedMinutes', { count: Math.ceil(seconds / MINUTE_S) });
};

/**
 * A translated sentence for a failure this module recognizes: a build file a deployment removed,
 * no connection, a request that did not finish, a rate limit, a Matrix error code or HTTP status,
 * or the browser refusing to store the account list. Undefined for anything else, whose own text
 * is all there is to show.
 */
export const describeKnownError = (t: TFunction, error: unknown): string | undefined => {
  const fields = fieldsOf(error);
  if (fields === undefined) return undefined;
  // Chromium words a missing module like a failed fetch, but the server answered.
  if (isMissingBuildFile(error)) return t('errors.newVersion');
  if (isNoConnection(fields) || isRefreshWithoutConnection(fields)) {
    return t('errors.noConnection');
  }
  if (text(fields.name) === 'TokenRefreshLogoutError') return t('errors.signedOut');
  if (isUnfinished(fields)) return t('errors.timedOut');
  if (text(fields.name) === 'SessionStoreWriteError') return t('errors.storageBlocked');
  if (isRateLimited(fields)) return rateLimitMessage(t, retryAfterMs(fields));
  const errcode = errcodeOf(fields);
  const status = statusOf(fields);
  const key =
    (errcode !== undefined ? BY_ERRCODE[errcode] : undefined) ??
    (status !== undefined ? byStatus(status) : undefined);
  if (key !== undefined) return t(`errors.${key}`);
  if (errcode !== undefined || status !== undefined) return t('errors.serverRefused');
  return undefined;
};

/**
 * A failure as a translated sentence for people: what `describeKnownError` recognizes, or
 * "Something went wrong." Show `errorDetail` beside it (the `ErrorDetail` component does) so
 * the error's own text stays available to whoever debugs it.
 */
export const describeError = (t: TFunction, error: unknown): string =>
  describeKnownError(t, error) ?? t('errors.unknown');

/**
 * The error's own text, untranslated: the server's error code and explanation for a Matrix
 * error, the message of any other error (for a missing build file, which file). Undefined when
 * it would add nothing to the sentence, as for a dropped connection or a request that did not
 * finish.
 */
export const errorDetail = (error: unknown): string | undefined => {
  if (typeof error === 'string') return text(error);
  const fields = fieldsOf(error);
  if (fields === undefined) return undefined;
  if (!isMissingBuildFile(error) && (isNoConnection(fields) || isUnfinished(fields))) {
    return undefined;
  }
  const errcode = errcodeOf(fields);
  const explanation = text(fields.data?.error);
  // Some servers (Tuwunel) already begin the explanation with the code.
  if (errcode !== undefined && explanation !== undefined && !explanation.startsWith(errcode)) {
    return `${errcode}: ${explanation}`;
  }
  return explanation ?? errcode ?? text(fields.message);
};
