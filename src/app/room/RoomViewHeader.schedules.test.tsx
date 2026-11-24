// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { MsgType, RelationType, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node as SlateNode } from 'slate';
import {
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { liveCaptureAtom } from '../composer/capture/liveCapture';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { createParagraphElement } from '../editor/utils';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { StateEvent } from '../matrix/types/room';
import type { EditScheduledTaskResult } from '../schedules/RoomSchedulesDialog';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

type CapturedOverlayProps = {
  onClose: (dismissed?: boolean) => void;
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
};

const {
  perms,
  roomState,
  sendMessage,
  makeTxnId,
  getEventForTxnId,
  discardFailedLocalEcho,
  navigateRoomThread,
  overlayCapture,
} = vi.hoisted(() => ({
  perms: { canSend: true },
  roomState: { tombstone: undefined as { getType: () => StateEvent } | undefined },
  sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
  makeTxnId: vi.fn(() => 'txn-1'),
  getEventForTxnId: vi.fn((_txnId: string) => undefined as unknown),
  discardFailedLocalEcho: vi.fn(),
  navigateRoomThread: vi.fn(),
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
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
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
vi.mock('../matrix/protocol/pendingLocalEcho', () => ({ discardFailedLocalEcho }));
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
  useStateEvent: (_room: unknown, type: string) =>
    type === `${StateEvent.RoomTombstone}` ? roomState.tombstone : undefined,
}));
vi.mock('../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/hooks/usePowerLevels')>()),
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
  invalidateRoomMindroomAgent: () => undefined,
  useRoomHasMindroomAgent: () => false,
  useRoomViewMode: () => ({
    viewMode: 'compact',
    setViewMode: vi.fn(),
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
  roomState.tombstone = undefined;
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ event_id: '$sent' });
  makeTxnId.mockClear();
  getEventForTxnId.mockReset();
  discardFailedLocalEcho.mockClear();
  navigateRoomThread.mockClear();
  overlayCapture.openTrigger = undefined;
  overlayCapture.props = undefined;
});

const renderAndOpen = (props: RoomViewHeaderProps = {}) => {
  const store = createStore();
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomViewHeader hasMindroomAgents {...props} />
      </Provider>
    );
  });
  act(() => overlayCapture.openTrigger?.());
  return store;
};

