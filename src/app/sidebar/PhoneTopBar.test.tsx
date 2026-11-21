import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../calls/callStore';
import type { CallState } from '../calls/RoomCall';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { PhoneTopBar } from './PhoneTopBar';

const unread = vi.hoisted(() => ({
  value: undefined as undefined | { total: number; highlight: number },
}));
const activity = vi.hoisted(() => ({ badge: { count: 0, needsYou: false } }));
const navigation = vi.hoisted(() => ({
  selected: undefined as string | undefined,
  search: '',
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
}));

vi.mock('../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => navigation.selected }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: navigation.search }) }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: (id: string) => (id === HOME ? { name: 'Studio' } : null) }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomName: (room: { name: string }) => room.name,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../lib/user-agent', () => ({ isMacOS: () => false, isIOS: () => false }));
vi.mock('../matrix/state/useUnread', () => ({ useRoomsUnread: () => unread.value }));
vi.mock('./rail/SettingsTab', () => ({
  SettingsTab: ({ inTopBar }: { inTopBar?: boolean }) =>
    React.createElement('button', { 'data-account': inTopBar }),
}));
vi.mock('../activity/useActivityRows', () => ({ useActivityBadge: () => activity.badge }));
vi.mock('../activity/ActivitySheet', () => ({
  ActivitySheet: () => React.createElement('section', { 'data-activity-sheet': true }),
}));
vi.mock('./rail/ActivityTab', () => ({
  ActivityBadge: ({ count }: { count: number }) => React.createElement('b', null, String(count)),
}));
vi.mock('./PhoneTopBar.css', () => ({
  PhoneTopBar: 'bar',
  PhoneChrome: 'chrome',
  ReturnToCallRow: 'call-row',
  ReturnToCallButton: 'call-button',
  MenuButtonFrame: 'menu',
  UnreadDot: 'dot',
  SearchField: 'search',
  BarControl: 'control',
  BellFrame: 'bell',
  BellBadge: 'bell-badge',
}));
vi.mock('../command-palette/CommandPaletteSearchField.css', () => ({
  SearchField: 'field',
  SearchPlaceholder: 'placeholder',
  ShortcutHint: 'shortcut-hint',
}));
vi.mock('folds', async () => {
  const reactModule = await import('react');
  const element =
    (tag: string) =>
    ({ as, children, ...rest }: { as?: string; children?: React.ReactNode }) =>
      reactModule.createElement(as ?? tag, rest, children);
  return {
    Badge: element('span'),
    Button: element('button'),
    Icon: element('i'),
    IconButton: element('button'),
    Icons: { Search: 'Search', Bell: 'Bell', Phone: 'Phone', MicMute: 'MicMute' },
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const renders: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renders.splice(0).forEach((renderer) => renderer.unmount()));
  navigation.selected = undefined;
  navigation.search = '';
  unread.value = undefined;
  activity.badge = { count: 0, needsYou: false };
  vi.clearAllMocks();
});

const renderBar = (store = createStore()) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <PhoneTopBar />
      </Provider>
    );
  });
  renders.push(renderer);
  // By its label, or by its text, as the search field is named.
  const buttons = (name: string) =>
    renderer.root.findAll(
      (node) =>
        node.type === 'button' &&
        (node.props['aria-label'] === name ||
          (!node.props['aria-label'] && textOf(node).startsWith(name)))
    );
  const button = (name: string) => {
    const matches = buttons(name);
    expect(matches).toHaveLength(1);
    return matches[0]!;
  };
  return { store, renderer, button, buttons };
};

