import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { prewarmMindroomLongTextSidecars } from './longTextPrewarm';

const hydrateMock = vi.hoisted(() => vi.fn(async () => ({})));
const cachedMock = vi.hoisted(() => vi.fn(() => undefined as Record<string, unknown> | undefined));

vi.mock('./longText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./longText')>();
  return {
    ...actual,
    getCachedMindroomLongTextContent: cachedMock,
    hydrateMindroomLongTextSource: hydrateMock,
  };
});
vi.mock('./MindroomLongTextText', () => ({
  downloadMindroomLongTextSidecarText: vi.fn(async () => '{}'),
}));

const mx = {} as MatrixClient;

const makeLongTextEvent = (mxcUri: string): MatrixEvent =>
  ({
    getContent: () => ({
      msgtype: 'm.file',
      body: 'preview',
      url: mxcUri,
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    }),
  } as unknown as MatrixEvent);

const makePlainEvent = (): MatrixEvent =>
  ({ getContent: () => ({ msgtype: 'm.text', body: 'hi' }) } as unknown as MatrixEvent);

describe('prewarmMindroomLongTextSidecars', () => {
  it('hydrates each unique uncached sidecar once and skips plain events', async () => {
    hydrateMock.mockClear();
    cachedMock.mockReturnValue(undefined);

    await prewarmMindroomLongTextSidecars(
      mx,
      [
        makeLongTextEvent('mxc://s/a'),
        makePlainEvent(),
        makeLongTextEvent('mxc://s/a'), // duplicate identity
        makeLongTextEvent('mxc://s/b'),
      ],
      false
    );

    expect(hydrateMock).toHaveBeenCalledTimes(2);
    const uris = hydrateMock.mock.calls.map((call) => (call[0] as { mxcUri: string }).mxcUri);
    expect(uris.sort()).toEqual(['mxc://s/a', 'mxc://s/b']);
    // Cache owner is the Matrix client, matching the render path's keying.
    expect(hydrateMock.mock.calls[0][2]).toBe(mx);
  });

  it('skips sidecars that are already cached', async () => {
    hydrateMock.mockClear();
    cachedMock.mockReturnValue({ body: 'cached' });

    await prewarmMindroomLongTextSidecars(mx, [makeLongTextEvent('mxc://s/c')], false);

    expect(hydrateMock).not.toHaveBeenCalled();
  });

  it('stops fetching once cancelled', async () => {
    hydrateMock.mockClear();
    cachedMock.mockReturnValue(undefined);
    let cancelled = false;
    hydrateMock.mockImplementation(async () => {
      cancelled = true; // cancel after the first fetch begins
      return {};
    });

    await prewarmMindroomLongTextSidecars(
      mx,
      // 4 unique sources but concurrency 3: the pool starts 3, the 4th is
      // never picked up after cancellation.
      ['mxc://s/1', 'mxc://s/2', 'mxc://s/3', 'mxc://s/4'].map(makeLongTextEvent),
      false,
      () => cancelled
    );

    expect(hydrateMock.mock.calls.length).toBeLessThan(4);
  });
});
