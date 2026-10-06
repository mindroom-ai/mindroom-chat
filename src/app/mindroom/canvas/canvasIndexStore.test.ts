import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CanvasListEntry,
  forgetCanvas,
  listCanvases,
  recordCanvas,
  recordCanvasUpdate,
  subscribeCanvasList,
} from './canvasIndexStore';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const AGENT = '@mindroom_planner:example.org';

const entry = (overrides: Partial<CanvasListEntry> = {}): CanvasListEntry => ({
  canvasId: '$canvas',
  roomId: '!room:example.org',
  threadId: '$thread',
  agentUserId: AGENT,
  title: 'Plans',
  createdTs: 1,
  updatedTs: 1,
  shared: false,
  ...overrides,
});

describe('canvasIndexStore', () => {
  it('lists the canvases of one session', async () => {
    await recordCanvas('session-a', entry());
    await recordCanvas('session-a', entry({ canvasId: '$other', title: 'Other' }));
    expect((await listCanvases('session-a')).map((listed) => listed.title).sort()).toEqual([
      'Other',
      'Plans',
    ]);
    expect(await listCanvases('session-b')).toEqual([]);
  });

  it('never rolls a newer update back to an older copy of the request', async () => {
    await recordCanvas('session-a', entry({ title: 'Plans v2', updatedTs: 5 }));
    await recordCanvas('session-a', entry({ title: 'Plans', updatedTs: 1, shared: true }));
    expect(await listCanvases('session-a')).toEqual([
      entry({ title: 'Plans v2', updatedTs: 5, shared: true }),
    ]);
  });

  it('applies an update from the canvas agent when it is the newest', async () => {
    await recordCanvas('session-a', entry({ updatedTs: 5 }));
    await recordCanvasUpdate('session-a', '$canvas', '@mallory:example.org', 'Forged', 9);
    await recordCanvasUpdate('session-a', '$canvas', AGENT, 'Older', 4);
    expect((await listCanvases('session-a'))[0]).toMatchObject({ title: 'Plans', updatedTs: 5 });
    await recordCanvasUpdate('session-a', '$canvas', AGENT, 'Plans v2', 6);
    expect((await listCanvases('session-a'))[0]).toMatchObject({
      title: 'Plans v2',
      updatedTs: 6,
    });
    // An update of a canvas not listed has nothing to apply to.
    await recordCanvasUpdate('session-a', '$unknown', AGENT, 'Lost', 7);
    expect(await listCanvases('session-a')).toHaveLength(1);
  });

  it('forgets a deleted canvas', async () => {
    await recordCanvas('session-a', entry());
    await forgetCanvas('session-a', '$canvas');
    expect(await listCanvases('session-a')).toEqual([]);
  });

  it('tells listeners of every write, since another tab may have made the change first', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasList(listener);
    await recordCanvas('session-a', entry());
    await recordCanvas('session-a', entry());
    await recordCanvasUpdate('session-a', '$canvas', AGENT, 'Plans v2', 2);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    await forgetCanvas('session-a', '$canvas');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
