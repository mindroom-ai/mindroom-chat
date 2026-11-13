// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createClient, EventStatus, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { Editable, Slate } from 'slate-react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import {
  conversationBehindPanelAtom,
  conversationHiddenAtom,
} from '../navigation/conversationCover';
import { shownConversationViewsAtom } from '../navigation/conversationView';
import type { RoomTimelineProps } from '../timeline/RoomTimeline';
import type { ThreadContextBannerProps } from '../threads/ThreadContextBanner';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../composer/roomInputDrafts';
import { PanelRow } from '../members/PanelRow';
import type { RoomInputProps } from '../composer/RoomInput';
import type { RoomHeaderSlotComponent } from '../plugins/registry';
import { RoomView, type RoomViewProps } from './RoomView';
import type { ThreadView } from './ThreadView';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const LAYOUT_KEY = 'mindroom.threadColumn.layout';

const state = vi.hoisted(() => ({
  thread: undefined as string | undefined,
  main: undefined as RoomTimelineProps | undefined,
  focused: [] as (string | undefined)[],
  approvalThread: 'unset' as string | undefined,
  columnLoadError: undefined as ((threadId: string) => void) | undefined,
  rootDeleted: () => undefined as void,
  threadNotFound: false,
  threadLoadError: (() => undefined) as (threadId: string) => void,
  resized: [] as (() => void)[],
  canMessage: true,
  read: [] as string[],
  // The header the plugin header slot's marker was last given.
  slotHeader: undefined as HTMLElement | null | undefined,
  // The composer, the room's or a thread's, that each dropped file went to.
  dropped: [] as string[],
  // How often the thread's view and the plugin cover mounted.
  viewMounts: 0,
  coverMounts: 0,
  // The room composer's report of a sent room message.
  roomMessageSent: undefined as ((eventId: string) => boolean | void) | undefined,
  // Whether the thread's view took the focus as each thread opened in it, as ThreadView reads it.
  openFocus: [] as [string, boolean | undefined][],
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => state.canMessage }),
}));
vi.mock('../notifications/readReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notifications/readReceipts')>()),
  markMainTimelineAsRead: () => state.read.push('messages'),
  markThreadAsRead: (_mx: unknown, _roomId: string, threadId: string) => state.read.push(threadId),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({
    noteRoomFocused: (_roomId: string, threadId?: string) => state.focused.push(threadId),
    clearRoomFocus: () => undefined,
  }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({
    viewMode: 'compact',
    effectiveThreadId: state.thread,
    handleExitThread: () => undefined,
    handleThreadRootDeleted: state.rootDeleted,
    threadNotFound: state.threadNotFound,
    handleThreadLoadError: (threadId: string) => state.threadLoadError(threadId),
    storeThreadSummary: () => undefined,
    summaryMap: new Map(),
    threadSortFreezeState: null,
    // A Compact send opens its root's thread.
    handleRoomMessageSent: (eventId: string) => {
      state.thread = eventId;
      return true;
    },
  }),
}));
vi.mock('./RoomViewHeader', () => ({ RoomViewHeader: () => <div data-testid="room-header" /> }));
// A plugin of the build whose header slot shows a marker.
vi.mock('../plugins/pluginEntries', async () => {
  const { useEffect } = await import('react');
  function Marker({ headerRef }: ComponentProps<RoomHeaderSlotComponent>) {
    useEffect(() => {
      state.slotHeader = headerRef.current;
    }, [headerRef]);
    return <div data-testid="header-slot" />;
  }
  return {
    pluginEntries: [{ id: 'example', version: '1.0.0', plugin: { roomHeaderSlot: [Marker] } }],
  };
});
vi.mock('./ConversationCover', async () => {
  const { useEffect } = await import('react');
  return {
    ConversationCover: () => {
      useEffect(() => {
        state.coverMounts += 1;
      }, []);
      return null;
    },
  };
});
vi.mock('../timeline/RoomTimeline', () => ({
  RoomTimeline: (props: RoomTimelineProps) => {
    state.main = props;
    return <div data-testid="messages">{props.threadHeader}</div>;
  },
}));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({
  BackgroundJobsBar: ({ threadId }: { threadId: string | null }) => (
    <div data-testid="jobs" data-thread={threadId ?? 'room'} />
  ),
}));
vi.mock('../messages/FailedSendActions', () => ({
  FailedSendActions: () => <div>Root not sent</div>,
}));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children, threadId }: { children: ReactNode; threadId?: string }) => {
    state.approvalThread = threadId;
    return children;
  },
}));
vi.mock('../approvals/ThreadApprovalControls', () => ({ ThreadApprovalQueue: () => null }));
vi.mock('../threads/ThreadContextBanner', () => ({
  ThreadContextBanner: ({ onShowBeside, onShowFull, onExitThread }: ThreadContextBannerProps) => (
    <div>
      <button type="button" onClick={onExitThread}>
        Back
      </button>
      {onShowBeside && (
        <button type="button" onClick={onShowBeside}>
          Beside
        </button>
      )}
      {onShowFull && (
        <button type="button" onClick={onShowFull}>
          Full
        </button>
      )}
    </div>
  ),
}));
// The column's view, which reports its last thread as it unmounts, and whose composer takes the
// files dropped on the element the page names, else on the view.
vi.mock('./ThreadView', async () => {
  const { useCallback, useEffect, useRef } = await import('react');
  const { useFileDropZone } = await import('../lib/hooks/useFileDrop');
  return {
    ThreadView: ({
      threadId,
      eventId,
      header,
      autoFocus,
      hidden,
      onThreadLoadError,
      onUnmount,
      focusRef,
      fileDropContainerRef,
      roomHeader,
    }: ComponentProps<typeof ThreadView>) => {
      const reply = useRef<HTMLDivElement>(null);
      const viewRef = useRef<HTMLDivElement>(null);
      const headerRef = useRef<HTMLDivElement>(null);
      useFileDropZone(
        fileDropContainerRef ?? viewRef,
        useCallback(() => state.dropped.push(threadId), [threadId])
      );
      useEffect(() => {
        if (!focusRef) return undefined;
        focusRef.current = () => reply.current?.focus();
        return () => {
          focusRef.current = undefined;
        };
      }, [focusRef]);
      const last = useRef({ threadId, onUnmount });
      last.current = { threadId, onUnmount };
      useEffect(() => {
        state.openFocus.push([threadId, autoFocus]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- read as the thread opens
      }, [threadId]);
      useEffect(() => {
        state.viewMounts += 1;
        return () => last.current.onUnmount?.(last.current.threadId);
      }, []);
      state.columnLoadError = onThreadLoadError;
      return (
        <div
          ref={viewRef}
          data-testid="thread-view"
          data-thread={threadId}
          data-event={eventId}
          data-autofocus={autoFocus}
          data-hidden={hidden}
        >
          {roomHeader && (
            <div ref={headerRef} data-glass-flat="true">
              {roomHeader(headerRef)}
            </div>
          )}
          {header}
          <div ref={reply} contentEditable suppressContentEditableWarning aria-label="Reply" />
          {/* A menu it opens renders outside it, as the app's menus and dialogs do. */}
          {createPortal(<button type="button">Column menu item</button>, document.body)}
        </div>
      );
    },
  };
});
// The composer is its Slate text box, and takes the files dropped on the element it is given.
vi.mock('../composer/RoomInput', async () => {
  const { useFileDropZone } = await import('../lib/hooks/useFileDrop');
  const dropToRoom = () => state.dropped.push('room');
  return {
    RoomInput: ({ editor, fileDropContainerRef, onRoomMessageSent }: RoomInputProps) => {
      useFileDropZone(fileDropContainerRef, dropToRoom);
      state.roomMessageSent = onRoomMessageSent;
      return (
        <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
          <Editable aria-label="Message" />
        </Slate>
      );
    },
  };
});

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

beforeEach(() => {
  state.thread = '$thread';
  state.main = undefined;
  state.focused = [];
  state.rootDeleted = () => undefined;
  state.threadNotFound = false;
  state.resized = [];
  state.canMessage = true;
  state.read = [];
  state.slotHeader = undefined;
  state.dropped = [];
  state.viewMounts = 0;
  state.coverMounts = 0;
  state.openFocus = [];
  localStorage.clear();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        state.resized.push(callback);
      }

      observe() {}

      disconnect() {}
    }
  );
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getDefaultStore().set(conversationBehindPanelAtom, false);
});

