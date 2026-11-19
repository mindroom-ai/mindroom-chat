// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type MutableRefObject, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDefaultStore } from 'jotai';
import { ThreadEvent } from 'matrix-js-sdk';
import { callPanelRoomAtom } from '../calls/callStore';
import { clearCallWindowStore, getCallWindowSettingsAtom } from '../calls/window/callWindowState';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import {
  SecondThreadContext,
  type SecondThreadControl,
  THREAD_DRAG_TYPE,
} from '../navigation/secondThread';
import { secondThreadStorageKey } from '../preferences/accountStorageKeys';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// The second thread (B) beside the one the room page shows (A): a side panel of the room, which
// the thread menu's Open in second column opens through the page's SecondThreadContext.

const { mx, room, state } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const members = [{ membership: 'join', userId: '@alice:example.org', name: 'Alice' }];
  return {
    state: {
      members,
      config: {} as ClientConfig,
      thread: undefined as string | undefined,
      view: undefined as RoomViewProps | undefined,
      second: undefined as SecondThreadControl | undefined,
      focusComposer: vi.fn(),
      listeners,
      /** What a header canvas still loading answers for: its last context. */
      canvasContext: '',
    },
    mx: {
      getSafeUserId: () => '@alice:example.org',
      isInitialSyncComplete: () => true,
      getSyncState: () => 'SYNCING',
      on: () => undefined,
      removeListener: () => undefined,
    },
    room: {
      roomId: '!r',
      getMember: (userId: string) => members.find((member) => member.userId === userId),
      getThread: () => undefined,
      findEventById: (eventId: string) =>
        ['$a', '$b', '$c'].includes(eventId)
          ? {
              getId: () => eventId,
              threadRootId: eventId,
              isSending: () => false,
              getUnsigned: () => ({}),
            }
          : undefined,
      on: (name: string, handler: (...args: unknown[]) => void) => {
        listeners.set(name, (listeners.get(name) ?? new Set()).add(handler));
      },
      removeListener: (name: string, handler: (...args: unknown[]) => void) => {
        listeners.get(name)?.delete(handler);
      },
    },
  };
});

vi.mock('react-router-dom', () => ({
  NavigationType: { Push: 'PUSH' },
  useNavigationType: () => 'POP',
  useLocation: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(state.thread ? { threadId: state.thread } : {})],
}));
function SecondThreadConsumer() {
  state.second = useContext(SecondThreadContext);
  return null;
}
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    return (
      <div data-testid="room-view" data-route-thread={props.threadId}>
        <SecondThreadConsumer />
        <button type="button">Elsewhere</button>
        {/* A's column: an inline edit of one of its messages above its composer. */}
        <div data-testid="thread-column">
          <div contentEditable role="textbox" tabIndex={0} data-editable-name="MessageEditor" />
          <div data-room-footer="true" data-footer-of="thread">
            <div
              contentEditable
              role="textbox"
              tabIndex={0}
              data-editable-name="RoomInput"
              data-testid="a-composer"
            />
          </div>
        </div>
      </div>
    );
  },
}));
vi.mock('./ThreadView', () => ({
  ThreadView: ({
    threadId,
    header,
    focusRef,
    autoFocus,
  }: {
    threadId: string;
    header: React.ReactNode;
    focusRef: MutableRefObject<(() => void) | undefined>;
    autoFocus?: boolean;
  }) => {
    focusRef.current = state.focusComposer;
    // As ThreadView, it reads autoFocus as it mounts.
    const [focusOnMount] = useState(!!autoFocus);
    const composer = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (focusOnMount) composer.current?.focus();
    }, [focusOnMount]);
    return (
      <div data-thread-view={threadId} data-auto-focus={String(focusOnMount)}>
        {header}
        <div
          ref={composer}
          contentEditable
          role="textbox"
          tabIndex={0}
          data-editable-name="RoomInput"
          data-testid="b-composer"
        />
        <p data-testid="b-timeline" tabIndex={-1}>
          beta
        </p>
        <div role="menu" tabIndex={-1} data-testid="b-menu" />
        {/* A popover of B's, such as its thread options, rendered outside B's nodes. */}
        {createPortal(<button type="button">Portal option</button>, document.body)}
      </div>
    );
  },
}));
vi.mock('../threads/ThreadContextBanner', () => ({
  ThreadContextBanner: ({ onClose }: { onClose?: () => void }) => (
    <button type="button" onClick={onClose}>
      Close thread
    </button>
  ),
}));
vi.mock('../timeline/RoomMessageAnnouncer', () => ({
  RoomMessageAnnouncer: ({ threadId }: { threadId?: string }) => (
    <div data-announcer={threadId ?? 'room'} />
  ),
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return { useMembersDrawer: () => useState(false) };
});
vi.mock('../computer/ComputerPanel', () => ({ ComputerPanel: () => null }));
vi.mock('../canvas/RoomCanvasPanel', () => ({ RoomCanvasPanel: () => null }));
vi.mock('../calls/CallPanel', () => ({ CallPanel: () => null }));
vi.mock('../calls/transcription/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => null }));
vi.mock('../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/canvasIndex')>()),
  useConversationCanvases: () => [],
  useComputerShown: () => false,
  useOpenCanvasById: (_client: unknown, _room: unknown, context: string) => {
    state.canvasContext = context;
    return () => undefined;
  },
}));
vi.mock('../matrix/hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({
  useClientConfig: () => state.config,
  useOptionalClientConfig: () => state.config,
}));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => [],
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));

