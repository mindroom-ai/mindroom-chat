import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { Box } from 'folds';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/matrix/hooks/useSpecVersions';
import { Sidebar, SidebarStack } from '../../src/app/ui/sidebar/SidebarItem';
import { ActiveCallTab } from '../../src/app/calls/ActiveCallTab';
import { CallPanel } from '../../src/app/calls/CallPanel';
import { activeCallAtom, type ActiveCall } from '../../src/app/calls/callStore';
import type { CallParticipant, CallState, RoomCall } from '../../src/app/calls/RoomCall';

// The call this device is in, in a room whose name holds direction controls: the rail's call tab
// (its label and tooltip) and the call panel (its heading, its name and its controls' name), as
// a call shows them once connected. No call service: the call is a stand-in that only reports a
// connected state. Query parameter: `lang` (default en).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(LightTheme);

const ROOM_ID = '!payroll-call:matrix.localhost';
const ME = '@robin:matrix.localhost';
const MEMBER = '@avery:matrix.localhost';

const client = createClient({ baseUrl: 'https://matrix.localhost', userId: ME });

const room = new Room(ROOM_ID, client, ME);
room.currentState.setStateEvents([
  new MatrixEvent({
    room_id: ROOM_ID,
    type: 'm.room.name',
    state_key: '',
    sender: ME,
    event_id: '$name',
    content: { name: 'Payroll ‮sevihcra‬' },
  }),
  ...[
    [ME, 'Robin Reader'],
    [MEMBER, 'Avery Quinn'],
  ].map(
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
client.store.storeRoom(room);

const participant = (userId: string, local: boolean): CallParticipant => ({
  key: `${userId}:DEVICE`,
  userId,
  deviceId: 'DEVICE',
  local,
  connected: true,
  speaking: false,
  microphone: true,
});

const state: CallState = {
  phase: 'connected',
  microphone: true,
  camera: false,
  screenShare: false,
  sound: true,
  audioBlocked: false,
  devices: {},
  participants: [participant(ME, true), participant(MEMBER, false)],
};

const ignore = async () => undefined;
const call = {
  room,
  subscribe: () => () => undefined,
  getState: () => state,
  setMicrophone: ignore,
  setCamera: ignore,
  setScreenShare: ignore,
  setSound: () => undefined,
  setDevice: ignore,
  resumeAudio: ignore,
} as unknown as RoomCall;

const active: ActiveCall = { call, kind: 'room' };
const store = createStore();
store.set(activeCallAtom, active);

function Fixture() {
  return (
    <Provider store={store}>
      <MatrixClientProvider value={client}>
        <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
          <MemoryRouter>
            <Box style={{ height: '100vh' }}>
              <Sidebar data-fixture-rail="">
                <SidebarStack>
                  <ActiveCallTab active={active} />
                </SidebarStack>
              </Sidebar>
              <Box grow="Yes" style={{ minWidth: 0 }}>
                <CallPanel room={room} onClose={() => undefined} />
              </Box>
            </Box>
          </MemoryRouter>
        </SpecVersionsProvider>
      </MatrixClientProvider>
    </Provider>
  );
}

void i18n.changeLanguage(params.get('lang') ?? 'en').then(async () => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
