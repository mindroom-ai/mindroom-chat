// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { MsgType, RelationType } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node as SlateNode } from 'slate';
import {
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { liveVoiceRecordingAtom } from '../composer/voice/liveVoiceRecording';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { createParagraphElement } from '../editor/utils';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { StateEvent } from '../matrix/types/room';
import type { EditScheduledTaskResult } from '../schedules/RoomSchedulesDialog';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

type CapturedOverlayProps = {
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
};

const {
  perms,
  tombstoneState,
  sendMessage,
  makeTxnId,
  getEventForTxnId,
  discardFailedLocalEcho,
  navigateRoomThread,
  setViewMode,
  overlayCapture,
} = vi.hoisted(() => ({
  perms: { canSend: true },
  tombstoneState: { event: undefined as { getType: () => StateEvent } | undefined },
  sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
  makeTxnId: vi.fn(() => 'txn-1'),
  getEventForTxnId: vi.fn((_txnId: string) => undefined as unknown),
  discardFailedLocalEcho: vi.fn(),
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
    makeTxnId,
    sendMessage,
  }),
}));
vi.mock('../matrix/protocol/pendingLocalEcho', () => ({
  discardFailedLocalEcho,
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
    getEventForTxnId,
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
vi.mock('../matrix/hooks/useStateEvent', () => ({
  useStateEvent: (_room: unknown, type: StateEvent) =>
    type === StateEvent.RoomTombstone ? tombstoneState.event : undefined,
}));
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
  tombstoneState.event = undefined;
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ event_id: '$sent' });
  makeTxnId.mockClear();
  getEventForTxnId.mockReset();
  discardFailedLocalEcho.mockClear();
  navigateRoomThread.mockClear();
  setViewMode.mockClear();
  overlayCapture.openTrigger = undefined;
  overlayCapture.props = undefined;
  vi.restoreAllMocks();
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
  it('omits cancel/edit when unpermitted or tombstoned, and hides edit when canEditSchedule is false', () => {
    perms.canSend = false;
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    perms.canSend = true;
    tombstoneState.event = { getType: () => StateEvent.RoomTombstone };
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    tombstoneState.event = undefined;
    renderAndOpenSchedules({ canEditSchedule: false });
    expect(overlayCapture.props?.onCancelTask).toBeDefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();
  });

  it('sends !cancel_schedule to task destination with txnId, discards failed local echo, and blocks unsafe IDs', async () => {
    renderAndOpenSchedules({ openThreadId: '~local-unconfirmed' });

    await overlayCapture.props!.onCancelTask!(task({ taskId: 'abc', threadId: '$task-thread' }));
    expect(sendMessage).toHaveBeenLastCalledWith(
      '!room:example.org',
      '$task-thread',
      {
        msgtype: MsgType.Text,
        body: '!cancel_schedule abc',
        'm.relates_to': {
          rel_type: RelationType.Thread,
          event_id: '$task-thread',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$task-thread' },
        },
      },
      'txn-1'
    );

    await overlayCapture.props!.onCancelTask!(task({ taskId: 'room-1', threadId: null }));
    expect(sendMessage).toHaveBeenLastCalledWith(
      '!room:example.org',
      null,
      {
        msgtype: MsgType.Text,
        body: '!cancel_schedule room-1',
      },
      'txn-1'
    );

    // Failed cancel send discards its failed local echo event and rethrows.
    const failedEvent = { getId: () => '~local-failed' };
    getEventForTxnId.mockReturnValueOnce(failedEvent);
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
    await expect(
      overlayCapture.props!.onCancelTask!(task({ taskId: 'room-2', threadId: null }))
    ).rejects.toThrow('send failed');
    expect(getEventForTxnId).toHaveBeenCalledWith('txn-1');
    expect(discardFailedLocalEcho).toHaveBeenCalledWith(expect.anything(), failedEvent);

    sendMessage.mockClear();
    await overlayCapture.props!.onCancelTask!(task({ taskId: 'all' }));
    await overlayCapture.props!.onCancelTask!(task({ taskId: 'bad id' }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('targets the visible composer without toggling Compact, resumes edits, and blocks busy or live voice recording', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const onFocusComposer = vi.fn();
    const store = renderAndOpenSchedules({ onFocusComposer });

    const roomDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', undefined)
    );

    // Live voice recording blocks editing without modifying drafts.
    store.set(liveVoiceRecordingAtom, {} as VoiceCaptureSession);
    let result: EditScheduledTaskResult = undefined;
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-voice', threadId: null }));
    });
    expect(result).toBe('draft-busy');
    expect(store.get(roomDraftAtom)).toEqual([]);
    store.set(liveVoiceRecordingAtom, undefined);

    // Editing a thread-bound task from room view targets room composer, never navigates or toggles Compact.
    act(() => {
      result = overlayCapture.props!.onEditTask!(
        task({ taskId: 'edit-1', threadId: '$other-thread' })
      );
    });
    expect(result).toBe('prefilled');
    expect(store.get(roomDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-1 ',
    ]);
    expect(navigateRoomThread).not.toHaveBeenCalled();
    expect(setViewMode).not.toHaveBeenCalled();
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(onFocusComposer).toHaveBeenLastCalledWith(undefined);

    // Resuming an in-progress edit of the SAME task preserves typed text and focuses composer.
    store.set(roomDraftAtom, [createParagraphElement('!edit_schedule edit-1 tomorrow at 9am')]);
    act(() => {
      overlayCapture.openTrigger?.();
    });
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1', threadId: null }));
    });
    expect(result).toBe('prefilled');
    expect(store.get(roomDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-1 tomorrow at 9am',
    ]);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(onFocusComposer).toHaveBeenLastCalledWith(undefined);

    // Staged attachment and reply target still reject even with matching prefix.
    const file = new File(['x'], 'report.txt');
    store.set(composerUploadItemsAtom('!room:example.org', undefined), {
      type: 'PUT',
      item: [
        { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } },
      ],
    });
    act(() => {
      overlayCapture.openTrigger?.();
    });
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1', threadId: null }));
    });
    expect(result).toBe('draft-busy');
    store.set(composerUploadItemsAtom('!room:example.org', undefined), { type: 'RESET' });

    store.set(composerReplyDraftAtom('!room:example.org', undefined), {
      userId: '@bob:example.org',
      eventId: '$evt',
      body: 'Earlier',
    });
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1', threadId: null }));
    });
    expect(result).toBe('draft-busy');
    store.set(composerReplyDraftAtom('!room:example.org', undefined), undefined);

    // Inside an open thread, edit targets that open thread composer.
    const threadDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', '$open-thread')
    );
    act(() => {
      renderer?.update(
        <Provider store={store}>
          <RoomViewHeader
            hasMindroomAgents
            openThreadId="$open-thread"
            onFocusComposer={onFocusComposer}
          />
        </Provider>
      );
    });
    act(() => {
      overlayCapture.openTrigger?.();
    });
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-thread', threadId: null }));
    });
    expect(result).toBe('prefilled');
    expect(store.get(threadDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-thread ',
    ]);
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    expect(onFocusComposer).toHaveBeenLastCalledWith('$open-thread');
  });
});
