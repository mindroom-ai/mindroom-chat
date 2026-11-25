// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { RoomProvider } from '../matrix/hooks/useRoom';
import { TriggerWakeMarker } from '../messages/TriggerWakeMarker';
import { roomTriggersDialogAtom } from '../navigation/roomTriggersDialog';
import { triggerRowJson } from '../triggers/useRoomTriggers.test.shared';
import { RoomViewHeader } from './RoomViewHeader';

type SendFn = (path: string, init?: RequestInit) => Promise<Response>;
const mocks = vi.hoisted(
  (): {
    send: ReturnType<typeof vi.fn<SendFn>>;
    server: { apiUrl: string | undefined; pending: boolean };
  } => ({
    send: vi.fn<SendFn>(),
    server: { apiUrl: 'https://mindroom.example.org', pending: false },
  })
);

vi.mock('folds', async (importOriginal) => {
  const folds = await importOriginal<typeof import('folds')>();
  return {
    ...folds,
    Overlay: ({
      open,
      backdrop,
      children,
    }: {
      open: boolean;
      backdrop?: React.ReactNode;
      children: React.ReactNode;
    }) =>
      open ? (
        <>
          {backdrop}
          {children}
        </>
      ) : null,
    OverlayCenter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? content : null,
  };
});
vi.mock('../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => mocks.server,
}));
vi.mock('../computer/clientSessions', () => ({
  clientSessions: () => ({ send: mocks.send }),
}));
vi.mock('../notifications/MarkRoomReadMenuItem', () => ({ MarkRoomReadMenuItem: () => null }));
vi.mock('../rooms/archive/ArchiveRoomMenuItem', () => ({ ArchiveRoomMenuItem: () => null }));
vi.mock('../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../avatars/RoomAvatar', () => ({ RoomAvatar: () => null, RoomIcon: () => null }));
vi.mock('../matrix/hooks/useSpace', () => ({ useSpaceOptionally: () => undefined }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'Design',
  useRoomTopic: () => undefined,
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../matrix/hooks/useStateEvents', () => ({ useStateEvents: () => [] }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false, stateEvent: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigatePath: vi.fn(),
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
    navigateRoomThread: vi.fn(),
    roomPath: () => '/home',
  }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => 'Desktop',
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: 'threaded',
    setViewMode: vi.fn(),
    availableViewModes: ['threaded'],
  }),
}));
vi.mock('../schedules/RoomSchedulesButton', () => ({
  RoomSchedulesButton: () => <button type="button">Scheduled tasks</button>,
  RoomSchedulesMenuEntry: () => null,
  RoomSchedulesOverlay: () => null,
  usePendingRoomSchedules: () => [],
}));

const ROOM_ID = '!design:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const box = new DOMRect(0, 0, 120, 40);

const rowJson = (overrides: Record<string, unknown> = {}) =>
  triggerRowJson({
    trigger_id: 'tr_design',
    target_room_id: ROOM_ID,
    last_fired_at: Date.now() - 120_000,
    ...overrides,
  });

const makeRoom = (roomId: string) =>
  ({
    roomId,
    name: roomId,
    myUserId: '@alice:example.org',
    getMyMembership: () => 'join',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
    getMember: () => null,
    loadMembersIfNeeded: async () => true,
  }) as unknown as Room;

