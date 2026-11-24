import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ClientEvent,
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useJoinedRoom } from './useJoinedRoom';

const makeRoom = (roomId: string, getMembership: () => string): Room =>
  ({
    roomId,
    getMyMembership: getMembership,
  } as unknown as Room);

describe('useJoinedRoom', () => {
  it('tracks room arrival, join/leave membership transitions, and cleans up listeners', () => {
    const rooms = new Map<string, Room>();
    const mx = Object.assign(new EventEmitter(), {
      getRoom: (id: string) => rooms.get(id) ?? null,
    }) as unknown as MatrixClient & EventEmitter;

    let latest: Room | undefined;
    function Harness({ client, roomId }: { client: MatrixClient | undefined; roomId?: string }) {
      latest = useJoinedRoom(client, roomId);
      return null;
    }

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness client={mx} roomId="!alpha:example.org" />);
    });
    expect(latest).toBeUndefined();

    // Room arrives in store as invited -> still not joined.
    let membership: string = KnownMembership.Invite;
    const alpha = makeRoom('!alpha:example.org', () => membership);
    rooms.set(alpha.roomId, alpha);
    act(() => {
      mx.emit(ClientEvent.Room, alpha);
    });
    expect(latest).toBeUndefined();

    // Unrelated room join does not affect !alpha:example.org.
    const beta = makeRoom('!beta:example.org', () => KnownMembership.Join);
    rooms.set(beta.roomId, beta);
    act(() => {
      mx.emit(RoomEvent.MyMembership, beta, KnownMembership.Join);
    });
    expect(latest).toBeUndefined();

    // User joins !alpha:example.org -> resolves to alpha.
    membership = KnownMembership.Join;
    act(() => {
      mx.emit(RoomEvent.MyMembership, alpha, KnownMembership.Join);
    });
    expect(latest).toBe(alpha);

    // User leaves !alpha:example.org -> drops back to undefined.
    membership = KnownMembership.Leave;
    act(() => {
      mx.emit(RoomEvent.MyMembership, alpha, KnownMembership.Leave);
    });
    expect(latest).toBeUndefined();

    // Switching to an already-joined room resolves immediately; undefined client/roomId yields undefined.
    act(() => {
      renderer.update(<Harness client={mx} roomId="!beta:example.org" />);
    });
    expect(latest).toBe(beta);

    act(() => {
      renderer.update(<Harness client={undefined} roomId="!beta:example.org" />);
    });
    expect(latest).toBeUndefined();
    expect(mx.listenerCount(RoomEvent.MyMembership)).toBe(0);
    expect(mx.listenerCount(ClientEvent.Room)).toBe(0);

    act(() => {
      renderer.unmount();
    });
  });
});
