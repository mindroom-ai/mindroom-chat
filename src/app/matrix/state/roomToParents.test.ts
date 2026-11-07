import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  MemoryStore,
  Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { chatRoomParentsAtom, roomToParentsAtom, useBindRoomToParentsAtom } from './roomToParents';

enableMapSet();

const ME = '@me:example.org';
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
});

const spaceChildEvent = (spaceId: string, childId: string, linked: boolean) =>
  new MatrixEvent({
    type: 'm.space.child',
    state_key: childId,
    sender: ME,
    room_id: spaceId,
    event_id: `$${spaceId}-${childId}-${linked}`,
    content: linked ? { via: ['example.org'] } : {},
  });

const setup = (spaces: Record<string, string[]>) => {
  const mx = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: ME,
    store: new MemoryStore(),
  });
  const rooms = new Map<string, Room>();
  Object.entries(spaces).forEach(([spaceId, children]) => {
    const space = new Room(spaceId, mx, ME);
    space.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.create',
        state_key: '',
        sender: ME,
        room_id: spaceId,
        event_id: `$${spaceId}-create`,
        content: { type: 'm.space' },
      }),
      ...children.map((childId) => spaceChildEvent(spaceId, childId, true)),
    ]);
    // Sync re-emits room events on the client.
    mx.reEmitter.reEmit(space, [RoomStateEvent.Events]);
    mx.store.storeRoom(space);
    rooms.set(spaceId, space);
  });
  const store = createStore();
  const Binder = () => {
    useBindRoomToParentsAtom(mx, roomToParentsAtom);
    return null;
  };
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Binder)));
  });
  const unlinkChild = (spaceId: string, childId: string) =>
    act(() => {
      rooms.get(spaceId)!.currentState.setStateEvents([spaceChildEvent(spaceId, childId, false)]);
    });
  const parentsOf = (roomId: string) => store.get(roomToParentsAtom).get(roomId);
  return { unlinkChild, parentsOf, store };
};

describe('useBindRoomToParentsAtom', () => {
  it('keeps the other Space when one of two Spaces removes a room', () => {
    const { unlinkChild, parentsOf } = setup({
      '!space-a:example.org': ['!room:example.org'],
      '!space-b:example.org': ['!room:example.org'],
    });

    unlinkChild('!space-a:example.org', '!room:example.org');

    expect(parentsOf('!room:example.org')).toEqual(new Set(['!space-b:example.org']));
  });

  it('keeps a subspace as the parent of its own rooms when its parent Space removes it', () => {
    const { unlinkChild, parentsOf } = setup({
      '!parent:example.org': ['!subspace:example.org'],
      '!subspace:example.org': ['!room:example.org'],
    });

    unlinkChild('!parent:example.org', '!subspace:example.org');

    expect(parentsOf('!subspace:example.org')).toBeUndefined();
    expect(parentsOf('!room:example.org')).toEqual(new Set(['!subspace:example.org']));
  });

  it('counts no Space among the chat rooms that list sub-rooms, also when its list changes', () => {
    const { store, unlinkChild } = setup({
      '!space:example.org': ['!room:example.org', '!other:example.org'],
    });
    expect(store.get(chatRoomParentsAtom)).toEqual(new Set());

    unlinkChild('!space:example.org', '!other:example.org');

    expect(store.get(chatRoomParentsAtom)).toEqual(new Set());
  });

  it("deletes a room's entry when its last Space removes it", () => {
    const { unlinkChild, parentsOf } = setup({
      '!space:example.org': ['!room:example.org', '!other:example.org'],
    });

    unlinkChild('!space:example.org', '!room:example.org');

    expect(parentsOf('!room:example.org')).toBeUndefined();
    expect(parentsOf('!other:example.org')).toEqual(new Set(['!space:example.org']));
  });
});

const stateEvent = (roomId: string, type: string, stateKey: string, content: object) =>
  new MatrixEvent({
    type,
    state_key: stateKey,
    sender: ME,
    room_id: roomId,
    event_id: `$${roomId}-${type}-${stateKey}-${JSON.stringify(content)}`,
    content,
  });

const PARENT = '!parent:example.org';
const CHILD = '!child:example.org';
const canonicalBackLink = { canonical: true, via: ['example.org'] };

