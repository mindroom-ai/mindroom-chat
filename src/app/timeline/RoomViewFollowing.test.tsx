// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { EventEmitter } from 'events';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomViewFollowing } from './RoomViewFollowing';

vi.mock('./RoomViewFollowing.css', () => ({
  FollowingStrip: 'following-strip',
  FollowingButton: 'following-button',
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org' }),
}));
const settings = vi.hoisted(() => ({ hideActivity: false }));
vi.mock('../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: 'hideActivity') => [settings[key]],
}));
vi.mock('../ui/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));
vi.mock('../messages/EventReaders', () => ({
  EventReaders: ({ eventId, readers }: { eventId: string; readers?: string[] }) => (
    <p data-readers-of={eventId}>{readers?.join(',')}</p>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAMES: Record<string, string> = {
  '@me:example.org': 'Me',
  '@avery:example.org': 'Avery',
  '@sam:example.org': 'Sam',
};

type FakeRoom = EventEmitter & {
  read: Set<string>;
  latest: { id: string; sender: string };
  liveTimeline: { getEvents: () => unknown[] };
};

/** A room whose latest event is `latest` and whose members in `read` have read it. */
const makeRoom = (): FakeRoom => {
  const emitter = new EventEmitter() as FakeRoom;
  emitter.read = new Set();
  emitter.latest = { id: '$latest', sender: '@sam:example.org' };
  emitter.liveTimeline = {
    getEvents: () =>
      [
        { getId: () => '~local', getSender: () => '@me:example.org' },
        { getId: () => emitter.latest.id, getSender: () => emitter.latest.sender },
      ].reverse(),
  };
  Object.assign(emitter, {
    roomId: '!room:example.org',
    getLiveTimeline: () => emitter.liveTimeline,
    getThread: () => null,
    getJoinedMembers: () => Object.keys(NAMES).map((userId) => ({ userId })),
    getMember: (userId: string) => ({ rawDisplayName: NAMES[userId] }),
    hasUserReadEvent: (userId: string, eventId: string) =>
      eventId === emitter.latest.id && emitter.read.has(userId),
  });
  return emitter;
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  settings.hideActivity = false;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const render = (room: FakeRoom) => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(<RoomViewFollowing room={room as unknown as Room} />);
  });
  return container;
};

const strip = (view: HTMLElement) => view.querySelector('[data-room-following="true"]');

it('keeps an empty row while nobody else has read the latest message', () => {
  const room = makeRoom();
  // The user's own receipt and the sender's do not count.
  room.read.add('@me:example.org').add('@sam:example.org');
  const view = render(room);
  expect(strip(view)).not.toBeNull();
  expect(strip(view)?.textContent).toBe('');
});

it('names a reader as their receipt arrives and lists the readers on press', () => {
  const room = makeRoom();
  const view = render(room);
  expect(strip(view)?.textContent).toBe('');

  room.read.add('@avery:example.org');
  act(() => {
    room.emit('Room.receipt');
  });
  const button = strip(view)?.querySelector('button');
  expect(button?.textContent).toBe('Avery is following the conversation.');

  act(() => button?.click());
  expect(view.querySelector('[data-readers-of="$latest"]')?.textContent).toBe('@avery:example.org');
});

it('follows the newest event, so a new message empties the row again', () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const view = render(room);
  expect(strip(view)?.textContent).toContain('Avery');

  room.latest = { id: '$newer', sender: '@sam:example.org' };
  room.read.clear();
  act(() => {
    room.emit('Room.timeline');
  });
  expect(strip(view)?.textContent).toBe('');
});

it('stays empty while the user keeps their own activity private', () => {
  settings.hideActivity = true;
  const room = makeRoom();
  room.read.add('@avery:example.org');
  expect(strip(render(room))?.textContent).toBe('');
});

it('does not draw the row again for events that leave the same readers', () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const getMember = vi.spyOn(room as unknown as { getMember: () => unknown }, 'getMember');
  render(room);
  const namedOnFirstDraw = getMember.mock.calls.length;
  expect(namedOnFirstDraw).toBeGreaterThan(0);

  // A streamed reply's edits arrive as timeline events and change nobody's receipt.
  act(() => {
    room.emit('Room.timeline');
    room.emit('Room.timeline');
  });
  expect(getMember.mock.calls.length).toBe(namedOnFirstDraw);
});

it('asks no receipts for the events and receipts of threads the room view does not show', () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const hasUserReadEvent = vi.spyOn(
    room as unknown as { hasUserReadEvent: () => boolean },
    'hasUserReadEvent'
  );
  const view = render(room);
  const askedOnFirstDraw = hasUserReadEvent.mock.calls.length;

  // A streamed reply's edits land in its thread's timeline, which the room passes on, and give
  // the agent a receipt in that thread.
  const threadTimeline = { getEvents: () => [] };
  const threadReceipt = {
    getContent: () => ({
      $edit: { 'm.read': { '@agent:example.org': { ts: 1, thread_id: '$thread' } } },
    }),
  };
  act(() => {
    for (let edit = 0; edit < 20; edit += 1) {
      room.emit('Room.timeline', {}, room, false, false, { timeline: threadTimeline });
      room.emit('Thread.update', { id: '$thread' });
      room.emit('Room.receipt', threadReceipt, room);
    }
  });
  expect(hasUserReadEvent.mock.calls.length).toBe(askedOnFirstDraw);

  // A receipt in the main timeline still counts.
  const mainReceipt = {
    getContent: () => ({
      $latest: { 'm.read': { '@avery:example.org': { ts: 2, thread_id: 'main' } } },
    }),
  };
  act(() => {
    room.emit('Room.receipt', mainReceipt, room);
  });
  expect(hasUserReadEvent.mock.calls.length).toBeGreaterThan(askedOnFirstDraw);

  // An event of the room's own timeline still refreshes the row.
  room.latest = { id: '$newer', sender: '@sam:example.org' };
  room.read.clear();
  act(() => {
    room.emit('Room.timeline', {}, room, false, false, { timeline: room.liveTimeline });
  });
  expect(strip(view)?.textContent).toBe('');
});
