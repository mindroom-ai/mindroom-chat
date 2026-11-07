import type { IEvent } from 'matrix-js-sdk';

// MindRoom's homeserver sends previews beside a thread's summary (`unsigned['m.relations']
// ['m.thread']`): its latest reply (`io.mindroom.latest_reply`) and its latest title notice
// (`io.mindroom.title`), each a whole thread event with its bundled edit, as `latest_event` is.
// They are copies of thread events, so a redaction of one of those events reaches them too.

type RawEvent = Partial<IEvent>;
type Bundle = Record<string, unknown>;

const isRecord = (value: unknown): value is Bundle =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Whether `key` of a thread summary holds one of MindRoom's preview events. */
const isPreview = (key: string, value: unknown): value is RawEvent & { event_id: string } =>
  key.startsWith('io.mindroom.') && isRecord(value) && typeof value.event_id === 'string';

/** The preview events beside the thread summary `thread`. */
export const threadSummaryPreviews = (thread: Bundle): RawEvent[] =>
  Object.entries(thread).flatMap(([key, value]) => (isPreview(key, value) ? [value] : []));

/**
 * `event` without the previews in its thread summary that copy a redacted event, and with
 * `strip` applied to the others (an edit of theirs may be redacted). The same object when nothing
 * changes; events are replaced rather than changed, as the SDK's own events may share them.
 */
export const withoutRedactedThreadPreviews = <T extends { unsigned?: object }>(
  event: T,
  redactedEventIds: ReadonlySet<string>,
  strip: (preview: RawEvent, redactedEventIds: ReadonlySet<string>) => RawEvent
): T => {
  const unsigned = event.unsigned as Bundle | undefined;
  const relations = unsigned?.['m.relations'];
  const thread = isRecord(relations) ? relations['m.thread'] : undefined;
  if (!isRecord(relations) || !isRecord(thread)) return event;
  let changed = false;
  const nextThread: Bundle = {};
  Object.entries(thread).forEach(([key, value]) => {
    if (!isPreview(key, value)) {
      nextThread[key] = value;
      return;
    }
    if (redactedEventIds.has(value.event_id)) {
      changed = true;
      return;
    }
    const kept = strip(value, redactedEventIds);
    if (kept !== value) changed = true;
    nextThread[key] = kept;
  });
  if (!changed) return event;
  return {
    ...event,
    unsigned: { ...unsigned, 'm.relations': { ...relations, 'm.thread': nextThread } },
  };
};
