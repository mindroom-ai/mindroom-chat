import { Direction, MatrixClient, MatrixEvent, Room, type IRoomEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getEditedEvent } from '../../matrix/room';
import {
  getHistoryReplies,
  getShownHistoryReplies,
  takePageThreadEvents,
} from './classicHistoryReplies';
import { paginateRoomKeepingReplies } from '../sdk/roomHistoryPageSdk';

const ROOM_ID = '!room:example.org';

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    // startClient normally stores this option after server discovery and starts sync.
    this.clientOpts = { threadSupport: true };
  }
}

const raw = (id: string, ts: number, content: Record<string, unknown> = {}): IRoomEvent =>
  ({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@agent:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: id, ...content },
  } as IRoomEvent);

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
const reactionTo = (eventId: string): IRoomEvent => ({
  ...raw('$reaction', 5),
  type: 'm.reaction',
  content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: '+1' } },
});
const editOf = (eventId: string) => ({
  'm.new_content': { msgtype: 'm.text', body: 'edited' },
  'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
});

/** A room whose server answers each history page with `chunk`, newest first. */
const setup = (chunk: IRoomEvent[]) => {
  const mx = new ThreadEnabledClient();
  const room = new Room(ROOM_ID, mx, '@alice:example.org', { timelineSupport: true });
  const edge = room.getLiveTimeline();
  edge.setPaginationToken('older', Direction.Backward);
  const request = vi
    .spyOn(mx, 'createMessagesRequest')
    .mockImplementation(async () => ({ chunk, start: 'older', end: 'oldest' }));
  return { mx, room, edge, request };
};

const FILTERS = {
  ignoredUsersSet: new Set<string>(),
  showHiddenEvents: false,
  hideMembershipEvents: false,
  hideNickAvatarEvents: false,
};

describe('paginateRoomKeepingReplies', () => {
  it('keeps the thread replies of a room page, which the SDK drops, with their edits', async () => {
    const { mx, room, edge, request } = setup([
      raw('$edit', 4, editOf('$reply')),
      raw('$reply', 3, inThread),
      raw('$root', 2),
      raw('$note', 1),
    ]);

    await expect(paginateRoomKeepingReplies(mx, room, edge, true, 50)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(ROOM_ID, 'older', 50, Direction.Backward, undefined);
    expect(edge.getEvents().map((event) => event.getId())).toEqual(['$note', '$root']);
    expect(edge.getPaginationToken(Direction.Backward)).toBe('oldest');
    const replies = getHistoryReplies([edge]);
    expect(replies.map((event) => event.getId())).toEqual(['$reply']);
    const [reply] = replies as [MatrixEvent];
    expect(getEditedEvent('$reply', reply, room.getUnfilteredTimelineSet())?.getId()).toBe('$edit');

    // The same reply again (a page asked twice) is kept once.
    edge.setPaginationToken('older', Direction.Backward);
    await paginateRoomKeepingReplies(mx, room, edge, true, 50);
    expect(getHistoryReplies([edge])).toHaveLength(1);
  });

  it('shows an edit that came with a newer page once its reply arrives', async () => {
    const { mx, room, edge, request } = setup([raw('$edit', 4, editOf('$reply')), raw('$b', 3)]);
    await paginateRoomKeepingReplies(mx, room, edge, true, 50);
    request.mockImplementation(async () => ({
      chunk: [raw('$reply', 2, inThread), raw('$root', 1)],
      start: 'oldest',
      end: undefined,
    }));

    await expect(paginateRoomKeepingReplies(mx, room, edge, true, 50)).resolves.toBe(false);

    const [reply] = getHistoryReplies([edge]) as [MatrixEvent];
    await vi.waitFor(() => expect(reply.replacingEvent()?.getId()).toBe('$edit'));
    expect(edge.getPaginationToken(Direction.Backward)).toBeNull();
  });
});

describe('takePageThreadEvents', () => {
  it('hands the cache each page thread events once, with a reaction that came before its reply', async () => {
    const { mx, room, edge, request } = setup([reactionTo('$reply'), raw('$b', 4)]);
    await paginateRoomKeepingReplies(mx, room, edge, true, 50);
    // The reaction's reply, and so its thread, is not known yet.
    expect(takePageThreadEvents(edge)).toEqual([]);

    request.mockImplementation(async () => ({
      chunk: [raw('$edit', 3, editOf('$reply')), raw('$reply', 2, inThread), raw('$root', 1)],
      start: 'oldest',
      end: undefined,
    }));
    await paginateRoomKeepingReplies(mx, room, edge, true, 50);

    const held = takePageThreadEvents(edge);
    expect(held.map((event) => [event.getId(), event.threadRootId])).toEqual([
      ['$edit', '$root'],
      ['$reply', '$root'],
      ['$reaction', '$root'],
    ]);
    expect(takePageThreadEvents(edge)).toEqual([]);
  });
});

describe('getShownHistoryReplies', () => {
  it('passes the kept replies through the filters of the room rows', async () => {
    const { mx, room, edge } = setup([
      raw('$reply', 3, inThread),
      raw('$root', 2),
      raw('$note', 1),
    ]);
    await paginateRoomKeepingReplies(mx, room, edge, true, 50);

    expect(getShownHistoryReplies(room, [edge], FILTERS).map((event) => event.getId())).toEqual([
      '$reply',
    ]);
    const ignored = { ...FILTERS, ignoredUsersSet: new Set(['@agent:example.org']) };
    expect(getShownHistoryReplies(room, [edge], ignored)).toEqual([]);
  });
});
