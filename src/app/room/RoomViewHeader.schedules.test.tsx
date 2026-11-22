// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { MsgType, RelationType, RoomMemberEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
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
import { liveVoiceRecordingAtom } from '../composer/voice/liveVoiceRecording';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { createParagraphElement } from '../editor/utils';
import {
  MINDROOM_ACCOUNTS_STATE_EVENT,
  MINDROOM_ROUTER_STATE_EVENT,
} from '../matrix/protocol/routerBinding';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { StateEvent } from '../matrix/types/room';
import type { EditScheduledTaskResult } from '../schedules/RoomSchedulesDialog';
import type { ScheduleCancelState } from '../schedules/useScheduleCancelState';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

type CapturedOverlayProps = {
  onClose: (dismissed?: boolean) => void;
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
  cancelState?: ScheduleCancelState;
};

const DEFAULT_AGENT_MEMBERS = [
  { userId: '@me:example.org' },
  { userId: '@mindroom_helper:example.org' },
];

const {
  perms,
  roomState,
  powerLevelsState,
  listeners,
  sendMessage,
  makeTxnId,
  getEventForTxnId,
  discardFailedLocalEcho,
  navigateRoomThread,
  setViewMode,
  overlayCapture,
} = vi.hoisted(() => {
  const powerLevelsValue: Record<string, unknown> = {};
  return {
    perms: { canSend: true },
    roomState: {
      tombstone: undefined as { getType: () => StateEvent } | undefined,
      routerBinding: undefined as MatrixEvent | undefined,
      accountsRoster: undefined as MatrixEvent | undefined,
      powerLevelsEvent: undefined as MatrixEvent | undefined,
      joinedMembers: [{ userId: '@me:example.org' }, { userId: '@mindroom_helper:example.org' }],
    },
    powerLevelsState: {
      value: powerLevelsValue,
    },
    listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
    sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
    makeTxnId: vi.fn(() => 'txn-1'),
    getEventForTxnId: vi.fn((_txnId: string) => undefined as unknown),
    discardFailedLocalEcho: vi.fn(),
    navigateRoomThread: vi.fn(),
    setViewMode: vi.fn(),
    overlayCapture: {
      openTrigger: undefined as (() => void) | undefined,
      props: undefined as CapturedOverlayProps | undefined,
      open: false,
    },
  };
});

