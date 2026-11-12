import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room, RoomMember } from 'matrix-js-sdk';
import { MemberRow } from './MembersDrawer';

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useUserRoomProfileState', () => ({ useOpenUserRoomProfile: () => vi.fn() }));
vi.mock('../matrix/hooks/useSpace', () => ({ useSpaceOptionally: () => undefined }));
vi.mock('../avatars/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('../matrix/room', () => ({ getMemberDisplayName: () => 'Helper' }));

const ROLE = 'Answers questions about the codebase';
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const room = { roomId: '!r:x' } as Room;
const member = { userId: '@mindroom_helper:x', membership: 'join' } as RoomMember;

/** The row's lines of text, in order. */
const rowText = (role?: string): string[] => {
  act(() => {
    renderer = create(<MemberRow room={room} member={member} role={role} />);
  });
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.children.length > 0 &&
        node.children.every((child) => typeof child === 'string')
    )
    .map((node) => node.children.join(''));
};

describe('MemberRow role', () => {
  it("shows an agent's role under its name, cut to one line", () => {
    expect(rowText(ROLE)).toEqual(['Helper', ROLE]);
    const roleText = renderer!.root.findAll((node) => node.props.children === ROLE);
    expect(roleText.some((node) => node.props.truncate === true)).toBe(true);
  });

  it('shows only the name without a role', () => {
    expect(rowText()).toEqual(['Helper']);
  });
});
