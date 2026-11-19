// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { useContext } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { IconButton, Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuEntry } from '../ui/MenuEntry';
import type { PhoneThreadHeader } from '../threads/ThreadContextBanner';
import { TightCallPlace } from '../calls/headerCallPlace';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import * as css from './RoomViewHeaderLayout.css';

// On a phone the thread that fills the page shows in the room header's rows: the header gives the
// thread's banner (`phoneThread`) the room's name, its row's buttons and its menu, and draws no
// name, row or menu button of its own. Wider screens, and a phone's room without a thread, keep the
// header they had.

const screen = vi.hoisted(() => ({ size: 'Desktop' }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
// The room menu renders in place of folds' portal while it has an anchor.
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
}));
// The room menu's own rows, which need the app's providers, stay out of it.
vi.mock('../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org', getRoom: () => null }),
}));
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    name: 'General',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
  }),
  useIsDirectRoom: () => false,
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false, stateEvent: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: 'classic',
    setViewMode: () => undefined,
    availableViewModes: ['classic'],
  }),
}));

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  screen.size = 'Desktop';
});

/** `row` stands in for the thread's row, which a test renderer has no element for. */
const renderHeader = (props: RoomViewHeaderProps, row?: object) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader {...props} />
      </Provider>,
      { createNodeMock: (element) => (element.props['data-thread-rows'] === '' ? row : null) }
    );
  });
};

/** The row's button named `label`. */
const rowButton = (label: string): ReactTestInstance | undefined =>
  renderer?.root.findAllByType(IconButton).find((node) => node.props['aria-label'] === label);
const menuEntries = (): string[] =>
  (renderer?.root.findAllByType(MenuEntry) ?? []).map((node) => String(node.props.label));
const heading = () => renderer?.root.findAllByType('h1') ?? [];

const BOARD = { id: 'notes/board', label: 'Board', icon: Icons.Star, placement: 'auto' } as const;
const PINNED = { id: 'notes/pinned', label: 'Notes', icon: Icons.Bulb, placement: 'row' } as const;
const calls = <button type="button" aria-label="Start call" />;

/** Renders the header of the open thread, and returns what it gave the thread's rows. */
const renderInThread = (size: string, props: RoomViewHeaderProps = {}, row?: object) => {
  screen.size = size;
  const given: PhoneThreadHeader[] = [];
  renderHeader(
    {
      threadId: '$thread',
      calls,
      pluginPanels: [BOARD, PINNED],
      onPanelToggle: vi.fn(),
      phoneThread: (parts) => {
        given.push(parts);
        return (
          <section data-thread-rows="" ref={parts.rowRef}>
            <i>{parts.roomName}</i>
            {parts.actions}
          </section>
        );
      },
      ...props,
    },
    row
  );
  return given.at(-1);
};

describe("a phone's room header with a thread filling the page", () => {
  it("is the thread's rows, given the room's name and the row's buttons, without a name or menu button of its own", () => {
    const parts = renderInThread('Mobile');
    expect(parts?.roomName).toBe('General');
    const rows = renderer?.root.findByProps({ 'data-thread-rows': '' });
    // The call buttons and a plugin panel placed in the row stay one tap away, in the thread's row.
    expect(rows?.findAllByProps({ 'aria-label': 'Start call' })).toHaveLength(1);
    expect(rows?.findAllByType(IconButton).map((node) => node.props['aria-label'])).toEqual([
      'Notes',
    ]);
    expect(rowButton('More Options')).toBeUndefined();
    expect(heading()).toHaveLength(0);
    // As tall as the rows need, not the header's one line.
    expect(renderer?.root.findByProps({ role: 'banner' }).props.className).toContain(
      css.ThreadHeader
    );
    expect(css.ThreadHeader).not.toBe(css.Header);
  });

  it("opens the room's menu where the thread's menu asks, with what the row leaves out", () => {
    const parts = renderInThread('Mobile');
    expect(menuEntries()).toEqual([]);
    act(() => parts?.onRoomMenu({ x: 340, y: 60, width: 32, height: 32 }));
    // The panel that is no button on a phone, and the room's own actions.
    expect(menuEntries()).toEqual(expect.arrayContaining(['Board', 'Show Members']));
    expect(menuEntries()).not.toContain('Notes');
  });

  it('moves what a row too narrow has no width for to the room menu, and keeps one call button', () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }

        observe = () => undefined;

        disconnect = () => undefined;
      }
    );
    // Says where the header drew the call controls.
    function Calls() {
      const tight = useContext(TightCallPlace);
      const place = tight?.closeMenu ? 'menu' : 'tight row';
      return <button type="button" aria-label={`calls: ${tight ? place : 'row'}`} />;
    }
    const drawn = () =>
      renderer?.root
        .findAll((node) => String(node.props['aria-label']).startsWith('calls: '), { deep: false })
        .map((node) => node.props['aria-label']);
    const rowPanels = () =>
      renderer?.root
        .findByProps({ 'data-thread-rows': '' })
        .findAllByType(IconButton)
        .map((node) => node.props['aria-label']);
    // 320 px at 150% zoom: the buttons need more than the row has, the name already gone.
    const row = { scrollWidth: 340, clientWidth: 213, lastElementChild: null };
    const parts = renderInThread('Mobile', { calls: <Calls /> }, row);
    expect(rowPanels()).toEqual([]);
    expect(drawn()).toEqual(['calls: tight row']);
    act(() => parts?.onRoomMenu({ x: 180, y: 60, width: 40, height: 40 }));
    expect(menuEntries()).toEqual(expect.arrayContaining(['Notes', 'Board', 'Show Members']));
    expect(drawn()).toEqual(['calls: tight row', 'calls: menu']);

    // Without the buttons that left, the row no longer overflows: they stay in the menu until
    // the row is as wide as all of them needed.
    row.scrollWidth = 213;
    act(() => resized.forEach((callback) => callback()));
    expect(rowPanels()).toEqual([]);
    row.clientWidth = 390;
    row.scrollWidth = 390;
    act(() => resized.forEach((callback) => callback()));
    expect(rowPanels()).toEqual(['Notes']);
    expect(drawn()).toContain('calls: row');
    expect(menuEntries()).not.toContain('Notes');
    vi.unstubAllGlobals();
  });

  it.each(['Tablet', 'Desktop'])(
    'keeps its own name, row and menu button on a %s screen',
    (size) => {
      expect(renderInThread(size)).toBeUndefined();
      expect(renderer?.root.findAllByProps({ 'data-thread-rows': '' })).toHaveLength(0);
      expect(heading()).toHaveLength(1);
      expect(rowButton('More Options')).toBeDefined();
      expect(renderer?.root.findByProps({ role: 'banner' }).props.className).toContain(css.Header);
    }
  );

  it('keeps its own name and menu button on a phone whose room has no thread open', () => {
    expect(renderInThread('Mobile', { threadId: undefined })).toBeUndefined();
    expect(heading()).toHaveLength(1);
    expect(rowButton('More Options')).toBeDefined();
    // Nor for a thread without rows to draw (a thread that is not found).
    expect(renderInThread('Mobile', { phoneThread: undefined })).toBeUndefined();
    expect(heading()).toHaveLength(1);
  });
});
