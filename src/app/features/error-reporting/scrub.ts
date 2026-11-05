/**
 * The last step before an error report leaves the device: the reporter's `beforeSend`. It
 * rebuilds the report from an allowlist of fields and drops everything else. Free text survives
 * in two places only, an exception's message and the report's message; there it loses what could
 * identify a person or carry their words: Matrix IDs (plain and URL-encoded), access tokens and
 * other secrets, URL queries and fragments, email addresses, file names, and quoted text, which is
 * where engines and the app put data in error messages. Tags, fingerprints and breadcrumb data
 * may hold single codes only (`M_FORBIDDEN`, a route template, a number).
 *
 * Reports never contain message bodies, room names or display names to begin with: the reporter
 * reads none of them. This step makes sure an error message that does carry one, or a field a
 * future change adds, does not get through either.
 */

export type ReportLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export type ReportFrame = {
  filename?: string;
  abs_path?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
};

export type ReportException = {
  type: string;
  value: string;
  mechanism?: { type: string; handled?: boolean };
  stacktrace?: { frames: ReportFrame[] };
};

type Code = string | number | boolean;

export type ReportBreadcrumb = {
  timestamp: number;
  category: string;
  level?: ReportLevel;
  data?: Record<string, Code | undefined>;
};

/** A report in the Sentry event format, which GlitchTip and Sentry take at their store endpoint. */
export type ReportEvent = {
  event_id: string;
  timestamp: number;
  platform: 'javascript';
  level: ReportLevel;
  logger?: string;
  release?: string;
  environment?: string;
  sdk?: { name: string; version: string };
  message?: string;
  exception?: { values: ReportException[] };
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, Code | undefined>>;
  extra?: Record<string, Code | undefined>;
  request?: { url?: string; headers?: Record<string, string> };
  fingerprint?: string[];
  breadcrumbs?: { values: ReportBreadcrumb[] };
};

const MAX_MESSAGE = 500;
const MAX_CODE = 120;
const MAX_FRAMES = 50;
const MAX_BREADCRUMBS = 40;

const LEVELS: readonly ReportLevel[] = ['fatal', 'error', 'warning', 'info', 'debug'];

/** Tags a report may carry; every other tag is dropped. */
const TAG_KEYS: ReadonlySet<string> = new Set([
  'route',
  'source',
  'app_release',
  'viewport',
  'online',
  'visibility',
  'display_mode',
  'errcode',
  'http_status',
  'error_name',
  'decryption_code',
  'event_type',
  'duration',
  'room_open',
]);

/** Numbers and codes `extra` may hold; `component_stack` is the one text field. */
const EXTRA_KEYS: ReadonlySet<string> = new Set(['duration_ms', 'count', 'at_ms']);

/** Fields a breadcrumb's data may hold, each a number, a boolean or a single code. */
const BREADCRUMB_KEYS: ReadonlySet<string> = new Set([
  'from',
  'to',
  'state',
  'previous',
  'duration_ms',
  'code',
  'count',
  'errcode',
  'http_status',
  'error_name',
  'event_type',
  'initial',
]);

/** Contexts a report may carry, each with the fields it may hold. */
const CONTEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  viewport: ['width', 'height', 'device_pixel_ratio'],
  app: ['app_version', 'app_build'],
};

// Extensions of the files people attach and share, the ones a path segment or a word is
// scrubbed for. The app's own code (.js, .css, .wasm, .json) is not among them, so failed chunk
// loads and stack frames keep their file.
const FILE_EXTENSIONS =
  'png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?|ico|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|tsv|epub|pages|numbers|key|mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|mov|webm|mkv|avi|zip|tar|gz|tgz|bz2|xz|7z|rar|zst|sql|db|sqlite|log|xml|ya?ml|ics|vcf|eml|msg|apk|ipa|dmg|exe|iso';
const FILE_SEGMENT = new RegExp(`\\.(?:${FILE_EXTENSIONS})$`, 'i');
const FILE_NAME = new RegExp(
  `(^|[\\s(=,:;[{])([^\\s"'\`<>()[\\]{}/\\\\|:;,]{1,120}\\.(?:${FILE_EXTENSIONS}))(?=$|[\\s)\\]},.;:!?])`,
  'gi'
);

