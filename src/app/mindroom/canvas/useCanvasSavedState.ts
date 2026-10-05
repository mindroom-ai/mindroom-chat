import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { createSessionId, listSessions } from '../../state/sessions';
import { loadCanvasState, saveCanvasState } from './canvasStateStore';

// A page may save on every keystroke; the store sees at most one write per interval.
const SAVE_INTERVAL_MS = 500;

export type CanvasSavedState = {
  /** False until the saved state is read or fails to be, so the page starts from any state there is. */
  ready: boolean;
  /** The latest state, including saves not yet written. */
  read: () => string | undefined;
  save: (json: string) => void;
};

/** The state a canvas's pages save on this device, shared by all versions of the canvas. */
export function useCanvasSavedState(mx: MatrixClient, canvasId: string): CanvasSavedState {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const [ready, setReady] = useState(false);
  const latest = useRef<string>();
  // Saves stay in memory when the saved state could not be read, so they cannot overwrite it.
  const writable = useRef(false);
  const pending = useRef<{ json: string; timer: number }>();
  const flushNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    latest.current = undefined;
    writable.current = false;
    setReady(false);
    // Without IndexedDB (private browsing in some browsers) the read fails and pages start without state.
    loadCanvasState(sessionId, canvasId).then(
      (json) => {
        if (!alive) return;
        latest.current = json;
        writable.current = true;
        setReady(true);
      },
      () => {
        if (alive) setReady(true);
      }
    );
    const flush = () => {
      if (!pending.current) return;
      window.clearTimeout(pending.current.timer);
      const { json } = pending.current;
      pending.current = undefined;
      // Removing an account deletes its saved state before the panel unmounts; a write now would restore it.
      if (!listSessions().some((session) => session.sessionId === sessionId)) return;
      saveCanvasState(sessionId, canvasId, json).catch(() => undefined);
    };
    flushNow.current = flush;
    return () => {
      alive = false;
      flush();
    };
  }, [sessionId, canvasId]);

  const save = useCallback((json: string) => {
    latest.current = json;
    if (!writable.current) return;
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
