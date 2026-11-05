// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { allInvitesAtom } from '../../matrix/state/inviteList';
import { InboxTab } from './InboxTab';

/** Shows where the router is, so a test can read where a click led. */
function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

/** The rail's Inbox button at `screenSize`, opened from Home, with `invites` pending. */
const renderTab = (screenSize: ScreenSize, invites: string[] = []) => {
  const store = createStore();
  store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: invites });
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={screenSize}>
        <MemoryRouter initialEntries={['/home/']}>
          <InboxTab />
          <CurrentPath />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
};

const currentPath = () => screen.getByRole('status', { name: 'Current path' }).textContent;

afterEach(cleanup);

describe('the rail Inbox button', () => {
  it.each([ScreenSize.Desktop, ScreenSize.Tablet, ScreenSize.Mobile])(
    'opens the Inbox on Invites (%s)',
    (screenSize) => {
      renderTab(screenSize);
      fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
      expect(currentPath()).toBe('/inbox/invites/');
    }
  );

  it('opens Invites also while invites wait, and counts them', () => {
    renderTab(ScreenSize.Desktop, ['!first:example.org', '!second:example.org']);
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(currentPath()).toBe('/inbox/invites/');
  });

  it('shows no count without pending invites', () => {
    renderTab(ScreenSize.Desktop);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});
