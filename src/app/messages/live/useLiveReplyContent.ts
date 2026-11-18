import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { IContent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { getStreamStatusFromContent, STREAM_STATUS_KEY } from '../../matrix/protocol/aiRun';
import {
  isThinkingPlaceholderBody,
  MINDROOM_THINKING_PLACEHOLDER_BODY,
} from '../../matrix/protocol/thinkingPlaceholder';
import { MINDROOM_TOOL_TRACE_KEY } from '../../matrix/protocol/toolTrace';
import { compareLiveOrder, type LiveDocs, type LiveOrder } from '../../matrix/protocol/liveFrame';
import { isLiveMarkdownReady, renderLiveMarkdown, useLiveMarkdownReady } from './liveMarkdown';
import {
  getLiveReplyStore,
  LIVE_REPLY_FRESHNESS_MS,
  type LiveReplyEntry,
  type LiveReplyStore,
} from './liveReplyStore';

/** On durable writes: the content is at least as new as every frame up to this `(sid, seq)`. */
export const LIVE_CHECKPOINT_KEY = 'io.mindroom.live_checkpoint';
/** Worker warm-up lines, shown below the body: from live frames or a durable progress edit. */
export const LIVE_ACTIVITY_KEY = 'io.mindroom.live_activity';
/** Live content only: the model reasoning so far, which the reply's bulb shows in segments. */
export const LIVE_REASONING_KEY = 'io.mindroom.live_reasoning';
/** Live content only: where each reasoning segment starts, as `LiveDocs.segments`. */
export const LIVE_REASONING_SEGMENTS_KEY = 'io.mindroom.live_reasoning_segments';
/** Live content only: the reply's compactions so far, as `LiveDocs.compactions`. */
export const LIVE_COMPACTIONS_KEY = 'io.mindroom.live_compactions';

/** On durable progress edits: the warm-up lines after the body, one `<p>` each in the HTML. */
const WARMUP_SUFFIX_KEY = 'io.mindroom.warmup_suffix';
const LONG_TEXT_KEY = 'io.mindroom.long_text';
const LIVE_DURABLE_STATUSES = new Set(['pending', 'streaming']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getLiveCheckpoint = (content: IContent): LiveOrder | undefined => {
  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;
  const checkpoint = newContent?.[LIVE_CHECKPOINT_KEY] ?? content[LIVE_CHECKPOINT_KEY];
  if (!isRecord(checkpoint)) return undefined;
  const { sid, seq } = checkpoint;
  return typeof sid === 'string' && typeof seq === 'number' ? { sid, seq } : undefined;
};

/**
 * Whether the entry shows over the durable content, shows the durable content until a newer
 * frame, or is dropped because it can never show over this reply.
 */
export const getLiveVerdict = (
  event: MatrixEvent,
  content: IContent,
  entry: LiveReplyEntry,
  now: number
): 'show' | 'wait' | 'drop' => {
  if (event.isRedacted() || entry.sender !== event.getSender()) return 'drop';
  const status = getStreamStatusFromContent(content);
  if (!status || !LIVE_DURABLE_STATUSES.has(status)) return 'drop';
  if (now - entry.lastFrameAt >= LIVE_REPLY_FRESHNESS_MS) return 'drop';
  const checkpoint = getLiveCheckpoint(content);
  // The entry stays: the frames after the checkpoint still apply to it.
  if (checkpoint && compareLiveOrder(entry, checkpoint) <= 0) return 'wait';
  return 'show';
};

const getLiveContent = (content: IContent, docs: LiveDocs, renderMarkdown: boolean): IContent => {
  const live: IContent = {
    ...content,
    body: docs.md || MINDROOM_THINKING_PLACEHOLDER_BODY,
    [STREAM_STATUS_KEY]: docs.status,
  };
  ['m.new_content', LONG_TEXT_KEY, 'format', 'formatted_body', MINDROOM_TOOL_TRACE_KEY].forEach(
    (key) => {
      delete live[key];
    }
  );
  const html = docs.md && renderMarkdown ? renderLiveMarkdown(docs.md) : undefined;
  if (html !== undefined) {
    live.format = 'org.matrix.custom.html';
    live.formatted_body = html;
  }
  if (docs.tools.length > 0) live[MINDROOM_TOOL_TRACE_KEY] = { version: 2, events: docs.tools };
  if (docs.activity) live[LIVE_ACTIVITY_KEY] = docs.activity;
  if (docs.reasoning) live[LIVE_REASONING_KEY] = docs.reasoning;
  if (docs.segments.length > 0) live[LIVE_REASONING_SEGMENTS_KEY] = docs.segments;
  // An empty list says the reply has none, over a durable list an older edit left.
  if (docs.compactions) live[LIVE_COMPACTIONS_KEY] = docs.compactions;
  return live;
};

/** Live documents as message content with no durable reply under them (a sub-agent run's). */
export const liveDocsContent = (docs: LiveDocs, renderMarkdown: boolean): IContent =>
  getLiveContent({ msgtype: 'm.text' }, docs, renderMarkdown);

/**
 * The durable reply with its warm-up lines moved out of the body to the activity line, where
 * live frames put them, so the line keeps one look while frames and checkpoints alternate.
 * Content whose body and HTML do not both end in those lines stays as it is.
 */
const withWarmupActivity = (content: IContent): IContent => {
  const suffix = content[WARMUP_SUFFIX_KEY];
  const { body } = content;
  if (typeof suffix !== 'string' || !suffix || typeof body !== 'string') return content;
  const separated = `\n\n${suffix}`;
  const html = content.formatted_body;
  if (!body.endsWith(separated) || typeof html !== 'string' || !html.endsWith('</p>')) {
    return content;
  }
  // One `<p>` per line, with the line's text; tool names lose their backticks to `<code>`.
  const start = suffix
    .split('\n')
    .reduce((end) => (end > 0 ? html.lastIndexOf('<p>', end - 1) : -1), html.length);
  if (start < 0) return content;
  const text = new DOMParser().parseFromString(html.slice(start), 'text/html').body.textContent;
  if (text?.replace(/`/g, '') !== suffix.replace(/[`\n]/g, '')) return content;
  const shown: IContent = {
    ...content,
    body: body.slice(0, -separated.length),
    formatted_body: html.slice(0, start),
    [LIVE_ACTIVITY_KEY]: suffix,
  };
  // Readers prefer `m.new_content`, which still has the lines in its body.
  delete shown['m.new_content'];
  return shown;
};

/**
 * The frames' output on the calls a covering checkpoint still shows running: progress edits never
 * carry it, so it would vanish until the next frame while a quiet command keeps running.
 */
const withRunningOutput = (content: IContent, tools: LiveDocs['tools']): IContent => {
  const trace = content[MINDROOM_TOOL_TRACE_KEY];
  if (!isRecord(trace) || !Array.isArray(trace.events)) return content;
  let changed = false;
  const events = trace.events.map((event: unknown, index) => {
    const live = tools[index];
    if (
      !isRecord(event) ||
      event.type !== 'tool_call_started' ||
      typeof live?.progress !== 'string' ||
      live.tool_name !== event.tool_name
    ) {
      return event;
    }
    changed = true;
    return { ...event, progress: live.progress };
  });
  return changed ? { ...content, [MINDROOM_TOOL_TRACE_KEY]: { ...trace, events } } : content;
};

/**
 * Whether the streaming durable reply is an earlier state of the live Markdown `md`: its body, or
 * the thinking placeholder, that `md` grew from. Progress edits and frames show the same text.
 */
const isEarlierState = (event: MatrixEvent, content: IContent, md: string): boolean => {
  const status = getStreamStatusFromContent(content);
  if (event.isRedacted() || !status || !LIVE_DURABLE_STATUSES.has(status)) return false;
  const { body } = withWarmupActivity(content);
  if (typeof body !== 'string') return false;
  if (isThinkingPlaceholderBody(content)) return md.length > 0;
  return body.length < md.length && md.startsWith(body);
};

const noSubscription = () => () => undefined;

export type LiveReplyContent = {
  content: IContent;
  /** Live frames apply to the reply: they show over it or wait for a frame past its checkpoint. */
  live: boolean;
};

type LiveReplyState = {
  /** The documents drawn over the durable content. */
  docs?: LiveDocs;
  /** The documents a covering checkpoint stands for, which still lend it reasoning and output. */
  waitDocs?: LiveDocs;
};

/**
 * How the reply's live state draws over its durable `content`: the entry's documents while they
 * show (getLiveVerdict), or only its reasoning and running output while a checkpoint covers it.
 * When frames and edits stop together (the connection dropped mid-stream), the entry goes while
 * the durable reply is still an earlier state of what the reader saw; its last documents
 * (`held`, LiveReplyStore.getHeld) stay until an edit with more of them arrives, so a reply only
 * grows or pauses.
 */
const getLiveReplyState = (
  event: MatrixEvent,
  content: IContent,
  entry: LiveReplyEntry | undefined,
  held: LiveReplyEntry | undefined,
  now: number
): LiveReplyState => {
  const verdict = entry ? getLiveVerdict(event, content, entry, now) : undefined;
  if (verdict === 'show') return { docs: entry?.docs };
  if (verdict === 'wait') return { waitDocs: entry?.docs };
  const last = entry ?? held;
  return last && last.sender === event.getSender() && isEarlierState(event, content, last.docs.md)
    ? { docs: last.docs }
    : {};
};

const drawLiveReplyState = (
  content: IContent,
  { docs, waitDocs }: LiveReplyState,
  markdownReady: boolean
): IContent => {
  if (docs) return getLiveContent(content, docs, markdownReady);
  const durable = withWarmupActivity(content);
  if (!waitDocs) return durable;
  const covered = withRunningOutput(durable, waitDocs.tools);
  if (!waitDocs.reasoning) return covered;
  const { segments } = waitDocs;
  const segmentsContent = segments.length > 0 ? { [LIVE_REASONING_SEGMENTS_KEY]: segments } : {};
  return { ...covered, [LIVE_REASONING_KEY]: waitDocs.reasoning, ...segmentsContent };
};

/**
 * What the reply's row draws now (useLiveReplyContent) over the resolved durable `content`, for
 * readers that must agree with it, as the thread's secret request plan does.
 */
export const getDrawnReplyContent = (
  store: LiveReplyStore,
  event: MatrixEvent,
  content: IContent
): IContent => {
  const roomId = event.getRoomId();
  const replyId = event.getId();
  const state =
    roomId && replyId
      ? getLiveReplyState(
          event,
          content,
          store.get(roomId, replyId),
          store.getHeld(roomId, replyId),
          Date.now()
        )
      : {};
  return drawLiveReplyState(content, state, isLiveMarkdownReady());
};

/**
 * The reply's content with its live frames over the resolved durable `content`, while the
 * durable reply streams and no durable checkpoint covers them; otherwise `content` itself.
 * A covering checkpoint keeps the live reasoning and running calls' output, which progress edits
 * never carry.
 */
export const useLiveReplyContent = (
  mx: MatrixClient,
  event: MatrixEvent | undefined,
  content: IContent
): LiveReplyContent => {
  const store = getLiveReplyStore(mx);
  const roomId = event?.getRoomId();
  const replyId = event?.getId();
  const subscribe = useCallback(
    (onChange: () => void) =>
      roomId && replyId ? store.subscribe(roomId, replyId, onChange) : noSubscription(),
    [roomId, replyId, store]
  );
  const entry = useSyncExternalStore(subscribe, () =>
    roomId && replyId ? store.get(roomId, replyId) : undefined
  );
  // The store changes it only with the entry, so the entry's subscription follows it too.
  const held = roomId && replyId ? store.getHeld(roomId, replyId) : undefined;
  const now = Date.now();
  const verdict = event && entry ? getLiveVerdict(event, content, entry, now) : undefined;
  const { docs, waitDocs }: LiveReplyState = event
    ? getLiveReplyState(event, content, entry, held, now)
    : {};
  const markdownReady = useLiveMarkdownReady(docs !== undefined);

  useEffect(() => {
    if (!roomId || !replyId || !event) return;
    const status = getStreamStatusFromContent(content);
    const streams = !!status && LIVE_DURABLE_STATUSES.has(status) && !event.isRedacted();
    if (verdict === 'drop' && store.get(roomId, replyId) === entry) {
      // Frames that went stale stay held; those of another sender or a finished reply go.
      store.drop(roomId, replyId, streams && entry?.sender === event.getSender());
    } else if (!entry && held && !streams) {
      store.drop(roomId, replyId, false);
    }
  }, [content, entry, event, held, replyId, roomId, store, verdict]);

  const liveContent = useMemo(
    () => drawLiveReplyState(content, { docs, waitDocs }, markdownReady),
    [content, docs, markdownReady, waitDocs]
  );
  return { content: liveContent, live: verdict === 'show' || verdict === 'wait' || !!docs };
};
