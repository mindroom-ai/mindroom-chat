// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Editable, Slate } from 'slate-react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { shownConversationViewsAtom } from '../navigation/conversationView';
import type { RoomTimelineProps } from '../timeline/RoomTimeline';
import type { ThreadContextBannerProps } from '../threads/ThreadContextBanner';
import { RoomView, type RoomViewProps } from './RoomView';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
const LAYOUT_KEY = 'mindroom.threadColumn.layout';

const state = vi.hoisted(() => ({
  thread: undefined as string | undefined,
  main: undefined as RoomTimelineProps | undefined,
  exit: () => undefined as void,
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({ noteRoomFocused: () => undefined, clearRoomFocus: () => undefined }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({
    viewMode: 'compact',
    effectiveThreadId: state.thread,
    handleExitThread: state.exit,
  }),
}));
vi.mock('./RoomViewHeader', () => ({ RoomViewHeader: () => null }));
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
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
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
vi.mock('./ThreadView', () => ({
  ThreadView: ({
    threadId,
    eventId,
    header,
    autoFocus,
  }: {
    threadId: string;
    eventId?: string;
    header?: ReactNode;
    autoFocus?: boolean;
  }) => (
    <div
      data-testid="thread-view"
      data-thread={threadId}
      data-event={eventId}
      data-autofocus={autoFocus}
    >
      {header}
    </div>
  ),
}));
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
  state.exit = () => undefined;
  localStorage.clear();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
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
});

const renderView = (props: Partial<RoomViewProps> = {}, screenSize = ScreenSize.Desktop) =>
  render(
    <ScreenSizeProvider value={screenSize}>
      <RoomView room={room} {...props} />
    </ScreenSizeProvider>
  );
const column = () => screen.queryByTestId('thread-view');
const storedLayout = () => localStorage.getItem(LAYOUT_KEY);

it("opens a thread in the messages' place on first use", () => {
  renderView();
  expect(state.main?.threadId).toBe('$thread');
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
  });
  expect(screen.getByRole('separator', { name: 'Resize the thread' })).toBeDefined();
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
  rerender(
    <ScreenSizeProvider value={ScreenSize.Desktop}>
      <RoomView room={room} />
    </ScreenSizeProvider>
  );
  expect(column()?.dataset.thread).toBe('$next');

  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  expect(storedLayout()).toBe('"full"');
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$next');
});

it("takes the thread to the messages' place when its edge is dragged past the messages' least width, and stores that", () => {
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

  fireEvent.pointerDown(handle, { clientX: 340, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 100 });
  expect(screen.getByTestId('thread-column').dataset.expandPreview).toBe('true');
  expect(handle.getAttribute('aria-valuetext')).toBe('Show the thread in full');
  fireEvent.pointerUp(handle, { clientX: 100 });
  expect(column()).toBeNull();
  expect(state.main?.threadId).toBe('$thread');
  expect(storedLayout()).toBe('"full"');
});

it("returns the focus to the messages' composer when the column closes", () => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify('beside'));
  const { rerender } = renderView();
  screen.getByRole('button', { name: 'Back' }).focus();
  state.thread = undefined;
  rerender(
    <ScreenSizeProvider value={ScreenSize.Desktop}>
      <RoomView room={room} />
    </ScreenSizeProvider>
  );
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
