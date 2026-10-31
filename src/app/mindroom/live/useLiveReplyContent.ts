import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { IContent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { getStreamStatusFromContent, STREAM_STATUS_KEY } from '../messages/aiRun';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from '../messages/thinkingPlaceholder';
import { MINDROOM_TOOL_TRACE_KEY } from '../messages/toolTrace';
import { compareLiveOrder, type LiveDocs, type LiveOrder } from './liveFrame';
import { renderLiveMarkdown, useLiveMarkdownReady } from './liveMarkdown';
import { getLiveReplyStore, LIVE_REPLY_FRESHNESS_MS, type LiveReplyEntry } from './liveReplyStore';

/** On durable writes: the content is at least as new as every frame up to this `(sid, seq)`. */
export const LIVE_CHECKPOINT_KEY = 'io.mindroom.live_checkpoint';
/** Live content only: worker warm-up lines, shown below the body. */
export const LIVE_ACTIVITY_KEY = 'io.mindroom.live_activity';
/** Live content only: the model reasoning so far, shown above the body. */
export const LIVE_REASONING_KEY = 'io.mindroom.live_reasoning';

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
const getLiveVerdict = (
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
  return live;
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
 * A covering checkpoint keeps the live reasoning, which progress edits never carry.
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
  const markdownReady = useLiveMarkdownReady(verdict === 'show');

  useEffect(() => {
    if (verdict !== 'drop' || !roomId || !replyId || store.get(roomId, replyId) !== entry) return;
    store.drop(roomId, replyId);
  }, [entry, replyId, roomId, store, verdict]);

  const docs = verdict === 'show' ? entry?.docs : undefined;
  const waitReasoning = verdict === 'wait' ? entry?.docs.reasoning : undefined;
  const liveContent = useMemo(() => {
    if (docs) return getLiveContent(content, docs, markdownReady);
    if (waitReasoning) return { ...content, [LIVE_REASONING_KEY]: waitReasoning };
    return content;
  }, [content, docs, markdownReady, waitReasoning]);
  return { content: liveContent, live: verdict === 'show' || verdict === 'wait' };
};
