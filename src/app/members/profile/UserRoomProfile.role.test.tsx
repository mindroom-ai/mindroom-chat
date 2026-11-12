import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../../computer/agentServer';
import { UserRoomProfile } from './UserRoomProfile';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:x', getUser: () => null }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: () => ({}),
}));
vi.mock('../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => false }),
}));
vi.mock('../../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../../matrix/hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => [] }));
vi.mock('../useMemberPowerTag', () => ({ useGetMemberPowerTag: () => () => undefined }));
vi.mock('../useUserProfile', () => ({ useUserProfile: () => ({}) }));
vi.mock('../../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../../calls/agent/AgentCallButton', () => ({ AgentCallButton: () => null }));
vi.mock('../../avatars/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('./MutualRoomsChip', () => ({ MutualRoomsChip: () => null }));
vi.mock('./PowerChip', () => ({ PowerChip: () => null }));
vi.mock('./UserChips', () => ({ ServerChip: () => null, ShareChip: () => null }));
vi.mock('./UserModeration', () => ({ UserModeration: () => null }));

const HELPER = '@mindroom_helper:x';
const QUINN = '@quinn:x';
const ROLE = 'Answers questions about the codebase';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const state = (type: string, sender: string, content: Record<string, unknown>) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: sender,
    sender,
    room_id: '!r:x',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

/** A room the helper agent and Quinn joined, each with the server state given. */
const roomWith = async (published: Record<string, Record<string, unknown>>) => {
  const room = new Room(
    '!r:x',
    createClient({ baseUrl: 'http://localhost:1', userId: '@me:x' }),
    '@me:x'
  );
  await room.addLiveEvents(
    [HELPER, QUINN].flatMap((userId) => [
      state('m.room.member', userId, {
        membership: 'join',
        displayname: userId === HELPER ? 'Helper' : 'Quinn',
      }),
      ...(published[userId] ? [state(MINDROOM_SERVER_EVENT, userId, published[userId])] : []),
    ]),
    { addToState: true }
  );
  return room;
};

/** The card's lines of text, from its heading on, without the buttons. */
const cardText = (room: Room, userId: string): string[] => {
  act(() => {
    renderer = create(<UserRoomProfile room={room} userId={userId} onDone={() => undefined} />);
  });
  return renderer!.root
    .findAll(
      (node) => typeof node.type === 'string' && node.children.every((c) => typeof c === 'string')
    )
    .map((node) => node.children.join(''))
    .filter(Boolean);
};

describe('UserRoomProfile role', () => {
  it('shows the role an agent publishes under its name', async () => {
    const room = await roomWith({ [HELPER]: { api_origin: 'http://localhost:8765', role: ROLE } });
    const text = cardText(room, HELPER);
    expect(text.slice(0, 3)).toEqual(['Helper', HELPER, ROLE]);
  });

  it('shows no role line for an agent of an older runtime, which publishes none', async () => {
    const room = await roomWith({ [HELPER]: { api_origin: 'http://localhost:8765' } });
    const withRole = cardText(await roomWith({ [HELPER]: { role: ROLE } }), HELPER);
    act(() => renderer?.unmount());
    expect(cardText(room, HELPER)).toEqual(withRole.filter((line) => line !== ROLE));
  });

  it("leaves a person's card as it was, whatever state the person writes", async () => {
    const plain = cardText(await roomWith({}), QUINN);
    act(() => renderer?.unmount());
    expect(cardText(await roomWith({ [QUINN]: { role: 'Room administrator' } }), QUINN)).toEqual(
      plain
    );
  });
});
