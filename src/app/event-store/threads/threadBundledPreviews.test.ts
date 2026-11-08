import { MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { buildThreadRecord } from './threadRecord';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { getBundledThreadPreviews } from './threadBundledPreviews';
import { buildCompactThreadCardViewModelFromRecord } from '../../threads/overview/compactThreadCardViewModel';
import { buildThreadHeaderViewModelFromRecord } from '../../threads/threadHeaderViewModel';
import { buildCrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import titleLastSummary from './fixtures/thread-summary-title-last.json';
import continuedSummary from './fixtures/thread-summary-continued.json';
import markedReplySummary from './fixtures/thread-summary-marked-reply.json';

const roomId = '!board:example.org';
const userId = '@reader:example.org';
const author = '@helper:example.org';
const rootId = '$question';
const reply = (id: string, body: string, ts: number, title = false): IEvent => ({
  event_id: id,
  sender: author,
  type: 'm.room.message',
  origin_server_ts: ts,
  unsigned: {},
  content: {
    msgtype: title ? 'm.notice' : 'm.text',
    body,
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    ...(title ? { 'io.mindroom.thread_summary': { version: 1, summary: body } } : {}),
  },
});

// Recorded PR #143 envelope: embedded events omit room_id; reply edits are bundled.
const summaryShape = () => {
  const title = reply('$title', 'Launch checklist', 3000, true);
  const latestReply = reply('$reply', 'Draft answer', 2000);
  latestReply.unsigned = {
    'm.relations': {
      'm.replace': {
        ...reply('$edit', '* Final answer with dates', 4000),
        content: {
          msgtype: 'm.text',
          body: '* Final answer with dates',
          'm.new_content': { msgtype: 'm.text', body: 'Final answer with dates' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        },
      },
    },
  };
  return {
    count: 2,
    current_user_participated: true,
    latest_event: title,
    'io.mindroom.title': title,
    'io.mindroom.latest_reply': latestReply,
  };
};

const fixture = (bundle = summaryShape()) => {
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId });
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      state_key: author,
      sender: author,
      room_id: roomId,
      content: { membership: 'join', displayname: 'helper' },
    }),
  ]);
  const root = new MatrixEvent({
    event_id: rootId,
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Please review the plan' },
    unsigned: { 'm.relations': { 'm.thread': bundle } },
  });
  return { room, root, mx };
};

const presentation = (room: Room, root: MatrixEvent, events: MatrixEvent[] = []) =>
  resolveThreadPresentationSnapshot({
    room,
    threadRootId: rootId,
    rootEvent: root,
    thread: { rootEvent: root, events },
  });

