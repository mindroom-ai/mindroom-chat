// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createClient, EventStatus, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import type { Editor } from 'slate';
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
import {
  composerReplyDraftAtom,
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
  voiceRecorderRoomAtom,
} from '../composer/roomInputDrafts';
import { PanelRow } from '../members/PanelRow';
import { RoomView, type RoomViewProps } from './RoomView';
import type { ThreadView } from './ThreadView';

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
  resized: [] as (() => void)[],
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
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
    handleThreadRootDeleted: state.rootDeleted,
  }),
}));
vi.mock('./RoomViewHeader', () => ({ RoomViewHeader: () => <div data-testid="room-header" /> }));
vi.mock('./RoomHeaderSlot', () => ({ RoomHeaderSlot: () => null }));
vi.mock('./ConversationCover', () => ({ ConversationCover: () => null }));
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
  ThreadContextBanner: ({
    onShowBeside,
    showBesideBlocked,
    onShowFull,
    onRestore,
    onExitThread,
  }: ThreadContextBannerProps) => (
    <div>
      <button type="button" onClick={onExitThread}>
        Back
      </button>
      {onShowBeside && (
        <button type="button" onClick={onShowBeside} disabled={showBesideBlocked}>
          Beside
        </button>
      )}
      {onShowFull && (
        <button type="button" onClick={onShowFull}>
          Full
        </button>
      )}
      {onRestore && (
        <button type="button" onClick={onRestore}>
          Restore
        </button>
      )}
    </div>
  ),
}));
// The column's view, which reports its last thread as it unmounts.
vi.mock('./ThreadView', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    ThreadView: ({
      threadId,
      eventId,
      header,
      autoFocus,
      hidden,
      onThreadLoadError,
      onUnmount,
    }: ComponentProps<typeof ThreadView>) => {
      const last = useRef({ threadId, onUnmount });
      last.current = { threadId, onUnmount };
      useEffect(() => () => last.current.onUnmount?.(last.current.threadId), []);
      state.columnLoadError = onThreadLoadError;
      return (
        <div
          data-testid="thread-view"
          data-thread={threadId}
          data-event={eventId}
          data-autofocus={autoFocus}
          data-hidden={hidden}
        >
          {header}
          {/* A message edit open in its timeline comes before its composer. */}
          <div contentEditable suppressContentEditableWarning aria-label="Edit" />
          <div
            contentEditable
            suppressContentEditableWarning
            data-editable-name="RoomInput"
            aria-label="Reply"
          />
        </div>
      );
    },
  };
});
// The composer is its Slate text box.
vi.mock('../composer/RoomInput', () => ({
  RoomInput: ({ editor }: { editor: Editor }) => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
      <Editable aria-label="Message" />
    </Slate>
  ),
}));

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
  state.resized = [];
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

