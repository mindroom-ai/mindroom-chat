import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getSnoozeEndedNote, THREAD_SNOOZE_CONTENT_KEY } from './threadSnooze';

const message = (content: Record<string, unknown>) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: '$wake',
    room_id: '!room:x',
    sender: '@mindroom_router:x',
    content,
  });
const ended = { event: 'ended', until: '2026-11-14T08:00:00Z' };

describe('getSnoozeEndedNote', () => {
  it('recognises a snooze-ended message and its note', () => {
    expect(
      getSnoozeEndedNote(
        message({ body: '⏰ Snooze ended: check CI', [THREAD_SNOOZE_CONTENT_KEY]: ended })
      )
    ).toBe('check CI');
  });

  it('keeps colons inside the note and takes it from the plain body, not the formatted one', () => {
    expect(
      getSnoozeEndedNote(
        message({
          body: '⏰ Snooze ended: ask @code: then ship',
          formatted_body: '⏰ Snooze ended: ask <a href="x">Code</a>: then ship',
          [THREAD_SNOOZE_CONTENT_KEY]: ended,
        })
      )
    ).toBe('ask @code: then ship');
  });

  it('takes the note after the marker text, not after an earlier colon', () => {
    expect(
      getSnoozeEndedNote(
        message({
          body: '> <@bas:x> re: launch\n\n⏰ Snooze ended: check CI',
          [THREAD_SNOOZE_CONTENT_KEY]: ended,
        })
      )
    ).toBe('check CI');
  });

  it('gives undefined for one without a note', () => {
    expect(
      getSnoozeEndedNote(message({ body: '⏰ Snooze ended', [THREAD_SNOOZE_CONTENT_KEY]: ended }))
    ).toBeUndefined();
    expect(
      getSnoozeEndedNote(message({ body: '⏰ Snooze ended: ', [THREAD_SNOOZE_CONTENT_KEY]: ended }))
    ).toBeUndefined();
  });

  it('gives null for any other message', () => {
    expect(getSnoozeEndedNote(message({ body: '⏰ Snooze ended: x' }))).toBeNull();
    expect(
      getSnoozeEndedNote(message({ body: 'x', [THREAD_SNOOZE_CONTENT_KEY]: { event: 'started' } }))
    ).toBeNull();
    expect(
      getSnoozeEndedNote(message({ body: 'x', [THREAD_SNOOZE_CONTENT_KEY]: 'ended' }))
    ).toBeNull();
  });
});
