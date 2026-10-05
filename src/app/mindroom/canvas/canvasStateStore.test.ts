import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCanvasStateDbName,
  loadCanvasState,
  MAX_STORED_CANVAS_STATES,
  saveCanvasState,
} from './canvasStateStore';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('canvasStateStore', () => {
  it('keeps one saved state per canvas and session', async () => {
    expect(await loadCanvasState('session-a', '$canvas')).toBeUndefined();
    await saveCanvasState('session-a', '$canvas', '{"slots":[1,2]}');
    await saveCanvasState('session-a', '$canvas', '{"slots":[3]}');
    await saveCanvasState('session-a', '$other', '"other"');
    expect(await loadCanvasState('session-a', '$canvas')).toBe('{"slots":[3]}');
    expect(await loadCanvasState('session-a', '$other')).toBe('"other"');
    expect(await loadCanvasState('session-b', '$canvas')).toBeUndefined();
  });

  it('forgets the canvases saved longest ago beyond its limit', async () => {
    for (let index = 0; index <= MAX_STORED_CANVAS_STATES; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveCanvasState('session-a', `$canvas-${index}`, `${index}`);
    }
    expect(await loadCanvasState('session-a', '$canvas-0')).toBeUndefined();
    expect(await loadCanvasState('session-a', '$canvas-1')).toBe('1');
    expect(await loadCanvasState('session-a', `$canvas-${MAX_STORED_CANVAS_STATES}`)).toBe(
      `${MAX_STORED_CANVAS_STATES}`
    );
  });

  it('reports a failed write once and keeps the state saved before it', async () => {
    await saveCanvasState('session-a', '$canvas', '"before"');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { put } = IDBObjectStore.prototype;
    const failedPut = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function abortedPut(this: IDBObjectStore, ...args) {
        const request = put.apply(this, args);
        this.transaction.abort();
        return request;
      });
    await expect(saveCanvasState('session-a', '$canvas', '"after"')).rejects.toThrow();
    failedPut.mockRestore();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(await loadCanvasState('session-a', '$canvas')).toBe('"before"');
  });

  it('names one database per session, so logout can delete it', () => {
    expect(getCanvasStateDbName('session-a')).toBe('mindroom-canvas-state::session-a');
  });
});
