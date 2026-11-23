import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { DesktopBridge } from '../lib/desktopBridge';
import { getLivekitServiceUrl } from './rtcFocus';
import { browserSharesScreens, useCallSupport, type CallSupport } from './callSupport';

vi.mock('./rtcFocus', () => ({ getLivekitServiceUrl: vi.fn() }));

/** Mounts a component that reads the support, and records what it rendered with, in order. */
const mountReader = (mx: MatrixClient) => {
  const seen: CallSupport[] = [];
  function Reader() {
    seen.push(useCallSupport(mx));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Reader />);
  });
  return { seen, unmount: () => act(() => renderer?.unmount()) };
};

const answered = () => act(async () => Promise.resolve());

afterEach(() => {
  vi.mocked(getLivekitServiceUrl).mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCallSupport', () => {
  it('answers what the discovery finds, and starts from that answer when it mounts again', async () => {
    vi.mocked(getLivekitServiceUrl).mockResolvedValue('https://rtc.calls.test');
    const mx = {} as MatrixClient;

    const first = mountReader(mx);
    await answered();
    expect(first.seen).toEqual(['checking', 'supported']);
    first.unmount();

    // The header of the next room: no moment without its call button.
    const next = mountReader(mx);
    await answered();
    expect(next.seen.every((support) => support === 'supported')).toBe(true);
    next.unmount();
  });

  it('asks again about a deployment without a service only after a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.mocked(getLivekitServiceUrl).mockResolvedValue(undefined);
    const mx = {} as MatrixClient;

    const first = mountReader(mx);
    await answered();
    expect(first.seen.at(-1)).toBe('unsupported');
    first.unmount();

    const soon = mountReader(mx);
    await answered();
    expect(soon.seen.every((support) => support === 'unsupported')).toBe(true);
    expect(getLivekitServiceUrl).toHaveBeenCalledTimes(1);
    soon.unmount();

    vi.setSystemTime(Date.now() + 61_000);
    vi.mocked(getLivekitServiceUrl).mockResolvedValue('https://rtc.calls.test');
    const later = mountReader(mx);
    await answered();
    expect(later.seen.at(-1)).toBe('supported');
    expect(getLivekitServiceUrl).toHaveBeenCalledTimes(2);
    later.unmount();
  });
});

const makeBridge = (screenShare: boolean): DesktopBridge => ({
  onShellEvent: vi.fn(() => () => undefined),
  setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
  startSignIn: vi.fn(async () => ({ ok: true as const, value: '' })),
  openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
  showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
  setBadge: vi.fn(),
  screenShare,
  appUrl: {
    addListener: vi.fn(async () => undefined),
    getLaunchUrl: vi.fn(async () => undefined),
  },
});

describe('browserSharesScreens', () => {
  it('follows navigator.mediaDevices.getDisplayMedia when no desktop bridge is present', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn() } });
    expect(browserSharesScreens()).toBe(true);

    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(browserSharesScreens()).toBe(false);
  });

  it('returns true when desktop bridge screenShare is true and getDisplayMedia exists', () => {
    vi.stubGlobal('window', { mindroomDesktop: makeBridge(true) });
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn() } });
    expect(browserSharesScreens()).toBe(true);

    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(browserSharesScreens()).toBe(false);
  });

  it('returns false when desktop bridge screenShare is false even if getDisplayMedia exists', () => {
    vi.stubGlobal('window', { mindroomDesktop: makeBridge(false) });
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn() } });
    expect(browserSharesScreens()).toBe(false);
  });
});
