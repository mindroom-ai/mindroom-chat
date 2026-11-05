// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadForNewVersion } from '../config/appUpdate';
import { PartUnavailable, ReloadWouldLoseWorkContext } from './PartUnavailable';

vi.mock('../config/appUpdate', () => ({ reloadForNewVersion: vi.fn(() => Promise.resolve()) }));

const failAgain = () =>
  Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

const renderView = (wouldLoseWork: () => boolean) =>
  render(
    <ReloadWouldLoseWorkContext.Provider value={wouldLoseWork}>
      <PartUnavailable retryLoad={failAgain} />
    </ReloadWouldLoseWorkContext.Provider>
  );

describe('PartUnavailable', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reloads the page when Retry cannot load the part and nothing would be lost', async () => {
    renderView(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(reloadForNewVersion).toHaveBeenCalledOnce());
    // The view keeps its message while the page reloads.
    expect(
      screen.getByText("This couldn't load. Check your connection and try again.")
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(true);
  });

  it('says a reload is needed and offers it when one would lose something', async () => {
    renderView(() => true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const reload = await screen.findByRole('button', { name: 'Reload page' });
    expect(screen.getByText(/Loading this needs a page reload/)).toBeTruthy();
    expect(reloadForNewVersion).not.toHaveBeenCalled();
    fireEvent.click(reload);
    expect(reloadForNewVersion).toHaveBeenCalledOnce();
  });
});
