import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { createSessionId } from '../../state/sessions';
import { loadCanvasState, saveCanvasState } from './canvasStateStore';

// A page may save on every keystroke; the store sees at most one write per interval.
const SAVE_INTERVAL_MS = 500;

export type CanvasState = {
  /** False until the saved state is read, so the page never starts without it. */
  ready: boolean;
  /** The latest state, including saves not yet written. */
  read: () => string | undefined;
  save: (json: string) => void;
};

/** The state a canvas's pages save on this device, shared by all versions of the canvas. */
export function useCanvasState(mx: MatrixClient, canvasId: string): CanvasState {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  // Without IndexedDB (private browsing in some browsers), pages simply start without state.
  const [ready, setReady] = useState(typeof indexedDB === 'undefined');
  const latest = useRef<string>();
  const pending = useRef<{ json: string; timer: number }>();
  const flushNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    latest.current = undefined;
    if (typeof indexedDB !== 'undefined') {
      setReady(false);
      loadCanvasState(sessionId, canvasId)
        .catch(() => undefined)
        .then((json) => {
          if (!alive) return;
          latest.current = json;
          setReady(true);
        });
    }
    const flush = () => {
      if (!pending.current) return;
      window.clearTimeout(pending.current.timer);
      saveCanvasState(sessionId, canvasId, pending.current.json).catch(() => undefined);
      pending.current = undefined;
    };
    flushNow.current = flush;
    return () => {
      alive = false;
      flush();
    };
  }, [sessionId, canvasId]);

  const save = useCallback((json: string) => {
    latest.current = json;
    if (typeof indexedDB === 'undefined') return;
    if (pending.current) {
      pending.current.json = json;
      return;
    }
    pending.current = {
      json,
      timer: window.setTimeout(() => flushNow.current(), SAVE_INTERVAL_MS),
    };
  }, []);
  const read = useCallback(() => latest.current, []);

  return { ready, read, save };
}
