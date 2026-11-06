// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { RoomCard } from '../RoomCard';

// A click on an Explore card, away from its topic, does what the card's button does: View for a
// joined room, Join or Request to join for one the person is not in.

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

const ROOM_ID = '!studio:example.org';

const makeClient = () =>
  ({
    getRoom: vi.fn(() => null),
    getRooms: vi.fn(() => []),
    getUserId: vi.fn(() => '@viewer:example.org'),
    joinRoom: vi.fn(() => new Promise(() => undefined)),
    knockRoom: vi.fn(() => new Promise(() => undefined)),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MatrixClient);

const renderCard = (
  mx: MatrixClient,
  props: Partial<React.ComponentProps<typeof RoomCard>> = {}
) => {
  const onView = vi.fn();
  render(
    <MatrixClientProvider value={mx}>
      <RoomCard
        roomIdOrAlias={ROOM_ID}
        roomId={ROOM_ID}
        viaServers={['one.example.org']}
        allRooms={[]}
        name="Open Studio"
        topic="Anyone may drop in"
        memberCount={8}
        joinRule={JoinRule.Public}
        accessStatus={AsyncStatus.Success}
        onView={onView}
        renderTopicViewer={(_name, topic) => <p>{topic}</p>}
        {...props}
      />
    </MatrixClientProvider>
  );
  return onView;
};

afterEach(cleanup);

describe('an Explore room card', () => {
  it('joins a room the person is not in on a click on the card', () => {
    const mx = makeClient();
    renderCard(mx);
    fireEvent.click(screen.getByText('Open Studio'));
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM_ID, { viaServers: ['one.example.org'] });
  });

  it('opens a joined room on a click on the card, as View does', () => {
    const mx = makeClient();
    const onView = renderCard(mx, { allRooms: [ROOM_ID] });
    fireEvent.click(screen.getByText('8 Members'));
    expect(onView).toHaveBeenCalledWith(ROOM_ID);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('opens the request to join for a room that takes requests', () => {
    const mx = makeClient();
    renderCard(mx, { joinRule: JoinRule.Knock });
    fireEvent.click(screen.getByText('Open Studio'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('keeps the topic button for the full topic, and waits while access is checked', () => {
    const mx = makeClient();
    renderCard(mx, { accessStatus: AsyncStatus.Loading });
    fireEvent.click(screen.getByText('Open Studio'));
    expect(mx.joinRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Anyone may drop in' }));
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });
});