// The room's Escape handler (Room.tsx), which reads the open thread or the room's messages.
function EscapeReads() {
  useRoomEscapeReadReceipts({ hideActivity: false, roomId: room.roomId, threadId: state.thread });
  return null;
}
// In the room's row, which measures itself before the view mounts.
const tree = (props: Partial<RoomViewProps> = {}, screenSize = ScreenSize.Desktop) => (
  <ScreenSizeProvider value={screenSize}>
    <EscapeReads />
    <PanelRow>
      <RoomView room={room} {...props} />
    </PanelRow>
  </ScreenSizeProvider>
);
const renderView = (props: Partial<RoomViewProps> = {}, screenSize = ScreenSize.Desktop) =>
  render(tree(props, screenSize));
const rerenderView = (rerender: (ui: ReactNode) => void) => rerender(tree());
const column = () => screen.queryByTestId('thread-view');
const draftAtom = (threadId?: string) =>
  roomIdToMsgDraftAtomFamily(getRoomInputDraftKey('@alice:example.org', room.roomId, threadId));
const storedLayout = () => localStorage.getItem(LAYOUT_KEY);
// Whether the plugins' slot, which only one header on the page mounts, is the thread column's.
const slotInColumn = () => {
  const markers = screen.getAllByTestId('header-slot');
  expect(markers).toHaveLength(1);
  const header = markers[0]?.closest<HTMLElement>('[data-glass-flat]');
  if (!header) throw new Error('the slot shows in no header');
  // The slot's components are given the element of the header they show in.
  expect(state.slotHeader).toBe(header);
  expect(within(header).getByTestId('room-header')).toBeDefined();
  return !!screen.queryByTestId('thread-column')?.contains(header);
};

