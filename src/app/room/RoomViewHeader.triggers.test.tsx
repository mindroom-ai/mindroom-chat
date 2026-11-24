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
import { RoomViewHeader } from './RoomViewHeader';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  navigateRoomThread: vi.fn(),
  screenSize: 'Desktop' as 'Desktop' | 'Mobile',
  server: { apiUrl: 'https://mindroom.example.org' as string | undefined, pending: false },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    ...actual,
    useTranslation: () => ({
      t: translateFromEn,
      i18n: { language: 'en', resolvedLanguage: 'en' },
    }),
  };
});
vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('folds', async (importOriginal) => {
  const folds = await importOriginal<typeof import('folds')>();
  return {
    ...folds,
    Overlay: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? children : null,
    OverlayCenter: ({ children }: { children: React.ReactNode }) => children,
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
    navigateRoomThread: mocks.navigateRoomThread,
    roomPath: () => '/home',
  }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => mocks.screenSize,
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

const rowJson = (overrides: Record<string, unknown> = {}) => ({
  trigger_id: 'tr_design',
  kind: 'room_message',
  relation: 'target',
  description: 'Design triage',
  prompt: 'Summarize new issues in the Design channel',
  agent: 'assistant',
  target_room_id: ROOM_ID,
  target_thread_id: '$thread1',
  thread_mode: 'thread',
  enabled: true,
  disabled_reason: null,
  once: false,
  expires_at: null,
  last_fired_at: Date.now() - 120_000,
  owner_user_id: '@alice:example.org',
  can_manage: true,
  ...overrides,
});

const renderRoomHeader = (withWakePill?: string) => {
  const emitter = new EventEmitter();
  const room = {
    roomId: ROOM_ID,
    name: 'Design',
    myUserId: '@alice:example.org',
    getMyMembership: () => 'join',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
    getMember: () => null,
  } as unknown as Room;
  const mx = Object.assign(emitter, {
    getSafeUserId: () => '@alice:example.org',
    getUserId: () => '@alice:example.org',
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
  }) as unknown as MatrixClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createStore();
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <MemoryRouter>
            <RoomProvider value={room}>
              <RoomViewHeader hasMindroomAgents />
              {withWakePill && (
                <TriggerWakeMarker
                  roomId={ROOM_ID}
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
};

afterEach(() => {
  cleanup();
  mocks.send.mockReset();
  mocks.navigateRoomThread.mockReset();
  mocks.screenSize = 'Desktop';
  mocks.server = { apiUrl: 'https://mindroom.example.org', pending: false };
});

describe('RoomViewHeader triggers integration', () => {
  it('hides the header entry when the API returns 404 or no triggers', async () => {
    mocks.send.mockResolvedValueOnce(new Response(null, { status: 404 }));
    renderRoomHeader();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Triggers/ })).toBeNull();
  });

  it('shows the header button on desktop, overflows to the room menu on mobile, and handles owner mutations', async () => {
    let rows = [
      rowJson(),
      rowJson({ trigger_id: 'tr_other', owner_user_id: '@bob:example.org', can_manage: false }),
    ];
    mocks.send.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { enabled: boolean };
        rows = rows.map((r) =>
          path.endsWith(String(r.trigger_id)) ? { ...r, enabled: body.enabled } : r
        );
        return new Response(JSON.stringify(rows[0]), { status: 200 });
      }
      if (init?.method === 'DELETE') {
        rows = rows.filter((r) => !path.endsWith(String(r.trigger_id)));
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ triggers: rows }), { status: 200 });
    });

    renderRoomHeader();
    const button = await screen.findByRole('button', { name: 'Triggers (2)' });
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Triggers' });
    expect(dialog.querySelectorAll('article')).toHaveLength(2);
    // Refetches when dialog opens.
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    // Owner toggles off -> PATCH with { enabled: false }.
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy());
    expect(mocks.send).toHaveBeenCalledWith(
      '/api/rooms/!design%3Aexample.org/triggers/tr_design',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) })
    );

    // Owner deletes with confirm -> DELETE.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete trigger' }));
    await waitFor(() => expect(dialog.querySelectorAll('article')).toHaveLength(1));
    expect(mocks.send).toHaveBeenCalledWith(
      '/api/rooms/!design%3Aexample.org/triggers/tr_design',
      expect.objectContaining({ method: 'DELETE' })
    );

    // On mobile, Triggers overflows into the room menu instead of the base row.
    cleanup();
    mocks.screenSize = 'Mobile';
    renderRoomHeader();
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Triggers (1)' })).toBeNull();
    const moreButton = screen.getByRole('button', { name: 'More Options' });
    const rect = new DOMRect(0, 0, 40, 40);
    moreButton.getClientRects = () => [rect] as unknown as DOMRectList;
    moreButton.getBoundingClientRect = () => rect;
    fireEvent.click(moreButton);
    expect(await screen.findByRole('button', { name: 'Triggers (1)' })).toBeTruthy();
  });

  it('opens the dialog highlighted on the wake pill trigger, or reports it gone if deleted', async () => {
    mocks.send.mockImplementation(
      async () => new Response(JSON.stringify({ triggers: [rowJson()] }), { status: 200 })
    );
    renderRoomHeader('tr_design');
    await screen.findByRole('button', { name: 'Triggers (1)' });

    fireEvent.click(screen.getByRole('button', { name: 'View trigger tr_design' }));
    const dialog = await screen.findByRole('dialog', { name: 'Triggers' });
    expect(
      dialog.querySelector('[data-trigger-id="tr_design"]')?.getAttribute('data-highlighted')
    ).toBe('true');

    // When the wake pill points to a trigger no longer in the room (even if 0 triggers remain).
    cleanup();
    mocks.send.mockImplementation(
      async () => new Response(JSON.stringify({ triggers: [] }), { status: 200 })
    );
    renderRoomHeader('tr_deleted');
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Triggers/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View trigger tr_deleted' }));
    const goneDialog = await screen.findByRole('dialog', { name: 'Triggers' });
    await waitFor(() =>
      expect(goneDialog.querySelector('[data-trigger-missing]')?.textContent).toContain(
        'tr_deleted'
      )
    );
  });
});
