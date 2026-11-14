// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { Icons, config, type IconSrc } from 'folds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu, type ThreadActionsMenuProps } from './ThreadActionsMenu';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';
import { getDefaultStore } from 'jotai';
import { getSettings, settingsAtom } from '../preferences/settings';
import { clearToolCallOverrides } from '../messages/toolCallVisibility';

vi.mock('./ThreadContextBanner.css', () => ({ TagPickerInput: 'i', TagPickerInputContainer: 'c' }));
vi.mock('../ui/styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));

const state = vi.hoisted(() => ({
  resolved: false,
  canEdit: true,
  snoozedUntilTs: undefined as number | undefined,
  pinned: [] as string[],
  members: [] as { userId: string; membership: string }[],
}));
vi.mock('./tags/useThreadTags', () => ({
  useThreadTags: () => ({
    displayTags: ['triage'],
    availableTags: [],
    canEdit: state.canEdit,
    isResolved: state.resolved,
    snoozedUntilTs: state.snoozedUntilTs,
  }),
}));
const mutations = vi.hoisted(() => ({ snooze: vi.fn(), unsnooze: vi.fn() }));
vi.mock('./tags/useMutateThreadTags', () => ({
  useMutateThreadTags: () => ({ updating: false, ...mutations }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({ pinnedEventIds: state.pinned, canPin: true, updating: false }),
}));
vi.mock('./summary/threadSummaryActions', () => ({
  getThreadSummaryActionError: () => undefined,
  requestThreadSummary: vi.fn(),
  saveThreadSummary: vi.fn(),
  SUMMARY_MAX_LENGTH: 300,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../matrix/session/useSessionStore', async (original) => ({
  ...(await original<typeof import('../matrix/session/useSessionStore')>()),
  useActiveSession: () => ({ sessionId: 'me-session' }),
}));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content }: { content: React.ReactNode }) => content,
}));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const rootEvent = new MatrixEvent({
  event_id: '$root',
  room_id: '!room:test',
  type: 'm.room.message',
  sender: '@me:test',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Thread root' },
});
const room = {
  roomId: '!room:test',
  getThread: () => undefined,
  findEventById: () => rootEvent,
} as unknown as Room;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.resolved = false;
  state.canEdit = true;
  state.snoozedUntilTs = undefined;
  state.pinned = [];
  mutations.snooze.mockReset();
  mutations.unsnooze.mockReset();
  state.members = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const renderMenu = (props: Partial<ThreadActionsMenuProps> = {}) => {
  act(() =>
    root.render(
      <ThreadActionsMenu
        room={room}
        rootId="$root"
        anchor={{ x: 0, y: 0, width: 0, height: 0 }}
        onClose={() => undefined}
        {...props}
      />
    )
  );
  return [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
};

const glyph = (src: IconSrc) => renderToStaticMarkup(<>{src()}</>);
const rows = (items: HTMLElement[]) =>
  items.map((item) => ({
    action: item.dataset.threadAction,
    label: item.textContent,
    icon: item.querySelector('svg')?.innerHTML,
  }));
const rowOf = (items: HTMLElement[], action: string) =>
  items.find((item) => item.dataset.threadAction === action);

describe('ThreadActionsMenu rows', () => {
  it('lists the banner menu as tags, summary, resolve, pin, link, hide, each with its icon after the label', () => {
    const items = renderMenu({ onHideDetails: () => undefined });

    expect(rows(items)).toEqual([
      { action: 'tags', label: 'Edit tags', icon: glyph(Icons.Bookmark) },
      { action: 'editSummary', label: 'Edit summary', icon: glyph(Icons.Pencil) },
      { action: 'regenerate', label: 'Regenerate summary', icon: glyph(Icons.Bulb) },
      { action: 'resolve', label: 'Resolve', icon: glyph(Icons.CheckTwice) },
      { action: 'snooze', label: 'Snooze', icon: glyph(Icons.Clock) },
      { action: 'pin', label: 'Pin thread', icon: glyph(Icons.Pin) },
      { action: 'copy', label: 'Copy thread link', icon: glyph(Icons.Link) },
      { action: 'hideDetails', label: 'Hide thread details', icon: glyph(Icons.ChevronTop) },
    ]);
    // Resolve acts on the open thread here, so it shows the shortcut that does the same.
    expect(rowOf(items, 'resolve')?.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Enter');
    expect(rowOf(items, 'resolve')?.querySelector('[data-keys]')?.getAttribute('data-keys')).toBe(
      'Ctrl+Shift+Enter'
    );
    // The icon follows the label, so the label starts the row and names it.
    items.forEach((item) => {
      const label = item.querySelector('span');
      const icon = item.querySelector('svg');
      expect(label && icon && label.compareDocumentPosition(icon)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
  });

  it('offers to show the thread beside the messages before Hide where the banner asks for it', () => {
    const onShowBeside = vi.fn();
    const onClose = vi.fn();
    const items = renderMenu({ onShowBeside, onHideDetails: () => undefined, onClose });

    expect(rows(items).slice(-3)).toEqual([
      { action: 'copy', label: 'Copy thread link', icon: glyph(Icons.Link) },
      {
        action: 'showBeside',
        label: 'Show the thread beside the messages',
        icon: glyph(ShrinkIcon),
      },
      { action: 'hideDetails', label: 'Hide thread details', icon: glyph(Icons.ChevronTop) },
    ]);
    act(() => rowOf(items, 'showBeside')?.click());
    expect(onShowBeside).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers to show the thread in full before Hide where the banner asks for it', () => {
    const onShowFull = vi.fn();
    const onClose = vi.fn();
    const items = renderMenu({ onShowFull, onHideDetails: () => undefined, onClose });

    expect(rows(items).slice(-2)).toEqual([
      { action: 'showFull', label: 'Show the thread in full', icon: glyph(ExpandIcon) },
      { action: 'hideDetails', label: 'Hide thread details', icon: glyph(Icons.ChevronTop) },
    ]);
    act(() => rowOf(items, 'showFull')?.click());
    expect(onShowFull).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('starts a card menu with Open thread, and gives Reopen its own icon', () => {
    state.resolved = true;
    const menuItems = renderMenu({ onOpenThread: () => undefined });
    const items = rows(menuItems);
    // The shortcut resolves the open thread, not the card's.
    expect(rowOf(menuItems, 'resolve')?.hasAttribute('aria-keyshortcuts')).toBe(false);

    expect(items.map((item) => item.action)).toEqual([
      'open',
      'tags',
      'editSummary',
      'regenerate',
      'resolve',
      'pin',
      'copy',
    ]);
    expect(items[0]?.icon).toBe(glyph(Icons.Thread));
    expect(items[4]).toEqual({
      action: 'resolve',
      label: 'Reopen thread',
      icon: glyph(Icons.Reload),
    });
  });

  it('opens at least 220px wide with the large corner radius, as the original menu measures', () => {
    renderMenu();
    const menu = host.querySelector<HTMLElement>('[role="menu"]');

    expect(menu?.style.minWidth).toBe('13.75rem');
    expect(menu?.style.borderRadius).toBe(config.radii.R500);
  });
});

describe("ThreadActionsMenu's snooze", () => {
  it('offers Snooze on an open thread and Unsnooze on a snoozed one', () => {
    const onClose = vi.fn();
    const items = renderMenu({ onClose });
    expect(rowOf(items, 'snooze')?.textContent).toBe('Snooze');

    const before = Date.now();
    act(() => rowOf(items, 'snooze')?.click());
    const preset = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) =>
      node.textContent?.startsWith('In 1 hour')
    );
    expect(host.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Snooze until');
    act(() => preset?.click());
    expect(mutations.snooze).toHaveBeenCalledOnce();
    const [rootId, until] = mutations.snooze.mock.calls[0] as [string, Date];
    expect(rootId).toBe('$root');
    expect(until.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
    expect(until.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
    expect(onClose).toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(host);
    state.snoozedUntilTs = Date.now() + 60_000;
    const snoozed = renderMenu();
    expect(rowOf(snoozed, 'snooze')?.textContent).toBe('Unsnooze');
    act(() => rowOf(snoozed, 'snooze')?.click());
    expect(mutations.unsnooze).toHaveBeenCalledWith('$root');
  });

  it('reads a snooze whose time has passed as no snooze', () => {
    state.snoozedUntilTs = Date.now() - 1;
    expect(rowOf(renderMenu(), 'snooze')?.textContent).toBe('Snooze');
  });

  it('offers neither on a resolved or pinned thread, or without permission', () => {
    state.resolved = true;
    expect(rowOf(renderMenu(), 'snooze')).toBeUndefined();

    state.resolved = false;
    state.pinned = ['$root'];
    expect(rowOf(renderMenu(), 'snooze')).toBeUndefined();

    state.pinned = [];
    state.canEdit = false;
    state.snoozedUntilTs = Date.now() + 60_000;
    expect(rowOf(renderMenu(), 'snooze')).toBeUndefined();
  });
});

describe("ThreadActionsMenu's tool calls switch", () => {
  const SESSION = 'me-session';
  const entry = () => host.querySelector<HTMLElement>('[data-thread-action="toolCalls"]');
  const stored = () => localStorage.getItem(`toolCallsShown:${SESSION}`);
  beforeEach(() => {
    getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: false });
  });
  afterEach(() => clearToolCallOverrides(SESSION));

  it('shows or hides the tool calls of this thread only, then closes the menu', () => {
    state.members = [{ userId: '@mindroom_research:example.org', membership: 'join' }];
    const onClose = vi.fn();
    renderMenu({ onClose });
    expect(entry()?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(entry()?.getAttribute('aria-checked')).toBe('false');
    expect(entry()?.textContent).toBe('Show tool calls');

    act(() => entry()?.click());
    expect(JSON.parse(stored() ?? 'null')).toEqual({ '!room:test': { threads: { $root: true } } });
    expect(getDefaultStore().get(settingsAtom).showToolCalls).toBe(false);
    expect(onClose).toHaveBeenCalled();
    expect(entry()?.getAttribute('aria-checked')).toBe('true');
  });

  it('is left out of rooms without agents, which have no tool calls', () => {
    renderMenu();
    expect(entry()).toBeNull();
  });

  it('is there while an agent is still invited, as in the room menu', () => {
    state.members = [{ userId: '@mindroom_research:example.org', membership: 'invite' }];
    renderMenu();
    expect(entry()?.textContent).toBe('Show tool calls');
  });
});