it("shows the plugins' header slot once, under the header people see, as the column fills the page and goes back", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  state.thread = undefined;
  const { rerender } = renderView();
  expect(slotInColumn()).toBe(false);

  // Beside the messages, the room's header above them keeps it; the column shows none.
  state.thread = '$thread';
  rerenderView(rerender);
  expect(column()).not.toBeNull();
  expect(slotInColumn()).toBe(false);

  // Filling the page, the column's header has it, and the hidden room area none.
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(slotInColumn()).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Beside' }));
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(slotInColumn()).toBe(false);
});

it('opens every thread in the column, filling the page with the layout full', () => {
  renderView();
  expect(column()?.dataset).toMatchObject({ thread: '$thread', autofocus: 'false' });
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  // The room's conversation goes from under it: one timeline, one composer, the thread's.
  expect(screen.queryByTestId('messages')).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  expect(screen.getByLabelText('Reply')).toBeDefined();
  // From there it can move beside them.
  expect(screen.getByRole('button', { name: 'Beside' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Full' })).toBeNull();
});
it("shows the thread in its own column beside the room's messages once chosen, as it opens", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView({ eventId: '$reply' });
  expect(state.main?.threadId).toBeUndefined();
  expect(state.main?.threadHeader).toBeUndefined();
  // The event the address names is the thread's.
  expect(state.main?.eventId).toBeUndefined();
  expect(column()?.dataset).toMatchObject({
    thread: '$thread',
    event: '$reply',
    autofocus: 'true',
    hidden: 'false',
  });
  // The thread's approvals are the column's; the room keeps its own composer beside it.
  expect(state.approvalThread).toBeUndefined();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeDefined();
  expect(screen.getByLabelText('Reply')).toBeDefined();
  expect(screen.getByRole('separator', { name: 'Resize the thread' })).toBeDefined();
  // In the column the banner offers Full, not the menu's Show beside.
  expect(screen.getByRole('button', { name: 'Full' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
});

it('shows the room timeline at an event the address asks for in the room, beside the thread', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView({ eventId: '$event', focusEventInRoom: true });
  expect(state.main?.eventId).toBe('$event');
  expect(column()?.dataset.event).toBeUndefined();
});

it('stores each choice and opens the next thread the way chosen last', () => {
  const { rerender } = renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Beside' }));
  expect(storedLayout()).toBe('"beside"');
  expect(column()?.dataset.thread).toBe('$thread');

  state.thread = '$next';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('$next');

  // Full fills the page with the column, which keeps the thread and its composer; focus left in
  // the room's composer goes with that composer.
  screen.getByRole('textbox', { name: 'Message' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  expect(document.activeElement).toBe(document.body);
  expect(storedLayout()).toBe('"full"');
  expect(column()?.dataset.thread).toBe('$next');
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('separator')).toBeNull();
  // It has the room's header, which the room area no longer shows.
  expect(within(screen.getByTestId('thread-column')).getByTestId('room-header')).toBeDefined();
  // Filling the page, the column offers the way back beside the messages, not Full.
  expect(screen.queryByRole('button', { name: 'Full' })).toBeNull();
  expect(getDefaultStore().get(conversationHiddenAtom)).toBe(true);
  // The room's messages go from under it, and come back beside it.
  expect(screen.queryByTestId('messages')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Beside' }));
  expect(screen.getByTestId('messages').closest('[aria-hidden="true"]')).toBeNull();
  expect(within(screen.getByTestId('thread-column')).queryByTestId('room-header')).toBeNull();
  expect(storedLayout()).toBe('"beside"');
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(getDefaultStore().get(conversationHiddenAtom)).toBe(false);

  // The next thread opens filling the page once full was chosen last.
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  state.thread = '$third';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('$third');
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
});

it("fills the page with the column when its edge is dragged past the messages' least width, and stores that", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  renderView();
  const handle = screen.getByRole('separator', { name: 'Resize the thread' });
  // The column opens 480 px wide and may grow to 640 px, leaving the messages 360 px.
  fireEvent.pointerDown(handle, { clientX: 520, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 340 });
  expect(screen.getByTestId('thread-column').dataset.expandPreview).toBeUndefined();
  fireEvent.pointerUp(handle, { clientX: 340 });
  expect(column()).not.toBeNull();
  expect(storedLayout()).toBe('"beside"');

  // A drag the browser cancels changes nothing.
  fireEvent.pointerDown(handle, { clientX: 340, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 100 });
  fireEvent.pointerCancel(handle, { clientX: 100 });
  expect(column()).not.toBeNull();

  fireEvent.pointerDown(handle, { clientX: 340, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 100 });
  expect(screen.getByTestId('thread-column').dataset.expandPreview).toBe('true');
  expect(handle.getAttribute('aria-valuenow')).toBe(handle.getAttribute('aria-valuemax'));
  expect(handle.getAttribute('aria-valuetext')).toBe('Show the thread in full');
  fireEvent.pointerUp(handle, { clientX: 100 });
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(column()?.dataset.thread).toBe('$thread');
  expect(storedLayout()).toBe('"full"');
});

it("returns the focus to the messages' composer when the column closes", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const { rerender } = renderView();
  screen.getByRole('button', { name: 'Back' }).focus();
  state.thread = undefined;
  rerenderView(rerender);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
});

it('leaves the focus alone on a phone as the thread closes, which would raise the keyboard', () => {
  const { rerender } = render(tree({}, ScreenSize.Mobile));
  state.thread = undefined;
  rerender(tree({}, ScreenSize.Mobile));
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeDefined();
  expect(document.activeElement).toBe(document.body);
});

it('counts the whole room as on screen for notifications while its messages show beside the thread', () => {
  const store = getDefaultStore();
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  expect(store.get(shownConversationViewsAtom)).toEqual([
    { view: 'room-messages', roomId: room.roomId },
  ]);
  act(() => screen.getByRole('button', { name: 'Full' }).click());
  expect(store.get(shownConversationViewsAtom)).toEqual([]);
});

it('counts nothing more on screen while a side panel takes the place of the messages and the thread', () => {
  getDefaultStore().set(conversationBehindPanelAtom, true);
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  expect(column()?.dataset.hidden).toBe('true');
  expect(getDefaultStore().get(shownConversationViewsAtom)).toEqual([]);
});

it('keeps the history downloads of the thread in its column, and asks for none of an unsent root', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  state.thread = '$confirmed';
  const { rerender } = renderView();
  expect(new Set(state.focused)).toEqual(new Set(['$confirmed']));
  state.thread = '~!room:example.org:m1.1';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('~!room:example.org:m1.1');
  expect(state.focused.at(-1)).toBeUndefined();
  // The unsent root's Retry and Delete are the thread view's (ThreadView.test.tsx).
  expect(screen.queryByText('Root not sent')).toBeNull();
});

it.each([
  ['on a phone', ScreenSize.Mobile, 0],
  ['on a page narrower than two conversations', ScreenSize.Desktop, 719],
])('fills the page with every thread %s, with no way beside the messages', (_, size, width) => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  renderView({}, size);
  expect(column()?.dataset.thread).toBe('$thread');
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  // The room's header, with its Back, is the column's.
  expect(within(screen.getByTestId('thread-column')).getByTestId('room-header')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
});

it('shows a thread that is not found as such, with the way back, instead of its view', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  state.threadNotFound = true;
  const back = vi.fn();
  state.rootDeleted = back;
  renderView();
  expect(column()).toBeNull();
  const notice = within(screen.getByTestId('thread-column'));
  expect(notice.getByRole('heading', { name: 'Thread not found' })).toBeDefined();
  fireEvent.click(notice.getByRole('button', { name: 'Back' }));
  expect(back).toHaveBeenCalledOnce();
});

it("keeps the room's header over a thread that is not found as the column fills the page", () => {
  state.threadNotFound = true;
  renderView({}, ScreenSize.Mobile);
  const filled = within(screen.getByTestId('thread-column'));
  expect(filled.getByTestId('room-header')).toBeDefined();
  expect(filled.getByRole('heading', { name: 'Thread not found' })).toBeDefined();
});

it('passes a thread that does not load to the page', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const onLoadError = vi.fn();
  const ownLoadError = vi.fn();
  state.threadLoadError = ownLoadError;
  renderView({ onThreadLoadError: onLoadError });
  state.columnLoadError?.('$thread');
  expect(onLoadError).toHaveBeenCalledWith('$thread');
  expect(ownLoadError).toHaveBeenCalledWith('$thread');
});

it.each([
  ['to', []],
  ['after the text in', [{ type: 'paragraph', children: [{ text: 'room text' }] }]],
])(
  "moves a reply's text %s the room's composer when the column's unsent root is deleted",
  (_, roomText) => {
    const store = getDefaultStore();
    localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
    const local = '~!room:example.org:m2.1';
    const threadDraft = draftAtom(local);
    const roomDraft = draftAtom();
    const reply = { type: 'paragraph', children: [{ text: 'my reply' }] };
    store.set(roomDraft, roomText as never);
    store.set(threadDraft, [reply] as never);
    const root = new MatrixEvent({ event_id: local, type: 'm.room.message', content: {} });
    vi.spyOn(room, 'findEventById').mockReturnValue(root);
    state.thread = local;
    state.rootDeleted = vi.fn();
    const { rerender } = renderView();

    root.status = EventStatus.CANCELLED;
    act(() => {
      room.emit(RoomEvent.LocalEchoUpdated, root, room, local);
    });
    expect(state.rootDeleted).toHaveBeenCalledOnce();
    state.thread = undefined;
    rerenderView(rerender);
    expect(store.get(roomDraft)).toEqual([...roomText, reply]);
    expect(store.get(threadDraft)).toEqual([]);
    store.set(roomDraft, []);
  }
);

it("keeps another thread's text where it is as the column closes", () => {
  const store = getDefaultStore();
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const threadDraft = draftAtom('$thread');
  const text = [{ type: 'paragraph', children: [{ text: 'later' }] }] as never;
  store.set(threadDraft, text);
  const { rerender } = renderView();
  state.thread = undefined;
  rerenderView(rerender);
  expect(store.get(threadDraft)).toEqual(text);
  store.set(threadDraft, []);
});

it("keeps the thread's view, and so its composer, as the column changes width", () => {
  const store = getDefaultStore();
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Beside' }));
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  fireEvent.click(screen.getByRole('button', { name: 'Beside' }));
  expect(state.viewMounts).toBe(1);
  // The room's conversation unmounted and mounted again; the plugin cover stayed.
  expect(screen.getByTestId('messages')).toBeDefined();
  expect(state.coverMounts).toBe(1);
  expect(store.get(conversationHiddenAtom)).toBe(false);
});
it('fills the page with the column while the page is too narrow for it beside the messages', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
  const resize = (next: number) => {
    width.mockReturnValue(next);
    act(() => state.resized.forEach((resized) => resized()));
  };
  renderView();
  // Opened on a narrow page, it fills the page, with no way beside the messages.
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
  expect(slotInColumn()).toBe(true);
  // Widened, it goes beside them, as the person chose.
  resize(1000);
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(slotInColumn()).toBe(false);
  resize(600);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  // No width, as behind a side panel that fills the room, keeps the last answer.
  resize(0);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  resize(1000);
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(storedLayout()).toBe('"beside"');
  expect(state.viewMounts).toBe(1);
});
it("keeps the thread's view as its unsent root gets its own ID", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(room, 'getEventForTxnId').mockImplementation((txnId) =>
    txnId === 'm3.1' ? new MatrixEvent({ event_id: '$confirmed' }) : undefined
  );
  state.thread = '~!room:example.org:m3.1';
  const { rerender } = renderView();
  expect(column()?.dataset.thread).toBe('~!room:example.org:m3.1');
  state.thread = '$confirmed';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('$confirmed');
  expect(state.viewMounts).toBe(1);
});
it("fills the page with a thread when the room's row is wide but the page beside a side panel is not", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  // The row, the render container's child, is wide; the page inside it is narrow.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function width(
    this: Element
  ) {
    return this.parentElement?.parentElement === document.body ? 1000 : 600;
  });
  renderView();
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
});
it("hands the room composer's focus to the thread that a send opens, filling the page", () => {
  state.thread = undefined;
  const { rerender } = renderView();
  // A letter typed with nothing focused takes the focus to the room's composer.
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  act(() => {
    state.roomMessageSent?.('$sent');
  });
  rerenderView(rerender);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  // A thread opened another way, filling the page, leaves the focus alone.
  state.thread = '$other';
  rerenderView(rerender);
  expect(state.openFocus).toEqual([
    ['$sent', true],
    ['$other', false],
  ]);
});

