import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { getLivekitServiceUrl } from './rtcFocus';
import { screenShareIsInAppOnly, useCallSupport, type CallSupport } from './callSupport';

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

describe('screenShareIsInAppOnly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      'iPhone',
      {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        platform: 'iPhone',
        maxTouchPoints: 5,
      },
      true,
    ],
    [
      'iPad',
      {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        platform: 'iPad',
        maxTouchPoints: 5,
      },
      true,
    ],
    [
      'iPadOS desktop mode (MacIntel + touch)',
      {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      },
      true,
    ],
    [
      'macOS desktop',
      {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      },
      false,
    ],
    [
      'Linux touch laptop',
      {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0',
        platform: 'Linux x86_64',
        maxTouchPoints: 10,
      },
      false,
    ],
    [
      'Android phone',
      {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/142.0.0.0',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      },
      false,
    ],
  ])('returns %s for %s', (_label, nav, expected) => {
    vi.stubGlobal('navigator', nav);
    expect(screenShareIsInAppOnly()).toBe(expected);
  });
});
