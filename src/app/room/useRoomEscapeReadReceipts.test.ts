import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Provider, createStore } from 'jotai';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { conversationCoveredAtom } from '../navigation/conversationCover';

const {
  keyHotkeyMock,
  markMainTimelineAsReadMock,
  markRoomAndThreadsAsReadMock,
  markThreadAsReadMock,
  state,
} = vi.hoisted(
  () => ({
    keyHotkeyMock: vi.fn(),
    markMainTimelineAsReadMock: vi.fn(),
    markRoomAndThreadsAsReadMock: vi.fn(),
    markThreadAsReadMock: vi.fn(),
    state: {
      handler: undefined as ((evt: KeyboardEvent) => void) | undefined,
      mx: { userId: '@user:server' },
    },
  })
);

vi.mock('is-hotkey', () => ({
  isKeyHotkey: keyHotkeyMock,
}));

vi.mock('../lib/hooks/useKeyDown', () => ({
  useKeyDown: (_target: Window, handler: (evt: KeyboardEvent) => void) => {
    state.handler = handler;
  },
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => state.mx,
}));

vi.mock('../notifications/readReceipts', () => ({
  markMainTimelineAsRead: markMainTimelineAsReadMock,
  markRoomAndThreadsAsRead: markRoomAndThreadsAsReadMock,
  markThreadAsRead: markThreadAsReadMock,
}));

const Harness = ({
  conversationHidden = false,
  hideActivity = false,
  threadId,
}: {
  conversationHidden?: boolean;
  hideActivity?: boolean;
  threadId?: string;
}) => {
  useRoomEscapeReadReceipts({
    conversationHidden,
    hideActivity,
    roomId: '!room:server',
    threadId,
  });
  return null;
};

describe('useRoomEscapeReadReceipts', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    keyHotkeyMock.mockReset();
    markMainTimelineAsReadMock.mockReset();
    markRoomAndThreadsAsReadMock.mockReset();
    markThreadAsReadMock.mockReset();
    state.handler = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks nothing read while a panel covers the conversation', () => {
    keyHotkeyMock.mockReturnValue(true);
    create(React.createElement(Harness, { conversationHidden: true, threadId: '$thread' }));

    act(() => {
      state.handler?.({} as KeyboardEvent);
    });

    expect(markRoomAndThreadsAsReadMock).not.toHaveBeenCalled();
    expect(markThreadAsReadMock).not.toHaveBeenCalled();
  });

  it("marks nothing read while a phone's navigation drawer covers the conversation", () => {
    keyHotkeyMock.mockReturnValue(true);
    // Its own store: other cases' harnesses stay mounted on the default one.
    const store = createStore();
    store.set(phoneNavDrawerOpenAtom, true);
    const renderer = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(Harness, { threadId: '$thread' })
      )
    );
    act(() => {
      state.handler?.({} as KeyboardEvent);
    });
    expect(markThreadAsReadMock).not.toHaveBeenCalled();
    expect(markMainTimelineAsReadMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("marks nothing read while a plugin's cover hides the conversation", () => {
    keyHotkeyMock.mockReturnValue(true);
    // Its own store: other cases' harnesses stay mounted on the default one.
    const store = createStore();
    store.set(conversationCoveredAtom, true);
    const renderer = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(Harness, { threadId: '$thread' })
      )
    );
    act(() => {
      state.handler?.({} as KeyboardEvent);
    });
    expect(markThreadAsReadMock).not.toHaveBeenCalled();
    expect(markMainTimelineAsReadMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('marks only the main timeline read on Escape outside a thread, never the threads', () => {
    keyHotkeyMock.mockReturnValue(true);
    create(React.createElement(Harness));

    act(() => {
      state.handler?.({} as KeyboardEvent);
    });

    expect(markMainTimelineAsReadMock).toHaveBeenCalledWith(state.mx, '!room:server', false);
    expect(markRoomAndThreadsAsReadMock).not.toHaveBeenCalled();
    expect(markThreadAsReadMock).not.toHaveBeenCalled();
  });

  it('marks only the active thread read on Escape inside a thread', () => {
    keyHotkeyMock.mockReturnValue(true);
    create(React.createElement(Harness, { hideActivity: true, threadId: '$thread' }));

    act(() => {
      state.handler?.({} as KeyboardEvent);
    });

    expect(markThreadAsReadMock).toHaveBeenCalledWith(state.mx, '!room:server', '$thread', true);
    expect(markRoomAndThreadsAsReadMock).not.toHaveBeenCalled();
  });

  it('ignores non-Escape key events', () => {
    keyHotkeyMock.mockReturnValue(false);
    create(React.createElement(Harness));

    act(() => {
      state.handler?.({} as KeyboardEvent);
    });

    expect(markRoomAndThreadsAsReadMock).not.toHaveBeenCalled();
    expect(markThreadAsReadMock).not.toHaveBeenCalled();
  });
});
