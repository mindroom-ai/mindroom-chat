// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageNoticeSlotAtom } from '../ui/noticeSlots';
import { SyncStatus } from './SyncStatus';

vi.mock('../native/cloudflareAccess', () => ({ useCloudflareAccessSignInRequired: () => false }));

const client = () =>
  Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => 'https://matrix.example',
  }) as unknown as MatrixClient;

describe('SyncStatus with the page notice place', () => {
  afterEach(() => {
    cleanup();
    getDefaultStore().set(pageNoticeSlotAtom, null);
    document.body.innerHTML = '';
  });

  it('shows its pill in the page notice place and reads it out where it is mounted', () => {
    const place = document.body.appendChild(document.createElement('div'));
    act(() => getDefaultStore().set(pageNoticeSlotAtom, place));
    const { container } = render(<SyncStatus mx={client()} reported={false} />);

    expect(place.querySelector('[data-testid="client-sync-status"]')?.textContent).toBe(
      'Catching up...'
    );
    expect(container.querySelector('[data-testid="client-sync-status"]')).toBeNull();
    expect(container.querySelector('[data-sync-status-announcement]')?.textContent).toBe(
      'Catching up...'
    );
  });
});
