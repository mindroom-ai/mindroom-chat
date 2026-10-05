// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { loadCanvasState, saveCanvasState } from './canvasStateStore';
import { type CanvasState, useCanvasState } from './useCanvasState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mx = {
  getHomeserverUrl: () => 'https://example.org',
  getSafeUserId: () => '@alice:example.org',
} as unknown as MatrixClient;
const sessionId = createSessionId('https://example.org', '@alice:example.org');

let container: HTMLDivElement;
let root: Root;
let state: CanvasState;

function Probe() {
  state = useCanvasState(mx, '$canvas');
  return null;
}

const render = () =>
  act(() => {
    root.render(<Probe />);
  });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useCanvasState', () => {
  it('reads the saved state before the page may start', async () => {
    await saveCanvasState(sessionId, '$canvas', '{"slots":[1]}');
    render();
    expect(state.ready).toBe(false);
    await vi.waitFor(() => expect(state.ready).toBe(true));
    expect(state.read()).toBe('{"slots":[1]}');
  });

  it('writes the latest of quick saves once, and on leaving at the latest', async () => {
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    act(() => {
      state.save('{"draft":"a"}');
      state.save('{"draft":"ab"}');
    });
    expect(state.read()).toBe('{"draft":"ab"}');
    expect(await loadCanvasState(sessionId, '$canvas')).toBeUndefined();
    await vi.waitFor(async () =>
      expect(await loadCanvasState(sessionId, '$canvas')).toBe('{"draft":"ab"}')
    );
    act(() => state.save('{"draft":"abc"}'));
    act(() => root.unmount());
    // Leaving writes at once rather than when the save interval ends.
    await vi.waitFor(
      async () => expect(await loadCanvasState(sessionId, '$canvas')).toBe('{"draft":"abc"}'),
      { timeout: 300 }
    );
    root = createRoot(container);
  });
});
