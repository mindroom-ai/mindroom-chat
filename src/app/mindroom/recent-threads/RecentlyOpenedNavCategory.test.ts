import React from 'react';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { clearRecentThreadsStore, makeRecentThreadsAtom } from './recentThreads';
import {
  DEFAULT_RECENTLY_OPENED_THREAD_LIMIT,
  RECENTLY_OPENED_NAV_CATEGORY_ID,
  RecentlyOpenedNavCategory,
} from './RecentlyOpenedNavCategory';

enableMapSet();

const { rooms } = vi.hoisted(() => ({
  rooms: new Map<string, { getMyMembership: () => string; roomId: string }>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Text: ({
    as: asElement = 'span',
    children,
    ...props
  }: {
    as?: string;
    children?: React.ReactNode;
  }) => React.createElement(asElement, props, children),
}));
vi.mock('../../components/nav', () => ({
  NavCategory: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('section', props, children),
  NavCategoryHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', null, children),
}));
vi.mock('../../features/room-nav', () => ({
  RoomNavCategoryButton: ({
    children,
    closed,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { closed?: boolean }) =>
    React.createElement('button', { ...props, 'aria-expanded': !closed }, children),
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => rooms.get(roomId),
    getSafeUserId: () => '@me:example.org',
  }),
}));
vi.mock('./RecentThreadEntry', () => ({
  RecentThreadEntry: ({ threadId }: { threadId: string }) =>
    React.createElement('div', { 'data-recent-thread-id': threadId }),
}));
vi.mock('./threadNav.css', () => ({ CategoryState: 'CategoryState' }));

const USER_ID = '@me:example.org';

describe('RecentlyOpenedNavCategory', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    clearRecentThreadsStore(USER_ID);
    rooms.clear();
    store = createStore();
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    clearRecentThreadsStore(USER_ID);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const seedJoinedThreads = (count: number) => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    for (let index = 0; index < count; index += 1) {
      const roomId = `!room-${index}:example.org`;
      rooms.set(roomId, { roomId, getMyMembership: () => 'join' });
      store.set(recentThreadsAtom, {
        type: 'BUMP',
        roomId,
        threadId: `$thread-${index}`,
        openedAt: index + 1,
      });
    }
  };

  const renderCategory = (limit?: number) => {
    const closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID);
    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            ClosedNavCategoriesProvider,
            { value: closedCategoriesAtom },
            React.createElement(RecentlyOpenedNavCategory, { limit })
          )
        )
      );
    });
    return closedCategoriesAtom;
  };

  const renderedThreadIds = () =>
    renderer!.root
      .findAll((node) => node.props['data-recent-thread-id'])
      .map((node) => node.props['data-recent-thread-id']);

  it('renders a peer category with the 10 most recently opened threads by default', () => {
    seedJoinedThreads(DEFAULT_RECENTLY_OPENED_THREAD_LIMIT + 2);
    renderCategory();

    const category = renderer!.root.findByProps({
      'data-testid': 'recently-opened-nav-category',
    });
    expect(
      category
        .findByProps({ 'data-category-id': RECENTLY_OPENED_NAV_CATEGORY_ID })
        .findAll(() => true)
        .some((node) => node.children.includes('Recently Opened'))
    ).toBe(true);
    expect(renderedThreadIds()).toEqual(
      Array.from(
        { length: DEFAULT_RECENTLY_OPENED_THREAD_LIMIT },
        (_, index) => `$thread-${DEFAULT_RECENTLY_OPENED_THREAD_LIMIT + 1 - index}`
      )
    );
  });

  it('accepts a custom visible entry limit', () => {
    seedJoinedThreads(5);
    renderCategory(3);

    expect(renderedThreadIds()).toEqual(['$thread-4', '$thread-3', '$thread-2']);
  });

  it('skips unavailable and unjoined rooms before applying the limit', () => {
    seedJoinedThreads(3);
    rooms.delete('!room-2:example.org');
    rooms.get('!room-1:example.org')!.getMyMembership = () => 'leave';
    renderCategory(2);

    expect(renderedThreadIds()).toEqual(['$thread-0']);
  });

  it('uses existing per-user sidebar category collapse state', () => {
    seedJoinedThreads(1);
    const closedCategoriesAtom = renderCategory();

    act(() => {
      renderer!.root
        .findByProps({ 'data-category-id': RECENTLY_OPENED_NAV_CATEGORY_ID })
        .props.onClick({
          currentTarget: { getAttribute: () => RECENTLY_OPENED_NAV_CATEGORY_ID },
        });
    });

    expect(store.get(closedCategoriesAtom)).toContain(RECENTLY_OPENED_NAV_CATEGORY_ID);
    expect(
      renderer!.root.findAllByProps({ 'data-testid': 'recently-opened-nav-list' })
    ).toHaveLength(0);
  });
});
