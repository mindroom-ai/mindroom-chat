import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isPluginHiddenRow } from './pluginHiddenRows';

const ROOT = '$root';

const event = (id: string, relatesTo?: Record<string, unknown>) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    type: 'm.room.message',
    sender: '@mindroom_router:example.org',
    content: {
      msgtype: 'm.text',
      body: 'For the agents',
      ...(relatesTo ? { 'm.relates_to': relatesTo } : {}),
    },
  });

const inThread = (id: string) => event(id, { rel_type: 'm.thread', event_id: ROOT });
const contentOf = (shown: MatrixEvent) => shown.getContent();

describe('isPluginHiddenRow', () => {
  it('asks the plugins about a reply in a thread, with the content its row shows', () => {
    const hides = vi.fn(() => true);
    const content = { msgtype: 'm.text', body: 'Edited for the agents' };
    expect(isPluginHiddenRow(inThread('$reply'), () => content, hides)).toBe(true);
    expect(hides).toHaveBeenCalledWith({
      eventId: '$reply',
      roomId: '!room:example.org',
      type: 'm.room.message',
      sender: '@mindroom_router:example.org',
      content,
    });
  });

  it('keeps the row of a reply the route or a jump opened', () => {
    const hides = vi.fn(() => true);
    expect(isPluginHiddenRow(inThread('$reply'), contentOf, hides, new Set(['$reply']))).toBe(
      false
    );
    expect(isPluginHiddenRow(inThread('$other'), contentOf, hides, new Set(['$reply']))).toBe(true);
  });

  it('keeps the row of a reply the plugins keep', () => {
    expect(isPluginHiddenRow(inThread('$reply'), contentOf, () => false)).toBe(false);
  });

  it("keeps a thread's root and a message outside any thread, without asking", () => {
    const hides = vi.fn(() => true);
    const getContent = vi.fn(contentOf);
    const root = event(ROOT);
    root.setThreadId(ROOT);
    expect(isPluginHiddenRow(root, getContent, hides)).toBe(false);
    expect(isPluginHiddenRow(event('$plain'), getContent, hides)).toBe(false);
    expect(hides).not.toHaveBeenCalled();
    expect(getContent).not.toHaveBeenCalled();
  });

  it('keeps every row, reading no content, without a test (no renderer hides rows)', () => {
    const getContent = vi.fn(contentOf);
    expect(isPluginHiddenRow(inThread('$reply'), getContent, undefined)).toBe(false);
    expect(getContent).not.toHaveBeenCalled();
  });
});