describe('PhoneTopBar', () => {
  it('shows a search field that names the shortcut and opens the palette', () => {
    const { store, button } = renderBar();
    const search = button('Find anything');
    expect(textOf(search)).toContain('Ctrl + K');
    expect(search.findByType('kbd').props.dir).toBe('ltr');
    expect(search.props['aria-keyshortcuts']).toBe('Control+K');
    act(() => {
      search.props.onClick();
    });
    expect(store.get(commandPaletteOpenAtom)).toBe('all');
  });

  it('opens and closes the drawer with the menu button', () => {
    const { store, button } = renderBar();
    act(() => {
      button('Navigation').props.onClick();
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    const close = button('Navigation');
    expect(close.props['aria-expanded']).toBe(true);
    expect(close.props['aria-controls']).toBe('phone-nav-drawer');
    act(() => {
      close.props.onClick();
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
  });

  it('marks unread messages on the menu button, as a mention when one is', () => {
    unread.value = undefined;
    expect(
      renderBar().renderer.root.findAll(
        (node) => node.type === 'span' && 'data-highlight' in node.props
      )
    ).toHaveLength(0);
    // A room with unread messages but nothing that notifies still shows the dot.
    unread.value = { total: 0, highlight: 0 };
    expect(
      renderBar().renderer.root.findAll(
        (node) => node.type === 'span' && 'data-highlight' in node.props
      )
    ).toHaveLength(1);
    unread.value = { total: 3, highlight: 1 };
    const [dot] = renderBar().renderer.root.findAll(
      (node) => node.type === 'span' && 'data-highlight' in node.props
    );
    expect(dot?.props['data-highlight']).toBe(true);
  });

  it('opens Activity as a sheet from the bell, which counts the unread rows', () => {
    activity.badge = { count: 2, needsYou: false };
    const { renderer, button } = renderBar();
    const bell = button('Activity, 2 unread');
    expect(bell.props['aria-expanded']).toBe(false);
    expect(
      renderer.root.findAll((node) => node.props['data-activity-sheet'] === true)
    ).toHaveLength(0);
    act(() => {
      bell.props.onClick();
    });
    expect(
      renderer.root.findAll((node) => node.props['data-activity-sheet'] === true)
    ).toHaveLength(1);
    activity.badge = { count: 0, needsYou: false };
  });

  it('puts the account at the end of the bar', () => {
    const { renderer } = renderBar();
    expect(renderer.root.find((node) => node.props['data-account'] === true)).toBeTruthy();
  });
});

const HOME = '!studio:example.org';
const ELSEWHERE = '!workshop:example.org';
const RETURN = 'Return to the call in Studio';

const callStore = ({
  selected = ELSEWHERE,
  panel = HOME,
  phase = 'connected',
  agent = false,
  microphone = false,
  speaking = false,
}: {
  selected?: string;
  panel?: string | null;
  phase?: CallState['phase'];
  agent?: boolean;
  microphone?: boolean;
  speaking?: boolean;
} = {}) => {
  navigation.selected = selected;
  const state = { phase, microphone, participants: [{ speaking }] };
  const active = {
    kind: agent ? 'agent' : 'room',
    origin: agent ? { roomId: HOME, threadId: '$planning' } : undefined,
    call: {
      room: agent
        ? { roomId: '!agent:example.org', name: 'Agent Media Room' }
        : { roomId: HOME, name: 'Studio' },
      subscribe: () => () => undefined,
      getState: () => state,
    },
  } as unknown as ActiveCall;
  const store = createStore();
  store.set(activeCallAtom, active);
  store.set(callPanelRoomAtom, panel ?? undefined);
  return store;
};

const documentButton = { ownerDocument: { activeElement: null }, focus: () => undefined };

describe('PhoneTopBar return to call', () => {
  it('shows the return button and muted microphone when elsewhere', () => {
    const { renderer, button } = renderBar(callStore());
    const pill = button(RETURN);
    expect(pill.findByType('i').props.src).toBe('MicMute');
    const muted = renderer.root.findByProps({ id: pill.props['aria-describedby'] });
    expect(textOf(muted)).toBe('Microphone off');
    expect(muted.props.hidden).toBe(true);
  });

  it('shows the phone icon with no muted description when unmuted, and marks speaking', () => {
    const { button } = renderBar(callStore({ microphone: true, speaking: true }));
    const pill = button(RETURN);
    expect(pill.findByType('i').props.src).toBe('Phone');
    expect(pill.props['aria-describedby']).toBeUndefined();
    expect(pill.props['data-speaking']).toBe(true);
  });

  it.each([false, true])(
    'keeps the pill hidden in the call view when the drawer opens (agent: %s)',
    (agent) => {
      const inCallView = renderBar(callStore({ selected: HOME, agent }));
      expect(inCallView.buttons('Return to the call')).toHaveLength(0);
      act(() => inCallView.store.set(phoneNavDrawerOpenAtom, true));
      expect(inCallView.buttons('Return to the call')).toHaveLength(0);
    }
  );

  it.each([false, true])(
    'reopens the panel without navigating away from an open thread (agent: %s)',
    (agent) => {
      navigation.search = '?threadId=%24planning';
      const call = callStore({ selected: HOME, panel: null, agent });
      call.set(phoneNavDrawerOpenAtom, true);
      const { store, button } = renderBar(call);
      act(() => {
        button(RETURN).props.onClick({ currentTarget: documentButton });
      });
      expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(store.get(callPanelRoomAtom)).toBe(HOME);
      expect(navigation.navigateRoom).not.toHaveBeenCalled();
      expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
    }
  );

  it('hides the button without a live call, including a failure awaiting dismissal', () => {
    expect(renderBar().buttons(RETURN)).toHaveLength(0);
    expect(renderBar(callStore({ phase: 'failed' })).buttons(RETURN)).toHaveLength(0);
  });

  it.each([false, true])('opens the panel and returns to its conversation (agent: %s)', (agent) => {
    const call = callStore({ agent, panel: null });
    call.set(phoneNavDrawerOpenAtom, true);
    const { store, button } = renderBar(call);
    act(() => {
      button(RETURN).props.onClick({ currentTarget: documentButton });
    });
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    expect(store.get(callPanelRoomAtom)).toBe(HOME);
    if (agent) {
      expect(navigation.navigateRoomThread).toHaveBeenCalledWith(HOME, '$planning');
      expect(navigation.navigateRoom).not.toHaveBeenCalled();
    } else {
      expect(navigation.navigateRoom).toHaveBeenCalledWith(HOME);
      expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
    }
  });
});
