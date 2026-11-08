import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'jotai';
import { config, toRem } from 'folds';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { DarkTheme, LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/matrix/hooks/useSpecVersions';
import { CallTile, ScreenTile } from '../../src/app/calls/CallTile';
import { RingCard } from '../../src/app/calls/IncomingCalls';
import type { CallParticipant, CallVideoTrack } from '../../src/app/calls/RoomCall';
import * as panelCss from '../../src/app/calls/CallPanel.css';
import * as ringCss from '../../src/app/calls/IncomingCalls.css';

// A call between members whose names other members of the room show too, so the user ID follows
// each name: a copy of a person's name, a copy with a user ID longer than a tile's line, and a
// copy of a long name. Its tiles, shared screens and rings sit as wide as the call panel opens
// (400 px, or the screen's width on a phone). Query parameters: `view` (`tiles`, the default, or
// `rings`) and `theme` (`dark`).

const params = new URLSearchParams(window.location.search);
const dark = params.get('theme') === 'dark';
applyThemeToDom(dark ? DarkTheme : LightTheme);
// The page scrolls (the app's does not), so a full-page screenshot holds every tile.
for (const element of [document.documentElement, document.body, document.getElementById('root')!]) {
  element.style.height = 'auto';
  element.style.overflow = 'visible';
}

const ROOM_ID = '!deploy-desk:matrix.localhost';
const ME = '@robin:matrix.localhost';
const COPY = '@casey:matrix.localhost';
const LONG_ID_COPY = '@morgan.lee.design.operations:matrix.localhost';
const LONG_NAME_COPY = '@alexandra.copy:matrix.localhost';
const LONG_NAME = 'Alexandra Konstantinidou-Whitfield';

const client = createClient({ baseUrl: 'https://matrix.localhost', userId: ME });

const members: [userId: string, displayname: string][] = [
  [ME, 'Robin Reader'],
  ['@morgan:matrix.localhost', 'Morgan Lee'],
  [COPY, 'Morgan Lee'],
  [LONG_ID_COPY, 'Morgan Lee'],
  ['@alexandra:matrix.localhost', LONG_NAME],
  [LONG_NAME_COPY, LONG_NAME],
];

const room = new Room(ROOM_ID, client, ME);
room.currentState.setStateEvents([
  new MatrixEvent({
    room_id: ROOM_ID,
    type: 'm.room.name',
    state_key: '',
    sender: ME,
    event_id: '$name',
    content: { name: 'Deploy desk' },
  }),
  ...members.map(
    ([userId, displayname], index) =>
      new MatrixEvent({
        room_id: ROOM_ID,
        type: 'm.room.member',
        state_key: userId,
        sender: userId,
        event_id: `$member${index}`,
        origin_server_ts: index,
        content: { membership: 'join', displayname },
      })
  ),
]);
// The room's name comes from its state only once it is recalculated.
room.recalculate();

/** A shared screen; the tile only attaches it to its video. */
const screenTrack = {
  attach: () => undefined,
  detach: () => undefined,
} as unknown as CallVideoTrack;

const device = (
  userId: string,
  deviceId: string,
  extra: Partial<CallParticipant> = {}
): CallParticipant => ({
  key: `${userId}:${deviceId}`,
  userId,
  deviceId,
  local: false,
  connected: true,
  speaking: false,
  microphone: true,
  ...extra,
});

// Each copy on two devices: one in the call, one still connecting ("Waiting for ...").
const tiles = [
  device(ME, 'OWN', { local: true }),
  ...[COPY, LONG_ID_COPY, LONG_NAME_COPY].flatMap((userId, index) => [
    device(userId, 'IN', { microphone: index !== 1 }),
    device(userId, 'WAITING', { connected: false }),
  ]),
];

const screens = [COPY, LONG_ID_COPY, LONG_NAME_COPY].map((userId) =>
  device(userId, 'IN', { screen: screenTrack })
);

// The tiles in a plain grid, each at its own 4:3 and in the middle of the panel's body. The call
// stage (CallStage.tsx) sizes its tiles to the space it measures, which this scrolling page has
// none of.
const TILE_GRID: CSSProperties = {
  flex: '1 1 auto',
  alignContent: 'center',
  display: 'grid',
  // At least 160 px wide: two to a 400 px line, as in a call panel that wide.
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(160)}, 1fr))`,
  gap: config.space.S200,
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

function Tiles() {
  return (
    <div
      className={panelCss.Panel}
      style={{ width: 'min(400px, 100vw)', height: 'auto', minHeight: '100vh' }}
    >
      <div className={panelCss.Body}>
        <ul style={TILE_GRID}>
          {screens.map((participant) => (
            <ScreenTile key={participant.key} room={room} participant={participant} />
          ))}
          {tiles.map((participant) => (
            <CallTile key={participant.key} room={room} participant={participant} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Rings() {
  return (
    <div className={ringCss.Host}>
      {[COPY, LONG_ID_COPY, LONG_NAME_COPY].map((sender) => (
        <RingCard
          key={sender}
          room={room}
          ring={{
            roomId: ROOM_ID,
            eventId: `$ring-${sender}`,
            sender,
            video: false,
            expiresAt: Number.MAX_SAFE_INTEGER,
          }}
          onAnswer={() => undefined}
          onDecline={() => undefined}
          onIgnore={() => undefined}
          onOpen={() => undefined}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <MatrixClientProvider value={client}>
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        {params.get('view') === 'rings' ? <Rings /> : <Tiles />}
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
void document.fonts.ready.then(() => {
  document.body.dataset.fixtureReady = 'true';
});
