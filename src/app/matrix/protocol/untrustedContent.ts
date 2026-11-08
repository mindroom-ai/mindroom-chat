import { MatrixEvent, type IContent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { isRecord } from '../../lib/isRecord';

/**
 * Message content keys only MindRoom's agents send: the run details (model chip, Reply details),
 * the streaming status (the streaming dots, the thinking placeholder, finished-reply
 * notifications), the tool trace, the reasoning, the live reply state, a voice call's
 * transcript, which shows other members' names and avatars beside its turns, and a call's row and
 * transcript message. Any member can write them into a message, so they count only from an agent
 * account.
 */
export const AGENT_ONLY_CONTENT_KEYS: readonly string[] = [
  'io.mindroom.ai_run',
  'io.mindroom.stream_status',
  'io.mindroom.tool_trace',
  'io.mindroom.reasoning',
  'io.mindroom.live_reasoning',
  'io.mindroom.live_activity',
  'io.mindroom.live_checkpoint',
  'io.mindroom.warmup_suffix',
  'io.mindroom.call_transcript',
  'io.mindroom.call',
  'io.mindroom.call_notes',
];

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

const viewers = new Set<string>();
let viewersVersion = 0;
const trustBySender = new Map<string, boolean>();

/**
 * Counts `userId` as a viewer: agent metadata is trusted from the accounts the existing agent rule
 * (`isMindroomAgentUserIdForViewer`: a `mindroom_` localpart on the viewer's own homeserver) gives
 * any signed-in account.
 */
export const trustAgentsOfViewer = (userId: string | undefined): void => {
  if (!userId || viewers.has(userId)) return;
  viewers.add(userId);
  viewersVersion += 1;
  trustBySender.clear();
};

export const isTrustedAgentSender = (sender: string | undefined): boolean => {
  if (!sender) return false;
  let trusted = trustBySender.get(sender);
  if (trusted === undefined) {
    trusted = [...viewers].some((viewer) => isMindroomAgentUserIdForViewer(sender, viewer));
    trustBySender.set(sender, trusted);
  }
  return trusted;
};

/**
 * `m.relates_to` as the specification shapes it, or undefined. A relation whose type, target or
 * key is not a string is dropped whole, so nothing treats the event as related; a reply target
 * that is not an object with a string event ID is dropped alone.
 */
export const sanitizeRelation = (relation: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(relation)) return undefined;
  if (
    !isOptionalString(relation.rel_type) ||
    !isOptionalString(relation.event_id) ||
    !isOptionalString(relation.key)
  ) {
    return undefined;
  }
  const replyTo = relation['m.in_reply_to'];
  if (replyTo === undefined || (isRecord(replyTo) && typeof replyTo.event_id === 'string')) {
    return relation;
  }
  const rest = { ...relation };
  delete rest['m.in_reply_to'];
  return rest;
};

const withoutAgentKeys = (content: Record<string, unknown>): Record<string, unknown> => {
  if (!AGENT_ONLY_CONTENT_KEYS.some((key) => key in content)) return content;
  const rest = { ...content };
  AGENT_ONLY_CONTENT_KEYS.forEach((key) => delete rest[key]);
  return rest;
};

/**
 * Content in the shapes the app reads: an object, a well-formed `m.relates_to` or none, an object
 * `m.new_content` or none, and without the agent-only keys unless `fromAgent`. Returns `content`
 * itself when nothing changes.
 */
export const sanitizeContent = (content: unknown, fromAgent: boolean): IContent => {
  if (!isRecord(content)) return {};
  let result = content;
  const edit = (key: string, value: unknown) => {
    if (result === content) result = { ...content };
    if (value === undefined) delete result[key];
    else result[key] = value;
  };
  if ('m.relates_to' in content) {
    const relation = sanitizeRelation(content['m.relates_to']);
    if (relation !== content['m.relates_to']) edit('m.relates_to', relation);
  }
  if ('m.new_content' in content) {
    const newContent = content['m.new_content'];
    if (!isRecord(newContent)) edit('m.new_content', undefined);
    else if (!fromAgent) {
      const stripped = withoutAgentKeys(newContent);
      if (stripped !== newContent) edit('m.new_content', stripped);
    }
  }
  if (!fromAgent) {
    const stripped = withoutAgentKeys(result);
    if (stripped !== result) result = stripped;
  }
  return result;
};

/** Whether the content needs no change, checked without copying: the common case. */
const isClean = (content: unknown, sender: string | undefined): boolean => {
  if (!isRecord(content)) return false;
  const relation = content['m.relates_to'];
  if (relation !== undefined && sanitizeRelation(relation) !== relation) return false;
  const newContent = content['m.new_content'];
  if (newContent !== undefined && !isRecord(newContent)) return false;
  const hasAgentKeys =
    AGENT_ONLY_CONTENT_KEYS.some((key) => key in content) ||
    (isRecord(newContent) && AGENT_ONLY_CONTENT_KEYS.some((key) => key in newContent));
  return !hasAgentKeys || isTrustedAgentSender(sender);
};

