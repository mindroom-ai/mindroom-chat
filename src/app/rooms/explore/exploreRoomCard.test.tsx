// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { RoomCard } from '../RoomCard';
import { renderTopicText } from './exploreRoomCard';

// The Explore card's full topic, in the card's real focus trap: the trap holds the dialog itself,
// so Escape, a press outside and Close each close it.

vi.unmock('../../ui/glass/GlassPrimitives');
vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

const mx = {
  getRoom: vi.fn(() => null),
  getRooms: vi.fn(() => []),
  getUserId: vi.fn(() => '@viewer:example.org'),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const topic = () => screen.queryByRole('dialog', { name: 'Open Studio' });
const openTopic = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Anyone may drop in' }));
  await waitFor(() => expect(topic()).not.toBeNull());
};

it('closes the full topic on Escape, on a press outside and on Close', async () => {
  // Treats attached elements as laid out, so the real focus trap finds its controls in jsdom.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
    this: HTMLElement
  ) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
  render(
    <MatrixClientProvider value={mx}>
      <RoomCard
        roomIdOrAlias="!studio:example.org"
        roomId="!studio:example.org"
        allRooms={[]}
        name="Open Studio"
        topic="Anyone may drop in"
        joinRule={JoinRule.Public}
        accessStatus={AsyncStatus.Success}
        renderTopicViewer={renderTopicText}
      />
    </MatrixClientProvider>
  );

  await openTopic();
  fireEvent.keyDown(topic()!, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(topic()).toBeNull());

  await openTopic();
  fireEvent.mouseDown(document.body);
  fireEvent.click(document.body);
  await waitFor(() => expect(topic()).toBeNull());

  await openTopic();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(topic()).toBeNull());
});