describe('fresh-device bundled thread presentation', () => {
  // Responses of the merged server (v1.9.4-mindroom.29): disposable IDs normalized, age and
  // transaction IDs removed. A member who never replied sent each title; the marked-reply case's
  // latest reply is an m.text with an io.mindroom.thread_summary marker.
  it.each([titleLastSummary, continuedSummary, markedReplySummary])(
    'reads a recorded server bundle',
    (rawRoot) => {
      const { room } = fixture();
      const value = presentation(room, new MatrixEvent(rawRoot));
      expect(value.summaryText).toBe('Release checklist and launch dates');
      expect(value.latestReplyPreviewText).toBe(
        'The release checklist is ready. Review the dates, confirm the rollout window, and share the final plan.'
      );
      expect(value.lastSenderId).toBe(author);
      expect(room.getThread(rootId)).toBeNull();
    }
  );
  it('shows a title and edited conversational preview without loading the thread', () => {
    const { room, root, mx } = fixture();
    const record = buildThreadRecord({ room, threadRootId: rootId, threadRootEvent: root });
    expect(record.presentation.summaryText).toBe('Launch checklist');
    expect(record.presentation.latestReplyPreviewText).toBe('Final answer with dates');
    expect(record.presentation.lastSenderId).toBe(author);
    expect(room.getThread(rootId)).toBeNull();
    const card = buildCompactThreadCardViewModelFromRecord({
      record,
      room,
      mx,
      useAuthentication: false,
    });
    expect(card.titleText).toBe('Launch checklist');
    expect(card.previewText).toBe('helper: Final answer with dates');
    expect(
      buildThreadHeaderViewModelFromRecord({
        record,
        canEdit: false,
        availableTags: [],
        pickerDisabled: true,
      }).summaryText
    ).toBe('Launch checklist');
    expect(
      buildCrossRoomThreadIndexEntry({
        room,
        threadRootId: rootId,
        threadRootEvent: root,
      })?.summaryText
    ).toBe('Launch checklist');
  });

  it('keeps newer live titles and replies, including edits to the bundled reply', () => {
    const { room, root } = fixture();
    const liveTitle = new MatrixEvent({
      ...reply('$new-title', 'Updated checklist', 6000, true),
      room_id: roomId,
    });
    const liveReply = new MatrixEvent({
      ...reply('$new-reply', 'Newer answer', 5000),
      room_id: roomId,
    });
    const value = presentation(room, root, [liveReply, liveTitle]);
    expect(value.summaryText).toBe('Updated checklist');
    expect(value.latestReplyPreviewText).toBe('Newer answer');
    const edited = new MatrixEvent({ ...reply('$reply', 'Draft answer', 2000), room_id: roomId });
    edited.makeReplaced(
      new MatrixEvent({
        ...reply('$live-edit', '* Live edited answer', 7000),
        room_id: roomId,
        content: {
          'm.new_content': { msgtype: 'm.text', body: 'Live edited answer' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        },
      })
    );
    expect(presentation(room, root, [edited]).latestReplyPreviewText).toBe('Live edited answer');
  });

  it('keeps a newer cached title and reply', () => {
    const { room, root } = fixture();
    const record = buildThreadRecord({
      room,
      threadRootId: rootId,
      threadRootEvent: root,
      summaryInfo: { summaryText: 'Cached checklist', eventTs: 9000 },
      fallbackLatestReplyPreviewText: 'Cached answer',
      fallbackLastSenderId: '@writer:example.org',
      fallbackLastActivityTs: 8000,
    });
    expect(record.presentation.summaryText).toBe('Cached checklist');
    expect(record.presentation.latestReplyPreviewText).toBe('Cached answer');
    expect(record.presentation.lastSenderId).toBe('@writer:example.org');
  });

  it('gets the title even when latest_event has moved on to a reply', () => {
    const shape = summaryShape();
    shape.latest_event = reply('$continued', 'Later conversation', 5000);
    const { room, root } = fixture(shape);
    expect(presentation(room, root).summaryText).toBe('Launch checklist');
  });

  it('does not let a later cached title make an older cached reply win', () => {
    const { room, root } = fixture();
    const record = buildThreadRecord({
      room,
      threadRootId: rootId,
      threadRootEvent: root,
      fallbackLatestReplyPreviewText: 'Old cached answer',
      fallbackLastSenderId: '@old:example.org',
      fallbackLastActivityTs: 9000,
      fallbackLatestReplyTs: 1500,
    });
    expect(record.presentation.latestReplyPreviewText).toBe('Final answer with dates');
    expect(record.presentation.lastSenderId).toBe(author);
  });

  it('uses a newer bundle over an older loaded reply and cached title', () => {
    const { room, root } = fixture();
    const old = new MatrixEvent({ ...reply('$old', 'Old answer', 1500), room_id: roomId });
    expect(presentation(room, root, [old]).latestReplyPreviewText).toBe('Final answer with dates');
    expect(
      buildThreadRecord({
        room,
        threadRootId: rootId,
        threadRootEvent: root,
        summaryInfo: { summaryText: 'Old title', eventTs: 2500 },
      }).presentation.summaryText
    ).toBe('Launch checklist');
  });

  it('does not use namespaced plaintext in encrypted rooms', () => {
    const { room, root } = fixture();
    room.currentState.setStateEvents([
      new MatrixEvent({
        event_id: '$encryption',
        room_id: roomId,
        sender: userId,
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      }),
    ]);
    const value = presentation(room, root);
    expect(value.summaryText).toBeUndefined();
    expect(value.latestReplyPreviewText).toBeUndefined();
  });

  it('drops a bundled reply once the device knows newer thread events than the bundle', () => {
    // The root was listed while the reply was a placeholder; the SDK has followed the thread since.
    const shape = summaryShape();
    const placeholder = reply('$reply', 'Thinking...', 2000);
    shape.latest_event = placeholder;
    shape['io.mindroom.latest_reply'] = placeholder;
    const { room, root } = fixture(shape);
    const live = new MatrixEvent({ ...placeholder, room_id: roomId });
    live.makeReplaced(
      new MatrixEvent({
        ...reply('$step', '* Checking the notes', 3000),
        room_id: roomId,
        content: {
          'm.new_content': { msgtype: 'm.text', body: 'Checking the notes' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        },
      })
    );
    const read = (replyToEvent: MatrixEvent) =>
      resolveThreadPresentationSnapshot({
        room,
        threadRootId: rootId,
        rootEvent: root,
        thread: { rootEvent: root, events: [], replyToEvent },
      });
    // A newer revision of the bundle's latest event.
    expect(read(live).latestReplyPreviewText).toBe('Checking the notes');
    // A newer thread event: the placeholder is no longer the latest reply anyone knows.
    const title = new MatrixEvent({
      ...reply('$late-title', 'Notes', 4000, true),
      room_id: roomId,
    });
    expect(read(title).latestReplyPreviewText).toBeUndefined();
  });

  it('dates the bundle’s latest event by its own sender’s edit only', () => {
    const latest = (editSender: string) => {
      const shape = summaryShape();
      shape.latest_event = {
        ...reply('$reply', 'Thinking...', 2000),
        unsigned: {
          'm.relations': { 'm.replace': { ...reply('$edit', '* Done', 5000), sender: editSender } },
        },
      };
      const { room, root } = fixture(shape);
      return getBundledThreadPreviews(room, root).latest;
    };

    expect(latest('@other:example.org')).toEqual({ id: '$reply', ts: 2000 });
    expect(latest(author)).toEqual({ id: '$reply', ts: 5000 });
  });

  it('reads titles and replies as the server sorts them, whoever sent the title', () => {
    // Any member's m.notice with a truthy marker is a title; every other thread event is a reply.
    const shape = summaryShape();
    const titler = '@reviewer:example.org';
    shape['io.mindroom.title'] = {
      ...reply('$title', 'Launch checklist', 3000, true),
      sender: titler,
    };
    const marked = reply('$marked', 'Answer with dates', 2500);
    marked.content['io.mindroom.thread_summary'] = { version: 1, summary: 'Not a title' };
    shape['io.mindroom.latest_reply'] = marked;
    const { room, root } = fixture(shape);
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.power_levels',
        state_key: '',
        sender: userId,
        room_id: roomId,
        content: { users: { [userId]: 100 }, users_default: 0, events_default: 0 },
      }),
    ]);
    expect(presentation(room, root).summaryText).toBe('Launch checklist');
    expect(presentation(room, root).latestReplyPreviewText).toBe('Answer with dates');

    // A marker added by an edit does not make a title, and a legacy notice is no reply.
    const edited = reply('$edited', 'Plain note', 3000);
    edited.unsigned = {
      'm.relations': {
        'm.replace': {
          ...reply('$edit-marker', '* Edited note', 3100),
          content: {
            'm.new_content': {
              msgtype: 'm.notice',
              body: 'Edited note',
              'io.mindroom.thread_summary': { version: 1, summary: 'Edited note' },
            },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$edited' },
          },
        },
      },
    };
    const legacy = reply('$legacy', 'Legacy title', 2500);
    legacy.content = { ...legacy.content, msgtype: 'm.notice', 'io.mindroom.thread_summary': true };
    const odd = summaryShape();
    odd['io.mindroom.title'] = edited;
    odd['io.mindroom.latest_reply'] = legacy;
    const other = fixture(odd);
    expect(presentation(other.room, other.root).summaryText).toBeUndefined();
    expect(presentation(other.room, other.root).latestReplyPreviewText).toBeUndefined();
  });

  it('reads a notice with any truthy marker as the bundled title, as the server sorts it', () => {
    // The server (mindroom-tuwunel #149) bundles a notice as the title when its marker is truthy.
    const titled = (marker: unknown) => {
      const shape = summaryShape();
      const title = reply('$title', 'Older style title', 3000);
      title.content = {
        ...title.content,
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': marker,
      };
      shape['io.mindroom.title'] = title;
      const { room, root } = fixture(shape);
      return presentation(room, root).summaryText;
    };
    for (const marker of [true, 'yes', 1, ['summary']]) {
      expect(titled(marker)).toBe('Older style title');
    }
    for (const marker of [false, 0, '', null]) {
      expect(titled(marker)).toBeUndefined();
    }
  });

  it('ignores a title-shaped reply and an event for a different root', () => {
    const shape = summaryShape();
    shape['io.mindroom.latest_reply'] = shape['io.mindroom.title'];
    shape['io.mindroom.title'] = reply('$wrong', 'Other thread', 3000, true);
    shape['io.mindroom.title'].content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: '$other',
    };
    const { room, root } = fixture(shape);
    expect(presentation(room, root).summaryText).toBeUndefined();
    expect(presentation(room, root).latestReplyPreviewText).toBeUndefined();
  });
});
