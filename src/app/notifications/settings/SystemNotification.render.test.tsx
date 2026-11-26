// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SystemNotification } from './SystemNotification';

vi.mock('../push/IOSPushNotification', () => ({
  IOSPushNotification: () => <p>iOS push tile</p>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const createClient = (setPusher = vi.fn(() => Promise.resolve({}))) =>
  ({
    getThreePids: () =>
      Promise.resolve({ threepids: [{ medium: 'email', address: 'ana@example.org' }] }),
    getPushers: () => Promise.resolve({ pushers: [] }),
    setPusher,
  }) as unknown as MatrixClient;

describe('SystemNotification rendered with its real tiles', () => {
  it('shows desktop notifications on web and names the app in the email pusher', async () => {
    const setPusher = vi.fn(() => Promise.resolve({}));

    render(
      <MatrixClientProvider value={createClient(setPusher)}>
        <SystemNotification />
      </MatrixClientProvider>
    );

    expect(screen.getByText('Desktop Notifications')).toBeTruthy();
    expect(screen.getByText('iOS push tile')).toBeTruthy();
    fireEvent.click(await screen.findByRole('switch', { name: 'Email Notification' }));
    await waitFor(() =>
      expect(setPusher).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'email',
          pushkey: 'ana@example.org',
          data: { brand: 'MindRoom' },
        })
      )
    );
  });

  it('hides the desktop notifications tile on Capacitor native platforms', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    render(
      <MatrixClientProvider value={createClient()}>
        <SystemNotification />
      </MatrixClientProvider>
    );

    expect(screen.queryByText('Desktop Notifications')).toBeNull();
    expect(screen.getByText('Notification Sound')).toBeTruthy();
    expect(await screen.findByRole('switch', { name: 'Email Notification' })).toBeTruthy();
  });
});
