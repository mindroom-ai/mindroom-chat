// @vitest-environment jsdom
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
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
  conversationUnderThreadAtom,
} from '../navigation/conversationCover';
import {
  SWIPE_THREAD_STAGE,
  SWIPE_UNDER_THREAD,
  type LiveThreadBackUnder,
} from '../navigation/phonePageSlide';
import { shownConversationViewsAtom } from '../navigation/conversationView';
import type { RoomTimelineProps } from '../timeline/RoomTimeline';
import type { ThreadContextBannerProps } from '../threads/ThreadContextBanner';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../composer/roomInputDrafts';
import { liveCaptureAtom } from '../composer/capture/liveCapture';
import type { VoiceCaptureSession } from '../composer/voice/voiceCaptureSession';
import { PanelRow } from '../members/PanelRow';
import type { RoomInputProps } from '../composer/RoomInput';
import type { RoomHeaderSlotComponent } from '../plugins/registry';
import { runShortcut } from '../shortcuts/useShortcut';
import { RoomView, type RoomViewProps } from './RoomView';
import type { ThreadView } from './ThreadView';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import type { LiveRoomPeekFocus } from './useRoomViewThreadState';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const LAYOUT_KEY = 'mindroom.threadColumn.layout';

const state = vi.hoisted(() => ({
  thread: undefined as string | undefined,
  main: undefined as RoomTimelineProps | undefined,
  focused: [] as (string | undefined)[],
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  approvalThread: 'unset' as string | undefined,
  columnLoadError: undefined as ((threadId: string) => void) | undefined,
  rootDeleted: () => undefined,
  threadNotFound: false,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
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
  // The threads of the Compact cards the room's messages show while no thread is open.
  cards: undefined as string[] | undefined,
  enterLiveRoomPeek: undefined as
    ((peekFocus?: LiveRoomPeekFocus) => LiveThreadBackUnder | null) | undefined,
  timelineMounts: 0,
  headerProps: [] as Array<{ passive?: boolean; openThreadId?: string; threadId?: string }>,
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
const toggleForMe = vi.fn();
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: (opts: {
    enterLiveRoomPeek?: (peekFocus?: LiveRoomPeekFocus) => LiveThreadBackUnder | null;
  }) => {
    state.enterLiveRoomPeek = opts.enterLiveRoomPeek;
    return {
      viewMode: 'compact',
      handleToggleForMe: toggleForMe,
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
    };
  },
}));
vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: (props: { passive?: boolean; openThreadId?: string; threadId?: string }) => {
    state.headerProps.push({
      passive: props.passive,
      openThreadId: props.openThreadId,
      threadId: props.threadId,
    });
    return (
      <div
        data-testid="room-header"
        data-passive={props.passive ? 'true' : 'false'}
        data-open-thread-id={props.openThreadId ?? ''}
        data-thread-id={props.threadId ?? ''}
      />
    );
  },
}));
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
vi.mock('../timeline/RoomTimeline', async () => {
  const { useLayoutEffect, useState } = await import('react');
  const { compactCardNavigation, compactCardsIn, focusCompactCard } =
    await import('../threads/overview/compactCardKeys');
  // A Compact list shows its cards a pass after it mounts, in the same task (RoomTimeline).
  function Cards({ ids }: { ids: string[] }) {
    const [shown, setShown] = useState(false);
    useLayoutEffect(() => setShown(true), []);
    if (!shown) return null;
    // As the list does, it tells the keys its order and how to focus one of its cards.
    const register = (view: HTMLElement | null) => {
      const focus = (id?: string) =>
        focusCompactCard(compactCardsIn(view).find((card) => card.dataset.threadRootId === id));
      if (view) compactCardNavigation.set(view, { ids, focus });
    };
    return (
      <div ref={register} data-compact-room-view="true">
        {ids.map((id) => (
          <button key={id} type="button" data-thread-root-id={id} aria-label={`Card ${id}`} />
        ))}
      </div>
    );
  }
  return {
    RoomTimeline: (props: RoomTimelineProps) => {
      state.main = props;
      useLayoutEffect(() => {
        state.timelineMounts += 1;
      }, []);
      return (
        <div data-testid="messages">
          {props.threadHeader}
          {!state.thread && state.cards && <Cards ids={state.cards} />}
        </div>
      );
    },
  };
});
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
      forkAt,
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
          data-fork-at={forkAt}
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
  state.cards = undefined;
  state.enterLiveRoomPeek = undefined;
  state.timelineMounts = 0;
  state.headerProps = [];
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
it('passes the For me action from the room to its timeline', () => {
  state.thread = undefined;
  renderView();
  expect(state.main?.onToggleForMe).toBe(toggleForMe);
});

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
it("opens a fork draft in the thread's column at the fork point its address names", () => {
  // The fork point is the address's event too, which the thread's view loads around.
  renderView({ eventId: '$point', forkAt: '$point' });
  expect(column()?.dataset).toMatchObject({ thread: '$thread', event: '$point', forkAt: '$point' });
  const draftBanner = document.querySelector('[data-fork-draft-banner="true"]');
  expect(draftBanner).not.toBeNull();
  expect(draftBanner?.hasAttribute('data-cross-room-fork-banner')).toBe(false);
  expect(screen.getByRole('button', { name: 'Show the thread beside the messages' })).toBeDefined();
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
  // It stays at its widest, beside the messages, until the release fills the page.
  expect(screen.getByTestId('thread-column').style.width).toBe('640px');
  fireEvent.pointerUp(handle, { clientX: 100 });
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(column()?.dataset.thread).toBe('$thread');
  expect(storedLayout()).toBe('"full"');
});

