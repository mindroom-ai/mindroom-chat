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

// A MindRoom team as a room holds it: every agent's user ID starts with `mindroom_`, the router
// among them, beside the people.
const scout = member('@mindroom_scout:x', 'Scout');
const router = member('@mindroom_router:x', 'RouterAgent');
const maya = member('@maya:x', 'Maya');
const mind = member('@mindroom_mind:x', 'Mind');
const quill = member('@mindroom_quill:x', 'Quill');
const forge = member('@mindroom_forge:x', 'Forge');
const grace = member('@grace:x', 'Grace');
const researcher = member('@mindroom_research:x', 'Researcher');
let members: RoomMember[] = [];

const mentions = vi.hoisted(() => ({ createMentionElement: vi.fn() }));
vi.mock('../utils', () => ({
  createMentionElement: mentions.createMentionElement,
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
vi.mock('../../avatars/UserAvatar', () => ({ UserAvatar: () => null }));

const keydownListeners = new Set<(event: KeyboardEvent) => void>();
const originalWindow = globalThis.window;
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  mentions.createMentionElement.mockClear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      performance: globalThis.performance,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: (_type: string, handler: (event: KeyboardEvent) => void) =>
        keydownListeners.add(handler),
      removeEventListener: (_type: string, handler: (event: KeyboardEvent) => void) =>
        keydownListeners.delete(handler),
    },
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  keydownListeners.clear();
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

type MentionRoom = Parameters<typeof UserMentionAutocomplete>[0]['room'];

/** A room whose loaded timeline holds one message from each sender, oldest first. */
const roomWithSenders = (...senders: RoomMember[]): MentionRoom =>
  ({
    roomId: '!r:x',
    getLiveTimeline: () => ({
      getEvents: () =>
        senders.map((sender, index) => ({
          getType: () => 'm.room.message',
          getSender: () => sender.userId,
          getTs: () => 1_000 + index,
          isState: () => false,
        })),
    }),
    getThreads: () => [],
  } as unknown as MentionRoom);

const picker = (
  text: string,
  onSuggestionsChange?: (hasSuggestions: boolean) => void,
  room: MentionRoom = { roomId: '!r:x' } as unknown as Room
) => (
  <UserMentionAutocomplete
    room={room}
    editor={{} as Editor}
    query={{ range: {} as never, prefix: '@', text }}
    requestClose={() => undefined}
    onSuggestionsChange={onSuggestionsChange}
  />
);

const render = (element: React.ReactElement, { searched }: { searched: boolean }) => {
  act(() => {
    renderer = create(element);
    if (searched) vi.runAllTimers();
  });
};

/** The names of the rows the menu shows, top first. */
const shownNames = (): unknown[] =>
  renderer!.root
    .findAllByType('button')
    .map((row) => row.findAll((node) => node.props.align === 'Left')[0]?.props.children);

/** Presses Tab and returns the user ID and label of the mention it inserts. */
const pickWithTab = (): [string, string] => {
  mentions.createMentionElement.mockClear();
  const tab = { key: 'Tab', preventDefault: () => undefined } as KeyboardEvent;
  act(() => keydownListeners.forEach((handler) => handler(tab)));
  expect(mentions.createMentionElement).toHaveBeenCalledTimes(1);
  const [userId, label] = mentions.createMentionElement.mock.calls[0] as [string, string];
  return [userId, label];
};

describe('UserMentionAutocomplete suggestions', () => {
  it('tells the host whether its menu shows, as the typed text changes', () => {
    members = [maya, grace];
    const onSuggestionsChange = vi.fn();
    render(picker('zz', onSuggestionsChange), { searched: true });
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

describe('UserMentionAutocomplete among MindRoom agents', () => {
  const team = () => [scout, mind, router, quill, forge];

  it.each([
    ['before the search answers', false],
    ['after the search answers', true],
  ])('takes Mind for "@Min" and Tab %s, not the agent listed first', (_when, searched) => {
    members = team();
    render(picker('Min'), { searched });

    expect(pickWithTab()[0]).toBe(mind.userId);
  });

  it('lists only the agent whose name matches, not every agent by the shared ID prefix', () => {
    members = team();
    render(picker('Min'), { searched: true });

    expect(shownNames()).toEqual(['Mind']);
  });

  it('puts Mind above the router in a room that lists the router first', () => {
    members = [router, mind, maya, grace];
    render(picker('Min'), { searched: true });

    expect(shownNames()[0]).toBe('Mind');
    expect(pickWithTab()[0]).toBe(mind.userId);
  });

  it('finds an agent by its user name without the shared prefix', () => {
    members = [scout, router, researcher];
    render(picker('resea'), { searched: true });

    expect(shownNames()).toEqual(['Researcher']);
  });

  it('puts whoever spoke last first when names match equally well', () => {
    members = [maya, mind];
    render(picker('M', undefined, roomWithSenders(maya, mind)), { searched: true });
    expect(shownNames()).toEqual(['Mind', 'Maya']);

    act(() => renderer!.unmount());
    render(picker('M', undefined, roomWithSenders(mind, maya)), { searched: true });
    expect(shownNames()).toEqual(['Maya', 'Mind']);
  });

  it('never puts the router above another agent its name matches as well', () => {
    members = [router, researcher];
    render(picker('R', undefined, roomWithSenders(researcher, router)), { searched: true });

    expect(shownNames()).toEqual(['Researcher', 'RouterAgent']);
  });

  it('inserts the mention as "@" and the display name, as the message shows it', () => {
    members = team();
    render(picker('Qui'), { searched: true });

    expect(pickWithTab()).toEqual([quill.userId, '@Quill']);
  });
});