const emitClientEvent = (eventName: string, ...args: unknown[]) => {
  listeners.get(eventName)?.forEach((fn) => fn(...args));
};

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
    on: (event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeListener: (event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
    },
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
    getJoinedMembers: () => roomState.joinedMembers,
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
  useStateEvent: (_room: unknown, type: string) => {
    if (type === `${StateEvent.RoomTombstone}`) return roomState.tombstone;
    if (type === MINDROOM_ROUTER_STATE_EVENT) return roomState.routerBinding;
    if (type === MINDROOM_ACCOUNTS_STATE_EVENT) return roomState.accountsRoster;
    if (type === `${StateEvent.RoomPowerLevels}`) return roomState.powerLevelsEvent;
    return undefined;
  },
}));
vi.mock('../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: () => powerLevelsState.value,
  usePowerLevelsContext: () => powerLevelsState.value,
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
    overlayCapture.open = true;
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

const makeStateEvent = (
  content: Record<string, unknown>,
  sender: string,
  stateKey = '',
  redacted = false
): MatrixEvent =>
  ({
    getContent: () => content,
    getSender: () => sender,
    getStateKey: () => stateKey,
    isRedacted: () => redacted,
  } as unknown as MatrixEvent);

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  perms.canSend = true;
  roomState.tombstone = undefined;
  roomState.routerBinding = undefined;
  roomState.accountsRoster = undefined;
  roomState.powerLevelsEvent = undefined;
  roomState.joinedMembers = [...DEFAULT_AGENT_MEMBERS];
  powerLevelsState.value = {};
  listeners.clear();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ event_id: '$sent' });
  makeTxnId.mockClear();
  getEventForTxnId.mockReset();
  discardFailedLocalEcho.mockClear();
  navigateRoomThread.mockClear();
  setViewMode.mockClear();
  overlayCapture.openTrigger = undefined;
  overlayCapture.props = undefined;
  overlayCapture.open = false;
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
  it('enables cancel/edit for a joined same-server agent without a router, and hides them for invited-only, federated, unpermitted, tombstoned, or non-agent rooms', () => {
    // Joined same-server @mindroom_helper:example.org (without @mindroom_router) enables Cancel/Edit.
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeDefined();
    expect(overlayCapture.props?.onEditTask).toBeDefined();

    // Invited-only agent (not in getJoinedMembers) hides Cancel/Edit.
    roomState.joinedMembers = [{ userId: '@me:example.org' }];
    const store = renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    // Router-only room (@mindroom_router without any real agent) hides Cancel/Edit.
    roomState.joinedMembers = [
      { userId: '@me:example.org' },
      { userId: '@mindroom_router:example.org' },
    ];
    act(() => {
      emitClientEvent(RoomMemberEvent.Membership, undefined, { roomId: '!room:example.org' });
    });
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    // Unrelated federated mindroom_* account hides Cancel/Edit.
    roomState.joinedMembers = [
      { userId: '@me:example.org' },
      { userId: '@mindroom_bot:foreign.org' },
    ];
    act(() => {
      emitClientEvent(RoomMemberEvent.Membership, undefined, { roomId: '!room:example.org' });
    });
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    // A joined account trusted via io.mindroom.router + io.mindroom.accounts enables Cancel/Edit.
    const steward = '@steward:foreign.org';
    const customAgent = '@helper_agent:foreign.org';
    const rawLevels = { state_default: 50, users_default: 0, users: { [steward]: 50 } };
    powerLevelsState.value = rawLevels;
    roomState.powerLevelsEvent = makeStateEvent(rawLevels, '@admin:example.org');
    roomState.routerBinding = makeStateEvent({ user_id: steward }, steward);
    roomState.accountsRoster = makeStateEvent({ accounts: [customAgent] }, steward, steward);
    roomState.joinedMembers = [{ userId: '@me:example.org' }, { userId: customAgent }];
    act(() => {
      renderer?.update(
        <Provider store={store}>
          <RoomViewHeader hasMindroomAgents />
        </Provider>
      );
    });
    expect(overlayCapture.props?.onCancelTask).toBeDefined();
    expect(overlayCapture.props?.onEditTask).toBeDefined();

    // Reset to default same-server joined agent for permission/tombstone/canEditSchedule checks.
    roomState.routerBinding = undefined;
    roomState.accountsRoster = undefined;
    roomState.powerLevelsEvent = undefined;
    powerLevelsState.value = {};
    roomState.joinedMembers = [...DEFAULT_AGENT_MEMBERS];

    const resetCapture = () => {
      overlayCapture.openTrigger = undefined;
      overlayCapture.props = undefined;
      overlayCapture.open = false;
    };
    resetCapture();
    renderAndOpenSchedules({ hasMindroomAgents: false });
    expect(overlayCapture.openTrigger).toBeUndefined();
    expect(overlayCapture.props).toBeUndefined();

    perms.canSend = false;
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    perms.canSend = true;
    roomState.tombstone = { getType: () => StateEvent.RoomTombstone };
    renderAndOpenSchedules();
    expect(overlayCapture.props?.onCancelTask).toBeUndefined();
    expect(overlayCapture.props?.onEditTask).toBeUndefined();

    roomState.tombstone = undefined;
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
    await expect(overlayCapture.props!.onCancelTask!(task({ taskId: 'all' }))).rejects.toThrow(
      'Unsupported task ID'
    );
    await expect(overlayCapture.props!.onCancelTask!(task({ taskId: 'bad id' }))).rejects.toThrow(
      'Unsupported task ID'
    );
    await expect(
      overlayCapture.props!.onCancelTask!(
        task({ taskId: 'pending-thread-1', threadId: '~pending', newThread: false })
      )
    ).rejects.toThrow('Unconfirmed thread destination');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('preserves pending cancel guard and surfaces late errors across dialog close and reopen', async () => {
    let rejectSend!: (error: Error) => void;
    sendMessage.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        })
    );

    renderAndOpenSchedules();
    const target = task({ taskId: 'in-flight-1', threadId: null });

    let cancelPromise!: Promise<boolean>;
    act(() => {
      cancelPromise = overlayCapture.props!.cancelState!.handleCancelTask(target);
    });
    expect(overlayCapture.props?.cancelState?.pendingCancelIds.has('in-flight-1')).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Close and reopen the schedules dialog while the send is still pending.
    act(() => {
      overlayCapture.props?.onClose(true);
    });
    overlayCapture.open = false;
    act(() => {
      overlayCapture.openTrigger?.();
    });
    expect(overlayCapture.open).toBe(true);
    expect(overlayCapture.props?.cancelState?.pendingCancelIds.has('in-flight-1')).toBe(true);

    // A second cancel attempt for the same task is blocked while the first send is in flight.
    let duplicateResult = true;
    await act(async () => {
      duplicateResult = await overlayCapture.props!.cancelState!.handleCancelTask(target);
    });
    expect(duplicateResult).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Close again, let the in-flight send fail, and reopen to verify the late error surfaces.
    act(() => {
      overlayCapture.props?.onClose(true);
    });
    await act(async () => {
      rejectSend(new Error('network error'));
      await cancelPromise;
    });
    act(() => {
      overlayCapture.openTrigger?.();
    });
    expect(overlayCapture.props?.cancelState?.pendingCancelIds.has('in-flight-1')).toBe(false);
    expect(overlayCapture.props?.cancelState?.cancelErrors.get('in-flight-1')).toBe(true);
  });

  it('targets the visible composer synchronously without toggling Compact, resumes edits, and blocks busy or voice drafts', () => {
    let draftAtFocusTime: string[] | undefined;
    const roomDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', undefined)
    );
    const onFocusComposer = vi.fn(() => {
      draftAtFocusTime = store.get(roomDraftAtom).map((node) => SlateNode.string(node));
    });
    const store = renderAndOpenSchedules({ onFocusComposer });

    // Live voice recording blocks editing without modifying drafts.
    store.set(liveVoiceRecordingAtom, {} as VoiceCaptureSession);
    let result: EditScheduledTaskResult = undefined;
    act(() => {
      result = overlayCapture.props!.onEditTask!(task({ taskId: 'edit-voice', threadId: null }));
    });
    expect(result).toBe('draft-busy');
    expect(store.get(roomDraftAtom)).toEqual([]);
    store.set(liveVoiceRecordingAtom, undefined);

    // Recovered voice audio blocks editing without modifying drafts.
    store.set(pendingVoiceSendDraftAtom, {
      recovered: true,
      file: new File(['audio'], 'voice.ogg', { type: 'audio/ogg' }),
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
    act(() => {
      result = overlayCapture.props!.onEditTask!(
        task({ taskId: 'edit-recovered-voice', threadId: null })
      );
    });
    expect(result).toBe('draft-busy');
    expect(store.get(roomDraftAtom)).toEqual([]);
    store.set(pendingVoiceSendDraftAtom, undefined);

    // Editing a thread-bound task from room view targets room composer synchronously (no RAF needed).
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
    expect(onFocusComposer).toHaveBeenLastCalledWith(undefined);
    expect(draftAtFocusTime).toEqual([]);

    // Resuming an in-progress edit of the SAME task preserves typed text and focuses composer synchronously.
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

    // In side-by-side layout (room header with openThreadId but no threadId), edit targets the
    // room composer and is not blocked by an unrelated draft in the open thread column.
    const threadDraftAtom = roomIdToMsgDraftAtomFamily(
      getRoomInputDraftKey('@me:example.org', '!room:example.org', '$open-thread')
    );
    store.set(roomDraftAtom, []);
    store.set(threadDraftAtom, [createParagraphElement('unrelated thread draft')]);
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
      result = overlayCapture.props!.onEditTask!(
        task({ taskId: 'edit-beside', threadId: '$open-thread' })
      );
    });
    expect(result).toBe('prefilled');
    expect(store.get(roomDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      '!edit_schedule edit-beside ',
    ]);
    expect(store.get(threadDraftAtom).map((node) => SlateNode.string(node))).toEqual([
      'unrelated thread draft',
    ]);
    expect(onFocusComposer).toHaveBeenLastCalledWith(undefined);

    // Inside a full-width thread header (`threadId` set), edit targets the thread composer.
    store.set(threadDraftAtom, []);
    act(() => {
      renderer?.update(
        <Provider store={store}>
          <RoomViewHeader
            hasMindroomAgents
            threadId="$open-thread"
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
    expect(onFocusComposer).toHaveBeenLastCalledWith('$open-thread');
  });
});
