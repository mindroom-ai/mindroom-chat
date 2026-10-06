import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { PINNED_CANVASES_TYPE, readPinnedCanvases, writePinnedCanvases } from './pinnedCanvases';

describe('pinnedCanvases', () => {
  it('reads valid pins once each, in order', () => {
    expect(
      readPinnedCanvases({
        canvases: [
          { room_id: '!a:example.org', event_id: '$one' },
          { room_id: 'not-a-room', event_id: '$bad' },
          { room_id: '!a:example.org', event_id: 'not-an-event' },
          'junk',
          { room_id: '!b:example.org', event_id: '$two' },
          { room_id: '!b:example.org', event_id: '$one' },
        ],
      })
    ).toEqual([
      { roomId: '!a:example.org', canvasId: '$one' },
      { roomId: '!b:example.org', canvasId: '$two' },
    ]);
    expect(readPinnedCanvases(undefined)).toEqual([]);
    expect(readPinnedCanvases({ canvases: 'junk' })).toEqual([]);
  });

  it('writes room and event IDs only', async () => {
    const setAccountData = vi.fn().mockResolvedValue({});
    await writePinnedCanvases({ setAccountData } as unknown as MatrixClient, [
      { roomId: '!a:example.org', canvasId: '$one' },
    ]);
    expect(setAccountData).toHaveBeenCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [{ room_id: '!a:example.org', event_id: '$one' }],
    });
  });
});
