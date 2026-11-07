import { type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { mergeRawEventRevisions } from './eventRevision';

const event = (id: string, ts: number, body: string, edit?: { id: string; ts: number }) => ({
  event_id: id,
  sender: '@agent:example.org',
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body },
  ...(edit
    ? {
        unsigned: {
          'm.relations': {
            'm.replace': {
              event_id: edit.id,
              sender: '@agent:example.org',
              origin_server_ts: edit.ts,
              type: 'm.room.message',
              content: {
                msgtype: 'm.text',
                body: '* Ready',
                'm.new_content': { msgtype: 'm.text', body: 'Ready' },
                'm.relates_to': { rel_type: 'm.replace', event_id: id },
              },
            },
          },
        },
      }
    : {}),
});
const root = (thread: Record<string, unknown>): Partial<IEvent> => ({
  event_id: '$root',
  sender: '@reader:example.org',
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Question' },
  unsigned: { 'm.relations': { 'm.thread': thread } },
});
const threadOf = (merged: Partial<IEvent>) =>
  merged.unsigned?.['m.relations']?.['m.thread'] as Record<string, unknown>;

describe("MindRoom's thread previews across saved copies of a root", () => {
  it('keep the previews that came with the latest event the merge keeps', () => {
    const placeholder = event('$reply', 100, 'Thinking...');
    const title = event('$title', 300, 'Release notes');
    // Saved while the reply was its placeholder, then read again after the reply and its title.
    const listedEarly = root({
      count: 1,
      latest_event: placeholder,
      'io.mindroom.latest_reply': placeholder,
    });
    const listedLater = root({
      count: 2,
      latest_event: title,
      'io.mindroom.latest_reply': event('$reply', 100, 'Thinking...', { id: '$edit', ts: 200 }),
      'io.mindroom.title': title,
    });

    const merged = threadOf(mergeRawEventRevisions(listedEarly, listedLater));
    expect(merged.latest_event).toMatchObject({ event_id: '$title' });
    expect(merged['io.mindroom.latest_reply']).toMatchObject({
      unsigned: { 'm.relations': { 'm.replace': { event_id: '$edit' } } },
    });
    expect(merged['io.mindroom.title']).toMatchObject({ event_id: '$title' });

    // An older copy arriving later neither brings its own previews back nor drops the newer ones.
    const replayed = threadOf(mergeRawEventRevisions(listedLater, listedEarly));
    expect(replayed.latest_event).toMatchObject({ event_id: '$title' });
    expect(replayed['io.mindroom.latest_reply']).toMatchObject({
      unsigned: { 'm.relations': { 'm.replace': { event_id: '$edit' } } },
    });

    // A copy whose latest event is newer but that carries no previews leaves none behind.
    const sdkCopy = root({ count: 3, latest_event: event('$later', 400, 'Later reply') });
    expect(threadOf(mergeRawEventRevisions(listedLater, sdkCopy))).not.toHaveProperty(
      'io.mindroom.latest_reply'
    );
  });
});
