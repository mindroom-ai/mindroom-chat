// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
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