it('gives the letters typed with nothing focused to the column that fills the page', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  (document.activeElement as HTMLElement).blur();

  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(screen.getByLabelText('Reply'));
});

it("gives a file dropped on the thread column's header, beside the messages or filling the page, to the thread's composer", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  const inColumn = () => within(screen.getByTestId('thread-column'));
  const drop = (target: HTMLElement) => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['dropped'], 'notes.txt')] },
    });
    fireEvent(target, event);
    expect(event.defaultPrevented).toBe(true);
  };
  // Beside the messages, the room's header takes it for their composer, the thread's banner for
  // the thread's.
  drop(screen.getByTestId('room-header'));
  drop(inColumn().getByRole('button', { name: 'Full' }));
  expect(state.dropped).toEqual(['room', '$thread']);

  // Filling the page, the room's header in the column and the thread's view take it for the thread.
  fireEvent.click(inColumn().getByRole('button', { name: 'Full' }));
  drop(inColumn().getByTestId('room-header'));
  drop(inColumn().getByTestId('thread-view'));
  expect(state.dropped).toEqual(['room', '$thread', '$thread', '$thread']);
});

it('leaves typed letters alone in a column that fills the page without a composer', () => {
  state.canMessage = false;
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(document.body);
});

it('marks the thread read on Escape in its column, in a menu it opened and on its edge', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  const escape = (target: Element) => fireEvent.keyDown(target, { key: 'Escape' });
  escape(screen.getByLabelText('Reply'));
  escape(screen.getByRole('button', { name: 'Column menu item' }));
  escape(screen.getByRole('separator', { name: 'Resize the thread' }));
  expect(state.read).toEqual(['$thread', '$thread', '$thread']);
  // Beside the column, the room's messages are read.
  escape(screen.getByRole('textbox', { name: 'Message' }));
  expect(state.read).toEqual(['$thread', '$thread', '$thread', 'messages']);
});
