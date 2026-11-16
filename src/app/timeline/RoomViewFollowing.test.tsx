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
  joined: Set<string>;
  read: Set<string>;
  latest: { id: string; sender: string };
  liveTimeline: { getEvents: () => unknown[] };
};

/** A room whose latest event is `latest` and whose members in `read` have read it. */
const makeRoom = (): FakeRoom => {
  const emitter = new EventEmitter() as FakeRoom;
  emitter.joined = new Set(Object.keys(NAMES));
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
    getJoinedMembers: () => [...emitter.joined].map((userId) => ({ userId })),
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

const render = (room: FakeRoom, threadId?: string) => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(<RoomViewFollowing room={room as unknown as Room} threadId={threadId} />);
  });
  return container;
};

const strip = (view: HTMLElement) => view.querySelector('[data-room-following="true"]');

/** Emits as the SDK does, then lets the row read once, as it does after the SDK's synchronous work. */
const emitting = async (emit: () => void) => {
  await act(async () => {
    emit();
  });
};

it('keeps an empty row while nobody else has read the latest message', () => {
  const room = makeRoom();
  // The user's own receipt and the sender's do not count.
  room.read.add('@me:example.org').add('@sam:example.org');
  const view = render(room);
  expect(strip(view)).not.toBeNull();
  expect(strip(view)?.textContent).toBe('');
});

it('names a reader as their receipt arrives and lists the readers on press', async () => {
  const room = makeRoom();
  const view = render(room);
  expect(strip(view)?.textContent).toBe('');

  room.read.add('@avery:example.org');
  await emitting(() => room.emit('Room.receipt'));
  const button = strip(view)?.querySelector('button');
  expect(button?.textContent).toBe('Avery is following the conversation.');

  act(() => button?.click());
  expect(view.querySelector('[data-readers-of="$latest"]')?.textContent).toBe('@avery:example.org');
});

it('follows the newest event, so a new message empties the row again', async () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const view = render(room);
  expect(strip(view)?.textContent).toContain('Avery');

  room.latest = { id: '$newer', sender: '@sam:example.org' };
  room.read.clear();
  await emitting(() => room.emit('Room.timeline'));
  expect(strip(view)?.textContent).toBe('');
});

it('stays empty while the user keeps their own activity private', () => {
  settings.hideActivity = true;
  const room = makeRoom();
  room.read.add('@avery:example.org');
  expect(strip(render(room))?.textContent).toBe('');
});

it('does not draw the row again for events that leave the same readers', async () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const getMember = vi.spyOn(room as unknown as { getMember: () => unknown }, 'getMember');
  render(room);
  const namedOnFirstDraw = getMember.mock.calls.length;
  expect(namedOnFirstDraw).toBeGreaterThan(0);

  // A streamed reply's edits arrive as timeline events and change nobody's receipt.
  await emitting(() => room.emit('Room.timeline'));
  await emitting(() => room.emit('Room.timeline'));
  expect(getMember.mock.calls.length).toBe(namedOnFirstDraw);
});

it('reads once for a page of older history, which brings an event for each of its events', async () => {
  const room = makeRoom();
  room.read.add('@avery:example.org');
  const hasUserReadEvent = vi.spyOn(
    room as unknown as { hasUserReadEvent: () => boolean },
    'hasUserReadEvent'
  );
  const view = render(room);
  const older = () =>
    room.emit('Room.timeline', {}, room, true, false, { timeline: room.liveTimeline });

  let asked = hasUserReadEvent.mock.calls.length;
  await emitting(older);
  const askedForOneRead = hasUserReadEvent.mock.calls.length - asked;
  expect(askedForOneRead).toBeGreaterThan(0);

  asked = hasUserReadEvent.mock.calls.length;
  await emitting(() => {
    for (let event = 0; event < 50; event += 1) older();
  });
  expect(hasUserReadEvent.mock.calls.length - asked).toBe(askedForOneRead);
  expect(strip(view)?.textContent).toContain('Avery');
});

it('asks no receipts for the events and receipts of threads the room view does not show', async () => {
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
  await emitting(() => {
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
  await emitting(() => room.emit('Room.receipt', mainReceipt, room));
  expect(hasUserReadEvent.mock.calls.length).toBeGreaterThan(askedOnFirstDraw);

  // An event of the room's own timeline still refreshes the row.
  room.latest = { id: '$newer', sender: '@sam:example.org' };
  room.read.clear();
  await emitting(() =>
    room.emit('Room.timeline', {}, room, false, false, { timeline: room.liveTimeline })
  );
  expect(strip(view)?.textContent).toBe('');
});

it('names a member the SDK announces before it sets their membership', async () => {
  const room = makeRoom();
  room.joined.delete('@avery:example.org');
  room.read.add('@avery:example.org');
  const view = render(room);
  expect(strip(view)?.textContent).toBe('');

  // Members load lazily. The SDK emits `RoomState.newMember` for a member it did not know, then
  // sets their membership.
  await emitting(() => {
    room.emit('RoomState.newMember');
    room.joined.add('@avery:example.org');
  });
  expect(strip(view)?.textContent).toContain('Avery');
});

it('in a thread, reads once for a burst of updates, and again for each later one', async () => {
  const room = makeRoom();
  const thread = { id: '$thread', liveTimeline: room.liveTimeline };
  Object.assign(room, { getThread: (id: string) => (id === thread.id ? thread : null) });
  const hasUserReadEvent = vi.spyOn(
    room as unknown as { hasUserReadEvent: () => boolean },
    'hasUserReadEvent'
  );
  const view = render(room, thread.id);
  expect(strip(view)?.textContent).toBe('');

  // The SDK adds the thread's first page in one go, with an update for each of its events.
  let asked = hasUserReadEvent.mock.calls.length;
  await emitting(() => room.emit('Thread.update', thread));
  const askedForOneRead = hasUserReadEvent.mock.calls.length - asked;
  asked = hasUserReadEvent.mock.calls.length;
  await emitting(() => {
    for (let update = 0; update < 20; update += 1) room.emit('Thread.update', thread);
  });
  expect(hasUserReadEvent.mock.calls.length - asked).toBe(askedForOneRead);

  // A later update reads again even when the newest event stays, as when a reply that held a
  // receipt is found again after a redaction moved it.
  room.read.add('@avery:example.org');
  await emitting(() => room.emit('Thread.update', thread));
  expect(strip(view)?.textContent).toContain('Avery');
});
