// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { enableMapSet } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivedRoomsAtom } from '../../matrix/state/archivedRooms';
import { makeClosedNavCategoriesAtom, makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { THREAD_NAV_CATEGORY_ID, ThreadNavCategory } from './ThreadNavCategory';
import {
  clearThreadSidebarPreferencesStore,
  getThreadSidebarPreferencesStoreKey,
  makeThreadSidebarPreferencesAtom,
} from '../../threads/cross-room/threadSidebarPreferences';

enableMapSet();

const { MINUTE_NOW, readSignals } = vi.hoisted(() => ({
  // Later than any real clock, so it wins over the time a snooze last renewed.
  MINUTE_NOW: 4_000_000_000_000,
  readSignals: vi.fn(() => undefined),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Button: ({
    before: _before,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { before?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Icon: () => null,
  Icons: {},
  Text: ({
    as: asElement = 'span',
    children,
    ...props
  }: {
    as?: string;
    children?: React.ReactNode;
  }) => React.createElement(asElement, props, children),
}));
vi.mock('../../ui/nav/NavItem', () => ({
  NavCategory: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('section', props, children),
}));
vi.mock('../../ui/nav/NavCategoryHeader', () => ({
  NavCategoryHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('header', props, children),
}));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({
  RoomNavCategoryButton: ({
    children,
    closed,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { closed?: boolean }) =>
    React.createElement('button', { ...props, 'aria-expanded': !closed }, children),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org', getRoom: () => ({}) }),
}));
vi.mock('../../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('./ThreadNavItem', () => ({
  ThreadNavItem: ({
    entry,
    pinned,
    onTogglePin,
  }: {
    entry: CrossRoomThreadIndexEntry;
    pinned: boolean;
    onTogglePin: () => void;
  }) =>
    React.createElement(
      'div',
      { 'data-thread-key': entry.key, 'data-pinned': pinned },
      entry.summaryText,
      React.createElement('button', { 'aria-label': `pin-${entry.key}`, onClick: onTogglePin })
    ),
}));
vi.mock('./threadNav.css', () => ({
  CategoryHeader: 'CategoryHeader',
  CategoryToggle: 'CategoryToggle',
  HeaderControls: 'HeaderControls',
  CategoryState: 'CategoryState',
  HeaderToggle: 'HeaderToggle',
  HeaderToggleLabel: 'HeaderToggleLabel',
}));
vi.mock('../../threads/cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: readSignals }),
}));
vi.mock('../../lib/hooks/useMinuteClock', () => ({ useMinuteClock: () => MINUTE_NOW }));

const USER_ID = '@me:example.org';
const makeEntry = (roomId: string, threadRootId: string, lastActivityTs: number) =>
  ({
    key: getCrossRoomThreadIndexKey(roomId, threadRootId),
    roomId,
    roomName: roomId,
    threadRootId,
    lastActivityTs,
    isInvolved: true,
    isForUser: true,
    isUnread: false,
    isResolved: false,
    summaryText: threadRootId,
    threadRecord: { status: { isStreaming: false }, cache: {} },
  } as unknown as CrossRoomThreadIndexEntry);

const older = makeEntry('!room:example.org', '$older', 10);
const newer = makeEntry('!newer-room:example.org', '$newer', 20);

