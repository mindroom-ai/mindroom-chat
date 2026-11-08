import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { UserModeration } from './UserModeration';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));

const BANNED = '@quinn:x';
const MODERATOR = '@morgan:x';
const NO_ABILITIES = { kick: false, ban: false, unban: false, invite: false, changePower: false };

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const moderator = { userId: MODERATOR, rawDisplayName: 'Morgan <i>Lee</i>', membership: 'join' };
const banned = (reason: string) => ({
  userId: BANNED,
  membership: 'ban',
  events: {
    member: {
      getSender: () => MODERATOR,
      getContent: () => ({ membership: 'ban', reason }),
      getPrevContent: () => ({ membership: 'join' }),
    },
  },
});

const text = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : ((node as { children?: unknown[] }).children ?? []).map(text).join('');

/** The lines of the moderation note, each as its text reads. */
const noteLines = (reason: string): string[] => {
  const members = [moderator, banned(reason)];
  const room = {
    roomId: '!r:x',
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    getMembers: () => members,
  } as unknown as Room;
  act(() => {
    renderer = create(<UserModeration room={room} userId={BANNED} abilities={NO_ABILITIES} />);
  });
  return renderer!.root
    .findAll((node) => node.props.size === 'T200' && typeof node.type !== 'string')
    .map(text);
};

describe('UserModeration note', () => {
  it('shows a reason with its direction controls as code points, and names as text', () => {
    expect(noteLines('Posted a \u202ekcilc\u202c link')).toEqual([
      'Banned by: Morgan <i>Lee</i>',
      'Reason: Posted a <U+202E>kcilc<U+202C> link',
    ]);
  });
});
