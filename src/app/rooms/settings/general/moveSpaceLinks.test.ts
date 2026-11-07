import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { moveSpaceLinks } from './moveSpaceLinks';

type Content = Record<string, unknown>;

/** A room stand-in whose live state answers `getStateEvents`; a joined chat room unless told. */
const fakeRoom = (
  state: Record<string, Record<string, Content>>,
  membership = 'join',
  space = false
) => ({
  getMyMembership: () => membership,
  isSpaceRoom: () => space,
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

type FakeRoom = ReturnType<typeof fakeRoom>;

const fakeClient = (
  rooms: Record<string, FakeRoom>,
  send: (
    roomId: string,
    type: string,
    content: Content,
    stateKey: string
  ) => Promise<unknown> = () => Promise.resolve({})
) => {
  const sendStateEvent = vi.fn(send);
  const client = {
    getRoom: (id: string) => rooms[id] ?? null,
    sendStateEvent,
  } as unknown as MatrixClient;
  return { client, sendStateEvent };
};

describe('moveSpaceLinks', () => {
  it('moves the space child to the new room and copies the parent links', async () => {
    const { client, sendStateEvent } = fakeClient({
      '!space': fakeRoom({ 'm.space.child': { '!old': { via: ['s'], suggested: true } } }),
      '!old': fakeRoom({ 'm.space.parent': { '!space': { via: ['s'], canonical: true } } }),
    });

    await expect(moveSpaceLinks(client, '!old', '!new', ['!space'])).resolves.toEqual([]);

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
    const { client, sendStateEvent } = fakeClient(
      {
        '!space': fakeRoom({ 'm.space.child': { '!old': {} } }),
        '!other': fakeRoom({ 'm.space.child': { '!old': { via: ['s'] } } }),
      },
      () => Promise.reject(new Error('M_FORBIDDEN'))
    );

    await expect(moveSpaceLinks(client, '!old', '!new', ['!space', '!other'])).resolves.toEqual([]);
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
  });

  it("lists the old room's children in the new room, and points the sub-rooms at it", async () => {
    const { client, sendStateEvent } = fakeClient({
      '!old': fakeRoom({
        'm.space.child': {
          '!sub': { via: ['s'], order: 'a' },
          '!plain': { via: ['s'] },
          '!removed': {},
        },
      }),
      '!sub': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'], canonical: true } } }),
      '!plain': fakeRoom({}),
    });

    await expect(moveSpaceLinks(client, '!old', '!new', [])).resolves.toEqual([]);

    expect(sendStateEvent.mock.calls).toEqual(
      expect.arrayContaining([
        ['!new', 'm.space.child', { via: ['s'], order: 'a' }, '!sub'],
        ['!new', 'm.space.child', { via: ['s'] }, '!plain'],
        ['!sub', 'm.space.parent', { via: ['s'], canonical: true }, '!new'],
      ])
    );
    // A room that did not name the old room gets no parent, and a removed child stays removed.
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
  });

  it('reports the children it could not point at the new room', async () => {
    const { client, sendStateEvent } = fakeClient(
      {
        '!old': fakeRoom({
          'm.space.child': {
            '!theirs': { via: ['s'] },
            '!unjoined': { via: ['s'] },
            '!left': { via: ['s'] },
            '!mine': { via: ['s'] },
          },
        }),
        '!theirs': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'], canonical: true } } }),
        '!left': fakeRoom(
          { 'm.space.parent': { '!old': { via: ['s'], canonical: true } } },
          'leave'
        ),
        '!mine': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'], canonical: true } } }),
      },
      (roomId) =>
        roomId === '!theirs' ? Promise.reject(new Error('M_FORBIDDEN')) : Promise.resolve({})
    );

    const unmoved = await moveSpaceLinks(client, '!old', '!new', []);

    expect([...unmoved].sort()).toEqual(['!left', '!theirs', '!unjoined']);
    // Each child is still listed in the new room; only rooms this account is in are written to.
    expect(sendStateEvent.mock.calls.filter(([roomId]) => roomId === '!new')).toHaveLength(4);
    expect(sendStateEvent.mock.calls.map(([roomId]) => roomId)).not.toContain('!left');
    expect(sendStateEvent.mock.calls.map(([roomId]) => roomId)).not.toContain('!unjoined');
  });

  it("lists a Space's rooms in the new Space; their own links to it are best effort", async () => {
    const { client, sendStateEvent } = fakeClient(
      {
        '!old': fakeRoom(
          {
            'm.space.child': {
              '!room': { via: ['s'] },
              '!theirs': { via: ['s'] },
              '!unjoined': { via: ['s'] },
            },
          },
          'join',
          true
        ),
        '!room': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'], canonical: true } } }),
        '!theirs': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'] } } }),
      },
      (roomId) =>
        roomId === '!theirs' ? Promise.reject(new Error('M_FORBIDDEN')) : Promise.resolve({})
    );

    await expect(moveSpaceLinks(client, '!old', '!new', [])).resolves.toEqual([]);

    expect(sendStateEvent.mock.calls).toEqual(
      expect.arrayContaining([
        ['!new', 'm.space.child', { via: ['s'] }, '!room'],
        ['!new', 'm.space.child', { via: ['s'] }, '!theirs'],
        ['!new', 'm.space.child', { via: ['s'] }, '!unjoined'],
        ['!room', 'm.space.parent', { via: ['s'], canonical: true }, '!new'],
        ['!theirs', 'm.space.parent', { via: ['s'] }, '!new'],
      ])
    );
  });

  it('reports a child the new room could not list', async () => {
    const { client } = fakeClient(
      {
        '!old': fakeRoom({ 'm.space.child': { '!sub': { via: ['s'] } } }),
        '!sub': fakeRoom({ 'm.space.parent': { '!old': { via: ['s'], canonical: true } } }),
      },
      (roomId) =>
        roomId === '!new' ? Promise.reject(new Error('M_LIMIT_EXCEEDED')) : Promise.resolve({})
    );

    await expect(moveSpaceLinks(client, '!old', '!new', [])).resolves.toEqual(['!sub']);
  });
});