describe('ThreadNavCategory', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    localStorage.clear();
    clearThreadSidebarPreferencesStore(USER_ID);
    store = createStore();
    store.set(crossRoomThreadIndexAtom, {
      version: 1,
      bootstrapped: true,
      eventIdToThreadRoots: new Map(),
      entries: new Map([
        [older.key, older],
        [newer.key, newer],
      ]),
    });
  });

  afterEach(() => {
    cleanup();
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    clearThreadSidebarPreferencesStore(USER_ID);
    vi.clearAllMocks();
  });

  const categoryTree = (
    closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID),
    spaceId?: string
  ) =>
    React.createElement(
      Provider,
      { store },
      React.createElement(
        ClosedNavCategoriesProvider,
        { value: closedCategoriesAtom },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/'] },
          React.createElement(ThreadNavCategory, { spaceId })
        )
      )
    );

  const renderCategory = ({ spaceId }: { spaceId?: string } = {}) => {
    const closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID);
    act(() => {
      renderer = create(categoryTree(closedCategoriesAtom, spaceId));
    });
    return closedCategoriesAtom;
  };

  it('renders as a peer collapsible nav category in activity order', () => {
    renderCategory();
    const category = renderer!.root.findByProps({ 'data-testid': 'thread-nav-category' });
    expect(
      category
        .findByProps({ 'data-category-id': THREAD_NAV_CATEGORY_ID })
        .findAll(() => true)
        .some((node) => node.children.includes('Threads'))
    ).toBe(true);
    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([newer.key, older.key]);
  });

  it('collapses exactly like the room category', () => {
    const closedCategoriesAtom = renderCategory();

    act(() => {
      renderer!.root.findByProps({ 'data-category-id': THREAD_NAV_CATEGORY_ID }).props.onClick({
        currentTarget: { getAttribute: () => THREAD_NAV_CATEGORY_ID },
      });
    });

    expect(store.get(closedCategoriesAtom)).toContain(THREAD_NAV_CATEGORY_ID);
    expect(renderer!.root.findAllByProps({ 'data-testid': 'thread-nav-list' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Group' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'For me' })).toHaveLength(0);
  });

  it('moves a pinned thread above newer activity', async () => {
    renderCategory();

    await act(() =>
      renderer!.root.findByProps({ 'aria-label': `pin-${older.key}` }).props.onClick()
    );

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key, newer.key]);
  });

  it('hides archived threads and restores their pin preference', async () => {
    renderCategory();
    await act(() =>
      renderer!.root.findByProps({ 'aria-label': `pin-${older.key}` }).props.onClick()
    );
    act(() => store.set(archivedRoomsAtom, new Set([older.roomId])));
    const visibleKeys = () =>
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key']);
    expect(visibleKeys()).toEqual([newer.key]);
    act(() => store.set(archivedRoomsAtom, new Set<string>()));
    expect(visibleKeys()).toEqual([older.key, newer.key]);
  });

  it('does not render threads from direct-message rooms', () => {
    store.set(mDirectAtom, { type: 'UPDATE', rooms: new Set([newer.roomId]) });

    renderCategory();

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });

  it('shows only threads from the active Space, including nested rooms', () => {
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [older.roomId, new Set(['!nested-space:example.org'])],
        ['!nested-space:example.org', new Set(['!space:example.org'])],
      ]),
    });

    renderCategory({ spaceId: '!space:example.org' });

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });

  it('round-trips the stored layout with Group and lets sections fold independently', () => {
    const resolved = {
      ...makeEntry('!resolved-room:example.org', '$resolved', 30),
      isResolved: true,
    };
    store.set(crossRoomThreadIndexAtom, {
      version: 2,
      bootstrapped: true,
      eventIdToThreadRoots: new Map(),
      entries: new Map([
        [older.key, older],
        [newer.key, newer],
        [resolved.key, resolved],
      ]),
    });
    const key = getThreadSidebarPreferencesStoreKey(USER_ID);
    const saved = () => JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    localStorage.setItem(key, JSON.stringify({ v: 1, layout: 'recent', pinnedThreadKeys: [] }));
    const closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID);
    const { container } = render(categoryTree(closedCategoriesAtom));
    const threadKeys = () =>
      Array.from(container.querySelectorAll('[data-thread-key]'), (row) =>
        row.getAttribute('data-thread-key')
      );
    const group = screen.getByRole('button', { name: 'Group' });
    expect(group.getAttribute('aria-pressed')).toBe('false');
    expect(threadKeys()).toEqual([newer.key, older.key]);

    fireEvent.click(group);

    expect(saved()).toMatchObject({ v: 1, layout: 'sections' });
    expect(group.getAttribute('aria-pressed')).toBe('true');
    const resolvedId = makeNavCategoryId('mindroom', 'threads', 'resolved');
    const resolvedHeading = screen.getByRole('button', { name: 'Resolved · 1' });
    expect(screen.getByRole('button', { name: 'Idle · 2' })).toBeTruthy();
    expect(threadKeys()).toEqual([newer.key, older.key, resolved.key]);

    fireEvent.click(resolvedHeading);

    expect(store.get(closedCategoriesAtom)).toContain(resolvedId);
    expect(resolvedHeading.getAttribute('aria-expanded')).toBe('false');
    expect(threadKeys()).toEqual([newer.key, older.key]);

    fireEvent.click(group);

    expect(saved()).toMatchObject({ v: 1, layout: 'recent' });
    expect(group.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Idle · 2' })).toBeNull();
    expect(threadKeys()).toEqual([newer.key, older.key]);
  });

  it.each(['recent', 'sections'])('filters the %s layout with For me', (layout) => {
    store.set(crossRoomThreadIndexAtom, {
      ...store.get(crossRoomThreadIndexAtom),
      entries: new Map([
        [older.key, older],
        [newer.key, { ...newer, isInvolved: false, isForUser: false }],
      ]),
    });
    render(categoryTree());
    const group = screen.getByRole('button', { name: 'Group' });
    const grouped = layout === 'sections';
    if (grouped) fireEvent.click(group);
    const forMe = screen.getByRole('button', { name: 'For me' });

    expect(forMe.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(newer.summaryText)).toBeTruthy();
    fireEvent.click(forMe);
    expect(forMe.getAttribute('aria-pressed')).toBe('true');
    expect(group.getAttribute('aria-pressed')).toBe(String(grouped));
    expect(screen.getByText(older.summaryText)).toBeTruthy();
    expect(screen.queryByText(newer.summaryText)).toBeNull();
    if (grouped) expect(screen.getByRole('button', { name: 'Idle · 1' })).toBeTruthy();
    fireEvent.click(forMe);
    expect(screen.getByText(newer.summaryText)).toBeTruthy();
  });

  it('keeps a pinned uninvolved thread visible with For me on', () => {
    store.set(crossRoomThreadIndexAtom, {
      ...store.get(crossRoomThreadIndexAtom),
      entries: new Map([
        [older.key, { ...older, isInvolved: false, isForUser: false }],
        [newer.key, { ...newer, isInvolved: false, isForUser: false }],
      ]),
    });
    store.set(makeThreadSidebarPreferencesAtom(USER_ID), {
      type: 'TOGGLE_PIN',
      threadKey: older.key,
    });
    renderCategory();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'For me' }).props.onClick();
    });
    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });

  it('keeps an attributed, unpinned thread visible with For me on', () => {
    store.set(crossRoomThreadIndexAtom, {
      ...store.get(crossRoomThreadIndexAtom),
      entries: new Map([
        [older.key, { ...older, isInvolved: false, isForUser: true }],
        [newer.key, { ...newer, isInvolved: false, isForUser: false }],
      ]),
    });
    renderCategory();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'For me' }).props.onClick();
    });
    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });

  it.each([
    ['Group', 'Group by status'],
    ['For me', 'Only threads you take part in, that an agent posted for you, or that you pinned'],
  ])('gives %s an accessible toggle name and a separate reveal label', (name, description) => {
    render(categoryTree());
    const toggle = screen.getByRole('button', { name, description });
    const label = within(toggle).getByText(name, { selector: 'span' });
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(label.classList.contains('HeaderToggleLabel')).toBe(true);
    toggle.focus();
    fireEvent.keyUp(toggle, { key: 'Tab' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows a distinct empty state when For me hides every thread', () => {
    store.set(crossRoomThreadIndexAtom, {
      ...store.get(crossRoomThreadIndexAtom),
      entries: new Map([[newer.key, { ...newer, isInvolved: false, isForUser: false }]]),
    });
    renderCategory();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'For me' }).props.onClick();
    });
    expect(
      renderer!.root.findAll((node) => node.children.includes('No threads for you yet'))
    ).not.toHaveLength(0);
  });

  it('labels scheduled threads Later with the later section id', () => {
    store.set(makeThreadSidebarPreferencesAtom(USER_ID), {
      type: 'SET_LAYOUT',
      layout: 'sections',
    });
    const scheduled = {
      ...older,
      threadRecord: {
        ...older.threadRecord,
        status: { ...older.threadRecord.status, scheduledTaskCount: 1 },
      },
    };
    store.set(crossRoomThreadIndexAtom, {
      ...store.get(crossRoomThreadIndexAtom),
      entries: new Map([[scheduled.key, scheduled]]),
    });
    renderCategory();
    expect(renderer!.root.findByProps({ 'aria-label': 'Later' }).type).toBe('section');
    expect(
      renderer!.root.findByProps({
        'data-category-id': makeNavCategoryId('mindroom', 'threads', 'later'),
      }).props['aria-expanded']
    ).toBe(true);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Snoozed' })).toHaveLength(0);
  });

  it('reads the signals of its sections at the minute clock, as Activity does', () => {
    store.set(makeThreadSidebarPreferencesAtom(USER_ID), {
      type: 'SET_LAYOUT',
      layout: 'sections',
    });

    renderCategory();

    expect(readSignals).toHaveBeenCalled();
    expect(readSignals.mock.calls.map((call: unknown[]) => call[3])).toEqual(
      readSignals.mock.calls.map(() => MINUTE_NOW)
    );
  });
});