importBeforeTests(() => import('./Room'));

const storageKey = secondThreadStorageKey('@alice:example.org');
const panel = () => screen.queryByTestId('second-thread-panel');

let rerenderRoom: (() => Promise<void>) | undefined;
let size = ScreenSize.Desktop;
const renderRoom = async (thread?: string, screenSize: ScreenSize = ScreenSize.Desktop) => {
  state.thread = thread;
  size = screenSize;
  const { Room } = await import('./Room');
  const ui = () => (
    <ScreenSizeProvider value={size}>
      <Room />
    </ScreenSizeProvider>
  );
  const { rerender } = await act(async () => render(ui()));
  rerenderRoom = () => act(async () => rerender(ui()));
};
const openBeside = (rootId: string) => act(async () => state.second?.open('!r', rootId));
const liveViews = () => document.querySelectorAll('[data-thread-view]').length;
const announcers = () =>
  [...document.querySelectorAll('[data-announcer]')].map((node) =>
    node.getAttribute('data-announcer')
  );

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  localStorage.clear();
  state.second = undefined;
  state.focusComposer.mockClear();
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(callPanelRoomAtom, undefined);
  clearCallWindowStore('@alice:example.org');
  vi.unstubAllGlobals();
});

describe('the second thread beside the open one', () => {
  it('Open in second column shows the thread in a second column', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    const view = panel()?.querySelector('[data-thread-view]');
    expect(view?.getAttribute('data-thread-view')).toBe('$b');
    expect(screen.getByTestId('room-view').getAttribute('data-route-thread')).toBe('$a');
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual({ '!r': '$b' });
  });

  it('offers neither the open thread nor the second one', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(state.second?.offers('!r', '$a')).toBe(false);
    expect(state.second?.offers('!r', '$b')).toBe(false);
    expect(state.second?.offers('!r', '$c')).toBe(true);
  });

  it("offers and opens nothing for another room's card", async () => {
    await renderRoom('$a');
    expect(state.second?.offers('!y', '$c')).toBe(false);
    await act(async () => state.second?.open('!y', '$c'));
    expect(panel()).toBeNull();
  });

  it("a header canvas still loading answers for B's place, which a new second thread changes", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    const withB = state.canvasContext;
    await openBeside('$c');
    expect(panel()?.querySelector('[data-thread-view="$c"]')).toBeTruthy();
    expect(state.canvasContext).not.toBe(withB);
  });

  it('opening the members list closes and forgets B', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(panel()).not.toBeNull();
    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(panel()).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual({});
  });

  it('B that becomes the page thread closes', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(panel()).not.toBeNull();
    state.thread = '$b';
    await rerenderRoom?.();
    expect(panel()).toBeNull();
  });

  it('Close removes B and forgets it', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    await act(async () => screen.getByRole('button', { name: 'Close thread' }).click());
    expect(panel()).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual({});
  });

  it('lays the open thread out beside the messages while B shows, and as stored once B goes', async () => {
    await renderRoom('$a');
    expect(state.view?.besideWhileSecond).toBe(false);
    await openBeside('$b');
    expect(state.view?.besideWhileSecond).toBe(true);
    await act(async () => screen.getByRole('button', { name: 'Close thread' }).click());
    expect(state.view?.besideWhileSecond).toBe(false);
  });

  it("a letter typed in B's column goes to B's composer", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    const timeline = screen.getByTestId('b-timeline');
    timeline.focus();
    fireEvent.keyDown(timeline, { code: 'KeyA', key: 'a' });
    expect(state.focusComposer).toHaveBeenCalledTimes(1);

    timeline.addEventListener('keydown', (evt) => evt.preventDefault(), { once: true });
    fireEvent.keyDown(timeline, { code: 'KeyA', key: 'a' });
    const menu = screen.getByTestId('b-menu');
    menu.focus();
    fireEvent.keyDown(menu, { code: 'KeyA', key: 'a' });
    expect(state.focusComposer).toHaveBeenCalledTimes(1);
  });

  it("a thread card dropped on the room's end edge opens in the second column", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    const dataTransfer = {
      types: [THREAD_DRAG_TYPE],
      getData: () => JSON.stringify({ roomId: '!r', rootId: '$c' }),
      dropEffect: 'none',
    };
    fireEvent.dragStart(document.body, { dataTransfer });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const zone = screen.getByTestId('second-thread-drop-zone');
    fireEvent.dragEnter(zone, { dataTransfer });
    await act(async () => fireEvent.drop(zone, { dataTransfer }));
    expect(panel()?.querySelector('[data-thread-view]')?.getAttribute('data-thread-view')).toBe(
      '$c'
    );
    expect(screen.queryByTestId('second-thread-drop-zone')).toBeNull();
  });

  it('phone: no context and no panel', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a', ScreenSize.Mobile);
    expect(state.second).toBeUndefined();
    expect(panel()).toBeNull();
    // Nothing there to drop a card on either.
    fireEvent.dragStart(document.body, { dataTransfer: { types: [THREAD_DRAG_TYPE] } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByTestId('second-thread-drop-zone')).toBeNull();
  });

  it('a remembered B shows again with its room', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a');
    expect(panel()?.querySelector('[data-thread-view="$b"]')).toBeTruthy();
  });
  it('a closing B keeps no live thread view while its panel moves out', async () => {
    // The exit motion never finishes, so the panel's shell stays on screen.
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    HTMLElement.prototype.animate = () =>
      ({
        playState: 'running',
        cancel: () => undefined,
        finished: new Promise(() => undefined),
      } as unknown as Animation);
    try {
      await renderRoom('$a');
      await openBeside('$b');
      expect(liveViews()).toBe(1);
      await act(async () => screen.getByRole('button', { name: 'Close thread' }).click());
      expect(panel()).not.toBeNull();
      expect(liveViews()).toBe(0);

      await openBeside('$b');
      expect(liveViews()).toBe(1);
      state.thread = '$b';
      await rerenderRoom?.();
      expect(liveViews()).toBe(0);
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });

  it("closing B with the focus in it focuses A's composer, not an inline edit", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    screen.getByTestId('b-composer').focus();
    await act(async () => screen.getByRole('button', { name: 'Close thread' }).click());
    expect(document.activeElement).toBe(screen.getByTestId('a-composer'));
  });

  it('B replaced by a call with the focus in its portaled popover hands the focus to A', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    screen.getByRole('button', { name: 'Portal option' }).focus();
    await act(async () => {
      getDefaultStore().set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
      getDefaultStore().set(callPanelRoomAtom, room.roomId);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('a-composer'));
  });

  it('B replaced by a call with the focus on its splitter hands the focus to A', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    screen.getByRole('separator', { name: 'Resize second thread' }).focus();
    await act(async () => {
      getDefaultStore().set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
      getDefaultStore().set(callPanelRoomAtom, room.roomId);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('a-composer'));
  });

  it('B replaced by a call hands the focus to A, unless it already moved elsewhere', async () => {
    const store = getDefaultStore();
    await renderRoom('$a');
    await openBeside('$b');
    screen.getByTestId('b-composer').focus();
    await act(async () => {
      store.set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
      store.set(callPanelRoomAtom, room.roomId);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('a-composer'));

    await act(async () => store.set(callPanelRoomAtom, undefined));
    await openBeside('$b');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    await act(async () => screen.getByRole('button', { name: 'Close thread' }).click());
    expect(document.activeElement).toBe(elsewhere);
  });

  it('a restored B that never had the focus leaves it on the page when a call replaces it', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a');
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      getDefaultStore().set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
      getDefaultStore().set(callPanelRoomAtom, room.roomId);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('a phone width and back does not take the focus from A again', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(document.activeElement).toBe(screen.getByTestId('b-composer'));
    screen.getByTestId('a-composer').focus();
    size = ScreenSize.Mobile;
    await rerenderRoom?.();
    size = ScreenSize.Desktop;
    await rerenderRoom?.();
    expect(panel()?.querySelector('[data-thread-view="$b"]')?.getAttribute('data-auto-focus')).toBe(
      'false'
    );
    expect(document.activeElement).toBe(screen.getByTestId('a-composer'));
  });

  it('only an explicit Open in second column takes the focus, not a restored B', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a');
    expect(panel()?.querySelector('[data-thread-view="$b"]')?.getAttribute('data-auto-focus')).toBe(
      'false'
    );
    await openBeside('$c');
    expect(panel()?.querySelector('[data-thread-view="$c"]')?.getAttribute('data-auto-focus')).toBe(
      'true'
    );
  });

  it('is a region named Second thread', async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(
      screen.getByRole('region', { name: 'Second thread' }).querySelector('[data-thread-view="$b"]')
    ).toBeTruthy();
  });

  it("announces B's replies once: on its own beside A, in the room's without A", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    expect(announcers()).toEqual(['$a', '$b']);
    cleanup();
    await renderRoom(undefined);
    expect(announcers()).toEqual(['room']);
  });

  it("initializes B's SDK thread model when it arrives after B opened", async () => {
    await renderRoom('$a');
    await openBeside('$b');
    const initialize = vi.fn(() => Promise.resolve());
    act(() => {
      state.listeners.get(ThreadEvent.New)?.forEach((handler) => handler({ id: '$b', initialize }));
    });
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
