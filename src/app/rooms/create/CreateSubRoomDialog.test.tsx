import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, MatrixEvent, MemoryStore, Room, RoomVersionStability } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { createSubRoom } from '../../../client-sdk/room';
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

/**
 * The parent room, already open only to the members of a space it sits in, where the user has
 * `myLevel` and listing rooms takes 50.
 */
const setup = (myLevel = 100) => {
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
      type: 'm.room.power_levels',
      state_key: '',
      sender: ME,
      room_id: PARENT,
      event_id: '$levels',
      content: { users: { [ME]: myLevel }, state_default: 50 },
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
  // The homeserver creates rooms in version 12 unless asked for another.
  vi.spyOn(mx, 'getCachedCapabilities').mockReturnValue({
    'm.room_versions': {
      default: '12',
      available: { '11': RoomVersionStability.Stable, '12': RoomVersionStability.Stable },
    },
  });
  return { mx, parent, createRoom, sendStateEvent };
};

/** Renders New Sub-room for `parent` under `config`, and submits it with the name `name`. */
const submitDialog = async (
  mx: MatrixClient,
  parent: Room,
  config: ClientConfig,
  name: string
): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <ClientConfigProvider value={config}>
        <MatrixClientProvider value={mx}>
          <CreateSubRoomDialog parent={parent} requestClose={vi.fn()} />
        </MatrixClientProvider>
      </ClientConfigProvider>
    );
  });
  const root = renderer!.root;
  act(() => {
    root.findByType('input').props.onChange({ currentTarget: { value: name } });
  });
  await act(async () => root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  return renderer!;
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

  it('refuses, with the reason, someone who may not list rooms in the parent', async () => {
    const { mx, parent, createRoom } = setup(0);
    act(() => {
      renderer = create(
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <CreateSubRoomDialog parent={parent} requestClose={vi.fn()} />
          </MatrixClientProvider>
        </ClientConfigProvider>
      );
    });
    const root = renderer!.root;
    act(() => {
      root.findByType('input').props.onChange({ currentTarget: { value: 'Ideas' } });
    });

    await act(async () => root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));

    expect(createRoom).not.toHaveBeenCalled();
    expect(root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "You can't change the rooms listed under !parent:example.org"
    );
  });
});

describe("the client SDK's createSubRoom", () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.clearAllMocks();
  });

  it.each<[string, ClientConfig, { encrypted: boolean; creationContent: object }]>([
    [
      'a policy that turns encryption and federation off',
      { createRoom: { defaultEncryption: false, defaultFederation: false } },
      { encrypted: false, creationContent: { 'm.federate': false } },
    ],
    ['no policy', {}, { encrypted: true, creationContent: {} }],
  ])('creates the room New Sub-room creates, for %s', async (_, config, expected) => {
    const { mx, parent, createRoom, sendStateEvent } = setup();
    renderer = await submitDialog(mx, parent, config, ' Ideas ');

    await expect(createSubRoom(parent, { name: ' Ideas ' })).resolves.toBe(NEW_ROOM);

    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[1]).toEqual(createRoom.mock.calls[0]);
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent.mock.calls[1]).toEqual(sendStateEvent.mock.calls[0]);
    const request = createRoom.mock.calls[0]?.[0];
    expect(request).toMatchObject({ name: 'Ideas', room_version: '12' });
    expect(request?.creation_content).toEqual(expected.creationContent);
    expect(request?.initial_state?.some(({ type }) => type === 'm.room.encryption')).toBe(
      expected.encrypted
    );
    expect(request?.initial_state).toContainEqual({
      type: 'm.room.join_rules',
      state_key: '',
      content: { join_rule: 'restricted', allow: [{ type: 'm.room_membership', room_id: PARENT }] },
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      PARENT,
      'm.space.child',
      expect.anything(),
      NEW_ROOM
    );
  });

  it('reads the policy of the configuration the app provides as it is called', async () => {
    const { mx, parent, createRoom } = setup();
    const provide = (config: ClientConfig) => (
      <ClientConfigProvider value={config}>
        <MatrixClientProvider value={mx} />
      </ClientConfigProvider>
    );
    act(() => {
      renderer = create(provide({}));
    });
    await createSubRoom(parent, { name: 'Ideas' });
    act(() => renderer!.update(provide({ createRoom: { defaultFederation: false } })));
    await createSubRoom(parent, { name: 'Ideas' });

    expect(createRoom.mock.calls.map(([request]) => request.creation_content)).toEqual([
      {},
      { 'm.federate': false },
    ]);
  });

  it('refuses, creating nothing, a parent where the user may not list rooms, and a blank name', async () => {
    act(() => {
      renderer = create(<ClientConfigProvider value={{}} />);
    });
    const refused = setup(0);
    await expect(createSubRoom(refused.parent, { name: 'Ideas' })).rejects.toThrow(
      "You can't change the rooms listed under !parent:example.org"
    );
    const allowed = setup();
    await expect(createSubRoom(allowed.parent, { name: '  ' })).rejects.toThrow(
      'A sub-room needs a name.'
    );

    [refused, allowed].forEach(({ createRoom, sendStateEvent }) => {
      expect(createRoom).not.toHaveBeenCalled();
      expect(sendStateEvent).not.toHaveBeenCalled();
    });
  });

  it('refuses, creating nothing, while the app provides no configuration', async () => {
    const { parent, createRoom } = setup();

    await expect(createSubRoom(parent, { name: 'Ideas' })).rejects.toThrow(
      'createSubRoom ran before the app provided its configuration'
    );

    expect(createRoom).not.toHaveBeenCalled();
  });
});
