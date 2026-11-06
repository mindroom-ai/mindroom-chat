import type { BugReport, BugReportEvent } from './bugReportPayload';

type RawEvent = BugReportEvent['event'];

/** A report whose message events keep only their type and relations, not what they say. */
export type BugReportWithoutText = BugReport & { messageTextOmitted: true };

/**
 * Content an administrator may see without the message: its msgtype and its relation (thread,
 * reply, edit or reaction target), which encrypted events already carry outside the ciphertext.
 * Body, formatted body, attachment keys and every MindRoom field are left out.
 */
const withoutText = (event: RawEvent): RawEvent => {
  // State events (name, members, encryption) are not end-to-end encrypted; they stay whole.
  if (typeof event.state_key === 'string') return event;
  const content = (event.content ?? {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  if (typeof content.msgtype === 'string') kept.msgtype = content.msgtype;
  if (content['m.relates_to'] !== undefined) kept['m.relates_to'] = content['m.relates_to'];
  // `unsigned` can bundle related events (a thread's latest reply) with their content.
  const rest = { ...event };
  delete rest.unsigned;
  return { ...rest, content: kept };
};

/**
 * The report without the text of its messages, for a report from an end-to-end encrypted room:
 * the report room is unencrypted, so its administrators and the homeserver would read the text.
 */
export const withoutMessageText = (report: BugReport): BugReportWithoutText => ({
  ...report,
  messageTextOmitted: true,
  events: report.events.map((item) => ({
    ...item,
    event: withoutText(item.event),
    latestEdit: item.latestEdit && withoutText(item.latestEdit),
  })),
});
