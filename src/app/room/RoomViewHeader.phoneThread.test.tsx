// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { IconButton, Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuEntry } from '../ui/MenuEntry';
import type { PhoneThreadHeader } from '../threads/ThreadContextBanner';
import { HeaderCallButtons } from '../calls/HeaderCallButtons';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import * as css from './RoomViewHeaderLayout.css';

// On a phone the thread that fills the page shows in the room header's rows: the header gives the
// thread's banner (`phoneThread`) the room's name, its row's buttons and its menu, and draws no
// name, row or menu button of its own. Wider screens, and a phone's room without a thread, keep the
// header they had.

const screen = vi.hoisted(() => ({ size: 'Desktop' }));
// What the room offers for calls: its voice agents, and whether a call is on in it.
const offer = vi.hoisted(() => ({ agents: [] as { displayName: string }[], callOn: false }));

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

// The real rule for the call buttons (`HeaderCallButtons`), over stand-ins for the buttons.
vi.mock('../calls/callSupport', () => ({ useCallSupport: () => 'supported' }));
vi.mock('../calls/callStore', () => ({
  isActiveCallShownIn: () => false,
  useActiveCall: () => undefined,
  useRoomCallMembers: () => (offer.callOn ? [{}] : []),
}));
vi.mock('../calls/agent/useAgentCallOffer', () => ({ useAgentCallOffer: () => offer.agents }));
vi.mock('../calls/RoomCallButton', () => ({
  RoomCallButton: () => <button type="button" data-call="room" />,
}));
vi.mock('../calls/agent/AgentCallHeaderButton', async () => {
  const { MenuEntry: Entry } = await import('../ui/MenuEntry');
  const { Icons: icons } = await import('folds');
  return {
    AgentCallHeaderButton: (props: {
      candidates: { displayName: string }[];
      inMenu?: () => void;
    }) =>
      props.inMenu ? (
        props.candidates.map((agent) => (
          <Entry
            icon={icons.Phone}
            key={agent.displayName}
            label={`Call ${agent.displayName}`}
            onSelect={vi.fn()}
          />
        ))
      ) : (
        <button type="button" data-call="agent" />
      ),
  };
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  screen.size = 'Desktop';
  offer.agents = [];
  offer.callOn = false;
});

const renderHeader = (props: RoomViewHeaderProps) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader {...props} />
      </Provider>
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

/** What the header gave the thread's rows on its newest render. */
let latest: PhoneThreadHeader | undefined;

/** Renders the header of the open thread, and returns what it gave the thread's rows. */
const renderInThread = (size: string, props: RoomViewHeaderProps = {}) => {
  screen.size = size;
  const given: PhoneThreadHeader[] = [];
  renderHeader({
    threadId: '$thread',
    calls,
    pluginPanels: [BOARD, PINNED],
    onPanelToggle: vi.fn(),
    phoneThread: (parts) => {
      given.push(parts);
      latest = parts;
      return (
        <section data-thread-rows="">
          <i>{parts.roomName}</i>
          {parts.actions}
        </section>
      );
    },
    ...props,
  });
  return given.at(-1);
};

describe("a phone's room header with a thread filling the page", () => {
  it("is the thread's rows, given the room's name and the call button, without a name or menu button of its own", () => {
    const parts = renderInThread('Mobile');
    expect(parts?.roomName).toBe('General');
    const rows = renderer?.root.findByProps({ 'data-thread-rows': '' });
    // The call stays one tap away, in the thread's row, which holds no other entry of the room's.
    expect(rows?.findAllByProps({ 'aria-label': 'Start call' })).toHaveLength(1);
    expect(rows?.findAllByType(IconButton)).toHaveLength(0);
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
    // The plugins' panels, a toggle placed in the row among them, and the room's own actions.
    expect(menuEntries()).toEqual(expect.arrayContaining(['Notes', 'Board', 'Show Members']));
    // More, which opened it, is told that it is open, and that it has closed.
    expect(parts?.roomMenuOpen).toBe(false);
    expect(latest?.roomMenuOpen).toBe(true);
    const notes = renderer?.root
      .findAllByType(MenuEntry)
      .find((node) => node.props.label === 'Notes');
    act(() => {
      notes?.props.onSelect();
    });
    expect(menuEntries()).toEqual([]);
    expect(latest?.roomMenuOpen).toBe(false);
  });

  // What the header drew in its row, in order: the call buttons and the plugins' toggles.
  const inRow = (root: ReactTestInstance | undefined) =>
    root
      ?.findAll((node) => node.type === IconButton || !!node.props['data-call'], { deep: false })
      .map((node) => node.props['data-call'] ?? node.props['aria-label']);
  const threadRow = () => inRow(renderer?.root.findByProps({ 'data-thread-rows': '' }));
  const openRoomMenu = (parts: PhoneThreadHeader | undefined) =>
    act(() => parts?.onRoomMenu({ x: 280, y: 60, width: 40, height: 40 }));

  it("holds one call button, the room's, and gives the room menu each row toggle and the agents' calls", () => {
    offer.agents = [{ displayName: 'Code' }, { displayName: 'Notes' }];
    offer.callOn = true;
    // At any width: what the row shows does not follow a measurement.
    const parts = renderInThread('Mobile', { calls: <HeaderCallButtons /> });
    expect(threadRow()).toEqual(['room']);
    openRoomMenu(parts);
    expect(menuEntries()).toEqual(
      expect.arrayContaining(['Notes', 'Board', 'Call Code', 'Call Notes', 'Show Members'])
    );
    expect(threadRow()).toEqual(['room']);
  });

  it("holds the agent's call where it is the only one, and the room menu then has no call", () => {
    offer.agents = [{ displayName: 'Code' }];
    const parts = renderInThread('Mobile', { calls: <HeaderCallButtons /> });
    expect(threadRow()).toEqual(['agent']);
    openRoomMenu(parts);
    expect(menuEntries()).toContain('Notes');
    expect(menuEntries().filter((label) => label.startsWith('Call '))).toEqual([]);
  });

  it("keeps the row toggle and both calls in the row of a phone's room without a thread", () => {
    offer.agents = [{ displayName: 'Code' }];
    offer.callOn = true;
    renderInThread('Mobile', { calls: <HeaderCallButtons />, threadId: undefined });
    expect(inRow(renderer?.root)).toEqual(['room', 'agent', 'Notes', 'More Options']);
    act(() => {
      rowButton('More Options')?.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({}) },
      });
    });
    expect(menuEntries()).toContain('Board');
    expect(menuEntries()).not.toContain('Notes');
    expect(menuEntries().filter((label) => label.startsWith('Call '))).toEqual([]);
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
