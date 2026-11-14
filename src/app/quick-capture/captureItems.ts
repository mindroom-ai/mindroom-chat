import type { CaptureChip, CaptureItem } from './captureProtocol';

export const MAX_CAPTURE_ITEMS = 30;
export const RESOLVED_SHOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_REPLY_TEXT = 600;

/** A thread's newest reply: cleaned as the app's previews clean it, as written, and its sender. */
export type CaptureReply = { replyText?: string; copyText?: string; replySender?: string };

export type CaptureThread = {
  threadId: string;
  title: string;
  /** Reads and cleans the newest reply: only for a thread the list keeps. */
  reply: () => CaptureReply;
  /** A pinned thread cannot be resolved. */
  pinned: boolean;
  streaming: boolean;
  needsYou: boolean;
  unread: boolean;
  resolved: boolean;
  resolvedTs?: number;
  ts: number;
};

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** Cuts text to the limit, backing up one unit rather than leaving half a surrogate pair. */
const cutReplyText = (text: string): string => {
  if (text.length <= MAX_REPLY_TEXT) return text;
  const lastKept = text.charCodeAt(MAX_REPLY_TEXT - 1);
  return text.slice(0, isHighSurrogate(lastKept) ? MAX_REPLY_TEXT - 1 : MAX_REPLY_TEXT);
};

const chipOf = (thread: CaptureThread): CaptureChip | undefined => {
  if (thread.resolved) return undefined;
  if (thread.streaming) return 'working';
  if (thread.needsYou) return 'needs-you';
  if (thread.unread) return 'new';
  return undefined;
};

const toItem = (thread: CaptureThread): CaptureItem => {
  const reply = thread.reply();
  const replyText = reply.replyText ? cutReplyText(reply.replyText) : undefined;
  const copyText = reply.copyText ? cutReplyText(reply.copyText) : undefined;
  const chip = chipOf(thread);
  return {
    threadId: thread.threadId,
    title: thread.title,
    line: replyText ? replyText.replace(/\s+/g, ' ').trim() : '',
    ...(reply.replySender === undefined ? {} : { lineSender: reply.replySender }),
    ...(replyText === undefined ? {} : { replyText }),
    ...(copyText === undefined || copyText === replyText ? {} : { copyText }),
    ...(chip === undefined ? {} : { chip }),
    ...(thread.pinned ? { pinned: true } : {}),
    resolved: thread.resolved,
    ts: thread.ts,
  };
};

/** The widget's list: the 30 newest unresolved threads, then threads resolved in the last 24 hours. */
export const buildCaptureItems = (threads: CaptureThread[], now: number): CaptureItem[] => {
  const seen = new Set<string>();
  const unique = threads.filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
  const open = unique
    .filter((thread) => !thread.resolved)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_CAPTURE_ITEMS);
  const resolvedAt = (thread: CaptureThread): number => thread.resolvedTs ?? 0;
  const resolved = unique
    .filter(
      (thread) =>
        thread.resolved &&
        thread.resolvedTs !== undefined &&
        now - thread.resolvedTs < RESOLVED_SHOWN_MS
    )
    .sort((a, b) => resolvedAt(b) - resolvedAt(a));
  return [...open, ...resolved].map(toItem);
};
