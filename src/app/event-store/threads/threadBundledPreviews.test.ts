import { MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { buildThreadRecord } from './threadRecord';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { buildCompactThreadCardViewModelFromRecord } from '../../threads/overview/compactThreadCardViewModel';
import { buildThreadHeaderViewModelFromRecord } from '../../threads/threadHeaderViewModel';
import { buildCrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import titleLastSummary from './fixtures/thread-summary-title-last.json';
import continuedSummary from './fixtures/thread-summary-continued.json';

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
  // Real PR #143 responses, with disposable IDs normalized and age/transaction IDs removed.
  it.each([titleLastSummary, continuedSummary])('reads a recorded server bundle', (rawRoot) => {
    const { room } = fixture();
    const value = presentation(room, new MatrixEvent(rawRoot));
    expect(value.summaryText).toBe('Release checklist and launch dates');
    expect(value.latestReplyPreviewText).toBe(
      'The release checklist is ready. Review the dates, confirm the rollout window, and share the final plan.'
    );
    expect(value.lastSenderId).toBe(author);
    expect(room.getThread(rootId)).toBeNull();
  });
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
