// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { allInvitesAtom } from '../../matrix/state/inviteList';
import { InboxNav } from './InboxNav';

// The column's scrolling frame measures itself with ResizeObserver, which jsdom lacks.
vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <>
      {header}
      {children}
    </>
  ),
}));

/** The Inbox navigation at `path` and `screenSize`, with `invites` pending. */
const renderNav = (path: string, screenSize = ScreenSize.Desktop, invites: string[] = []) => {
  const store = createStore();
  store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: invites });
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={screenSize}>
        <MemoryRouter initialEntries={[path]}>
          <InboxNav />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
  return within(screen.getByRole('navigation', { name: 'Inbox' })).getAllByRole('link');
};

afterEach(cleanup);

describe('the Inbox navigation', () => {
  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'lists Invites first, with the pending invites counted, then Notifications (%s)',
    (screenSize) => {
      const links = renderNav('/inbox/', screenSize, ['!first:example.org', '!second:example.org']);
      expect(links.map((link) => link.textContent)).toEqual(['Invites2', 'Notifications']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/inbox/invites/',
        '/inbox/notifications/',
      ]);
    }
  );

  it('marks the open page', () => {
    const onInvites = renderNav('/inbox/invites/');
    expect(onInvites.map((link) => link.getAttribute('aria-current'))).toEqual(['page', null]);
    cleanup();
    const onNotifications = renderNav('/inbox/notifications/');
    expect(onNotifications.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      'page',
    ]);
  });
});
