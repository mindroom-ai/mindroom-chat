// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { getMemberDisplayName } from '../../matrix/room';
import { renderMatrixMention } from './react-custom-html-parser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER = '@viewer:example.org';
const AGENT = '@mindroom_scout:example.org';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const member = (room: Room, userId: string, displayname: string) =>
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      room_id: room.roomId,
      sender: userId,
      state_key: userId,
      event_id: `$member-${displayname}`,
      content: { membership: 'join', displayname },
    }),
  ]);

it('names a mentioned member once the room learns them, not by Matrix ID', async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: VIEWER });
  const room = new Room('!room:example.org', mx, VIEWER, { lazyLoadMembers: true });
  vi.spyOn(mx, 'getRoom').mockReturnValue(room);
  // Lazy loading left out the agent, who has not spoken yet; loading the members finds it.
  let loaded!: () => void;
  vi.spyOn(room, 'loadMembersIfNeeded').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        loaded = () => {
          member(room, AGENT, 'Scout');
          resolve(true);
        };
      })
  );

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(renderMatrixMention(mx, room.roomId, `https://matrix.to/#/${AGENT}`, {}, 'Scout'))
  );
  const link = container.querySelector(`[data-mention-id="${AGENT}"]`);
  expect(link?.textContent).toBe(AGENT);

  await act(async () => loaded());
  expect(link?.textContent).toBe('@Scout');
  act(() => root.unmount());
});

/** The text of the mention `href` makes in `room` (without link text of its own), once loaded. */
const mentionText = async (room: Room, href: string): Promise<string | null | undefined> => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(renderMatrixMention(room.client, room.roomId, href, {}));
    await Promise.resolve();
  });
  const text = container.querySelector('a')?.textContent;
  act(() => root.unmount());
  return text;
};

const roomOf = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: VIEWER });
  const room = new Room('!room:example.org', mx, VIEWER, { lazyLoadMembers: true });
  vi.spyOn(mx, 'getRoom').mockImplementation((roomId) => (roomId === room.roomId ? room : null));
  vi.spyOn(room, 'loadMembersIfNeeded').mockResolvedValue(true);
  return room;
};

it('names a member whose name holds direction controls as their messages do: without them, with the ID after', async () => {
  const room = roomOf();
  const userId = '@quinn:example.org';
  member(room, userId, 'Quinn \u202erelyat\u202c');

  const text = await mentionText(room, `https://matrix.to/#/${userId}`);
  expect(text).toBe(`@${getMemberDisplayName(room, userId)}`);
  expect(text).toContain('Quinn relyat');
  expect(text).not.toMatch(/[\u202a-\u202e]/);
});

it('shows the direction controls of a user ID or room alias the room does not know as code points', async () => {
  // A link can name any ID; applied, the override would show `@ops<U+202E>nimda` as `@opsadmin`.
  const room = roomOf();
  expect(await mentionText(room, 'https://matrix.to/#/@ops%E2%80%AEnimda:example.org')).toBe(
    '@ops<U+202E>nimda:example.org'
  );
  expect(await mentionText(room, 'https://matrix.to/#/%23desk%E2%80%AEksed:example.org')).toBe(
    '#desk<U+202E>ksed:example.org'
  );
  expect(
    await mentionText(room, 'https://matrix.to/#/%23desk%E2%80%AEksed:example.org/$event')
  ).toBe('Message in #desk<U+202E>ksed:example.org');
});
