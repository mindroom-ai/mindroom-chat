import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'slate';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { UserMentionAutocomplete } from './UserMentionAutocomplete';

const member = (userId: string, name: string) =>
  ({
    userId,
    name,
    rawDisplayName: name,
    membership: 'join',
    getMxcAvatarUrl: () => undefined,
  } as unknown as RoomMember);
const members = [member('@maya:x', 'Maya'), member('@grace:x', 'Grace'), member('@mind:x', 'Mind')];

const replaceWithElement = vi.hoisted(() => vi.fn());
vi.mock('../utils', () => ({
  createMentionElement: (id: string) => ({ id }),
  replaceWithElement,
  moveCursor: () => undefined,
}));
vi.mock('../../../hooks/useRoomMembers', () => ({ useRoomMembers: () => members }));
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x' }),
}));
vi.mock('../../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../glass/GlassPrimitives', () => ({
  MenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock('../../user-avatar', () => ({ UserAvatar: () => null }));

const keydownListeners = new Set<(evt: KeyboardEvent) => void>();
const originalWindow = globalThis.window;

beforeEach(() => {
  vi.useFakeTimers();
  let now = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      // Each match takes 10 ms, so the search yields after one member and has not answered yet.
      performance: {
        now: () => {
          now += 10;
          return now;
        },
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: (_type: string, handler: (evt: KeyboardEvent) => void) =>
        keydownListeners.add(handler),
      removeEventListener: (_type: string, handler: (evt: KeyboardEvent) => void) =>
        keydownListeners.delete(handler),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  keydownListeners.clear();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

describe('UserMentionAutocomplete', () => {
  it('takes a member matching the typed text on Tab before the search answers', () => {
    const room = { roomId: '!r:x', getCanonicalAlias: () => null, getMember: () => null };
    act(() => {
      create(
        <UserMentionAutocomplete
          room={room as unknown as Room}
          editor={{} as Editor}
          query={{ range: {} as never, prefix: '@', text: 'Min' }}
          requestClose={() => undefined}
        />
      );
    });

    const tab = { key: 'Tab', preventDefault: () => undefined } as KeyboardEvent;
    act(() => keydownListeners.forEach((handler) => handler(tab)));

    expect(replaceWithElement).toHaveBeenCalledWith({}, {}, { id: '@mind:x' });
  });
});
