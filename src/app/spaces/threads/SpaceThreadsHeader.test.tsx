// @vitest-environment jsdom
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { StateEvent } from '../../matrix/types/room';
import { SpaceThreadsHeader } from './SpaceThreadsHeader';

type FocusTrapOptions = {
  initialFocus?: (() => HTMLElement | false) | false;
  escapeDeactivates?: (event: KeyboardEvent) => boolean;
  onDeactivate?: () => void;
};

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({
    children,
    focusTrapOptions,
  }: {
    children: ReactNode;
    focusTrapOptions?: FocusTrapOptions;
  }) => {
    useEffect(() => {
      if (typeof focusTrapOptions?.initialFocus === 'function') {
        const target = focusTrapOptions.initialFocus();
        if (target instanceof HTMLElement) target.focus();
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && focusTrapOptions?.escapeDeactivates?.(event) !== false) {
          focusTrapOptions?.onDeactivate?.();
        }
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [focusTrapOptions]);
    return children;
  },
}));

const ME = '@me:example.org';
const SPACE_ID = '!space:example.org';
const SUB_ID = '!sub-platform:example.org';
const OTHER_SPACE_ID = '!space-design:example.org';

type Listener = (...args: unknown[]) => void;

const createEmitter = () => {
  const map = new Map<string, Set<Listener>>();
  const remove = vi.fn((event: string, fn: Listener) => {
    map.get(event)?.delete(fn);
  });
  return {
    on: vi.fn((event: string, fn: Listener) => {
      const set = map.get(event) ?? new Set<Listener>();
      set.add(fn);
      map.set(event, set);
    }),
    off: remove,
    removeListener: remove,
    emit: (event: string, ...args: unknown[]) => {
      map.get(event)?.forEach((fn) => fn(...args));
    },
  };
};

type FakeSpace = Room & {
  emit: (event: string, ...args: unknown[]) => void;
  setName: (next: string) => void;
};

const makeSpace = (roomId: string, initialName: string): FakeSpace => {
  const emitter = createEmitter();
  let name = initialName;
  const state = {
    getStateEvents: (type: string) =>
      type === (StateEvent.RoomCreate as string)
        ? { getContent: () => ({ type: 'm.space' }), getTs: () => 0 }
        : null,
  };
  return {
    roomId,
    get name() {
      return name;
    },
    isSpaceRoom: () => true,
    getType: () => 'm.space',
    getCanonicalAlias: () => null,
    getMxcAvatarUrl: () => null,
    getLiveTimeline: () => ({ getEvents: () => [], getState: () => state }),
    on: emitter.on,
    off: emitter.off,
    removeListener: emitter.removeListener,
    emit: emitter.emit,
    setName: (next: string) => {
      name = next;
    },
    client: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  } as unknown as FakeSpace;
};

const renderHeader = ({
  space,
  allSpaces,
  roomToParents = new Map<string, Set<string>>(),
  showSpaceSwitcher = true,
}: {
  space: FakeSpace;
  allSpaces: FakeSpace[];
  roomToParents?: Map<string, Set<string>>;
  showSpaceSwitcher?: boolean;
}) => {
  const roomMap = new Map(allSpaces.map((item) => [item.roomId, item]));
  const clientEmitter = createEmitter();
  const client = {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getHomeserverUrl: () => 'https://example.org',
    getRoom: (id: string) => roomMap.get(id) ?? null,
    getRooms: () => [...roomMap.values()],
    getAccountData: () => undefined,
    on: clientEmitter.on,
    off: clientEmitter.off,
    removeListener: clientEmitter.removeListener,
    mxcUrlToHttp: () => null,
  } as unknown as MatrixClient;

  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: allSpaces.map((item) => item.roomId) });
  store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents });

  function Harness() {
    const location = useLocation();
    return (
      <>
        <div data-testid="header-path">{location.pathname}</div>
        <SpaceThreadsHeader
          space={space}
          activeRoomCount={2}
          totalRoomCount={3}
          showSpaceSwitcher={showSpaceSwitcher}
        />
      </>
    );
  }

  return render(
    <Provider store={store}>
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <MatrixClientProvider value={client}>
          <MemoryRouter initialEntries={[`/${encodeURIComponent(space.roomId)}/threads`]}>
            <Harness />
          </MemoryRouter>
        </MatrixClientProvider>
      </ScreenSizeProvider>
    </Provider>
  );
};

afterEach(() => {
  cleanup();
});

describe('SpaceThreadsHeader', () => {
  it('hides the switcher when only one space exists or when showSpaceSwitcher is omitted', () => {
    const space = makeSpace(SPACE_ID, 'Product');
    const other = makeSpace(OTHER_SPACE_ID, 'Design Studio');

    const single = renderHeader({ space, allSpaces: [space], showSpaceSwitcher: true });
    expect(single.container.querySelector('[data-space-switcher-button]')).toBeNull();
    cleanup();

    const disabled = renderHeader({ space, allSpaces: [space, other], showSpaceSwitcher: false });
    expect(disabled.container.querySelector('[data-space-switcher-button]')).toBeNull();
  });

  it('supports initialFocus, arrow keys, Escape/same-space focus return, rename freshness, and navigation', () => {
    const space = makeSpace(SPACE_ID, 'Product');
    const subSpace = makeSpace(SUB_ID, 'Platform');
    const otherSpace = makeSpace(OTHER_SPACE_ID, 'Design Studio');

    const { container } = renderHeader({
      space,
      allSpaces: [space, subSpace, otherSpace],
      roomToParents: new Map([[SUB_ID, new Set([SPACE_ID])]]),
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-space-switcher-button="true"]'
    )!;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-label')).toBe('Product, Switch space');

    fireEvent.click(trigger);
    const menu = document.querySelector<HTMLElement>('[data-space-switcher-menu="true"]')!;
    const options = [...document.querySelectorAll<HTMLElement>('[data-space-switcher-option]')];
    expect(options.map((el) => el.getAttribute('data-space-switcher-option'))).toEqual([
      OTHER_SPACE_ID,
      SPACE_ID,
      SUB_ID,
    ]);
    expect(options[1]?.getAttribute('aria-checked')).toBe('true');
    expect(options[2]?.style.paddingInlineStart).toContain('16px');

    // initialFocus prefers the checked item even when it is not first in DOM order.
    expect(document.activeElement).toBe(options[1]);

    // ArrowDown / ArrowUp / Home / End move focus across menuitemradio options.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);

    // Escape closes the menu and restores focus to the trigger button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[data-space-switcher-menu]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Selecting the current space closes the menu and returns focus to the trigger button.
    fireEvent.click(trigger);
    fireEvent.click(document.querySelector(`[data-space-switcher-option="${SPACE_ID}"]`)!);
    expect(document.querySelector('[data-space-switcher-menu]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Renaming a space/subspace updates switcher options on reopen.
    act(() => {
      subSpace.setName('Core Platform');
      space.setName('Product HQ');
      space.emit(RoomEvent.Name, space);
    });
    expect(trigger.getAttribute('aria-label')).toBe('Product HQ, Switch space');
    fireEvent.click(trigger);
    const renamedSub = document.querySelector<HTMLElement>(
      `[data-space-switcher-option="${SUB_ID}"]`
    )!;
    expect(renamedSub.textContent).toContain('Core Platform');

    fireEvent.click(renamedSub);
    expect(screen.getByTestId('header-path').textContent).toBe(
      `/${encodeURIComponent(SUB_ID)}/threads`
    );
    expect(document.querySelector('[data-space-switcher-menu]')).toBeNull();
  });
});
