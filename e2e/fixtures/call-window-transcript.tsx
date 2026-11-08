import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { ClientConfigProvider } from '../../src/app/config/useClientConfig';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/matrix/hooks/useSpecVersions';
import { PowerLevelsContextProvider } from '../../src/app/matrix/hooks/usePowerLevels';
import { CallPanel } from '../../src/app/calls/CallPanel';
import { activeCallAtom } from '../../src/app/calls/callStore';
import type { CallParticipant, CallState, RoomCall } from '../../src/app/calls/RoomCall';
import type { TranscriptLine } from '../../src/app/calls/transcription/api';
import {
  callTranscriptionAtom,
  liveTranscriptAtom,
} from '../../src/app/calls/transcription/transcriptionState';
import { FloatingCallWindow } from '../../src/app/calls/window/FloatingCallWindow';
import { callWindowStorageKey } from '../../src/app/calls/window/callWindowState';

// The call this device is in, joined in the floating call window with the live transcript shown
// inside it: the window, the call view and the transcript are the app's own, as the call window
// host renders them. No call service and no MindRoom: the call is a stand-in that only reports a
// connected state, and the transcript holds 40 made-up lines, as this device's transcriber would
// have read them, more than any layout shows at once. Query parameters: `width` and `height`, the
// window's size in px (400 by 480 by default, the size it first opens at).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(LightTheme);

const ROOM_ID = '!standup-call:matrix.localhost';
const ME = '@robin:matrix.localhost';
const MEMBER = '@avery:matrix.localhost';
const NAMES: Record<string, string> = { [ME]: 'Robin Reader', [MEMBER]: 'Avery Quinn' };

const client = createClient({ baseUrl: 'https://matrix.localhost', userId: ME });

const room = new Room(ROOM_ID, client, ME);
room.currentState.setStateEvents([
  new MatrixEvent({
    room_id: ROOM_ID,
    type: 'm.room.name',
    state_key: '',
    sender: ME,
    event_id: '$name',
    content: { name: 'Standup' },
  }),
  ...Object.entries(NAMES).map(
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

// Everyone may join the room's call: the panel shows no notice about who may.
const POWER_LEVELS = {
  users_default: 0,
  events_default: 0,
  state_default: 0,
  users: { [ME]: 100 },
};

// Each line names its number, so a spec can tell which ones show; every third one, the last among
// them, runs over several lines of text: more than the subtitle's two in a window up to 560 px
// wide, exactly two in a 900 px wide one.
const LINE_COUNT = 40;
const LONG_TEXT =
  'the release notes still need the migration steps, the screenshots and the list of fixed ' +
  'issues, and someone has to check the changelog against the merged pull requests before the ' +
  'release goes out on Friday.';
const lines: TranscriptLine[] = Array.from({ length: LINE_COUNT }, (_, index) => ({
  id: `line-${index + 1}`,
  callId: 'call-1',
  userId: index % 2 === 0 ? ME : MEMBER,
  saidAt: new Date(Date.UTC(2026, 10, 8, 9, 30, index)).toISOString(),
  seconds: 2,
  kind: 'speech',
  text: `Line ${index + 1}: ${index % 3 === 0 ? LONG_TEXT : 'noted.'}`,
}));

const store = createStore();
store.set(activeCallAtom, { call, kind: 'room' });
store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'transcribing' });
store.set(liveTranscriptAtom, {
  roomId: ROOM_ID,
  call: {
    id: 'call-1',
    roomId: ROOM_ID,
    rowEventId: '$row',
    startedAt: '2026-11-08T09:29:00Z',
    endedAt: null,
    members: [ME, MEMBER],
    pausedBy: null,
  },
  lines,
  names: {},
});

// The account's window, floating at the size asked for with the transcript switched on, as the
// window stores it.
localStorage.setItem(
  callWindowStorageKey(ME),
  JSON.stringify({
    mode: 'floating',
    rect: {
      x: 24,
      y: 24,
      width: Number(params.get('width') ?? 400),
      height: Number(params.get('height') ?? 480),
    },
    placedIn: { width: window.innerWidth, height: window.innerHeight },
    transcript: true,
  })
);

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ClientConfigProvider value={{}}>
      <MatrixClientProvider value={client}>
        <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
          <MemoryRouter>
            <PowerLevelsContextProvider value={POWER_LEVELS}>
              <FloatingCallWindow>
                <CallPanel room={room} onClose={() => undefined} />
              </FloatingCallWindow>
            </PowerLevelsContextProvider>
          </MemoryRouter>
        </SpecVersionsProvider>
      </MatrixClientProvider>
    </ClientConfigProvider>
  </Provider>
);
void document.fonts.ready.then(() => {
  document.body.dataset.fixtureReady = 'true';
});
