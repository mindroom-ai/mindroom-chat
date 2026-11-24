import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider, useAtomValue, useStore } from 'jotai';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '@fontsource-variable/inter';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { darkTheme, lightTheme } from '../../src/app/theme/colors.css';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { TriggerWakeMarker } from '../../src/app/messages/TriggerWakeMarker';
import {
  closeRoomTriggersDialog,
  openRoomTriggersDialog,
  roomTriggersDialogAtom,
} from '../../src/app/navigation/roomTriggersDialog';
import { RoomTriggersButton, RoomTriggersOverlay } from '../../src/app/triggers/RoomTriggersButton';
import type { RoomTrigger } from '../../src/app/triggers/roomTriggersApi';
import { installOverlayFocus } from '../../src/app/lib/overlayFocus';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
const startClosed = params.has('closed');
const showMissing = params.has('missing');
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;

const ROOM_ID = '!design-triggers:example.org';
const OPS_ROOM_ID = '!release-ops:example.org';
const client = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
const room = new Room(ROOM_ID, client, '@alice:example.org');
const opsRoom = new Room(OPS_ROOM_ID, client, '@alice:example.org');
opsRoom.name = 'Release Ops';
client.store.storeRoom(room);
client.store.storeRoom(opsRoom);
room.currentState.setStateEvents([
  new MatrixEvent({
    type: 'm.room.member',
    room_id: ROOM_ID,
    state_key: '@alice:example.org',
    content: { membership: 'join', displayname: 'Alice' },
  }),
  new MatrixEvent({
    type: 'm.room.member',
    room_id: ROOM_ID,
    state_key: '@bob:example.org',
    content: { membership: 'join', displayname: 'Bob' },
  }),
]);

const now = Date.now();
const INITIAL_TRIGGERS: RoomTrigger[] = [
  {
    triggerId: 'tr_design_watch',
    kind: 'room_message',
    relation: 'target',
    description: 'Design channel triage',
    prompt: 'Summarize new issues in the Design channel and flag blockers for @alice.',
    agent: 'assistant',
    targetRoomId: ROOM_ID,
    targetThreadId: '$design-triage',
    threadMode: 'thread',
    enabled: true,
    disabledReason: null,
    once: false,
    expiresAt: null,
    lastFiredAt: now - 12 * 60_000,
    ownerUserId: '@alice:example.org',
    canManage: true,
  },
  {
    triggerId: 'tr_release_hook',
    kind: 'webhook',
    relation: 'target',
    description: 'Release pipeline webhook',
    prompt: null,
    agent: 'deployer',
    targetRoomId: ROOM_ID,
    targetThreadId: null,
    threadMode: 'room',
    enabled: true,
    disabledReason: null,
    once: false,
    expiresAt: null,
    lastFiredAt: now - 3 * 3_600_000,
    ownerUserId: '@alice:example.org',
    canManage: true,
  },
  {
    triggerId: 'tr_staging_alerts',
    kind: 'external_event',
    relation: 'target',
    description: 'Staging error alerts',
    prompt: 'Investigate spikes in `staging-api` error rates and link recent deploys.',
    agent: 'oncall',
    targetRoomId: ROOM_ID,
    targetThreadId: null,
    threadMode: 'new_thread',
    enabled: true,
    disabledReason: null,
    once: false,
    expiresAt: null,
    lastFiredAt: now - 2 * 86_400_000,
    ownerUserId: '@bob:example.org',
    canManage: false,
  },
  {
    triggerId: 'tr_urgent_tag',
    kind: 'thread_tag',
    relation: 'watch',
    description: 'Urgent tag summary',
    prompt: 'Review threads tagged urgent and post a quick status summary.',
    agent: 'assistant',
    targetRoomId: OPS_ROOM_ID,
    targetThreadId: null,
    threadMode: 'origin',
    enabled: false,
    disabledReason: 'manual',
    once: false,
    expiresAt: null,
    lastFiredAt: null,
    ownerUserId: '@alice:example.org',
    canManage: true,
  },
];

function Fixture() {
  const store = useStore();
  const dialog = useAtomValue(roomTriggersDialogAtom);
  const open = dialog?.roomId === ROOM_ID;
  const [triggers, setTriggers] = useState<RoomTrigger[]>(INITIAL_TRIGGERS);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => installOverlayFocus(document), []);
  useEffect(() => {
    if (!startClosed) {
      openRoomTriggersDialog(store, ROOM_ID, {
        triggerId: showMissing ? 'tr_removed_demo' : 'tr_design_watch',
      });
    }
  }, [store]);

  return (
    <main
      style={{
        padding: 16,
        color: color.Surface.OnContainer,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <RoomTriggersButton
        total={triggers.length}
        open={open}
        onOpen={(opener) => openRoomTriggersDialog(store, ROOM_ID, { opener })}
      />
      <TriggerWakeMarker
        roomId={ROOM_ID}
        ts={now - 12 * 60_000}
        wake={{
          sourceKind: 'reactive',
          triggerId: 'tr_design_watch',
          kind: 'room_message',
          sourceType: 'matrix',
          prompt: 'Summarize new issues in the Design channel and flag blockers for @alice.',
          rawBody: 'Summarize new issues in the Design channel and flag blockers for @alice.',
        }}
      />
      {open && (
        <RoomTriggersOverlay
          roomId={ROOM_ID}
          triggers={triggers}
          highlightTriggerId={dialog?.triggerId}
          highlightRequest={dialog}
          onClose={() => closeRoomTriggersDialog(store, ROOM_ID)}
          onOpenThread={(threadId) => setStatusMessage(`Opened ${threadId}`)}
          onToggleTrigger={async (triggerId, enabled) => {
            setTriggers((prev) =>
              prev.map((row) =>
                row.triggerId === triggerId
                  ? { ...row, enabled, disabledReason: enabled ? null : 'manual' }
                  : row
              )
            );
            setStatusMessage(`${enabled ? 'Enabled' : 'Disabled'} ${triggerId}`);
          }}
          onDeleteTrigger={async (triggerId) => {
            setTriggers((prev) => prev.filter((row) => row.triggerId !== triggerId));
            setStatusMessage(`Deleted ${triggerId}`);
          }}
        />
      )}
      <p role="status">{statusMessage}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <JotaiProvider>
    <MatrixClientProvider value={client}>
      <MemoryRouter>
        <Fixture />
      </MemoryRouter>
    </MatrixClientProvider>
  </JotaiProvider>
);