/**
 * Whether an edit can replace its message: its content is not readable yet (still encrypted), or
 * it has an object `m.new_content`. An edit without one is ignored, as the specification says.
 */
export const isUsableEdit = (edit: MatrixEvent): boolean =>
  isRecord(edit.getContent()['m.new_content']) ||
  (edit.isEncrypted() && edit.getClearContent() === null);

type Sanitized = { source: unknown; version: number; result: IContent };

/** One sanitized copy per event and source, so readers keep getting the same object. */
const memo = (
  cache: WeakMap<MatrixEvent, Sanitized>,
  event: MatrixEvent,
  source: unknown,
  sanitize: () => IContent
): IContent => {
  const cached = cache.get(event);
  if (cached && cached.source === source && cached.version === viewersVersion) {
    return cached.result;
  }
  const result = sanitize();
  cache.set(event, { source, version: viewersVersion, result });
  return result;
};

const wireCache = new WeakMap<MatrixEvent, Sanitized>();
const originalCache = new WeakMap<MatrixEvent, Sanitized>();
let installed = false;
let sdkReplacingEvent: ((this: MatrixEvent) => MatrixEvent | null) | undefined;

/**
 * The edit the SDK applied to `event`, usable or not. Once the guard is installed,
 * `replacingEvent()` answers only a usable one; an edit that could not be decrypted is still
 * worth knowing about, to say that a newer version exists.
 */
export const getAppliedEdit = (event: MatrixEvent): MatrixEvent | null =>
  sdkReplacingEvent && event.replacingEvent === MatrixEvent.prototype.replacingEvent
    ? sdkReplacingEvent.call(event)
    : event.replacingEvent();

/**
 * Checks the shape of every event's content where the app reads it out of the SDK's events: the
 * content an event shows (`getContent`, `getOriginalContent`) and the content it was sent with
 * (`getWireContent`, which the SDK reads relations and thread IDs from). Events from the network
 * are untrusted, so a member can send any JSON; with this, the app sees only the shapes above,
 * and an edit whose `m.new_content` is unusable leaves the message as it was. Installed once,
 * before any client starts.
 */
export const installEventContentGuard = (): void => {
  if (installed) return;
  installed = true;
  const proto = MatrixEvent.prototype;
  const sdkGetWireContent = proto.getWireContent;
  const sdkGetOriginalContent = proto.getOriginalContent;
  const sdkGetContent = proto.getContent;
  const sdkReplacing = proto.replacingEvent;
  const sdkMakeReplaced = proto.makeReplaced;
  sdkReplacingEvent = sdkReplacing;

  proto.getWireContent = function getWireContent(this: MatrixEvent): IContent {
    const content: unknown = sdkGetWireContent.call(this);
    if (isRecord(content)) {
      const relation = content['m.relates_to'];
      if (relation === undefined || sanitizeRelation(relation) === relation) return content;
    }
    return memo(wireCache, this, content, () => sanitizeContent(content, true));
  };

  proto.getOriginalContent = function getOriginalContent<T = IContent>(this: MatrixEvent): T {
    const content: unknown = sdkGetOriginalContent.call(this);
    const sender = this.getSender();
    if (isClean(content, sender)) return content as T;
    return memo(originalCache, this, content, () =>
      sanitizeContent(content, isTrustedAgentSender(sender))
    ) as T;
  };

  // An edit without usable content is no edit: the message shows as it was, without "(edited)".
  proto.replacingEvent = function replacingEvent(this: MatrixEvent): MatrixEvent | null {
    const replacement = sdkReplacing.call(this);
    return replacement && isUsableEdit(replacement) ? replacement : null;
  };

  // `replacingEvent` hides an edit that could not be decrypted, so code that applies the newest
  // edit it sees (the event cache, history loads) puts back a fresh copy of that same edit from the
  // message's bundle, and nothing decrypts the copy: the message would never learn that its edit
  // failed, and its note would go. A copy of the applied edit replaces it once the copy is decrypted.
  proto.makeReplaced = function makeReplaced(this: MatrixEvent, newEvent?: MatrixEvent): void {
    const applied = sdkReplacing.call(this);
    const undecryptedCopy =
      !!applied &&
      !!newEvent &&
      newEvent !== applied &&
      newEvent.getId?.() === applied.getId() &&
      !!newEvent.shouldAttemptDecryption?.() &&
      !applied.shouldAttemptDecryption();
    if (!undecryptedCopy) sdkMakeReplaced.call(this, newEvent);
  };

  proto.getContent = function getContent<T extends IContent = IContent>(this: MatrixEvent): T {
    const replacement = sdkReplacing.call(this);
    if (replacement && !this.isRedacted() && !isUsableEdit(replacement)) {
      return this.getOriginalContent<T>();
    }
    return sdkGetContent.call(this) as T;
  };
};
