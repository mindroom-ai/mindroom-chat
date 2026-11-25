// @vitest-environment jsdom
import {
  useContext,
  useEffect,
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { getDefaultStore } from 'jotai';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient, EventStatus, MatrixEvent, Room, type RoomMember } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Editable, ReactEditor, Slate } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { ComposerActionsMenu } from '../composer/ComposerActionsMenu';
import { composerReplyDraftAtom, composerUploadItemsAtom } from '../composer/roomInputDrafts';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import {
  ConversationViewContext,
  shownConversationViewsAtom,
  useConversationHidden,
} from '../navigation/conversationView';
import type { RoomTimelineProps } from '../timeline/RoomTimeline';
import { PanelFrameProvider } from '../ui/panels/panelFrameContext';
import { ThreadView } from './ThreadView';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const THREAD = '$root';
type ApprovalProps = ComponentProps<typeof ThreadApprovalProvider>;

const LEVELS = vi.hoisted(() => ({ users_default: 0 }));
const SOURCE_LEVELS = vi.hoisted(() => ({ users_default: 10 }));
const state = vi.hoisted(() => ({
  mayPost: true,
  tombstone: false,
  members: [] as RoomMember[],
  membersByRoom: new Map<string, RoomMember[]>(),
  timeline: undefined as RoomTimelineProps | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  timelineLevels: undefined as unknown,
  dropTarget: undefined as HTMLElement | null | undefined,
  composerViews: [] as (string | undefined)[],
  composerHidden: undefined as boolean | undefined,
  showActionsMenu: false,
  approvals: undefined as Omit<ApprovalProps, 'children'> | undefined,
  composer: undefined as
    | {
        room?: Room;
        roomId?: string;
        threadId?: string;
        forkFrom?: { roomId?: string; threadId: string; eventId: string };
        onRoomMessageSent?: (eventId: string) => boolean | void;
      }
    | undefined,
  navigateRoomThread: vi.fn(),
}));

// jsdom lays nothing out, so the menu's focus trap would find no control to hold.
vi.mock('focus-trap-react', () => {
  const FocusTrap = ({ children }: { children?: unknown }) => children;
  return { default: FocusTrap, FocusTrap };
});
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: state.navigateRoomThread }),
}));
vi.mock('../matrix/hooks/useRoomMembers', () => ({
  useRoomMembers: (_mx: unknown, roomId: string) =>
    state.membersByRoom.get(roomId) ?? state.members,
}));
vi.mock('../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: (r: Room) => (r.roomId === '!alpha:example.org' ? SOURCE_LEVELS : LEVELS),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: (type: string, userId: string) =>
      state.mayPost && type === 'm.room.message' && userId === '@alice:example.org',
  }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({
  useStateEvent: () => (state.tombstone ? {} : undefined),
}));
vi.mock('../timeline/RoomTimeline', () => ({
  RoomTimeline: (props: RoomTimelineProps) => {
    state.timeline = props;
    state.timelineLevels = usePowerLevelsContext();
    return <div data-testid="timeline" />;
  },
}));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children, ...props }: ApprovalProps) => {
    state.approvals = props;
    return children;
  },
}));
vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalQueue: () => <div data-testid="approvals" />,
}));
vi.mock('../timeline/typing/RoomViewTyping', () => ({
  RoomViewTyping: ({ threadId }: { threadId?: string }) => (
    <div data-testid="typing" data-thread={threadId} />
  ),
}));
vi.mock('../timeline/RoomViewFollowing', () => ({
  RoomViewFollowing: ({ threadId }: { threadId?: string }) => (
    <div data-testid="following" data-thread={threadId} />
  ),
}));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({
  BackgroundJobsBar: ({ threadId }: { threadId: string | null }) => (
    <div data-testid="jobs" data-thread={threadId ?? undefined} />
  ),
}));
vi.mock('../messages/FailedSendActions', () => ({
  FailedSendActions: ({ event }: { event: MatrixEvent }) => (
    <div data-testid="failed-root">{event.getId()}</div>
  ),
}));
vi.mock('./RoomTombstone', () => ({
  RoomTombstone: () => <div data-testid="tombstone" />,
}));
// The composer is its Slate text box.
vi.mock('../composer/RoomInput', () => ({
  RoomInput: ({
    room: inputRoom,
    roomId: inputRoomId,
    editor,
    threadId,
    forkFrom,
    onRoomMessageSent,
    fileDropContainerRef,
  }: {
    room: Room;
    roomId: string;
    editor: Editor;
    threadId?: string;
    forkFrom?: { roomId?: string; threadId: string; eventId: string };
    onRoomMessageSent?: (eventId: string) => boolean | void;
    fileDropContainerRef: RefObject<HTMLElement | null>;
  }) => {
    state.composer = {
      room: inputRoom,
      roomId: inputRoomId,
      threadId,
      forkFrom,
      onRoomMessageSent,
    };
    const view = useContext(ConversationViewContext);
    const hidden = useConversationHidden();
    useEffect(() => {
      state.dropTarget = fileDropContainerRef.current;
      state.composerViews.push(view);
      state.composerHidden = hidden;
    });
    const noop = () => undefined;
    return (
      <>
        {state.showActionsMenu && (
          <ComposerActionsMenu
            formattingOpen={false}
            onAttach={noop}
            onAttachAppLogs={noop}
            onToggleFormatting={noop}
            onEmoji={noop}
          />
        )}
        <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
          <Editable aria-label={`Reply in ${threadId ?? 'the room'}`} />
        </Slate>
      </>
    );
  },
}));

