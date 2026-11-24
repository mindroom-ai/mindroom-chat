import { createClient, Direction, MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { RecalibrateFilterOpts, Timeline } from '../event-store/timeline/timelinePagination';
import { useRelinkKeepingRows } from './roomTimelinePaginationWindow';

const mx = createClient({ baseUrl: 'https://example.org', userId: '@reader:example.org' });
const room = new Room('!room:example.org', mx, '@reader:example.org');

const memberEvent = (displayname: string) =>
  new MatrixEvent({
    event_id: `$member-${displayname}`,
    room_id: room.roomId,
    sender: '@reader:example.org',
    state_key: '@reader:example.org',
    type: 'm.room.member',
    origin_server_ts: 2,
    content: { membership: 'join', displayname },
    unsigned: { prev_content: { membership: 'join', displayname: 'Name Before' } },
  });
const message = new MatrixEvent({
  event_id: '$message',
  room_id: room.roomId,
  sender: '@reader:example.org',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'The release checklist is in the pinned notes.' },
});

const liveTimeline = (events: MatrixEvent[]) =>
  ({
    getEvents: () => events,
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? 'prev-batch' : null,
    getNeighbouringTimeline: () => null,
  } as never);

const filterOpts: RecalibrateFilterOpts = {
  room,
  threadId: undefined,
  ignoredUsersSet: new Set(),
  showHiddenEvents: false,
  hideMembershipEvents: true,
  hideNickAvatarEvents: true,
};

const renderSetter = (paginate: MatrixClient['paginateEventTimeline'], rebuilt: Timeline) => {
  const setTimeline = vi.fn();
  const client = { paginateEventTimeline: paginate } as unknown as MatrixClient;
  let setRelinked: ReturnType<typeof useRelinkKeepingRows> | undefined;
  function Harness() {
    setRelinked = useRelinkKeepingRows({
      alive: () => true,
      mx: client,
      filterOptsRef: { current: filterOpts },
      rebuildTimeline: () => rebuilt,
      setTimeline,
    });
    return null;
  }
  act(() => {
    create(<Harness />);
  });
  return { setTimeline, setRelinked: setRelinked as ReturnType<typeof useRelinkKeepingRows> };
};

it('keeps the rows on screen while a page links a live timeline of hidden events to them', async () => {
  // A limited sync left a new live timeline with only the reader's rename, hidden here.
  const reset: Timeline = {
    linkedTimelines: [liveTimeline([memberEvent('Name After')])],
    range: { start: 0, end: 0 },
  };
  const linked: Timeline = {
    linkedTimelines: [liveTimeline([message, memberEvent('Name After')])],
    range: { start: 0, end: 1 },
  };
  let answer!: () => void;
  const paginate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = () => resolve(true);
      })
  );
  const { setTimeline, setRelinked } = renderSetter(paginate, linked);

  setRelinked(reset);
  expect(setTimeline).not.toHaveBeenCalled();
  expect(paginate).toHaveBeenCalledWith(reset.linkedTimelines[0], {
    backwards: true,
    limit: expect.any(Number),
  });

  await act(async () => {
    answer();
    await Promise.resolve();
  });
  expect(setTimeline).toHaveBeenCalledWith(linked);
});

it('shows a relinked timeline with rows at once', () => {
  const withRows: Timeline = {
    linkedTimelines: [liveTimeline([message])],
    range: { start: 0, end: 1 },
  };
  const paginate = vi.fn();
  const { setTimeline, setRelinked } = renderSetter(paginate, withRows);

  setRelinked(withRows);
  expect(setTimeline).toHaveBeenCalledWith(withRows);
  expect(paginate).not.toHaveBeenCalled();
});
