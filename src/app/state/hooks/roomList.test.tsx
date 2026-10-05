import React from 'react';
import { act, create } from 'react-test-renderer';
import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { agentCallState, fakeRoom } from '../../test-utils/agentCallRoom';
import { useDirects, useOrphanRooms, useRooms } from './roomList';

const rooms = new Map(
  [
    fakeRoom({ roomId: '!plain:mindroom.test', callRoom: false }),
    fakeRoom({ roomId: '!call:mindroom.test' }),
    fakeRoom({ roomId: '!legacy:mindroom.test', call: agentCallState({ ephemeral: true }) }),
    fakeRoom({ roomId: '!agent:mindroom.test', call: agentCallState() }),
  ].map((room) => [room.roomId, room])
);
const mx = { getRoom: (roomId: string) => rooms.get(roomId) ?? null } as unknown as MatrixClient;
const roomsAtom = atom([...rooms.keys()]);
const none = new Set<string>();
const all = new Set(rooms.keys());
const noParents = new Map<string, Set<string>>();

describe('room list selectors', () => {
  it.each([
    ['rooms', () => useRooms(mx, roomsAtom, none)],
    ['orphan rooms', () => useOrphanRooms(mx, roomsAtom, none, noParents)],
    ['directs', () => useDirects(mx, roomsAtom, all)],
  ])('leave permanent agent call rooms out of %s', (_case, useList) => {
    let listed: string[] = [];
    function Probe() {
      listed = useList();
      return null;
    }
    act(() => {
      create(<Probe />);
    });

    expect(listed).toEqual([
      '!plain:mindroom.test',
      '!call:mindroom.test',
      '!legacy:mindroom.test',
    ]);
  });
});