const renderRoomHeader = (withWakePill?: string) => {
  const emitter = new EventEmitter();
  const roomA = makeRoom(ROOM_ID);
  const roomB = makeRoom(OTHER_ROOM_ID);
  const mx = Object.assign(emitter, {
    getSafeUserId: () => '@alice:example.org',
    getUserId: () => '@alice:example.org',
    getRoom: (id: string) => (id === ROOM_ID ? roomA : id === OTHER_ROOM_ID ? roomB : null),
  }) as unknown as MatrixClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createStore();
  // Real FocusTrap checks tabbable geometry via getClientRects/getBoundingClientRect.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    box,
  ] as unknown as DOMRectList);
  const tree = (activeRoom: Room) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <MemoryRouter>
            <RoomProvider value={activeRoom}>
              <RoomViewHeader hasMindroomAgents />
              {withWakePill && (
                <TriggerWakeMarker
                  roomId={activeRoom.roomId}
                  wake={{
                    sourceKind: 'reactive',
                    triggerId: withWakePill,
                    kind: 'room_message',
                    prompt: 'Summarize new issues',
                    rawBody: 'Summarize new issues',
                  }}
                />
              )}
            </RoomProvider>
          </MemoryRouter>
        </MatrixClientProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
  const view = render(tree(roomA));
  return {
    ...view,
    queryClient,
    store,
    switchRoom: (toOther: boolean) => view.rerender(tree(toOther ? roomB : roomA)),
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.send.mockReset();
  mocks.server = { apiUrl: 'https://mindroom.example.org', pending: false };
});

describe('RoomViewHeader triggers integration', () => {
  it('hides the header entry when the room has 0 triggers', async () => {
    mocks.send.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [] }), { status: 200 })
    );
    const { queryClient } = renderRoomHeader();
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryCache().getAll()[0]?.state.status).toBe('success');
      expect(queryClient.isFetching()).toBe(0);
    });
    expect(screen.queryByRole('button', { name: /Triggers/ })).toBeNull();
  });

  it('shows the header button when >0, refetches on open, closes via real FocusTrap, and clears atom on room change', async () => {
    mocks.send.mockImplementation(
      async () => new Response(JSON.stringify({ triggers: [rowJson()] }), { status: 200 })
    );
    const { store, switchRoom } = renderRoomHeader();
    const button = await screen.findByRole('button', { name: 'Triggers (1)' });
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Triggers' });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    // Escape dismisses through real FocusTrap.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Triggers' })).toBeNull());

    // Backdrop click also dismisses through real FocusTrap.
    fireEvent.click(button);
    const reopened = await screen.findByRole('dialog', { name: 'Triggers' });
    const backdrop = reopened.parentElement?.previousElementSibling;
    expect(backdrop).toBeInstanceOf(HTMLElement);
    fireEvent.mouseDown(backdrop!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Triggers' })).toBeNull());

    // Switching rooms while open clears the dialog atom so returning does not reopen it.
    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'Triggers' });
    expect(store.get(roomTriggersDialogAtom)?.roomId).toBe(ROOM_ID);
    switchRoom(true);
    expect(store.get(roomTriggersDialogAtom)).toBeUndefined();
    switchRoom(false);
    expect(screen.queryByRole('dialog', { name: 'Triggers' })).toBeNull();
  });

  it('opens the dialog highlighted on the wake pill row, refetches on open, and closes on Escape', async () => {
    mocks.send.mockImplementation(
      async () => new Response(JSON.stringify({ triggers: [rowJson()] }), { status: 200 })
    );
    renderRoomHeader('tr_design');
    await screen.findByRole('button', { name: 'Triggers (1)' });

    fireEvent.click(screen.getByRole('button', { name: /Triggered/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View trigger tr_design' }));

    const dialog = await screen.findByRole('dialog', { name: 'Triggers' });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(
      dialog.querySelector('[data-trigger-id="tr_design"]')?.getAttribute('data-highlighted')
    ).toBe('true');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Triggers' })).toBeNull());
  });

  it('shows load error and focuses Close after PATCH 200 followed by GET failure', async () => {
    const offRow = rowJson({ enabled: false, disabled_reason: 'manual' });
    mocks.send
      .mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [offRow] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [offRow] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error('refresh down'));
    renderRoomHeader();
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Triggers' });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const enableBtn = screen.getByRole('button', { name: 'Enable' });
    enableBtn.focus();
    fireEvent.click(enableBtn);
    await waitFor(() =>
      expect(dialog.querySelector('[data-triggers-error]')?.textContent).toBe(
        "Couldn't load triggers."
      )
    );
    expect(dialog.querySelector('[data-trigger-id]')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});