describe('RoomViewHeader schedule actions', () => {
  it('gates cancel and edit on hasMindroomAgents, send permission, tombstone, and canEditSchedule', () => {
    renderAndOpen();
    expect(overlayCapture.props?.onCancelTask).toBeDefined();
    expect(overlayCapture.props?.onEditTask).toBeDefined();

    const resetCapture = () => {
      overlayCapture.openTrigger = undefined;
      overlayCapture.props = undefined;
    };
    resetCapture();
    renderAndOpen({ hasMindroomAgents: false });
    expect(overlayCapture.openTrigger).toBeUndefined();
    expect(overlayCapture.props).toBeUndefined();

    perms.canSend = false;
    renderAndOpen();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    perms.canSend = true;
    roomState.tombstone = { getType: () => StateEvent.RoomTombstone };
    renderAndOpen();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    roomState.tombstone = undefined;
    renderAndOpen({ canEditSchedule: false });
    expect(overlayCapture.props?.onCancelTask).toBeDefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();
  });

  it('sends !cancel_schedule to thread or room with txnId, discards failed echo, and blocks unsafe IDs or unconfirmed threads', async () => {
    renderAndOpen();

    await overlayCapture.props!.onCancelTask!(task({ taskId: 'abc', threadId: '$t1' }));
    expect(sendMessage).toHaveBeenLastCalledWith(
      '!room:example.org',
      '$t1',
      {
        msgtype: MsgType.Text,
        body: '!cancel_schedule abc',
        'm.relates_to': {
          rel_type: RelationType.Thread,
          event_id: '$t1',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$t1' },
        },
      },
      'txn-1'
    );

    await overlayCapture.props!.onCancelTask!(task({ taskId: 'room-1', threadId: null }));
    expect(sendMessage).toHaveBeenLastCalledWith(
      '!room:example.org',
      null,
      { msgtype: MsgType.Text, body: '!cancel_schedule room-1' },
      'txn-1'
    );

    const failedEvent = { getId: () => '~local-failed' };
    getEventForTxnId.mockReturnValueOnce(failedEvent);
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
    await expect(overlayCapture.props!.onCancelTask!(task({ taskId: 'room-2' }))).rejects.toThrow(
      'send failed'
    );
    expect(discardFailedLocalEcho).toHaveBeenCalledWith(expect.anything(), failedEvent);

    sendMessage.mockClear();
    await expect(overlayCapture.props!.onCancelTask!(task({ taskId: 'all' }))).rejects.toThrow(
      'Unsupported task ID'
    );
    await expect(
      overlayCapture.props!.onCancelTask!(task({ taskId: 'p1', threadId: '~local' }))
    ).rejects.toThrow('Unconfirmed thread destination');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('prefills or resumes edit drafts, guards busy/voice drafts, and targets room vs thread composer', () => {
    const onFocusComposer = vi.fn();
    const store = renderAndOpen({ onFocusComposer });
    const roomDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', undefined)
    );
    const readText = (atom: typeof roomDraftAtom) =>
      store.get(atom).map((n) => SlateNode.string(n));

    // Voice recording and recovered voice draft block editing.
    store.set(liveCaptureAtom, { kind: 'voice', session: {} as VoiceCaptureSession });
    expect(overlayCapture.props!.onEditTask!(task({ taskId: 'e1' }))).toBe('draft-busy');
    store.set(liveCaptureAtom, undefined);

    store.set(pendingVoiceSendDraftAtom, {
      recovered: true,
      file: new File(['a'], 'voice.ogg', { type: 'audio/ogg' }),
      duration: 3_000,
      context: {
        ownerSessionId: 'me-session',
        roomId: '!room:example.org',
        room: {} as Room,
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      },
    });
    expect(overlayCapture.props!.onEditTask!(task({ taskId: 'e1' }))).toBe('draft-busy');
    store.set(pendingVoiceSendDraftAtom, undefined);

    // Prefill from room view writes room draft and focuses room composer.
    let result: EditScheduledTaskResult = undefined;
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1', threadId: '$other' }));
    });
    expect(result).toBe('prefilled');
    expect(readText(roomDraftAtom)).toEqual(['!edit_schedule edit-1 ']);
    expect(onFocusComposer).toHaveBeenLastCalledWith(undefined);
    expect(navigateRoomThread).not.toHaveBeenCalled();

    // Resuming an existing edit draft preserves user text, while attachments/replies block.
    store.set(roomDraftAtom, [createParagraphElement('!edit_schedule edit-1 tomorrow')]);
    act(() => overlayCapture.openTrigger?.());
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1' }));
    });
    expect(result).toBe('prefilled');
    expect(readText(roomDraftAtom)).toEqual(['!edit_schedule edit-1 tomorrow']);

    const file = new File(['x'], 'report.txt');
    store.set(composerUploadItemsAtom('!room:example.org', undefined), {
      type: 'PUT',
      item: [
        { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } },
      ],
    });
    act(() => overlayCapture.openTrigger?.());
    expect(overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1' }))).toBe('draft-busy');
    store.set(composerUploadItemsAtom('!room:example.org', undefined), { type: 'RESET' });

    store.set(composerReplyDraftAtom('!room:example.org', undefined), {
      userId: '@bob:example.org',
      eventId: '$evt',
      body: 'Earlier',
    });
    expect(overlayCapture.props!.onEditTask!(task({ taskId: 'edit-1' }))).toBe('draft-busy');
    store.set(composerReplyDraftAtom('!room:example.org', undefined), undefined);

    // Full-width thread header targets the thread draft and focuses thread composer.
    const threadDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', '$t1')
    );
    act(() => {
      renderer?.update(
        <Provider store={store}>
          <RoomViewHeader hasMindroomAgents threadId="$t1" onFocusComposer={onFocusComposer} />
        </Provider>
      );
    });
    act(() => overlayCapture.openTrigger?.());
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-thread' }));
    });
    expect(result).toBe('prefilled');
    expect(readText(threadDraftAtom)).toEqual(['!edit_schedule edit-thread ']);
    expect(onFocusComposer).toHaveBeenLastCalledWith('$t1');
  });
});