type ChatRoomsOptions = {
  parentMembership?: string;
  childMembership?: string;
  childIsSpace?: boolean;
  listed?: boolean;
  backLink?: object;
};

/** A chat room and a room it may list, both joined unless told otherwise. */
const setupChatRooms = ({
  parentMembership = KnownMembership.Join,
  childMembership = KnownMembership.Join,
  childIsSpace = false,
  listed = true,
  backLink = canonicalBackLink,
}: ChatRoomsOptions = {}) => {
  const mx = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: ME,
    store: new MemoryStore(),
  });
  const makeRoom = (roomId: string, membership: string, state: MatrixEvent[]) => {
    const room = new Room(roomId, mx, ME);
    room.currentState.setStateEvents(state);
    room.updateMyMembership(membership);
    mx.reEmitter.reEmit(room, [RoomStateEvent.Events, RoomEvent.MyMembership]);
    mx.store.storeRoom(room);
    return room;
  };
  const parent = makeRoom(
    PARENT,
    parentMembership,
    listed ? [stateEvent(PARENT, 'm.space.child', CHILD, { via: ['example.org'] })] : []
  );
  const child = makeRoom(CHILD, childMembership, [
    ...(childIsSpace ? [stateEvent(CHILD, 'm.room.create', '', { type: 'm.space' })] : []),
    ...(Object.keys(backLink).length > 0
      ? [stateEvent(CHILD, 'm.space.parent', PARENT, backLink)]
      : []),
  ]);
  const store = createStore();
  const Binder = () => {
    useBindRoomToParentsAtom(mx, roomToParentsAtom);
    return null;
  };
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Binder)));
  });
  const setState = (room: Room, type: string, stateKey: string, content: object) =>
    act(() => {
      room.currentState.setStateEvents([stateEvent(room.roomId, type, stateKey, content)]);
    });
  const childParents = () => store.get(roomToParentsAtom).get(CHILD);
  const chatRoomParents = () => store.get(chatRoomParentsAtom);
  return { parent, child, setState, childParents, chatRoomParents };
};

describe('useBindRoomToParentsAtom with a chat room as parent', () => {
  it('lists a room under a chat room that lists it and that it names as its canonical parent', () => {
    const { childParents, chatRoomParents } = setupChatRooms();

    expect(childParents()).toEqual(new Set([PARENT]));
    expect(chatRoomParents()).toEqual(new Set([PARENT]));
  });

  it.each<[string, ChatRoomsOptions]>([
    ['the room does not name the chat room back', { backLink: {} }],
    [
      'the room names the chat room as a parent that is not canonical',
      { backLink: { via: ['example.org'] } },
    ],
    ['the back link has no servers', { backLink: { canonical: true, via: [] } }],
    ['only the room names the chat room, which does not list it', { listed: false }],
    ['the listed room is a Space', { childIsSpace: true }],
    ['the account has not joined the chat room', { parentMembership: KnownMembership.Invite }],
  ])('leaves a room at top level when %s', (_case, options) => {
    const { childParents, chatRoomParents } = setupChatRooms(options);

    expect(childParents()).toBeUndefined();
    expect(chatRoomParents()).toEqual(new Set());
  });

  it('lists the room once it names the chat room back', () => {
    const { child, setState, childParents } = setupChatRooms({ backLink: {} });

    setState(child, 'm.space.parent', PARENT, canonicalBackLink);

    expect(childParents()).toEqual(new Set([PARENT]));
  });

  it('lists the room once the account joins it', () => {
    const { child, childParents } = setupChatRooms({ childMembership: KnownMembership.Leave });
    expect(childParents()).toBeUndefined();

    act(() => child.updateMyMembership(KnownMembership.Join));

    expect(childParents()).toEqual(new Set([PARENT]));
  });

  it('puts the room back at top level when the chat room takes it off its list', () => {
    const { parent, setState, childParents, chatRoomParents } = setupChatRooms();

    setState(parent, 'm.space.child', CHILD, {});

    expect(childParents()).toBeUndefined();
    expect(chatRoomParents()).toEqual(new Set());
  });

  it('forgets the chat room when the account leaves it', () => {
    const { parent, childParents, chatRoomParents } = setupChatRooms();

    act(() => parent.updateMyMembership(KnownMembership.Leave));

    expect(childParents()).toBeUndefined();
    expect(chatRoomParents()).toEqual(new Set());
  });
});
