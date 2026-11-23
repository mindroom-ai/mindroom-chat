import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { IContent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';
import { getStreamStatusFromContent, STREAM_STATUS_KEY } from '../../matrix/protocol/aiRun';
import {
  isThinkingPlaceholderBody,
  MINDROOM_THINKING_PLACEHOLDER_BODY,
} from '../../matrix/protocol/thinkingPlaceholder';
import {
  getContentToolTraceEvents,
  MINDROOM_TOOL_TRACE_KEY,
  type ToolTraceEvent,
} from '../../matrix/protocol/toolTrace';
import { compareLiveOrder, type LiveDocs, type LiveOrder } from '../../matrix/protocol/liveFrame';
import { hasLongTextMetadata } from '../../matrix/protocol/longText';
import { parseToolRefText } from '../html/blocks';
import { renderLiveMarkdown, useLiveMarkdownReady } from './liveMarkdown';
import { getLiveReplyStore, LIVE_REPLY_FRESHNESS_MS, type LiveReplyEntry } from './liveReplyStore';

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

/**
 * The tool calls a reply shows, as its row renders them: its frames' while they show over it, else
 * its latest edit's trace. A redacted reply shows none.
 */
export const getShownToolCalls = (
  room: Room,
  reply: MatrixEvent,
  store: ReturnType<typeof getLiveReplyStore>,
  now: number
): ToolTraceEvent[] => {
  if (reply.isRedacted()) return [];
  const replyId = reply.getId() ?? '';
  const thread = reply.threadRootId ? room.getThread(reply.threadRootId) : undefined;
  const timelineSet = thread?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
  const content = getLatestMessageContent(reply, getEditedEvent(replyId, reply, timelineSet));
  const live = store.get(room.roomId, replyId);
  const shown = live && getLiveVerdict(reply, content, live, now) === 'show';
  return (shown ? live.docs.tools : getContentToolTraceEvents(content)) ?? [];
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
 * `text` without its tool marker lines, as the backend takes them out of the text it sends: each
 * goes with the blank line after it, and the markers that end the text with the one before them.
 */
const withoutToolMarkerLines = (text: string): string => {
  const kept: string[] = [];
  let afterMarker = false;
  let lastMarkerAt = -1;
  text.split('\n').forEach((line) => {
    const marker = line === line.trim() && parseToolRefText(line) !== undefined;
    if (marker) lastMarkerAt = kept.length;
    else if (line || !afterMarker) kept.push(line);
    afterMarker = marker;
  });
  if (lastMarkerAt === kept.length && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
};

/**
 * Whether the streaming durable reply is an earlier state of the frame the row showed last: its
 * text, or the thinking placeholder, that the frame's Markdown grew from. A checkpoint says only
 * that the reply is no older than it, so the text decides, for the preview of a reply sent as a
 * sidecar too: holding the frame would keep a preview with more text from loading its sidecar.
 */
const isEarlierState = (
  event: MatrixEvent,
  content: IContent,
  shown: { docs: LiveDocs; order: LiveOrder }
): boolean => {
  const status = getStreamStatusFromContent(content);
  if (event.isRedacted() || !status || !LIVE_DURABLE_STATUSES.has(status)) return false;
  const { md } = shown.docs;
  const checkpoint = getLiveCheckpoint(content);
  // The reply is at least as new as the frame, whatever its text shows.
  if (checkpoint && compareLiveOrder(shown.order, checkpoint) <= 0) return false;
  const { body } = withWarmupActivity(content);
  if (typeof body !== 'string') return false;
  const hasSidecar = hasLongTextMetadata(content);
  if (isThinkingPlaceholderBody(content)) {
    // A preview of calls alone has their rows in its sidecar, so only live prose is more than it.
    return hasSidecar ? withoutToolMarkerLines(md).trim().length > 0 : md.length > 0;
  }
  if (body.length >= md.length) return false;
  const bodyHasMarkers = withoutToolMarkerLines(body) !== body;
  if (hasSidecar && !bodyHasMarkers) {
    // A marker-free sidecar preview omits its tool calls (they live in the sidecar, even if
    // edit resolution borrowed an older trace). Hold the frame only when it has more prose.
    const prose = withoutToolMarkerLines(md);
    return body.length < prose.length && prose.startsWith(body);
  }
  if (md.startsWith(body)) return true;
  if (bodyHasMarkers) return false;
  // Marker-free upload-failure fallback (no sidecar): compare prose against marker-free live text.
  const prose = withoutToolMarkerLines(md);
  return body.length < prose.length && prose.startsWith(body);
};

const noSubscription = () => () => undefined;

export type LiveReplyContent = {
  content: IContent;
  /** Live frames apply to the reply: they show over it or wait for a frame past its checkpoint. */
  live: boolean;
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
  const verdict = event && entry ? getLiveVerdict(event, content, entry, Date.now()) : undefined;
  const docs = verdict === 'show' ? entry?.docs : undefined;
  // The frames the row showed last. When frames and edits stop together (the connection dropped
  // mid-stream), the entry expires while the durable reply is still an earlier state of what the
  // reader saw. The row keeps that text until an edit with more of it arrives, so a reply only
  // grows or pauses.
  const shownRef = useRef<{ docs: LiveDocs; order: LiveOrder }>(undefined);
  if (docs && entry) shownRef.current = { docs, order: { sid: entry.sid, seq: entry.seq } };
  const heldDocs =
    !docs &&
    verdict !== 'wait' &&
    event &&
    shownRef.current &&
    isEarlierState(event, content, shownRef.current)
      ? shownRef.current.docs
      : undefined;
  const liveDocs = docs ?? heldDocs;
  const markdownReady = useLiveMarkdownReady(liveDocs !== undefined);

  useEffect(() => {
    if (verdict !== 'drop' || !roomId || !replyId || store.get(roomId, replyId) !== entry) return;
    store.drop(roomId, replyId);
  }, [entry, replyId, roomId, store, verdict]);

  const waitDocs = verdict === 'wait' ? entry?.docs : undefined;
  const liveContent = useMemo(() => {
    if (liveDocs) return getLiveContent(content, liveDocs, markdownReady);
    const durable = withWarmupActivity(content);
    if (!waitDocs) return durable;
    const covered = withRunningOutput(durable, waitDocs.tools);
    if (!waitDocs.reasoning) return covered;
    const { segments } = waitDocs;
    const segmentsContent = segments.length > 0 ? { [LIVE_REASONING_SEGMENTS_KEY]: segments } : {};
    return { ...covered, [LIVE_REASONING_KEY]: waitDocs.reasoning, ...segmentsContent };
  }, [content, liveDocs, markdownReady, waitDocs]);
  return {
    content: liveContent,
    live: verdict === 'show' || verdict === 'wait' || heldDocs !== undefined,
  };
};
