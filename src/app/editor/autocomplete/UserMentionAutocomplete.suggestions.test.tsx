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

const mentions = vi.hoisted(() => ({
  createMentionElement: vi.fn((id: string, name: string, highlight: boolean) => ({
    id,
    name,
    highlight,
  })),
}));
const levels = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const replaceWithElement = vi.hoisted(() => vi.fn());
vi.mock('../utils', () => ({
  createMentionElement: mentions.createMentionElement,
  replaceWithElement,
  moveCursor: vi.fn(),
}));
vi.mock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: () => levels.current,
}));
vi.mock('../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => members }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x' }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
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
  levels.current = {};
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
  const call = mentions.createMentionElement.mock.calls[0] as [string, string, boolean];
  const [userId, label] = call;
  return [userId, label];
};

/** The visible text of each suggestion row. */
const rowTexts = (): string[] =>
  renderer!.root
    .findAllByType('button')
    .map((button) => button.findAll((node) => typeof node.props.children === 'string'))
    .map((nodes) => nodes.map((node) => node.props.children as string).join(' '));

const renderQuery = (text: string) => render(picker(text, () => undefined), { searched: true });

describe('UserMentionAutocomplete @room', () => {
  beforeEach(() => {
    members = [maya, grace];
  });

  it('offers @room to someone with the power to notify the room, and inserts its pill', () => {
    // Moderators (50) may notify the room by default.
    levels.current = { users: { '@me:x': 50 } };
    renderQuery('roo');
    expect(rowTexts()).toEqual([expect.stringContaining('@room')]);

    act(() => {
      renderer!.root.findAllByType('button')[0]!.props.onClick();
    });
    expect(replaceWithElement).toHaveBeenCalledWith(
      {},
      {},
      { id: '@room', name: '@room', highlight: true }
    );
  });

  it('follows the room notification level the power levels set', () => {
    levels.current = { users: { '@me:x': 10 }, notifications: { room: 10 } };
    renderQuery('r');
    expect(rowTexts().some((row) => row.includes('@room'))).toBe(true);
  });

  it('offers no @room to a member below the room notification level', () => {
    levels.current = { users: { '@me:x': 0 } };
    renderQuery('room');
    expect(renderer!.toJSON()).toBeNull();
  });

  it('puts @room after matching members until the whole word is typed', () => {
    levels.current = { users: { '@me:x': 100 } };
    const rose = member('@rose:x', 'Room Rose');
    members.push(rose);
    try {
      renderQuery('roo');
      expect(rowTexts()[0]).toContain('Room Rose');
      expect(rowTexts()[1]).toContain('@room');
      act(() => renderer!.unmount());
      renderer = undefined;
      renderQuery('room');
      expect(rowTexts()[0]).toContain('@room');
    } finally {
      members.pop();
    }
  });
});

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

  it('shows and inserts a name without its direction controls, as the room names the member', () => {
    // matrix-js-sdk drops U+202D and U+202E from display names; the other controls stay in them.
    const quinn = member('@quinn:x', 'Quinn \u2067relyat\u2069\u200f');
    members = [quinn];
    render(picker('Qui'), { searched: true });

    expect(shownNames()).toEqual(['Quinn relyat']);
    expect(pickWithTab()).toEqual([quinn.userId, '@Quinn relyat']);
  });
});
