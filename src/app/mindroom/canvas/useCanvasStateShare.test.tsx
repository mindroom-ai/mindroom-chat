// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSaved } from './canvasDocument';
import { CANVAS_STATE_EVENT_TYPE, useCanvasStateShare } from './useCanvasStateShare';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sidecars = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../messages/longTextSidecarUpload', () => ({
  uploadMindroomLongTextSidecar: sidecars.upload,
}));

const sendEvent = vi.fn();
const mx = { sendEvent } as unknown as MatrixClient;
const room = { roomId: '!room:example.org' } as Room;
const reference = { rel_type: 'm.reference', event_id: '$canvas' };

let container: HTMLDivElement;
let root: Root;
let share: (saved: CanvasSaved) => void;

function Probe({ enabled }: { enabled: boolean }) {
  share = useCanvasStateShare(mx, room, '$canvas', enabled);
  return null;
}

const render = (enabled = true) =>
  act(() => {
    root.render(<Probe enabled={enabled} />);
  });
const sent = () => sendEvent.mock.calls.map(([, type, content]) => ({ type, content }));

beforeEach(() => {
  vi.useFakeTimers();
  sendEvent.mockReset().mockResolvedValue({ event_id: '$copy' });
  sidecars.upload.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useCanvasStateShare', () => {
  it('shares the latest state once the user pauses, as a reference to the canvas', async () => {
    render();
    share({ json: '{"done":[]}' });
    share({ json: '{"done":["tent"]}', inputs: '{"#rate":"7"}' });
    await act(async () => {
      vi.advanceTimersByTime(4_999);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: {
          version: 1,
          json: '{"done":["tent"]}',
          inputs: '{"#rate":"7"}',
          'm.relates_to': reference,
        },
      },
    ]);
  });

  it('waits for a pause: each save starts the wait again', async () => {
    render();
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    share({ json: '2' });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(sent().map(({ content }) => content.json)).toEqual(['2']);
  });

  it('shares nothing for a canvas that does not share, nor the same state twice', async () => {
    render(false);
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sendEvent).not.toHaveBeenCalled();

    render(true);
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it('shares what is still waiting when the panel closes', async () => {
    render();
    share({ inputs: '{"#rate":"3"}' });
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: { version: 1, inputs: '{"#rate":"3"}', 'm.relates_to': reference },
      },
    ]);
  });

  it('sends a large state as a long-text sidecar that keeps the reference', async () => {
    sidecars.upload.mockResolvedValue({
      msgtype: 'm.file',
      url: 'mxc://x/y',
      'm.relates_to': reference,
    });
    render();
    const json = JSON.stringify({ notes: 'x'.repeat(50_000) });
    share({ json });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(sidecars.upload).toHaveBeenCalledWith(
      mx,
      room,
      { version: 1, json, 'm.relates_to': reference },
      { body: 'Canvas state', 'm.relates_to': reference }
    );
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: { msgtype: 'm.file', url: 'mxc://x/y', 'm.relates_to': reference },
      },
    ]);
  });

  it('shares the same state again after a failed send', async () => {
    sendEvent.mockRejectedValueOnce(new Error('offline'));
    render();
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });
});
