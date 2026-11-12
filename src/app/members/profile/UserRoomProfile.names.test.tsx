import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { UserRoomProfile } from './UserRoomProfile';

const shown = vi.hoisted(() => ({
  profile: {} as { displayName?: string },
  alt: undefined as unknown,
  callName: undefined as unknown,
}));

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
vi.mock('../useUserProfile', () => ({ useUserProfile: () => shown.profile }));
vi.mock('../useAgentRoles', () => ({ useAgentRoles: () => new Map() }));
vi.mock('../../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../../calls/agent/AgentCallButton', () => ({
  AgentCallButton: ({ displayName }: { displayName: string }) => {
    shown.callName = displayName;
    return null;
  },
}));
vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ alt }: { alt: string }) => {
    shown.alt = alt;
    return null;
  },
}));
vi.mock('./MutualRoomsChip', () => ({ MutualRoomsChip: () => null }));
vi.mock('./PowerChip', () => ({ PowerChip: () => null }));
vi.mock('./UserChips', () => ({ ServerChip: () => null, ShareChip: () => null }));
vi.mock('./UserModeration', () => ({ UserModeration: () => null }));

const QUINN = '@quinn:x';
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  shown.profile = {};
  shown.alt = undefined;
  shown.callName = undefined;
});

/** A room where Quinn is a member under `rawDisplayName`, or not a member at all. */
const room = (rawDisplayName?: string) =>
  ({
    roomId: '!r:x',
    getMember: (userId: string) =>
      rawDisplayName !== undefined && userId === QUINN
        ? { userId, rawDisplayName, membership: 'join', getMxcAvatarUrl: () => undefined }
        : null,
  } as unknown as Room);

const heading = (inRoom: Room): string => {
  act(() => {
    renderer = create(<UserRoomProfile room={inRoom} userId={QUINN} onDone={() => undefined} />);
  });
  return renderer!.root.findByType('h2').children.join('');
};

describe('UserRoomProfile names', () => {
  it('names a member without the direction controls in their name, as the room does', () => {
    // matrix-js-sdk drops U+202D and U+202E from display names; the other controls stay in them.
    expect(heading(room('Quinn \u2067relyat\u2069\u200f'))).toBe('Quinn relyat');
    expect(shown.alt).toBe('Quinn relyat');
    expect(shown.callName).toBe('Quinn relyat');
  });

  it('names someone who is not a member by their profile name, without its direction controls', () => {
    shown.profile = { displayName: 'Quinn \u202erelyat\u202c' };
    expect(heading(room())).toBe('Quinn relyat');
  });
});
