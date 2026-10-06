import { useCallback, useEffect, useRef } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { uploadMindroomLongTextSidecar } from '../messages/longTextSidecarUpload';
import type { CanvasSaved } from './canvasDocument';
import { MAX_CANVAS_RESPONSE_CONTENT_BYTES } from './canvasMessages';

/** A copy of a canvas's saved state for its agent, a reference to the canvas, read by `read_canvas_state`. */
export const CANVAS_STATE_EVENT_TYPE = 'io.mindroom.canvas_state';

// Shared once the user pauses, so a drag or a typed sentence is one event, not one per change.
const SHARE_AFTER_MS = 5000;

const contentBytes = (content: object): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;

/**
 * Keeps a copy of what a canvas saves in its room, for a canvas whose request shares its state; the
 * returned call takes each save. The copy never starts a turn; the agent reads it when it wants.
 */
export function useCanvasStateShare(
  mx: MatrixClient,
  room: Room,
  canvasId: string,
  enabled: boolean
): (saved: CanvasSaved) => void {
  const latest = useRef<CanvasSaved>();
  const shared = useRef<string>();
  const timer = useRef<number>();
  const shareNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    latest.current = undefined;
    shared.current = undefined;
    const share = () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      const saved = latest.current;
      const text = JSON.stringify([saved?.json, saved?.inputs]);
      if (!saved || text === shared.current) return;
      shared.current = text;
      const relation = { rel_type: 'm.reference', event_id: canvasId };
      const content = {
        version: 1,
        ...(saved.json === undefined ? {} : { json: saved.json }),
        ...(saved.inputs === undefined ? {} : { inputs: saved.inputs }),
        'm.relates_to': relation,
      };
      // State too large for one event goes as a long-text sidecar, as large canvas answers do.
      const event =
        contentBytes(content) <= MAX_CANVAS_RESPONSE_CONTENT_BYTES
          ? Promise.resolve<Record<string, unknown>>(content)
          : uploadMindroomLongTextSidecar(mx, room, content, {
              body: 'Canvas state',
              'm.relates_to': relation,
            });
      event
        .then((sent) => mx.sendEvent(room.roomId, CANVAS_STATE_EVENT_TYPE as never, sent as never))
        .catch(() => {
          // The next save shares again.
          if (shared.current === text) shared.current = undefined;
        });
    };
    shareNow.current = share;
    // Leaving the panel shares what is still waiting.
    return () => {
      if (timer.current !== undefined) share();
    };
  }, [mx, room, canvasId]);

  return useCallback(
    (saved: CanvasSaved) => {
      if (!enabled) return;
      latest.current = saved;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => shareNow.current(), SHARE_AFTER_MS);
    },
    [enabled]
  );
}