// In the room's row, which measures itself before the view mounts.
const tree = (props: Partial<RoomViewProps> = {}, screenSize = ScreenSize.Desktop) => (
  <ScreenSizeProvider value={screenSize}>
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

it("opens a thread in the messages' place on first use", () => {
  renderView();
  expect(state.main?.threadId).toBe('$thread');
  expect(state.approvalThread).toBe('$thread');
  expect(column()).toBeNull();
  // From there it can move beside them.
  expect(screen.getByRole('button', { name: 'Beside' })).toBeDefined();
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
  // The thread's approvals are the column's.
  expect(state.approvalThread).toBeUndefined();
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
  // the room's composer goes, as the composer turns inert.
  screen.getByRole('textbox', { name: 'Message' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  expect(document.activeElement).toBe(document.body);
  expect(storedLayout()).toBe('"full"');
  expect(column()?.dataset.thread).toBe('$next');
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('separator')).toBeNull();
  // It has the room's header, which the hidden room area holds too.
  expect(within(screen.getByTestId('thread-column')).getByTestId('room-header')).toBeDefined();
  // Filling the page, the column offers the way back, not Full or Show beside's menu entry.
  expect(screen.queryByRole('button', { name: 'Full' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
  expect(getDefaultStore().get(conversationHiddenAtom)).toBe(true);
  // The room's messages stay under it, out of reach.
  expect(screen.getByTestId('messages').closest('[aria-hidden="true"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(screen.getByTestId('messages').closest('[aria-hidden="true"]')).toBeNull();
  expect(within(screen.getByTestId('thread-column')).queryByTestId('room-header')).toBeNull();
  expect(storedLayout()).toBe('"beside"');
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(getDefaultStore().get(conversationHiddenAtom)).toBe(false);

  // The next thread opens in the messages' place once full was chosen last.
  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  state.thread = '$third';
  rerenderView(rerender);
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$third');
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

it("keeps the history downloads of the thread in its column, and its unsent root's notice", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(room, 'findEventById').mockReturnValue({ status: 'not_sent' } as never);
  state.thread = '$confirmed';
  const { rerender } = renderView();
  expect(new Set(state.focused)).toEqual(new Set(['$confirmed']));
  state.thread = '~!room:example.org:m1.1';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('~!room:example.org:m1.1');
  expect(screen.getByText('Root not sent')).toBeDefined();
});

it.each([
  ['on a phone', ScreenSize.Mobile, 0],
  ['on a page narrower than two conversations', ScreenSize.Desktop, 719],
])("keeps the thread in the messages' place %s, with no way beside them", (_, size, width) => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  renderView({}, size);
  expect(state.main?.threadId).toBe('$thread');
  expect(column()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Beside' })).toBeNull();
});

it("passes a thread that does not load to the page, as the thread in the messages' place does", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const onLoadError = vi.fn();
  renderView({ onThreadLoadError: onLoadError });
  expect(state.columnLoadError).toBe(onLoadError);
});

it("moves a reply's text to the room's composer when the column's unsent root is deleted", () => {
  const store = getDefaultStore();
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const local = '~!room:example.org:m2.1';
  const threadDraft = draftAtom(local);
  const roomDraft = draftAtom();
  const text = [{ type: 'paragraph', children: [{ text: 'my reply' }] }] as never;
  store.set(threadDraft, text);
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
  expect(store.get(roomDraft)).toEqual(text);
  expect(store.get(threadDraft)).toEqual([]);
  store.set(roomDraft, []);
});

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

it("lets a thread in the messages' place move beside them only with no reply or file in its composer", () => {
  const store = getDefaultStore();
  const file = new File(['x'], 'notes.txt');
  const item = {
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: { markedAsSpoiler: false },
  };
  renderView();
  const beside = () => screen.getByRole('button', { name: 'Beside' });
  act(() => store.set(composerUploadItemsAtom(room.roomId, undefined), { type: 'PUT', item }));
  expect(beside().hasAttribute('disabled')).toBe(true);
  act(() => store.set(composerUploadItemsAtom(room.roomId, undefined), { type: 'RESET' }));
  act(() =>
    store.set(composerReplyDraftAtom(room.roomId, undefined), {
      userId: '@bob:example.org',
      eventId: '$reply',
      body: 'Reply',
    })
  );
  expect(beside().hasAttribute('disabled')).toBe(true);
  act(() => store.set(composerReplyDraftAtom(room.roomId, undefined), undefined));
  // So does a voice recorder in this room's composer; another room's leaves it.
  act(() => store.set(voiceRecorderRoomAtom, room.roomId));
  expect(beside().hasAttribute('disabled')).toBe(true);
  act(() => store.set(voiceRecorderRoomAtom, '!other:example.org'));
  expect(beside().hasAttribute('disabled')).toBe(false);
  act(() => store.set(voiceRecorderRoomAtom, undefined));
  fireEvent.click(beside());
  expect(column()?.dataset.thread).toBe('$thread');
});

it('keeps an open thread where it opened as the page widens or narrows: a column fills the page instead', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(600);
  const resize = (next: number) => {
    width.mockReturnValue(next);
    act(() => state.resized.forEach((resized) => resized()));
  };
  const { rerender } = renderView();
  // Opened on a narrow page, it stays in the messages' place as the page widens.
  expect(column()).toBeNull();
  resize(1000);
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$thread');

  // The next thread opens beside; narrowed, its column fills the page, with no way back beside.
  state.thread = '$next';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('$next');
  resize(600);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  // No width, as behind a side panel that fills the room, keeps the last answer.
  resize(0);
  expect(screen.getByTestId('thread-column').dataset.filled).toBe('true');
  resize(1000);
  expect(screen.getByTestId('thread-column').dataset.filled).toBeUndefined();
  expect(storedLayout()).toBe('"beside"');
});

it('keeps the thread in its column as its unsent root gets its own ID, and only that thread', () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  vi.spyOn(room, 'getEventForTxnId').mockImplementation((txnId) =>
    txnId === 'm3.1' ? new MatrixEvent({ event_id: '$confirmed' }) : undefined
  );
  state.thread = '~!room:example.org:m3.1';
  const { rerender } = renderView();
  expect(column()?.dataset.thread).toBe('~!room:example.org:m3.1');
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('full'));
  state.thread = '$confirmed';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('$confirmed');

  // Another thread opened after an unsent root in the column opens as stored.
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  state.thread = undefined;
  rerenderView(rerender);
  state.thread = '~!room:example.org:m4.1';
  rerenderView(rerender);
  expect(column()?.dataset.thread).toBe('~!room:example.org:m4.1');
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('full'));
  state.thread = '$unrelated';
  rerenderView(rerender);
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$unrelated');
});

it("opens a thread in the messages' place when the room's row is wide but the page beside a side panel is not", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  // The row, the render container's child, is wide; the page inside it is narrow.
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function width(
    this: Element
  ) {
    return this.parentElement?.parentElement === document.body ? 1000 : 600;
  });
  renderView();
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$thread');
});

it("gives the column that fills the page the thread's background jobs and the letters typed with nothing focused", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  renderView();
  const jobs = () => screen.getAllByTestId('jobs').map((bar) => bar.dataset.thread);
  // Beside the messages, the room's bar lists every job, the thread's too.
  expect(jobs()).toEqual(['room']);
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  (document.activeElement as HTMLElement).blur();

  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  expect(jobs()).toEqual(['room', '$thread']);
  expect(within(screen.getByTestId('thread-column')).getByTestId('jobs').dataset.thread).toBe(
    '$thread'
  );
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' });
  expect(document.activeElement).toBe(screen.getByLabelText('Reply'));
});
