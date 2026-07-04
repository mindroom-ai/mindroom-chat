import { describe, expect, it } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  isRoomEligibleForRawFetch,
  resolveRoomPrefetchTier,
} from '../prefetchPolicy';
import { StateEvent } from '../../../../types/matrix/room';

const makeCreateEvent = (senderId: string | undefined): MatrixEvent =>
  ({
    getSender: () => senderId,
  }) as unknown as MatrixEvent;

const makeRoom = (
  createSender: string | undefined | 'missing',
  encrypted = false
): Room => {
  const stateEvent = createSender === 'missing' ? undefined : makeCreateEvent(createSender);
  return {
    hasEncryptionStateEvent: () => encrypted,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent, _stateKey: string) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return stateEvent;
        },
      }),
    }),
  } as unknown as Room;
};

const makeClient = (domain: string | undefined): MatrixClient =>
  ({
    getDomain: () => domain,
  }) as unknown as MatrixClient;

describe('resolveRoomPrefetchTier (CINNY-207 P4.2 / D3)', () => {
  it('returns "own" when the create event sender is on our homeserver', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@alice:mindroom.chat');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('own');
  });

  it('returns "federated" when the create event sender is on a different homeserver', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@bob:example.org');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('federated');
  });

  it('tolerates ports in the homeserver domain', () => {
    const mx = makeClient('example.test:8443');
    const room = makeRoom('@alice:example.test:8443');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('own');
  });

  it('returns "background" when the create event is missing (no room-state parse of the id)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('missing');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('background');
  });

  it('returns "federated" when the sender id is malformed (no colon)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('malformed');
    // No colon -> senderDomain is undefined -> tier is background, not
    // federated. Guard against future misclassification.
    expect(resolveRoomPrefetchTier(mx, room)).toBe('background');
  });

  it('returns "federated" when our homeserver domain is unknown', () => {
    const mx = makeClient(undefined);
    const room = makeRoom('@alice:example.org');
    expect(resolveRoomPrefetchTier(mx, room)).toBe('federated');
  });
});

describe('isRoomEligibleForRawFetch', () => {
  it('accepts an own-server unencrypted room', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@alice:mindroom.chat', false);
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(true);
  });

  it('rejects an encrypted own-server room (no useful ciphertext to cache)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@alice:mindroom.chat', true);
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(false);
  });

  it('rejects a federated room even if unencrypted', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('@bob:example.org', false);
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(false);
  });

  it('rejects a background room (create event unknown)', () => {
    const mx = makeClient('mindroom.chat');
    const room = makeRoom('missing');
    expect(isRoomEligibleForRawFetch(mx, room)).toBe(false);
  });
});
