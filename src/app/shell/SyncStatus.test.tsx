import { EventEmitter } from 'events';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';
import { NOTICE_LEAVE_MS } from '../ui/noticeSlots';
import {
  bindHomeserverReachability,
  createHomeserverReachability,
  HOMESERVER_CHECK_TIMEOUT_MS,
} from '../matrix/client/homeserverReachability';

const access = vi.hoisted(() => ({ signInRequired: false }));
const media = vi.hoisted(() => ({ unavailable: false }));

vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthenticationUnavailable: () => media.unavailable,
}));

vi.mock('../native/cloudflareAccess', () => ({
  discoverCloudflareAccess: vi.fn(),
  isCloudflareAccessSupported: () => true,
  signInToCloudflareAccess: vi.fn(),
  useCloudflareAccessSignInRequired: (baseUrl: string) =>
    access.signInRequired && baseUrl === 'https://matrix.example',
}));

/** What the status region reads out. */
const announced = (renderer: ReactTestRenderer): string =>
  renderer.root.findByProps({ 'data-sync-status-announcement': true }).children.join('');

const createClient = () => {
  const mx = Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => 'https://matrix.example',
  }) as unknown as MatrixClient;
  let online = false;
  const reachability = createHomeserverReachability(async () => {
    if (!online) throw new TypeError('Load failed');
    return new Response('{}');
  }, 'https://matrix.example');
  bindHomeserverReachability(mx, reachability);
  const request = ({ reachable }: { reachable: boolean }) =>
    act(async () => {
      online = reachable;
      await reachability
        .fetchFn('https://matrix.example/_matrix/client/v3/rooms/!a/send')
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);
    });
  const emitSync = (state: SyncState, previous: SyncState | null, catchingUp?: boolean) =>
    act(() => {
      mx.emit(ClientEvent.Sync, state, previous, { catchingUp });
    });
  return { mx, request, emitSync };
};

describe('SyncStatus', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    media.unavailable = false;
    vi.useRealTimers();
  });

  const render = (mx: MatrixClient) => {
    act(() => {
      renderer = create(<SyncStatus mx={mx} />);
    });
    return () => announced(renderer!);
  };

  it('shows that the connection is lost when a request cannot reach the homeserver before /sync fails', async () => {
    const { mx, request } = createClient();
    const text = render(mx);
    expect(text()).toBe('');

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost!');

    await request({ reachable: true });
    expect(text()).toBe('');
  });

  it('asks for the organization sign-in instead of a lost connection once the Access token expired', async () => {
    access.signInRequired = true;
    try {
      const { mx, emitSync } = createClient();
      const text = render(mx);

      // A server that left Access keeps syncing; the stale record then prompts nothing.
      emitSync(SyncState.Syncing, SyncState.Prepared);
      expect(text()).not.toContain('requires your organization');

      emitSync(SyncState.Error, SyncState.Syncing);

      expect(text()).toContain("matrix.example requires your organization's sign-in.");
      expect(text()).not.toContain('Connection Lost!');
    } finally {
      access.signInRequired = false;
    }
  });

  it('shows the lost connection instead of catching up', async () => {
    const { mx, request, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost!');

    await request({ reachable: true });
    expect(text()).toBe('Catching up...');
  });

  it('stops catching up on the first sync after startup that has caught up', () => {
    const { mx, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    emitSync(SyncState.Syncing, SyncState.Prepared, false);
    expect(text()).toBe('');
  });

  it('stops catching up once the SDK has caught up, without waiting for another sync', () => {
    const { mx, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Prepared, null);
    expect(text()).toBe('Catching up...');

    // The server still had to-device messages queued: the SDK polls again at once.
    emitSync(SyncState.Syncing, SyncState.Prepared, true);
    expect(text()).toBe('Catching up...');

    emitSync(SyncState.Syncing, SyncState.Syncing, false);
    expect(text()).toBe('');

    // After a reconnect, the first sync that catches up ends it.
    emitSync(SyncState.Catchup, SyncState.Error);
    expect(text()).toBe('Catching up...');
    emitSync(SyncState.Syncing, SyncState.Catchup, false);
    expect(text()).toBe('');
  });

  it('shows the sync state the client is already in when it mounts', () => {
    const { mx } = createClient();
    Object.assign(mx, {
      getSyncState: () => SyncState.Prepared,
      getSyncStateData: () => ({ catchingUp: false }),
    });
    expect(render(mx)()).toBe('Catching up...');
  });

  it('keeps the reconnecting banner while the /sync loop reconnects', async () => {
    const { mx, request, emitSync } = createClient();
    const text = render(mx);
    emitSync(SyncState.Reconnecting, SyncState.Syncing);

    await request({ reachable: false });
    expect(text()).toBe('Connection Lost! Reconnecting...');
  });

  it('reads catching up out before the sync loop has reported, whatever else it knows', async () => {
    const { mx, request } = createClient();
    act(() => {
      renderer = create(<SyncStatus mx={mx} reported={false} />);
    });
    await request({ reachable: false });
    expect(announced(renderer!)).toBe('Catching up...');
  });

  it('shows the status as a pill, critical for a lost connection, which leaves once all is well', async () => {
    const { mx, request } = createClient();
    render(mx);
    const pill = () =>
      renderer!.root.findAll(
        (node) =>
          typeof node.type === 'string' && node.props['data-testid'] === 'client-sync-status'
      );
    expect(pill()).toHaveLength(0);

    await request({ reachable: false });
    expect(pill()).toHaveLength(1);
    expect(pill()[0]?.props['aria-hidden']).toBe(true);
    // The critical look: a critical surface, where catching up has the plain one.
    expect(
      renderer!.root.findAll(
        (node) =>
          node.props['data-testid'] === 'client-sync-status' && node.props.variant === 'Critical'
      ).length
    ).toBeGreaterThan(0);
    expect(pill()[0]?.props['data-leaving']).toBeUndefined();

    await request({ reachable: true });
    expect(announced(renderer!)).toBe('');
    // It plays its way out with what it said, then goes.
    expect(pill()[0]?.props['data-leaving']).toBe(true);
    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    expect(pill()).toHaveLength(0);
  });

  it('says why images cannot load when nothing in this window can sign media requests', async () => {
    media.unavailable = true;
    const { mx, request } = createClient();
    const text = render(mx);
    expect(text()).toBe(
      "Some images can't load in this window: the browser runs no service worker for MindRoom here."
    );
    // Without a spinner: nothing is in progress.
    expect(renderer!.root.findAll((node) => node.props.variant === 'Secondary')).toHaveLength(0);

    // A lost connection says so first.
    await request({ reachable: false });
    expect(text()).toBe('Connection Lost!');
  });
});
