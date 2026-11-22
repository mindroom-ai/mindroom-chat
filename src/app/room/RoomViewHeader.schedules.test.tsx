// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { MsgType, RelationType } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node as SlateNode } from 'slate';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../composer/roomInputDrafts';
import { createParagraphElement } from '../editor/utils';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

type CapturedOverlayProps = {
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => void;
};

const { perms, sendMessage, navigateRoomThread, setViewMode, overlayCapture } = vi.hoisted(() => ({
  perms: { canSend: true },
  sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
  navigateRoomThread: vi.fn(),
  setViewMode: vi.fn(),
  overlayCapture: {
    openTrigger: undefined as (() => void) | undefined,
    props: undefined as CapturedOverlayProps | undefined,
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
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
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../ui/page/Page', async () => {
  const { forwardRef } = await import('react');
  return {
    PageHeader: forwardRef<HTMLElement, React.PropsWithChildren>(({ children }, ref) => (
      <header ref={ref}>{children}</header>
    )),
  };
});
vi.mock('../avatars/RoomAvatar', () => ({ RoomAvatar: () => null, RoomIcon: () => null }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:example.org',
    getRoom: () => null,
    sendMessage,
  }),
}));
vi.mock('../matrix/session/useSessionStore', async (original) => ({
  ...(await original<typeof import('../matrix/session/useSessionStore')>()),
  useActiveSession: () => ({ sessionId: 'me-session' }),
}));
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    name: 'General',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
  }),
  useIsDirectRoom: () => false,
}));
vi.mock('../matrix/hooks/useSpace', () => ({ useSpaceOptionally: () => undefined }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => false,
    event: (type: string) => (type === 'm.room.message' ? perms.canSend : false),
    stateEvent: () => false,
  }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../messages/pins/RoomPinMenu', () => ({ RoomPinMenu: () => null }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../schedules/RoomSchedulesButton', () => ({
  RoomSchedulesButton: ({ onOpen }: { onOpen: () => void }) => {
    overlayCapture.openTrigger = onOpen;
    return null;
  },
  RoomSchedulesMenuEntry: () => null,
  RoomSchedulesOverlay: (props: CapturedOverlayProps) => {
    overlayCapture.props = props;
    return null;
  },
  usePendingRoomSchedules: () => [],
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => 'Desktop',
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: 'compact',
    setViewMode,
    availableViewModes: ['compact', 'threaded', 'classic'],
  }),
}));

const task = (overrides: Partial<ParsedScheduledTask> = {}): ParsedScheduledTask => ({
  taskId: 'sched-1',
  status: 'pending',
  threadId: null,
  newThread: false,
  executeAt: null,
  scheduleType: 'once',
  ...overrides,
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  perms.canSend = true;
  sendMessage.mockClear();
  navigateRoomThread.mockClear();
  setViewMode.mockClear();
  overlayCapture.openTrigger = undefined;
  overlayCapture.props = undefined;
});

const renderAndOpenSchedules = (props: RoomViewHeaderProps = {}) => {
  const store = createStore();
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomViewHeader hasMindroomAgents {...props} />
      </Provider>
    );
  });
  act(() => {
    overlayCapture.openTrigger?.();
  });
  return store;
};

describe('RoomViewHeader schedule actions', () => {
  it('omits cancel and edit callbacks when the user cannot send messages', () => {
    perms.canSend = false;
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();
  });

  it('sends !cancel_schedule to the task thread or open thread when cancelling', async () => {
    renderAndOpenSchedules({ openThreadId: '$open-thread' });
    await overlayCapture.props!.onCancelTask!(task({ taskId: 'abc', threadId: '$task-thread' }));
    expect(sendMessage).toHaveBeenLastCalledWith('!room:example.org', {
      msgtype: MsgType.Text,
      body: '!cancel_schedule abc',
      'm.relates_to': {
        rel_type: RelationType.Thread,
        event_id: '$task-thread',
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$task-thread' },
      },
    });

    await overlayCapture.props!.onCancelTask!(
      task({ taskId: 'def', threadId: '$ignored', newThread: true })
    );
    expect(sendMessage).toHaveBeenLastCalledWith('!room:example.org', {
      msgtype: MsgType.Text,
      body: '!cancel_schedule def',
      'm.relates_to': {
        rel_type: RelationType.Thread,
        event_id: '$open-thread',
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$open-thread' },
      },
    });
  });

  it('populates the target composer draft, avoids duplicating the prefix, and reveals the composer', () => {
    const store = renderAndOpenSchedules();

    const targetTask = task({ taskId: 'edit-1', threadId: null });
    act(() => {
      overlayCapture.props!.onEditTask!(targetTask);
    });
    const roomDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', undefined)
    );
    expect(store.get(roomDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-1 ',
    ]);
    expect(setViewMode).toHaveBeenCalledWith('threaded');

    // Prepend before existing text in a thread and navigate to that thread.
    const threadDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', '$thread-9')
    );
    store.set(threadDraftAtom, [createParagraphElement('existing note')]);
    act(() => {
      overlayCapture.openTrigger?.();
    });
    act(() => {
      overlayCapture.props!.onEditTask!(task({ taskId: 'edit-2', threadId: '$thread-9' }));
    });
    expect(store.get(threadDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-2 ',
      'existing note',
    ]);
    expect(navigateRoomThread).toHaveBeenCalledWith('!room:example.org', '$thread-9');

    // Calling edit again on the same task does not duplicate the prefix.
    act(() => {
      overlayCapture.openTrigger?.();
    });
    act(() => {
      overlayCapture.props!.onEditTask!(task({ taskId: 'edit-2', threadId: '$thread-9' }));
    });
    expect(store.get(threadDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-2 ',
      'existing note',
    ]);
  });
});