const SERVER = String.raw`(?:\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::\d{1,5})?`;
const USER_ID = new RegExp(String.raw`@[^\s:"'\`<>()[\]{}@/]{1,255}:${SERVER}`, 'g');
const ROOM_ID = new RegExp(String.raw`![A-Za-z0-9._~=+-]{1,255}:${SERVER}`, 'g');
// Room version 12 room IDs have no server part: `!` and a 43-character hash.
const BARE_ROOM_ID = /![A-Za-z0-9_+=-]{20,}/g;
const ALIAS = new RegExp(String.raw`#[^\s:"'\`<>()[\]{}#/]{1,255}:${SERVER}`, 'g');
// Without `/`, which only room version 3 event IDs have, so a path keeps its next segment.
const EVENT_ID = new RegExp(String.raw`\$[A-Za-z0-9._~+=-]{8,255}(?::${SERVER})?`, 'g');
const ENCODED_ID = /%(40|21|23|24)[^\s/?#&"'`<>()[\]{}]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const URL_PATTERN = /\b(?:https?|wss?|mxc|blob|file|data):[^\s"'`<>(){}]+/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const SECRET_PAIR =
  /\b(access_token|refresh_token|login_token|token|password|passwd|secret|api_?key|sentry_key|sid)(\s*[=:]\s*["']?)[^\s&"',;)]+/gi;
const TOKEN_PREFIX =
  /\b(?:syt|syr|mct|mat|mcr|ghp|gho|ghu|ghs|github_pat|xox[abprs])_[A-Za-z0-9_-]{6,}/g;
const API_KEY = /\bsk-[A-Za-z0-9_-]{16,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
// Tokens and keys: 32 or more letters and digits with at least one digit (identifiers have few).
const LONG_RANDOM = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g;
const LONG_HEX = /\b[0-9a-fA-F]{24,}\b/g;
const LABELLED =
  /\b(file ?name|display ?name|room ?name|user ?name|tag name|paste id|name|title|topic|body)(\s*[:=]\s*)[^\n,;)]+/gi;
const DOUBLE_QUOTED = /"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|«[^»\n]*»|`[^`\n]*`/g;
const SINGLE_QUOTED = /(^|[\s([{,:=])'([^'\n]{0,200})'(?=$|[\s)\]},.:;!?])/g;
const CURLY_SINGLE = /‘[^’\n]*’/g;
const IDENTIFIER = /^[A-Za-z_$][\w$.:-]{0,63}$/;
const URL_SEGMENT_TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const MEDIA_OPERATIONS = ['download', 'thumbnail', 'preview_url'];
// A single code: an errcode, a route template, a state name, a size such as 1280x720.
const CODE = /^[\w.:/<>?=+-]{1,120}$/;

const replaceEncodedId = (_match: string, sigil: string): string => {
  switch (sigil) {
    case '40':
      return '<user-id>';
    case '21':
      return '<room-id>';
    case '23':
      return '<room-alias>';
    default:
      return '<event-id>';
  }
};

/** One path segment of a URL, without anything that names a person, a room or a file. */
const scrubPathSegment = (segment: string): string => {
  if (segment === '') return segment;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape stays as it is and is judged below.
  }
  const sigil = decoded.charAt(0);
  if (sigil === '@') return '<user-id>';
  if (sigil === '!') return '<room-id>';
  if (sigil === '#') return '<room-alias>';
  if (sigil === '$') return '<event-id>';
  if (decoded.length > 64 || URL_SEGMENT_TOKEN.test(decoded)) return '<id>';
  if (FILE_SEGMENT.test(decoded)) return '<file>';
  return /[\s"'`<>@]/.test(decoded) ? '<text>' : segment;
};

/**
 * A URL as scheme, host and path, with each path segment scrubbed. Its query and fragment (where
 * tokens and search terms go), credentials, the media part of a Matrix media URL (server, media ID
 * and file name), and any data or blob content are dropped.
 */
export const scrubUrl = (raw: string): string => {
  const scheme = raw.slice(0, raw.indexOf(':')).toLowerCase();
  if (scheme === 'mxc') return 'mxc://<media>';
  if (scheme === 'data' || scheme === 'blob' || scheme === 'file') return `${scheme}:<url>`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '<url>';
  }
  const segments = url.pathname.split('/');
  // `/_matrix/(client/v1|media/v3)/media/download/<server>/<media ID>/<file name>` and the like.
  const media = segments.indexOf('media');
  const operation = segments.findIndex(
    (segment, index) => media > 0 && index > media && MEDIA_OPERATIONS.includes(segment)
  );
  const path = (operation > 0 ? segments.slice(0, operation + 1) : segments)
    .map(scrubPathSegment)
    .join('/');
  return `${url.protocol}//${url.host}${path}${operation > 0 ? '/<media>' : ''}`;
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * `input` without Matrix IDs, secrets, URL queries, email addresses, file names and quoted text,
 * collapsed to one line of at most `max` characters.
 */
export const scrubText = (input: string, max: number = MAX_MESSAGE): string => {
  // Bound the work the patterns below do on a huge string. NUL marks the scrubbed URLs below.
  let text = input.slice(0, max * 4).replace(/\0/g, '');
  // Each URL is scrubbed on its own and set aside, so the text patterns cannot cut up its path.
  const urls: string[] = [];
  text = text.replace(URL_PATTERN, (match) => {
    // Punctuation that ends a sentence is not part of the address.
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
    urls.push(scrubUrl(match.slice(0, match.length - trailing.length)));
    return `\0${urls.length - 1}\0${trailing}`;
  });
  text = text
    .replace(AUTH_SCHEME, '$1 <token>')
    .replace(SECRET_PAIR, '$1$2<token>')
    .replace(TOKEN_PREFIX, '<token>')
    .replace(API_KEY, '<token>')
    .replace(JWT, '<token>')
    .replace(USER_ID, '<user-id>')
    .replace(ROOM_ID, '<room-id>')
    .replace(BARE_ROOM_ID, '<room-id>')
    .replace(ALIAS, '<room-alias>')
    .replace(EVENT_ID, '<event-id>')
    .replace(ENCODED_ID, replaceEncodedId)
    .replace(EMAIL, '<email>')
    .replace(LABELLED, '$1$2<text>')
    .replace(DOUBLE_QUOTED, '"<text>"')
    .replace(CURLY_SINGLE, '‘<text>’')
    .replace(SINGLE_QUOTED, (_match, before: string, inner: string) =>
      IDENTIFIER.test(inner) ? `${before}'${inner}'` : `${before}'<text>'`
    )
    .replace(FILE_NAME, '$1<file>')
    .replace(LONG_RANDOM, '<token>')
    .replace(LONG_HEX, '<id>')
    .replace(/\0(\d+)\0/g, (_match, index: string) => urls[Number(index)] ?? '');
  return truncate(text.replace(/\s+/g, ' ').trim(), max);
};

/** A single code after scrubbing, or `<text>` for anything with spaces or other text in it. */
const scrubCode = (value: Code): Code => {
  if (typeof value !== 'string') return Number.isFinite(value) ? value : '<text>';
  const scrubbed = scrubText(value, MAX_CODE);
  return CODE.test(scrubbed) ? scrubbed : '<text>';
};

/** A code identifier (an error type, a function name), or `fallback` for anything else. */
const identifier = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[\w$.<>[\] ()-]{1,80}$/.test(value) ? value : fallback;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The entries of `record` whose keys `keys` allows, each scrubbed to a code. */
const pickCodes = (
  record: Record<string, Code | undefined> | undefined,
  keys: ReadonlySet<string>
): Record<string, Code> => {
  const result: Record<string, Code> = {};
  Object.entries(record ?? {}).forEach(([key, value]) => {
    if (keys.has(key) && value !== undefined && value !== null) result[key] = scrubCode(value);
  });
  return result;
};

/** Where a stack frame's code is: a scrubbed URL, or a marker such as `<anonymous>`. */
const scrubLocation = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return /^[a-z][\w+.-]*:/i.test(value) ? scrubUrl(value) : identifier(value, '<unknown>');
};

const scrubFrame = (frame: ReportFrame): ReportFrame => ({
  filename: scrubLocation(frame.filename),
  abs_path: scrubLocation(frame.abs_path),
  function: identifier(frame.function, '?'),
  lineno: finite(frame.lineno),
  colno: finite(frame.colno),
  in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
});

const scrubException = (exception: ReportException): ReportException => ({
  type: identifier(exception.type, 'Error'),
  value: scrubText(String(exception.value ?? '')),
  mechanism: exception.mechanism && {
    type: identifier(exception.mechanism.type, 'generic'),
    handled: exception.mechanism.handled === true,
  },
  stacktrace: exception.stacktrace && {
    frames: exception.stacktrace.frames.slice(-MAX_FRAMES).map(scrubFrame),
  },
});

const scrubContexts = (
  contexts: ReportEvent['contexts']
): Record<string, Record<string, Code | undefined>> => {
  const result: Record<string, Record<string, Code | undefined>> = {};
  Object.entries(CONTEXT_FIELDS).forEach(([name, fields]) => {
    const context = contexts?.[name];
    if (context) result[name] = pickCodes(context, new Set(fields));
  });
  return result;
};

const scrubExtra = (extra: ReportEvent['extra']): Record<string, Code> | undefined => {
  if (!extra) return undefined;
  const result = pickCodes(extra, EXTRA_KEYS);
  // React's component stack names components and code files; long, so it has its own bound.
  const stack = extra.component_stack;
  if (typeof stack === 'string') result.component_stack = scrubText(stack, 2000);
  return result;
};

const scrubBreadcrumb = (crumb: ReportBreadcrumb): ReportBreadcrumb => ({
  timestamp: finite(crumb.timestamp) ?? 0,
  category: identifier(crumb.category, 'app'),
  level: crumb.level && LEVELS.includes(crumb.level) ? crumb.level : 'info',
  data: crumb.data && pickCodes(crumb.data, BREADCRUMB_KEYS),
});

/**
 * The report as it may leave the device, or `null` when it is not a report at all. Only the
 * fields of `ReportEvent` survive: no `user`, no cookies, no request body or query string, no
 * breadcrumb messages.
 */
export const scrubEvent = (event: ReportEvent): ReportEvent | null => {
  if (typeof event.event_id !== 'string' || !/^[0-9a-f]{32}$/.test(event.event_id)) return null;
  const userAgent = event.request?.headers?.['User-Agent'];
  const tags: Record<string, string> = {};
  Object.entries(pickCodes(event.tags, TAG_KEYS)).forEach(([key, value]) => {
    tags[key] = String(value);
  });
  return {
    event_id: event.event_id,
    timestamp: finite(event.timestamp) ?? Date.now() / 1000,
    platform: 'javascript',
    level: LEVELS.includes(event.level) ? event.level : 'error',
    logger: event.logger === undefined ? undefined : String(scrubCode(event.logger)),
    release: event.release === undefined ? undefined : String(scrubCode(event.release)),
    environment: event.environment === undefined ? undefined : String(scrubCode(event.environment)),
    sdk: event.sdk && {
      name: String(scrubCode(event.sdk.name)),
      version: String(scrubCode(event.sdk.version)),
    },
    message: event.message === undefined ? undefined : scrubText(event.message),
    exception: event.exception && { values: event.exception.values.map(scrubException) },
    tags,
    contexts: scrubContexts(event.contexts),
    extra: scrubExtra(event.extra),
    request: event.request && {
      url: event.request.url === undefined ? undefined : scrubText(event.request.url, 300),
      headers:
        typeof userAgent === 'string' ? { 'User-Agent': scrubText(userAgent, 300) } : undefined,
    },
    fingerprint: event.fingerprint?.slice(0, 5).map((part) => String(scrubCode(part))),
    breadcrumbs: event.breadcrumbs && {
      values: event.breadcrumbs.values.slice(-MAX_BREADCRUMBS).map(scrubBreadcrumb),
    },
  };
};
