import React from 'react';
import { JoinRule, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import type { RoomAccessJoinRule } from '../room-access';
import { RoomCard } from './RoomCard';

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({
      open,
      children,
      backdrop,
    }: {
      open?: boolean;
      children?: React.ReactNode;
      backdrop?: React.ReactNode;
    }) => (open ? React.createElement(React.Fragment, null, backdrop, children) : null),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('./style.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

type MockMatrixClient = Pick<
  MatrixClient,
  'getRoom' | 'joinRoom' | 'knockRoom' | 'on' | 'removeListener'
>;

const makeMx = (initialMembership?: string) => {
  let membership = initialMembership;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const room = {
    roomId: '!private:example.org',
    getMyMembership: () => membership,
  } as Room;
  const mx: MockMatrixClient = {
    getRoom: vi.fn((roomId: string) =>
      membership && roomId === '!private:example.org' ? room : null
    ),
    joinRoom: vi.fn(async () => ({} as never)),
    knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return mx as MatrixClient;
    }) as MatrixClient['on'],
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
      return mx as MatrixClient;
    }) as MatrixClient['removeListener'],
  };

  return {
    mx,
    setMembership: (nextMembership: string) => {
      membership = nextMembership;
      listeners.get(RoomEvent.MyMembership)?.forEach((listener) => listener(room, nextMembership));
    },
  };
};

const renderRoomCard = (joinRule: RoomAccessJoinRule, membership?: string) => {
  const matrix = makeMx(membership);
  const { mx } = matrix;
  let renderer: ReactTestRenderer;

  act(() => {
    renderer = create(
      <MatrixClientProvider value={mx as MatrixClient}>
        <RoomCard
          roomIdOrAlias="!private:example.org"
          allRooms={[]}
          name="Private room"
          joinRule={joinRule}
          viaServers={['one.example.org', 'two.example.org']}
          renderTopicViewer={() => null}
        />
      </MatrixClientProvider>
    );
  });

  return { renderer: renderer!, mx, setMembership: matrix.setMembership };
};

describe('RoomCard room access', () => {
  it('offers a join request when the room allows knocking', () => {
    const { renderer } = renderRoomCard(JoinRule.Knock);

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('offers the same request flow for knock-restricted rooms', () => {
    const { renderer } = renderRoomCard('knock_restricted');

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('explains the request and offers an optional message before knocking', async () => {
    const { renderer } = renderRoomCard(JoinRule.Knock);
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    expect(accessButton).toBeDefined();
    await act(async () => {
      accessButton?.props.onClick();
      await Promise.resolve();
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Request to join Private room'))
    ).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('An admin will review your request.'))
    ).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('Message (optional)'))
    ).toHaveLength(1);
  });

  it('submits a trimmed request message through the supplied servers and confirms success', async () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Knock);
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => accessButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');

    await act(async () => {
      form.props.onSubmit?.({
        preventDefault: vi.fn(),
        target: {
          reasonInput: { value: '  I work with this team.  ' },
        },
      });
      await Promise.resolve();
    });

    expect(mx.knockRoom).toHaveBeenCalledWith('!private:example.org', {
      reason: 'I work with this team.',
      viaServers: ['one.example.org', 'two.example.org'],
    });
    expect(mx.joinRoom).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === 'form')).toHaveLength(0);
  });

  it('restores the sent state from synced knock membership', () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Knock, 'knock');

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      0
    );
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('updates the pending state when sync publishes knock membership', () => {
    const { renderer, setMembership } = renderRoomCard(JoinRule.Knock, 'leave');

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );

    act(() => setMembership('knock'));

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
  });

  it('keeps the request dialog open and explains a failed knock', async () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Knock);
    vi.mocked(mx.knockRoom).mockRejectedValueOnce(new Error('Requests are paused'));
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => accessButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: 'Please let me in' } },
      });
      await Promise.resolve();
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Requests are paused'))
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === 'form')).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('does not carry a successful request into a different room', async () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Knock);
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => accessButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx as MatrixClient}>
          <RoomCard
            roomIdOrAlias="!other:example.org"
            allRooms={[]}
            name="Other private room"
            joinRule={JoinRule.Knock}
            renderTopicViewer={() => null}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('clears the sent state when sync reports that the knock ended', async () => {
    const { renderer, setMembership } = renderRoomCard(JoinRule.Knock, 'leave');
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => accessButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);

    act(() => setMembership('leave'));

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });
});
