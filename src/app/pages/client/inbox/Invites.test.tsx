// @vitest-environment jsdom

import React from 'react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { InviteCard, makeInviteData } from './Invites';

vi.mock('../../../components/page', () => ({}));
vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../components/room-avatar', () => ({ RoomAvatar: () => null }));
vi.mock('../../../components/room-topic-viewer', () => ({ RoomTopicViewer: () => null }));
vi.mock('../../../components/message', () => ({ Time: () => null }));

it.each([
  ['@maya:matrix.localhost', 'Maya', 'Maya (@maya:matrix.localhost)'],
  ['@maya:matrix.localhost', undefined, '@maya:matrix.localhost'],
  // A display name shaped like someone else's ID still shows the real ID.
  [
    '@mallory:evil.example',
    '@maya:matrix.localhost',
    '@maya:matrix.localhost (@mallory:evil.example)',
  ],
])('shows inviter %s named %s as "%s"', (inviterId, displayname, expected) => {
  const myUserId = '@me:matrix.localhost';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: myUserId });
  const roomId = '!invite:matrix.localhost';
  const room = new Room(roomId, mx, myUserId);
  // Stripped invite state: the server includes the inviter's member event.
  room.currentState.setStateEvents([
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: inviterId,
      sender: inviterId,
      content: { membership: 'join', displayname },
    }),
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: myUserId,
      sender: inviterId,
      content: { membership: 'invite' },
    }),
  ]);

  const renderer = create(
    <MatrixClientProvider value={mx}>
      <InviteCard
        invite={makeInviteData(mx, room, false)}
        hour24Clock={false}
        dateFormatString="D MMM YYYY"
        onNavigate={vi.fn()}
        hideAvatar={false}
      />
    </MatrixClientProvider>
  );

  const sender = renderer.root.find((node) => node.type === 'b' && node.props.title !== undefined);
  expect(sender.children).toEqual([expected]);
  expect(sender.props.title).toBe(inviterId);
});
