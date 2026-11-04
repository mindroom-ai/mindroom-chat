import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { moveSpaceLinks } from './moveSpaceLinks';

type Content = Record<string, unknown>;

/** A room stand-in whose live state answers `getStateEvents`. */
const fakeRoom = (state: Record<string, Record<string, Content>>) => ({
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (type: string, stateKey?: string) => {
        const byKey = state[type] ?? {};
        const event = (key: string) => ({ getContent: () => byKey[key], getStateKey: () => key });
        if (stateKey === undefined) return Object.keys(byKey).map(event);
        return byKey[stateKey] ? event(stateKey) : null;
      },
    }),
  }),
});

describe('moveSpaceLinks', () => {
  it('moves the space child to the new room and copies the parent links', async () => {
    const rooms: Record<string, ReturnType<typeof fakeRoom>> = {
      '!space': fakeRoom({ 'm.space.child': { '!old': { via: ['s'], suggested: true } } }),
      '!old': fakeRoom({ 'm.space.parent': { '!space': { via: ['s'], canonical: true } } }),
    };
    const sendStateEvent = vi.fn(() => Promise.resolve({}));
    const client = {
      getRoom: (id: string) => rooms[id] ?? null,
      sendStateEvent,
    } as unknown as MatrixClient;

    await moveSpaceLinks(client, '!old', '!new', ['!space']);

    expect(sendStateEvent.mock.calls).toEqual(
      expect.arrayContaining([
        ['!space', 'm.space.child', { via: ['s'], suggested: true }, '!new'],
        ['!space', 'm.space.child', {}, '!old'],
        ['!new', 'm.space.parent', { via: ['s'], canonical: true }, '!space'],
      ])
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
  });

  it('leaves spaces alone that no longer list the room, and survives refused writes', async () => {
    const rooms: Record<string, ReturnType<typeof fakeRoom>> = {
      '!space': fakeRoom({ 'm.space.child': { '!old': {} } }),
      '!other': fakeRoom({ 'm.space.child': { '!old': { via: ['s'] } } }),
    };
    const sendStateEvent = vi.fn(() => Promise.reject(new Error('M_FORBIDDEN')));
    const client = {
      getRoom: (id: string) => rooms[id] ?? null,
      sendStateEvent,
    } as unknown as MatrixClient;

    await expect(moveSpaceLinks(client, '!old', '!new', ['!space', '!other'])).resolves.toBe(
      undefined
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
  });
});
