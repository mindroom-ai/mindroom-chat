import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  MatrixClient,
  MatrixError,
  MatrixEvent,
  MemoryStore,
  Room,
  RoomVersionStability,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { createSubRoom } from '../../../client-sdk/room';
import { CreateSubRoomDialog } from './CreateSubRoomDialog';
import { createSubRoom as createAppSubRoom } from './createSubRoom';

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

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

/**
 * Renders New Sub-room for `parent` under `config`, signed in to the parent's client, and submits it
 * with the name `name`; returns the rendered tree.
 */
const submitDialog = async (
  parent: Room,
  config: ClientConfig,
  name: string,
  requestClose = vi.fn()
) => {
  act(() => {
    renderer = create(
      <ClientConfigProvider value={config}>
        <MatrixClientProvider value={parent.client}>
          <CreateSubRoomDialog parent={parent} requestClose={requestClose} />
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
  it('creates a room open to the members of its parent only, listed under it', async () => {
    const { parent, createRoom, sendStateEvent } = setup();
    const requestClose = vi.fn();
    await submitDialog(parent, {}, 'Ideas', requestClose);

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
    const { parent, createRoom } = setup(0);
    const rendered = await submitDialog(parent, {}, 'Ideas');

    expect(createRoom).not.toHaveBeenCalled();
    expect(rendered.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    expect(JSON.stringify(rendered.toJSON())).toContain(
      "You can't change the rooms listed under !parent:example.org"
    );
  });
});

describe("the client SDK's createSubRoom", () => {
  it.each<[string, ClientConfig, { encrypted: boolean; creationContent: object }]>([
    [
      'a policy that turns encryption and federation off',
      { createRoom: { defaultEncryption: false, defaultFederation: false } },
      { encrypted: false, creationContent: { 'm.federate': false } },
    ],
    ['no policy', {}, { encrypted: true, creationContent: {} }],
  ])('creates the room New Sub-room creates, for %s', async (_, config, expected) => {
    const { parent, createRoom, sendStateEvent } = setup();
    await submitDialog(parent, config, ' Ideas ');

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
  });

  it('reads the policy of the configuration the app provides as it is called', async () => {
    const { parent, createRoom } = setup();
    const provide = (config: ClientConfig) => <ClientConfigProvider value={config} />;
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

describe('createSubRoom, when the parent does not list the new room', () => {
  /**
   * The server of `setup`, where each room created is a new one and the parent refuses, rate
   * limited, to list the first `failures` of them. `hidden` gives the rooms created that the parent
   * does not list and that the user has not left and forgotten.
   */
  const refusingLinks = (failures: number) => {
    const { mx, parent, createRoom, sendStateEvent } = setup();
    const created: string[] = [];
    const listed: string[] = [];
    const left: string[] = [];
    const forgotten: string[] = [];
    let refusals = failures;
    createRoom.mockImplementation(async () => {
      created.push(`!new${created.length + 1}:example.org`);
      return { room_id: created[created.length - 1]! };
    });
    sendStateEvent.mockImplementation((async (...[, , , stateKey]: unknown[]) => {
      if (refusals-- > 0) {
        throw new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests' }, 429);
      }
      listed.push(String(stateKey));
      return { event_id: '$child' };
    }) as never);
    vi.spyOn(mx, 'getStateEvent').mockImplementation(async (_roomId, _type, stateKey) => {
      if (listed.includes(stateKey)) return { via: ['example.org'] };
      throw new MatrixError({ errcode: 'M_NOT_FOUND', error: 'Event not found' }, 404);
    });
    vi.spyOn(mx, 'leave').mockImplementation(async (roomId) => {
      left.push(roomId);
      return {};
    });
    vi.spyOn(mx, 'forget').mockImplementation(async (roomId) => {
      if (left.includes(roomId)) forgotten.push(roomId);
      return {};
    });
    const hidden = () =>
      created.filter((roomId) => !listed.includes(roomId) && !forgotten.includes(roomId));
    return { parent, listed, hidden };
  };

  it('leaves no room behind when the link fails once, and trying again makes one listed room', async () => {
    const { parent, listed, hidden } = refusingLinks(1);

    await expect(createAppSubRoom(parent, 'Ideas', undefined)).rejects.toThrow('Too many requests');
    expect(hidden()).toEqual([]);
    await expect(createAppSubRoom(parent, 'Ideas', undefined)).resolves.toBe('!new2:example.org');

    expect(listed).toEqual(['!new2:example.org']);
    expect(hidden()).toEqual([]);
  });

  it('leaves no room behind, and rejects with the failure, when the link keeps failing', async () => {
    const { parent, listed, hidden } = refusingLinks(Infinity);

    await expect(createAppSubRoom(parent, 'Ideas', undefined)).rejects.toMatchObject({
      errcode: 'M_LIMIT_EXCEEDED',
      httpStatus: 429,
    });
    expect(listed).toEqual([]);
    expect(hidden()).toEqual([]);
  });
});