it('keeps the stored layout as the edge is dragged past the expansion while a second thread shows', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  const { rerender } = renderView({ besideWhileSecond: true });
  const handle = screen.getByRole('separator', { name: 'Resize the thread' });
  fireEvent.pointerDown(handle, { clientX: 520, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 100 });
  expect(screen.getByTestId('thread-column').dataset.expandPreview).toBeUndefined();
  expect(handle.getAttribute('aria-valuetext')).not.toBe('Show the thread in full');
  fireEvent.pointerUp(handle, { clientX: 100 });
  expect(storedLayout()).toBe('"beside"');
  // The second thread closed, the thread stays beside the messages.
  rerenderView(rerender);
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
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
  // The room's header is the column's.
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
  const backButton = notice.getByRole('button', { name: 'Back' });
  backButton.focus();
  expect(runShortcut('focusComposer', new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
  expect(document.activeElement).toBe(backButton);
  fireEvent.click(backButton);
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
it('shows the messages beside the thread while a second thread shows, without storing that', () => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  // The stored layout is full; with the second thread showing on a roomy page the column goes
  // beside the messages, with no way to fill the page or to go beside them.
  const { rerender } = renderView({ besideWhileSecond: true });
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(screen.getByTestId('messages').closest('[aria-hidden="true"]')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Full' })).toBeNull();
  // The second thread closed, the stored layout holds again.
  rerenderView(rerender);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByTestId('messages')).toBeNull();
  expect(storedLayout()).toBeNull();
  expect(state.viewMounts).toBe(1);
});
it('holds no layout for a voice message being recorded as the second thread closes', () => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  const store = getDefaultStore();
  const { rerender } = renderView({ besideWhileSecond: true });
  // The account's recording belongs to no composer: the thread's own shows it once the
  // messages, and their composer, go.
  act(() => store.set(liveCaptureAtom, { kind: 'voice', session: {} as VoiceCaptureSession }));
  rerenderView(rerender);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByTestId('messages')).toBeNull();
  expect(storedLayout()).toBeNull();
  act(() => store.set(liveCaptureAtom, undefined));
});
it('fills the page with the column while a second thread shows on a page too narrow for both', () => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
  renderView({ besideWhileSecond: true });
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
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

it('sends typing, paste, and Escape inside the beside thread column to Reply, while body still focuses Message', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  const back = screen.getByRole('button', { name: 'Back' });
  const reply = screen.getByLabelText('Reply');

  back.focus();
  fireEvent.keyDown(back, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(reply);

  back.focus();
  fireEvent.keyDown(back, { key: 'v', code: 'KeyV', metaKey: true });
  expect(document.activeElement).toBe(reply);

  back.focus();
  expect(runShortcut('focusComposer', new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  expect(document.activeElement).toBe(reply);

  const separator = screen.getByRole('separator', { name: 'Resize the thread' });
  separator.focus();
  fireEvent.keyDown(separator, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(reply);

  separator.focus();
  const separatorEscape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  fireEvent(separator, separatorEscape);
  expect(runShortcut('focusComposer', separatorEscape)).toBe(true);
  expect(document.activeElement).toBe(reply);

  const bodyCases: Array<() => void> = [
    () => fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' }),
    () => fireEvent.keyDown(document.body, { key: 'v', code: 'KeyV', metaKey: true }),
    () =>
      expect(runShortcut('focusComposer', new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(
        true
      ),
  ];
  for (const trigger of bodyCases) {
    cleanup();
    renderView();
    trigger();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  }
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

// A control outside the room that takes the focus as the thread closes, after the room's effects.
function Elsewhere() {
  const control = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!state.thread) control.current?.focus();
  });
  return (
    <button ref={control} type="button">
      Elsewhere
    </button>
  );
}
/**
 * Alt and the left arrow in a thread that fills the page, over a Compact room: the labels of
 * what took the focus from then on, in order.
 */
const leaveThreadByKey = async ({
  elsewhere = false,
  cards = ['$other', '$thread'],
  screenSize = ScreenSize.Desktop,
} = {}) => {
  state.cards = cards;
  const page = () => (
    <>
      {tree({}, screenSize)}
      {elsewhere && <Elsewhere />}
    </>
  );
  const { rerender } = render(page());
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('button', { name: 'Card $thread' })).toBeNull();
  screen.getByLabelText('Reply').focus();
  const focused: (string | null)[] = [];
  const onFocus = (event: FocusEvent) =>
    focused.push((event.target as Element).getAttribute('aria-label'));
  document.addEventListener('focusin', onFocus);
  try {
    expect(runShortcut('leaveThread', new KeyboardEvent('keydown'))).toBe(true);
    state.thread = undefined;
    rerender(page());
    await act(async () => {});
  } finally {
    document.removeEventListener('focusin', onFocus);
  }
  return focused;
};

it("moves the focus the keys took out of a thread that filled the page to that thread's card alone", async () => {
  // Not by way of the room's composer: the focus moves once, as people who hear it move expect.
  expect(await leaveThreadByKey()).toEqual(['Card $thread']);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Card $thread' }));
});

it("moves the focus the keys took out of a thread to that thread's card in a room without a composer", async () => {
  state.canMessage = false;
  expect(await leaveThreadByKey()).toEqual(['Card $thread']);
});

it("gives the focus the keys took out of a thread to the composer where that thread's card does not show", async () => {
  expect(await leaveThreadByKey({ cards: ['$other'] })).toEqual(['Message']);
  expect(screen.getByRole('button', { name: 'Card $other' })).toBeDefined();
});

it('leaves the focus the keys took out of a thread alone on a phone without its card', async () => {
  const phone = { cards: ['$other'], screenSize: ScreenSize.Mobile };
  expect(await leaveThreadByKey(phone)).toEqual([]);
  expect(document.activeElement).toBe(document.body);
});

it('leaves the focus on a control that took it as the keys closed the thread', async () => {
  // With the thread's card there, and without it, where the composer would have had the focus.
  expect(await leaveThreadByKey({ elsewhere: true })).toEqual([null]);
  expect(screen.getByRole('button', { name: 'Card $thread' })).toBeDefined();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  cleanup();

  state.thread = '$thread';
  expect(await leaveThreadByKey({ elsewhere: true, cards: ['$other'] })).toEqual([null]);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
});

it('live room peek uncollapses inert ConversationLayout with passive header, single header slot, and preserves scroll memory on cancel', () => {
  state.thread = undefined;
  const { rerender } = render(tree({}, ScreenSize.Mobile));
  // Capture refs on the live room, seed scroll memory, then open a filling thread.
  const returnPlace = { roomId: room.roomId, eventId: '$saved-row', offset: 42 };
  const compactScroll = { scrollTop: 310, anchors: [] };
  state.main!.threadReturnPlaceRef!.current = returnPlace;
  state.main!.compactRoomScrollStateRef!.current.set(room.roomId, compactScroll);

  state.thread = '$thread';
  rerender(tree({}, ScreenSize.Mobile));
  expect(screen.queryByTestId('messages')).toBeNull();
  expect(screen.getAllByTestId('header-slot')).toHaveLength(1);
  expect(getDefaultStore().get(conversationUnderThreadAtom)).toBe(true);

  let live: LiveThreadBackUnder | null = null;
  act(() => {
    live = state.enterLiveRoomPeek?.() ?? null;
  });
  expect(live).not.toBeNull();
  expect(live!.stage.hasAttribute(SWIPE_THREAD_STAGE)).toBe(true);
  expect(live!.under.hasAttribute(SWIPE_UNDER_THREAD)).toBe(true);
  expect(live!.under.inert).toBe(true);
  expect(live!.under.getAttribute('aria-hidden')).toBe('true');
  expect(live!.over).toBe(screen.getByTestId('thread-column'));
  expect(getDefaultStore().get(conversationUnderThreadAtom)).toBe(true);
  expect(screen.getByTestId('messages')).toBeDefined();
  expect(screen.getAllByTestId('header-slot')).toHaveLength(1);
  const passiveHeaders = screen
    .getAllByTestId('room-header')
    .filter((el) => el.dataset.passive === 'true');
  expect(passiveHeaders).toHaveLength(1);
  expect(passiveHeaders[0]?.dataset.openThreadId).toBe('');

  // Simulate timeline mount/unmount overwriting scroll refs during peek.
  state.main!.threadReturnPlaceRef!.current = undefined;
  state.main!.compactRoomScrollStateRef!.current.set(room.roomId, { scrollTop: 0, anchors: [] });

  act(() => {
    live!.exit(false);
  });
  expect(live!.stage.hasAttribute(SWIPE_THREAD_STAGE)).toBe(false);
  expect(live!.under.hasAttribute(SWIPE_UNDER_THREAD)).toBe(false);
  expect(screen.queryByTestId('messages')).toBeNull();
  expect(state.main!.threadReturnPlaceRef!.current).toEqual(returnPlace);
  expect(state.main!.compactRoomScrollStateRef!.current.get(room.roomId)).toEqual(compactScroll);
});

it('live room peek keeps ConversationLayout mounted continuously on commit and re-collapses on aborted commit', () => {
  const { rerender } = render(tree({}, ScreenSize.Mobile));
  expect(state.timelineMounts).toBe(0);

  let live: LiveThreadBackUnder | null = null;
  act(() => {
    live = state.enterLiveRoomPeek?.() ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.timelineMounts).toBe(1);
  expect(screen.getByTestId('messages')).toBeDefined();

  // Aborted commit (e.g. handoff timeout while still in thread) re-collapses cleanly.
  act(() => {
    live!.exit(true);
  });
  expect(screen.queryByTestId('messages')).toBeNull();

  // Start a second peek, then commit route back to room before handoff release.
  act(() => {
    live = state.enterLiveRoomPeek?.() ?? null;
  });
  expect(state.timelineMounts).toBe(2);
  state.thread = undefined;
  rerender(tree({}, ScreenSize.Mobile));
  act(() => {
    live!.exit(true);
  });
  // ConversationLayout stayed continuously mounted through commit (no remount).
  expect(live!.stage.hasAttribute(SWIPE_THREAD_STAGE)).toBe(false);
  expect(live!.under.hasAttribute(SWIPE_UNDER_THREAD)).toBe(false);
  expect(state.timelineMounts).toBe(2);
  expect(screen.getByTestId('messages')).toBeDefined();
  expect(live!.under.inert).toBe(false);
  expect(live!.under.hasAttribute('aria-hidden')).toBe(false);
  expect(screen.getAllByTestId('header-slot')).toHaveLength(1);
  expect(screen.getByTestId('room-header').dataset.passive).toBe('false');
});

it('live room peek forwards direct-exit and unsaved focused-entry targets while preserving saved scroll positions', () => {
  state.thread = undefined;
  const { rerender } = render(tree({}, ScreenSize.Mobile));
  const savedCompactScroll = { scrollTop: 240, anchors: [{ key: '$other', offset: 12 }] };
  state.main!.compactRoomScrollStateRef!.current.set(room.roomId, savedCompactScroll);

  state.thread = '$thread';
  rerender(
    tree(
      {
        eventId: '$reply',
        focusEventInRoom: false,
        entryKey: 'k-thread',
        entryPushed: true,
        entryReturned: true,
      },
      ScreenSize.Mobile
    )
  );

  // 1. Direct exit (!returnsToRoom): passes eventId as room focus target with cleared route flags.
  let live: LiveThreadBackUnder | null = null;
  act(() => {
    live = state.enterLiveRoomPeek?.({ eventId: '$thread' }) ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.main).toMatchObject({
    eventId: '$thread',
    focusEventInRoom: true,
    entryKey: undefined,
    entryPushed: false,
    entryReturned: false,
  });

  // Simulate CompactRoomView overwriting compactRoomScrollStateRef during peek, then cancel.
  state.main!.compactRoomScrollStateRef!.current.set(room.roomId, {
    scrollTop: 1,
    anchors: [{ key: '$thread', offset: 160 }],
  });
  act(() => {
    live!.exit(false);
  });
  expect(state.main!.compactRoomScrollStateRef!.current.get(room.roomId)).toEqual(
    savedCompactScroll
  );

  // 2. Focused room entry with saved compact scroll (onlyIfUnsaved): omits focus override.
  act(() => {
    live = state.enterLiveRoomPeek?.({ eventId: '$older', onlyIfUnsaved: true }) ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.main).toMatchObject({
    eventId: undefined,
    focusEventInRoom: false,
    entryKey: 'k-thread',
    entryPushed: true,
    entryReturned: true,
  });
  act(() => {
    live!.exit(false);
  });

  // 3. Focused room entry with saved Threaded return place for this room: omits focus override.
  state.main!.compactRoomScrollStateRef!.current.delete(room.roomId);
  state.main!.threadReturnPlaceRef!.current = {
    roomId: room.roomId,
    eventId: '$saved-row',
    offset: 18,
  };
  act(() => {
    live = state.enterLiveRoomPeek?.({ eventId: '$older', onlyIfUnsaved: true }) ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.main).toMatchObject({
    eventId: undefined,
    focusEventInRoom: false,
    entryKey: 'k-thread',
    entryPushed: true,
    entryReturned: true,
  });
  act(() => {
    live!.exit(false);
  });

  // 4. Focused room entry with no saved scroll (e.g. after reload): forwards room focus props.
  state.main!.threadReturnPlaceRef!.current = undefined;
  act(() => {
    live = state.enterLiveRoomPeek?.({ eventId: '$older', onlyIfUnsaved: true }) ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.main).toMatchObject({
    eventId: '$older',
    focusEventInRoom: true,
    entryKey: undefined,
    entryPushed: false,
    entryReturned: false,
  });
  state.main!.compactRoomScrollStateRef!.current.set(room.roomId, {
    scrollTop: 1,
    anchors: [{ key: '$older', offset: 160 }],
  });
  act(() => {
    live!.exit(false);
  });
  expect(state.main!.compactRoomScrollStateRef!.current.has(room.roomId)).toBe(false);

  // 5. Plain room history entry (undefined): omits focus override even without saved scroll.
  act(() => {
    live = state.enterLiveRoomPeek?.(undefined) ?? null;
  });
  expect(live).not.toBeNull();
  expect(state.main).toMatchObject({
    eventId: undefined,
    focusEventInRoom: false,
    entryKey: 'k-thread',
    entryPushed: true,
    entryReturned: true,
  });
  act(() => {
    live!.exit(false);
  });
});
