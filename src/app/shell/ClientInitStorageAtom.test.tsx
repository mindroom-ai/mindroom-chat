// @vitest-environment jsdom
import { createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THREAD_NAV_CATEGORY_ID } from '../sidebar/threads/ThreadNavCategory';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from '../sidebar/threads/recentlyOpenedCategory';
import type { ClosedNavCategoriesAtom } from '../ui/nav/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../ui/nav/useClosedNavCategories';
import { ClientInitStorageAtom } from './ClientInitStorageAtom';

const USER_ID = '@reader:example.org';
const CLOSED_KEY = `closedNavCategories${USER_ID}`;

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => USER_ID }),
}));

/** The collapsed-categories atom a fresh mount of the account's storage provides. */
const mountAtom = (): ClosedNavCategoriesAtom => {
  let provided: ClosedNavCategoriesAtom | undefined;
  function Probe() {
    provided = useClosedNavCategoriesAtom();
    return null;
  }
  const renderer = create(
    <ClientInitStorageAtom>
      <Probe />
    </ClientInitStorageAtom>
  );
  act(() => renderer.unmount());
  if (!provided) throw new Error('ClientInitStorageAtom provided no atom');
  return provided;
};

describe('ClientInitStorageAtom collapsed categories', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('starts THREADS and Recently Opened collapsed for an account that never touched them', () => {
    const closed = createStore().get(mountAtom());
    expect(closed.has(THREAD_NAV_CATEGORY_ID)).toBe(true);
    expect(closed.has(RECENTLY_OPENED_NAV_CATEGORY_ID)).toBe(true);
    // Rooms keeps its default: open.
    expect(closed.has('home|room')).toBe(false);
  });

  it('keeps THREADS open once the person opens it', () => {
    createStore().set(mountAtom(), { type: 'DELETE', categoryId: THREAD_NAV_CATEGORY_ID });
    expect(createStore().get(mountAtom()).has(THREAD_NAV_CATEGORY_ID)).toBe(false);
  });

  it('keeps the categories a person collapsed before', () => {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(['home|room']));
    const closed = createStore().get(mountAtom());
    expect(closed).toEqual(
      new Set(['home|room', RECENTLY_OPENED_NAV_CATEGORY_ID, THREAD_NAV_CATEGORY_ID])
    );
  });
});
