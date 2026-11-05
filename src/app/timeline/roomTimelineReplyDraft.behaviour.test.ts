import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent } from '../matrix/room';
import { buildMindroomRoomTimelineReplyDraft } from './roomTimelineReplyDraft';

vi.mock('../matrix/room', () => ({
  getEditedEvent: vi.fn(),
}));

type FakeMessage = {
  content: Record<string, unknown>;
  wireContent?: Record<string, unknown>;
  sender?: string;
  threadRootId?: string;
};

const fakeMessage = ({ content, wireContent = {}, sender, threadRootId }: FakeMessage) =>
  ({
    threadRootId,
    getContent: () => content,
    getWireContent: () => wireContent,
    getSender: () => sender,
  } as unknown as MatrixEvent);

const timelineSet = { relations: {} };

const fakeRoom = (message: MatrixEvent) =>
  ({
    findEventById: (eventId: string) => (eventId === '$message' ? message : undefined),
    getUnfilteredTimelineSet: () => timelineSet,
  } as unknown as Room);

const canvasNotice = (title?: string) => ({
  msgtype: 'm.notice',
  body: 'Interactive panel. Open it in MindRoom Chat to respond.',
  'io.mindroom.ui_action': {
    version: 1,
    action: 'show_canvas',
    canvas: { ...(title === undefined ? {} : { title }), html: '<p>Choose</p>' },
  },
});

describe('buildMindroomRoomTimelineReplyDraft behaviour', () => {
  beforeEach(() => {
    vi.mocked(getEditedEvent).mockReset();
    vi.mocked(getEditedEvent).mockReturnValue(undefined);
  });

  it('relates a new thread to the root of the thread the message is in', () => {
    const wireRelation = {
      rel_type: 'm.thread',
      event_id: '$root',
      is_falling_back: true,
      'm.in_reply_to': { event_id: '$earlier' },
    };
    const room = fakeRoom(
      fakeMessage({
        content: { body: 'Inside the thread' },
        wireContent: { 'm.relates_to': wireRelation },
        sender: '@alice:example.org',
        threadRootId: '$root',
      })
    );

    const startingThread = buildMindroomRoomTimelineReplyDraft(room, '$message', true);
    expect(startingThread?.threadRootId).toBe('$root');
    expect(startingThread?.draft.relation).toEqual({ rel_type: 'm.thread', event_id: '$root' });

    const plainReply = buildMindroomRoomTimelineReplyDraft(room, '$message', false);
    expect(plainReply?.threadRootId).toBe('$root');
    expect(plainReply?.draft.relation).toBe(wireRelation);
  });

  it('builds no draft for a message without a sender', () => {
    const room = fakeRoom(fakeMessage({ content: { body: 'Who sent this?' } }));

    expect(buildMindroomRoomTimelineReplyDraft(room, '$message', false)).toBeUndefined();
  });

  it('quotes the original content when the edit carries no replacement content', () => {
    const message = fakeMessage({
      content: { body: 'Original text', formatted_body: '<em>Original text</em>' },
      sender: '@alice:example.org',
    });
    vi.mocked(getEditedEvent).mockReturnValue(
      fakeMessage({ content: { body: '* Edited text' }, sender: '@alice:example.org' })
    );

    const reply = buildMindroomRoomTimelineReplyDraft(fakeRoom(message), '$message', false);

    expect(getEditedEvent).toHaveBeenCalledWith('$message', message, timelineSet);
    expect(reply?.draft).toMatchObject({
      body: 'Original text',
      formattedBody: '<em>Original text</em>',
    });
  });

  it('takes the text of an encrypted message from its decrypted content', () => {
    const wireRelation = { rel_type: 'm.thread', event_id: '$root' };
    const room = fakeRoom(
      fakeMessage({
        content: { msgtype: 'm.text', body: 'Decrypted text' },
        wireContent: {
          algorithm: 'm.megolm.v1.aes-sha2',
          ciphertext: 'opaque',
          'm.relates_to': wireRelation,
        },
        sender: '@alice:example.org',
        threadRootId: '$root',
      })
    );

    expect(buildMindroomRoomTimelineReplyDraft(room, '$message', false)).toEqual({
      draft: {
        userId: '@alice:example.org',
        eventId: '$message',
        body: 'Decrypted text',
        formattedBody: undefined,
        relation: wireRelation,
      },
      threadRootId: '$root',
    });
  });

  it('gives a canvas notice without a title no preview text', () => {
    for (const title of [undefined, '', '   ']) {
      const room = fakeRoom(
        fakeMessage({ content: canvasNotice(title), sender: '@helper:example.org' })
      );

      const reply = buildMindroomRoomTimelineReplyDraft(room, '$message', false);

      expect(reply?.draft.body).toBe('Interactive panel. Open it in MindRoom Chat to respond.');
      expect(reply?.draft).not.toHaveProperty('previewText');
    }
  });

  it('previews an edited canvas notice by the title of its edit', () => {
    const room = fakeRoom(
      fakeMessage({ content: canvasNotice('First title'), sender: '@helper:example.org' })
    );
    vi.mocked(getEditedEvent).mockReturnValue(
      fakeMessage({
        content: { 'm.new_content': canvasNotice('Second title') },
        sender: '@helper:example.org',
      })
    );

    expect(buildMindroomRoomTimelineReplyDraft(room, '$message', false)?.draft).toMatchObject({
      body: 'Interactive panel. Open it in MindRoom Chat to respond.',
      previewText: 'Second title',
    });
  });
});
