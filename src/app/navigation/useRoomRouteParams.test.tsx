// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import {
  ACTIVITY_INVITES_PATH,
  ACTIVITY_ROOM_PATH,
  HOME_CREATE_PATH,
  HOME_ROOM_PATH,
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
} from '../routes/paths';
import {
  getActivityRoomPath,
  getHomeRoomPath,
  getSpaceLobbyPath,
  getSpaceRoomPath,
} from '../routes/pathUtils';
import { useRoomNavigate } from './useRoomNavigate';
import { useRoomRouteParams } from './useRoomRouteParams';
import { useSelectedRoom } from './useSelectedRoom';
import { useSelectedSpace } from './useSelectedSpace';

// A client that knows no room by an alias, so an alias names no room and an ID stays as it is.
const client = { getRoom: () => null, getRooms: () => [] } as unknown as MatrixClient;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

/** What each reader of the route makes of it, as one line of JSON (`null` for none). */
function Shown() {
  const { roomPath } = useRoomNavigate();
  const params = useRoomRouteParams();
  return (
    <output>
      {JSON.stringify({
        ...params,
        selectedRoom: useSelectedRoom() ?? null,
        selectedSpace: useSelectedSpace() ?? null,
        roomPath: params.roomIdOrAlias ? roomPath(params.roomIdOrAlias) : null,
      })}
    </output>
  );
}

const ROUTES = (
  <Routes>
    <Route path={HOME_CREATE_PATH} element={<Shown />} />
    <Route path={HOME_ROOM_PATH} element={<Shown />} />
    <Route path={ACTIVITY_INVITES_PATH} element={<Shown />} />
    <Route path={ACTIVITY_ROOM_PATH} element={<Shown />} />
    <Route path={SPACE_PATH} element={<Shown />}>
      <Route path={SPACE_LOBBY_PATH} element={null} />
      <Route path={SPACE_ROOM_PATH} element={null} />
    </Route>
  </Routes>
);

const shown = () => JSON.parse(screen.getByRole('status').textContent ?? '{}');

const open = (path: string) => {
  cleanup();
  render(
    <MatrixClientProvider value={client}>
      <MemoryRouter initialEntries={[path]}>{ROUTES}</MemoryRouter>
    </MatrixClientProvider>
  );
  return shown();
};

// A `%` that is part of an ID stays: `%41` is no `A`, and a literal `%2F` is no `/`. An escaped
// `/` is one, and ordinary IDs read as they always did.
const PERCENT_ROOM = '!sales%41:example.org';
const SLASH_ALIAS = '#sales%2Feu:example.org';
const ROOMS = ['!room:example.org', '#lobby:example.org', PERCENT_ROOM, SLASH_ALIAS, '!sales/eu:x'];
const PERCENT_SPACE = '#team%41:example.org';
const SLASH_SPACE = '!team%2F:example.org';
const SPACES = ['!space:example.org', PERCENT_SPACE, SLASH_SPACE, '!a/b:x'];
const PERCENT_EVENT = '$ev%41';
const SLASH_EVENT = '$ev%2Fx';
const EVENTS = ['$event:example.org', PERCENT_EVENT, SLASH_EVENT, '$ev/x+y'];

describe('the room, space and event a route names', () => {
  it.each(ROOMS)('reads the room %s of a Home route as written', (room) => {
    expect(open(getHomeRoomPath(room))).toMatchObject({
      roomIdOrAlias: room,
      selectedRoom: room.startsWith('!') ? room : null,
    });
  });

  it.each(EVENTS)('reads the event %s as written', (event) => {
    expect(open(getHomeRoomPath(PERCENT_ROOM, event))).toMatchObject({
      roomIdOrAlias: PERCENT_ROOM,
      eventId: event,
    });
  });

  it.each(SPACES)('reads the space %s and its room as written', (space) => {
    expect(open(getSpaceRoomPath(space, SLASH_ALIAS, SLASH_EVENT))).toMatchObject({
      spaceIdOrAlias: space,
      roomIdOrAlias: SLASH_ALIAS,
      eventId: SLASH_EVENT,
      selectedSpace: space.startsWith('!') ? space : null,
    });
  });

  it('names no room on a fixed page of a section or a space', () => {
    expect(open('/home/create/')).toEqual({
      selectedRoom: null,
      selectedSpace: null,
      roomPath: null,
    });
    expect(open(getSpaceLobbyPath(SLASH_SPACE))).toEqual({
      spaceIdOrAlias: SLASH_SPACE,
      selectedRoom: null,
      selectedSpace: SLASH_SPACE,
      roomPath: null,
    });
  });

  it('keeps a segment that is not valid percent-encoding as it is', () => {
    expect(open('/home/!a%zz/')).toMatchObject({ roomIdOrAlias: '!a%zz' });
  });

  it.each(ROOMS.filter((room) => room.startsWith('!')))(
    'keeps the room %s in the section that shows it',
    (room) => {
      expect(open(getActivityRoomPath(room)).roomPath).toBe(getActivityRoomPath(room));
    }
  );

  it('reads the address after `#` with the hash router', () => {
    window.history.replaceState(
      null,
      '',
      `/#${getSpaceRoomPath(PERCENT_SPACE, PERCENT_ROOM, PERCENT_EVENT)}`
    );
    render(
      <MatrixClientProvider value={client}>
        <HashRouter>{ROUTES}</HashRouter>
      </MatrixClientProvider>
    );
    expect(shown()).toMatchObject({
      spaceIdOrAlias: PERCENT_SPACE,
      roomIdOrAlias: PERCENT_ROOM,
      eventId: PERCENT_EVENT,
      selectedRoom: PERCENT_ROOM,
    });
  });
});
