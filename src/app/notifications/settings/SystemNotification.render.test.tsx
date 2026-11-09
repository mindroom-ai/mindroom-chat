// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SystemNotification } from './SystemNotification';

vi.mock('../push/IOSPushNotification', () => ({
  IOSPushNotification: () => <p>iOS push tile</p>,
}));

afterEach(cleanup);

describe('SystemNotification rendered with its real tiles', () => {
  it('shows the iOS push tile and names the app in the email pusher', async () => {
    const setPusher = vi.fn(() => Promise.resolve({}));
    const client = {
      getThreePids: () =>
        Promise.resolve({ threepids: [{ medium: 'email', address: 'ana@example.org' }] }),
      getPushers: () => Promise.resolve({ pushers: [] }),
      setPusher,
    } as unknown as MatrixClient;

    render(
      <MatrixClientProvider value={client}>
        <SystemNotification />
      </MatrixClientProvider>
    );

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
});