beforeEach(() => {
  state.mayPost = true;
  state.tombstone = false;
  state.members = [];
  state.membersByRoom.clear();
  state.timeline = undefined;
  state.timelineLevels = undefined;
  state.dropTarget = undefined;
  state.composerViews = [];
  state.composerHidden = undefined;
  state.showActionsMenu = false;
  state.approvals = undefined;
  state.composer = undefined;
  state.navigateRoomThread.mockReset();
});
afterEach(cleanup);

const composer = () => screen.queryByRole('textbox', { name: `Reply in ${THREAD}` });

it("shows the thread's root and replies, its approvals under them and the reply box under those", () => {
  render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timeline).toMatchObject({
    room,
    threadId: THREAD,
    viewMode: 'threaded',
    hasMindroomAgents: false,
  });
  expect(state.timeline?.summaryMap.size).toBe(0);
  expect(state.approvals).toMatchObject({ room, threadId: THREAD });
  const [timeline, approvals, reply] = [
    screen.getByTestId('timeline'),
    screen.getByTestId('approvals'),
    composer(),
  ];
  expect(
    timeline.compareDocumentPosition(approvals) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(
    reply && approvals.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it('shares one editor between the timeline and the reply box, which an approval focuses', () => {
  render(<ThreadView room={room} threadId={THREAD} />);
  state.approvals?.focusConversation?.();
  expect(document.activeElement).toBe(composer());
  expect(state.timeline?.editor).toBeDefined();
});

it('tells the timeline whether a MindRoom agent is in the room', () => {
  state.members = [{ userId: '@mindroom_helper:example.org', membership: 'join' } as RoomMember];
  render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timeline?.hasMindroomAgents).toBe(true);
});

it('shows no reply box where the account may not post, nor in an upgraded room', () => {
  state.mayPost = false;
  const { rerender } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(screen.getByTestId('timeline')).toBeDefined();
  expect(composer()).toBeNull();
  state.mayPost = true;
  state.tombstone = true;
  rerender(<ThreadView room={room} threadId={THREAD} />);
  expect(composer()).toBeNull();
});

it('lets an Escape the reply box leaves bubble out of it', () => {
  const heard = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
  render(
    <div onKeyDown={heard}>
      <ThreadView room={room} threadId={THREAD} />
    </div>
  );
  fireEvent.keyDown(composer() as HTMLElement, { key: 'Escape' });
  expect(heard).toHaveReturnedWith(false);
});

it("gives the timeline its room's power levels, also outside that room's page, and takes files dropped anywhere on it", () => {
  const { container } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(state.timelineLevels).toBe(LEVELS);
  expect(state.dropTarget).toBe(container.firstElementChild);
});

it('takes the files dropped on the element the page names instead, as the thread column does', () => {
  const column = document.createElement('div');
  render(<ThreadView room={room} threadId={THREAD} fileDropContainerRef={{ current: column }} />);
  expect(state.dropTarget).toBe(column);
});

it("shows typing, read receipts and the thread's background jobs", () => {
  render(<ThreadView room={room} threadId={THREAD} />);
  ['typing', 'following', 'jobs'].forEach((part) =>
    expect(screen.getByTestId(part).dataset.thread).toBe(THREAD)
  );
});

it('offers Retry and Delete for its unsent root', () => {
  const root = new MatrixEvent({ event_id: '~!room:example.org:m1.1', type: 'm.room.message' });
  root.setStatus(EventStatus.NOT_SENT);
  const find = vi.spyOn(room, 'findEventById').mockReturnValue(root);
  render(<ThreadView room={room} threadId="~!room:example.org:m1.1" />);
  expect(screen.getByTestId('failed-root').textContent).toBe('~!room:example.org:m1.1');
  find.mockRestore();
});

it('tells an upgraded room or a missing permission where the composer would be', () => {
  state.tombstone = true;
  const { rerender } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(screen.getByTestId('tombstone')).toBeDefined();
  expect(composer()).toBeNull();
  state.tombstone = false;
  state.mayPost = false;
  rerender(<ThreadView room={room} threadId={`${THREAD}-2`} />);
  expect(screen.queryByTestId('tombstone')).toBeNull();
  expect(screen.getByText('You do not have permission to post in this room')).toBeDefined();
});

it('shows the room header it is given in its floating header', () => {
  let headerRef: RefObject<HTMLDivElement | null> | undefined;
  render(
    <ThreadView
      room={room}
      threadId={THREAD}
      roomHeader={(ref) => {
        headerRef = ref;
        return <b>Room header</b>;
      }}
    />
  );
  expect(headerRef?.current?.dataset.glassFlat).toBe('true');
  expect(headerRef?.current?.contains(screen.getByText('Room header'))).toBe(true);
});

it("shares the thread's summaries with the page that gives it its map", () => {
  const summaryMap = new Map([['$root', { summaryText: 'Title' }]]);
  const onStoreThreadSummary = vi.fn();
  render(
    <ThreadView
      room={room}
      threadId={THREAD}
      summaryMap={summaryMap as never}
      onStoreThreadSummary={onStoreThreadSummary}
    />
  );
  expect(state.timeline?.summaryMap).toBe(summaryMap);
  expect(state.timeline?.onStoreThreadSummary).toBe(onStoreThreadSummary);
});

it('keeps the composer while its unsent root waits for the server', () => {
  render(<ThreadView room={room} threadId="~!room:example.org:m1.1" />);
  expect(screen.getByRole('textbox', { name: 'Reply in ~!room:example.org:m1.1' })).toBeDefined();
});

it('keeps Retry and Delete for its unsent root after losing permission to post', () => {
  state.mayPost = false;
  const root = new MatrixEvent({ event_id: '~!room:example.org:m1.1', type: 'm.room.message' });
  root.setStatus(EventStatus.NOT_SENT);
  const find = vi.spyOn(room, 'findEventById').mockReturnValue(root);
  render(<ThreadView room={room} threadId="~!room:example.org:m1.1" />);
  expect(screen.getByTestId('failed-root')).toBeDefined();
  expect(screen.queryByText('You do not have permission to post in this room')).toBeNull();
  find.mockRestore();
});

it('focuses the composer only as a thread opens or changes', () => {
  const focus = vi.spyOn(ReactEditor, 'focus');
  const { rerender } = render(<ThreadView room={room} threadId={THREAD} autoFocus={false} />);
  rerender(<ThreadView room={room} threadId={THREAD} autoFocus />);
  expect(focus).not.toHaveBeenCalled();
  rerender(<ThreadView room={room} threadId="$other" autoFocus />);
  expect(focus).toHaveBeenCalledTimes(1);
  focus.mockRestore();
});

it('is a conversation view of its own, apart from the room page and from another view of the thread, whose reply and staged files go with it', () => {
  const store = getDefaultStore();
  const { unmount } = render(
    <>
      <ThreadView room={room} threadId={THREAD} />
      <ThreadView room={room} threadId={THREAD} />
    </>
  );
  const [first, second] = state.composerViews;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(first).not.toBe(second);

  const reply = { userId: '@bob:example.org', eventId: '$reply', body: 'Reply' };
  const file = new File(['x'], 'notes.txt');
  const item = {
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: { markedAsSpoiler: false },
  };
  act(() => {
    store.set(composerReplyDraftAtom(room.roomId, first), reply);
    store.set(composerUploadItemsAtom(room.roomId, first), { type: 'PUT', item });
  });
  unmount();
  expect(store.get(composerReplyDraftAtom(room.roomId, first))).toBeUndefined();
  expect(store.get(composerUploadItemsAtom(room.roomId, first))).toEqual([]);
});

it('counts its thread as on screen for notifications while it is mounted', () => {
  const store = getDefaultStore();
  const { unmount } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(store.get(shownConversationViewsAtom)).toMatchObject([
    { roomId: room.roomId, threadId: THREAD },
  ]);
  unmount();
  expect(store.get(shownConversationViewsAtom)).toEqual([]);
});

it('counts its thread as off screen while the side panel it is in is folded', () => {
  const store = getDefaultStore();
  const frame = (layout: 'beside' | 'folded') => ({ label: 'Thread', layout, setLayout: vi.fn() });
  const { rerender } = render(
    <PanelFrameProvider value={frame('folded')}>
      <ThreadView room={room} threadId={THREAD} />
    </PanelFrameProvider>
  );
  expect(store.get(shownConversationViewsAtom)).toEqual([]);
  rerender(
    <PanelFrameProvider value={frame('beside')}>
      <ThreadView room={room} threadId={THREAD} />
    </PanelFrameProvider>
  );
  expect(store.get(shownConversationViewsAtom)).toMatchObject([
    { roomId: room.roomId, threadId: THREAD },
  ]);
});

it('counts its thread as off screen while hidden', () => {
  const store = getDefaultStore();
  const { rerender } = render(<ThreadView room={room} threadId={THREAD} hidden />);
  expect(store.get(shownConversationViewsAtom)).toEqual([]);
  rerender(<ThreadView room={room} threadId={THREAD} />);
  expect(store.get(shownConversationViewsAtom)).toMatchObject([
    { roomId: room.roomId, threadId: THREAD },
  ]);
});

it('tells onUnmount the thread it showed last, and the page its load errors', () => {
  const onThreadLoadError = vi.fn();
  const onUnmount = vi.fn();
  const props = { room, onThreadLoadError, onUnmount };
  const { rerender, unmount } = render(<ThreadView {...props} threadId={THREAD} />);
  expect(state.timeline?.onThreadLoadError).toBe(onThreadLoadError);
  rerender(<ThreadView {...props} threadId="$other" />);
  expect(onUnmount).not.toHaveBeenCalled();
  unmount();
  expect(onUnmount).toHaveBeenCalledOnce();
  expect(onUnmount).toHaveBeenCalledWith('$other');
});

it('leaves the focus where it is when the root of its thread gets its own ID', () => {
  const focus = vi.spyOn(ReactEditor, 'focus');
  // The server confirmed the unsent root as $confirmed.
  const confirmed = vi
    .spyOn(room, 'getEventForTxnId')
    .mockImplementation((txnId) =>
      txnId === 'm1.1' ? new MatrixEvent({ event_id: '$confirmed' }) : undefined
    );
  const view = (threadId: string) => <ThreadView room={room} threadId={threadId} autoFocus />;
  const { rerender } = render(view('~!room:example.org:m1.1'));
  expect(focus).toHaveBeenCalledTimes(1);
  rerender(view('$confirmed'));
  expect(focus).toHaveBeenCalledTimes(1);
  rerender(view('$another'));
  expect(focus).toHaveBeenCalledTimes(2);
  // Another thread after an unsent root takes the focus too.
  rerender(view('~!room:example.org:m2.1'));
  rerender(view('$unrelated'));
  expect(focus).toHaveBeenCalledTimes(4);
  focus.mockRestore();
  confirmed.mockRestore();
});

it("hands the page its composer's focus while it is mounted", () => {
  const focusRef: { current: (() => void) | undefined } = { current: undefined };
  const { unmount } = render(<ThreadView room={room} threadId={THREAD} focusRef={focusRef} />);
  act(() => focusRef.current?.());
  expect(document.activeElement).toBe(composer());
  unmount();
  expect(focusRef.current).toBeUndefined();
});

it('asks for the focus with no reply box to take it, and nothing breaks', () => {
  state.mayPost = false;
  render(<ThreadView room={room} threadId={THREAD} autoFocus />);
  expect(composer()).toBeNull();
  expect(screen.getByTestId('timeline')).toBeDefined();
});

it('asks for no approvals of a thread whose root the server has not confirmed', () => {
  render(<ThreadView room={room} threadId="~!room:example.org:m1.1" />);
  expect(state.approvals).toMatchObject({ room, threadId: undefined });
  expect(state.timeline?.threadId).toBe('~!room:example.org:m1.1');
});

it("puts the room page's header above the thread and opens it at the event its address names", () => {
  render(<ThreadView room={room} threadId={THREAD} eventId="$reply" header={<b>Banner</b>} />);
  expect(state.timeline).toMatchObject({ threadId: THREAD, eventId: '$reply' });
  render(<>{state.timeline?.threadHeader}</>);
  expect(screen.getByText('Banner')).toBeDefined();
});

it('takes the focus to its reply box as it opens only when asked to', () => {
  const { unmount } = render(<ThreadView room={room} threadId={THREAD} />);
  expect(document.activeElement).toBe(document.body);
  unmount();
  render(<ThreadView room={room} threadId={THREAD} autoFocus />);
  expect(document.activeElement).toBe(composer());
});

describe('a fork draft', () => {
  it('shows the thread up to the fork point, then a focused composer that starts a new thread there', () => {
    const focus = vi.spyOn(ReactEditor, 'focus');
    render(<ThreadView room={room} threadId={THREAD} forkAt="$point" />);
    expect(state.timeline).toMatchObject({ threadId: THREAD, forkAt: '$point' });
    render(<>{state.timeline?.threadHeader}</>);
    const draftBanner = document.querySelector('[data-fork-draft-banner="true"]');
    expect(draftBanner).not.toBeNull();
    expect(draftBanner?.hasAttribute('data-cross-room-fork-banner')).toBe(false);
    expect(screen.getByText('Forking thread')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(
      screen.getByText('Not created yet. Send a message below to start this forked thread.')
    ).toBeDefined();
    // From the start: text typed while the thread loads belongs to the draft, never to the thread.
    expect(state.composer).toMatchObject({
      threadId: undefined,
      forkFrom: { threadId: THREAD, eventId: '$point' },
    });
    expect(focus).toHaveBeenCalledTimes(1);

    // The sent message opens its thread in the draft's place.
    let opened: boolean | void = false;
    act(() => {
      opened = state.composer?.onRoomMessageSent?.('$fork');
    });
    expect(opened).toBe(true);
    expect(state.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$fork', undefined, {
      replace: true,
    });
    focus.mockRestore();
  });

  it('drops the reply chosen in its thread once the fork starts, so it takes nothing back there', () => {
    const store = getDefaultStore();
    render(<ThreadView room={room} threadId={THREAD} forkAt="$point" />);
    const replyAtom = composerReplyDraftAtom(room.roomId, state.composerViews.at(-1));
    act(() => {
      store.set(replyAtom, { userId: '@bob:example.org', eventId: '$reply', body: 'Reply' });
    });

    act(() => {
      state.composer?.onRoomMessageSent?.('$fork');
    });
    expect(store.get(replyAtom)).toBeUndefined();
  });

  it('asks the timeline for no draft at a point the server has not confirmed', () => {
    render(<ThreadView room={room} threadId={THREAD} forkAt="~!room:example.org:m1.1" />);

    expect(state.timeline?.forkAt).toBeUndefined();
    expect(state.composer).toMatchObject({ threadId: THREAD, forkFrom: undefined });
  });

  it("follows the fork point, and goes back to the thread's composer when the draft closes", () => {
    const { rerender } = render(<ThreadView room={room} threadId={THREAD} forkAt="$point" />);
    expect(state.composer?.forkFrom).toEqual({ threadId: THREAD, eventId: '$point' });

    rerender(<ThreadView room={room} threadId={THREAD} forkAt="$other" />);
    expect(state.composer?.forkFrom).toEqual({ threadId: THREAD, eventId: '$other' });

    // Closing the draft leaves the thread on screen, with its composer at once.
    rerender(<ThreadView room={room} threadId={THREAD} />);
    expect(state.composer).toMatchObject({ threadId: THREAD, forkFrom: undefined });
  });

  it('splits read scope (sourceRoom + sourcePowerLevels) from send scope (targetRoom) in a cross-room fork draft', () => {
    const sourceRoom = new Room('!alpha:example.org', mx, '@alice:example.org');
    sourceRoom.name = 'Project Alpha';
    room.name = 'Project Beta';
    state.membersByRoom.set(sourceRoom.roomId, [
      { userId: '@alice:example.org', membership: 'join' } as RoomMember,
    ]);
    state.membersByRoom.set(room.roomId, [
      { userId: '@alice:example.org', membership: 'join' } as RoomMember,
      { userId: '@mindroom_coder:example.org', membership: 'join' } as RoomMember,
    ]);

    const onBack = vi.fn();
    render(
      <ThreadView
        room={room}
        sourceRoom={sourceRoom}
        threadId={THREAD}
        forkAt="$point"
        onExitCrossRoomFork={onBack}
      />
    );

    // Timeline reads from sourceRoom with sourcePowerLevels and targets Project Beta for forks and divider.
    expect(state.timeline).toMatchObject({
      room: sourceRoom,
      threadId: THREAD,
      eventId: '$point',
      forkAt: '$point',
      forkTargetRoom: room,
    });
    expect(state.timelineLevels).toBe(SOURCE_LEVELS);

    // Composer sends to targetRoom with cross-room forkFrom ref.
    expect(state.composer).toMatchObject({
      room,
      roomId: room.roomId,
      threadId: undefined,
      forkFrom: { roomId: sourceRoom.roomId, threadId: THREAD, eventId: '$point' },
    });

    // Draft header shows "Forking from Project Alpha", DRAFT badge, hint, Back button, and agent warning.
    render(<>{state.timeline?.threadHeader}</>);
    const crossBanner = document.querySelector('[data-fork-draft-banner="true"]');
    expect(crossBanner?.getAttribute('data-cross-room-fork-banner')).toBe('true');
    expect(screen.getByText('Forking from Project Alpha')).toBeDefined();
    expect(screen.getByText('Draft')).toBeDefined();
    expect(
      screen.getByText('Not in Project Beta yet. Send a message below to create this thread.')
    ).toBeDefined();
    expect(document.querySelector('[data-cross-room-fork-agent-warning]')?.textContent).toContain(
      'Project Alpha'
    );
    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    // Sending navigates to the new fork in targetRoom.
    act(() => {
      state.composer?.onRoomMessageSent?.('$newFork');
    });
    expect(state.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$newFork', undefined, {
      replace: true,
    });
  });

  it('registers a visible cross-room fork draft under its view without claiming targetRoom/threadId and keeps composer menus open', () => {
    const store = getDefaultStore();
    const sourceRoom = new Room('!alpha:example.org', mx, '@alice:example.org');
    sourceRoom.name = 'Project Alpha';
    state.showActionsMenu = true;

    const { rerender } = render(
      <ThreadView room={room} sourceRoom={sourceRoom} threadId={THREAD} forkAt="$point" />
    );

    const view = state.composerViews.at(-1);
    expect(view).toBeDefined();
    // Registered by view only: neither roomId nor threadId is claimed on targetRoom or sourceRoom.
    expect(store.get(shownConversationViewsAtom)).toStrictEqual([{ view }]);
    expect(state.composerHidden).toBe(false);

    // Mobile More actions menu (Attach files, Formatting, Emoji) opens and stays open.
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Attach files' })).toBeDefined();

    // Hiding the draft unregisters the view and closes the open composer menu.
    rerender(
      <ThreadView room={room} sourceRoom={sourceRoom} threadId={THREAD} forkAt="$point" hidden />
    );
    expect(store.get(shownConversationViewsAtom)).toEqual([]);
    expect(state.composerHidden).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
