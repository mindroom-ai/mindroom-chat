import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { CreateSubRoomDialog } from './CreateSubRoomDialog';

const navigation = vi.hoisted(() => ({ navigate: vi.fn(), navigateRoom: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigation.navigate,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: navigation.navigateRoom }),
}));
vi.mock('../../ui/CreateDialogFrame', () => ({
  CreateDialogFrame: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const ME = '@me:example.org';
const PARENT = '!parent:example.org';
const NEW_ROOM = '!new:example.org';

/** The parent room, already open only to the members of a space it sits in. */
const setup = () => {
  const mx = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: ME,
    store: new MemoryStore(),
  });
  const parent = new Room(PARENT, mx, ME);
  parent.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.join_rules',
      state_key: '',
      sender: ME,
      room_id: PARENT,
      event_id: '$rules',
      content: {
        join_rule: 'restricted',
        allow: [{ type: 'm.room_membership', room_id: '!space:example.org' }],
      },
    }),
    new MatrixEvent({
      type: 'm.space.parent',
      state_key: '!space:example.org',
      sender: ME,
      room_id: PARENT,
      event_id: '$space',
      content: { canonical: true, via: ['example.org'] },
    }),
  ]);
  mx.store.storeRoom(parent);
  // Sync already has the new room, so the dialog opens it at once.
  mx.store.storeRoom(new Room(NEW_ROOM, mx, ME));
  const createRoom = vi.spyOn(mx, 'createRoom').mockResolvedValue({ room_id: NEW_ROOM });
  const sendStateEvent = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$child' });
  return { mx, parent, createRoom, sendStateEvent };
};

describe('CreateSubRoomDialog', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.clearAllMocks();
  });

  it('creates a room open to the members of its parent only, listed under it', async () => {
    const { mx, parent, createRoom, sendStateEvent } = setup();
    const requestClose = vi.fn();
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <CreateSubRoomDialog parent={parent} requestClose={requestClose} />
          </MatrixClientProvider>
        </ClientConfigProvider>
      );
    });
    const root = renderer!.root;

    act(() => {
      root.findByType('input').props.onChange({ currentTarget: { value: 'Ideas' } });
    });
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));

    const request = createRoom.mock.calls[0]?.[0];
    expect(request?.name).toBe('Ideas');
    expect(request?.initial_state).toEqual(
      expect.arrayContaining([
        {
          type: 'm.room.join_rules',
          state_key: '',
          content: {
            join_rule: 'restricted',
            allow: [{ type: 'm.room_membership', room_id: PARENT }],
          },
        },
        {
          type: 'm.space.parent',
          state_key: PARENT,
          content: { canonical: true, via: expect.any(Array) },
        },
      ])
    );
    expect(request?.initial_state?.filter((event) => event.type === 'm.space.parent')).toHaveLength(
      1
    );
    expect(sendStateEvent).toHaveBeenCalledWith(
      PARENT,
      'm.space.child',
      expect.objectContaining({ via: expect.any(Array) }),
      NEW_ROOM
    );
    expect(requestClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(navigation.navigateRoom).toHaveBeenCalledWith(NEW_ROOM));
  });
});
