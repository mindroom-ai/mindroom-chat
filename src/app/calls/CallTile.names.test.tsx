// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallParticipant, CallVideoTrack } from './RoomCall';
import { CallTile, ScreenTile } from './CallTile';

const ME = '@me:example.org';
const ROOM_ID = '!desk:example.org';
const REAL = '@morgan:example.org';
const COPY = '@casey:example.org';
const HOST = '@jordan:example.org';
const AGENT_COPY = '@riley:example.org';

const mx = createClient({ baseUrl: 'https://example.org', userId: ME });

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

let eventCount = 0;

const memberEvent = (userId: string, displayname: string) => {
  eventCount += 1;
  return new MatrixEvent({
    type: 'm.room.member',
    state_key: userId,
    sender: userId,
    room_id: ROOM_ID,
    event_id: `$member${eventCount}`,
    origin_server_ts: eventCount,
    content: { membership: 'join', displayname },
  });
};

/**
 * A room whose sync brought only these members, as with lazy-loaded members in a room the user has
 * not opened (or whose member list failed to load when the call started). Its member list arrives
 * when the test calls `listArrives`, or never with `failing`.
 */
const unopenedRoom = (
  members: Array<[userId: string, displayname: string]>,
  { failing = false } = {}
) => {
  const room = new Room(ROOM_ID, mx, ME, { lazyLoadMembers: true });
  room.currentState.setStateEvents(
    members.map(([userId, displayname]) => memberEvent(userId, displayname))
  );
  room.recalculate();
  vi.spyOn(mx, 'getRoom').mockImplementation((roomId) => (roomId === ROOM_ID ? room : null));
  let arrive: () => void = () => undefined;
  const list = failing
    ? Promise.reject(new Error('members unavailable'))
    : new Promise<boolean>((resolve) => {
        arrive = () => resolve(true);
      });
  list.catch(() => undefined);
  vi.spyOn(room, 'loadMembersIfNeeded').mockReturnValue(list);
  /** The client loads the room's member list, which brings members who have not posted lately. */
  const listArrives = async (...later: Array<[userId: string, displayname: string]>) => {
    room.currentState.markOutOfBandMembersStarted();
    room.currentState.setOutOfBandMembers(
      later.map(([userId, displayname]) => memberEvent(userId, displayname))
    );
    await act(async () => arrive());
  };
  return { room, listArrives };
};

const participant = (userId: string, extra: Partial<CallParticipant> = {}): CallParticipant => ({
  key: `${userId}:DEVICE`,
  userId,
  deviceId: 'DEVICE',
  local: false,
  connected: true,
  speaking: false,
  microphone: true,
  ...extra,
});

/** A shared screen; the tile only attaches it to its video. */
const screenTrack = {
  attach: () => undefined,
  detach: () => undefined,
} as unknown as CallVideoTrack;

/** The tiles' accessible names, in order, as the panel's participant list reads them. */
const tileNames = () =>
  screen.getAllByRole('listitem').map((tile) => tile.getAttribute('aria-label'));

const withId = (name: string, userId: string) => `${name} (⁦${userId}⁩)`;

/**
 * Whether the tiles show `text` in one place: the smallest element that holds all of it, as the
 * name and the user ID after it sit in elements of their own.
 */
const shows = (text: string) =>
  screen.queryAllByText(
    (_, element) =>
      element?.textContent === text &&
      !Array.from(element.children).some((child) => child.textContent === text)
  ).length > 0;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('call tiles in a room whose member list is not loaded', () => {
  it("put the user ID after a copied name until the member list shows who is who", async () => {
    // The copy's name reads like the real member's, whom the client has not loaded yet.
    const { room, listArrives } = unopenedRoom([
      [COPY, 'Morgan Lee'],
      [HOST, 'Jordan Host'],
    ]);
    render(
      <ul>
        <CallTile room={room} participant={participant(COPY)} />
        <CallTile room={room} participant={participant(HOST)} />
      </ul>
    );
    expect(tileNames()).toEqual([withId('Morgan Lee', COPY), withId('Jordan Host', HOST)]);
    expect(shows(withId('Morgan Lee', COPY))).toBe(true);

    await listArrives([REAL, 'Morgan Lee']);
    expect(tileNames()).toEqual([withId('Morgan Lee', COPY), 'Jordan Host']);
  });

  it("put the user ID after a name copied from an agent, also while it is awaited and on its screen", () => {
    // The member list failed to load: the copy keeps its user ID for the whole call.
    const { room } = unopenedRoom([[AGENT_COPY, 'Desk Helper']], { failing: true });
    render(
      <ul>
        <ScreenTile
          room={room}
          participant={participant(AGENT_COPY, { screen: screenTrack })}
        />
        <CallTile room={room} participant={participant(AGENT_COPY, { connected: false })} />
      </ul>
    );
    expect(tileNames()).toEqual([
      `${withId('Desk Helper', AGENT_COPY)}'s screen`,
      withId('Desk Helper', AGENT_COPY),
    ]);
    expect(shows(`Waiting for ${withId('Desk Helper', AGENT_COPY)}…`)).toBe(true);
  });
});
