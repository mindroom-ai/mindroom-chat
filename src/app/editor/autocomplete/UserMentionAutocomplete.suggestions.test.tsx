import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
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
const members = [member('@maya:x', 'Maya'), member('@grace:x', 'Grace')];

vi.mock('../utils', () => ({
  createMentionElement: vi.fn(),
  replaceWithElement: vi.fn(),
  moveCursor: vi.fn(),
}));
vi.mock('../../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => members }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x' }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  MenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock('../../avatars/user-avatar/UserAvatar', () => ({ UserAvatar: () => null }));

const originalWindow = globalThis.window;
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      performance: globalThis.performance,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

const picker = (text: string, onSuggestionsChange: (hasSuggestions: boolean) => void) => (
  <UserMentionAutocomplete
    room={{ roomId: '!r:x' } as unknown as Room}
    editor={{} as Editor}
    query={{ range: {} as never, prefix: '@', text }}
    requestClose={() => undefined}
    onSuggestionsChange={onSuggestionsChange}
  />
);

describe('UserMentionAutocomplete suggestions', () => {
  it('tells the host whether its menu shows, as the typed text changes', () => {
    const onSuggestionsChange = vi.fn();
    act(() => {
      renderer = create(picker('zz', onSuggestionsChange));
      vi.runAllTimers();
    });
    expect(onSuggestionsChange).toHaveBeenLastCalledWith(false);
    expect(renderer!.toJSON()).toBeNull();

    act(() => {
      renderer!.update(picker('Ma', onSuggestionsChange));
      vi.runAllTimers();
    });
    expect(onSuggestionsChange).toHaveBeenLastCalledWith(true);
    expect(renderer!.toJSON()).not.toBeNull();
  });
});
