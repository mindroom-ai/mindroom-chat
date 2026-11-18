// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type MutableRefObject, useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { SecondThreadContext, type SecondThreadControl } from '../navigation/secondThread';
import { secondThreadStorageKey } from '../preferences/accountStorageKeys';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// The second thread (B) beside the one the room page shows (A): a side panel of the room, which
// the thread menu's Open beside opens through the page's SecondThreadContext.

const { mx, room, state } = vi.hoisted(() => {
  const members = [{ membership: 'join', userId: '@alice:example.org', name: 'Alice' }];
  return {
    state: {
      members,
      config: {} as ClientConfig,
      thread: undefined as string | undefined,
      view: undefined as RoomViewProps | undefined,
      second: undefined as SecondThreadControl | undefined,
      focusComposer: vi.fn(),
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
      on: () => undefined,
      removeListener: () => undefined,
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
      </div>
    );
  },
}));
vi.mock('./ThreadView', () => ({
  ThreadView: ({
    threadId,
    header,
    focusRef,
  }: {
    threadId: string;
    header: React.ReactNode;
    focusRef: MutableRefObject<(() => void) | undefined>;
  }) => {
    focusRef.current = state.focusComposer;
    return (
      <div data-thread-view={threadId}>
        {header}
        <p data-testid="b-timeline" tabIndex={-1}>
          beta
        </p>
        <div role="menu" tabIndex={-1} data-testid="b-menu" />
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
const renderRoom = async (thread?: string, size: ScreenSize = ScreenSize.Desktop) => {
  state.thread = thread;
  const { Room } = await import('./Room');
  const ui = () => (
    <ScreenSizeProvider value={size}>
      <Room />
    </ScreenSizeProvider>
  );
  const { rerender } = await act(async () => render(ui()));
  rerenderRoom = () => act(async () => rerender(ui()));
};
const openBeside = (rootId: string) => act(async () => state.second?.open(rootId));

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
  vi.unstubAllGlobals();
});

describe('the second thread beside the open one', () => {
  it('Open beside shows the thread in a second column', async () => {
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
    expect(state.second?.offers('$a')).toBe(false);
    expect(state.second?.offers('$b')).toBe(false);
    expect(state.second?.offers('$c')).toBe(true);
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

  it('phone: no context and no panel', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a', ScreenSize.Mobile);
    expect(state.second).toBeUndefined();
    expect(panel()).toBeNull();
  });

  it('a remembered B shows again with its room', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ '!r': '$b' }));
    await renderRoom('$a');
    expect(panel()?.querySelector('[data-thread-view="$b"]')).toBeTruthy();
  });
});
