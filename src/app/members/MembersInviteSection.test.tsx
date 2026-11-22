// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerUserDirectoryUser } from './userDirectoryCache';
import { MembersInviteSection } from './MembersInviteSection';

const mocks = vi.hoisted(() => ({
  invite: vi.fn<(roomId: string, userId: string) => Promise<unknown>>(),
  setPowerLevel: vi.fn<(roomId: string, userId: string, level: number) => Promise<unknown>>(),
  search: {
    suggestions: [] as ServerUserDirectoryUser[],
    isFetching: false,
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { ...(await importOriginal<object>()), useTranslation: () => ({ t: translateFromEn }) };
});
const mockClient = {
  getSafeUserId: () => '@me:example.org',
  invite: mocks.invite,
  setPowerLevel: mocks.setPowerLevel,
  on: vi.fn(),
  removeListener: vi.fn(),
};
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mockClient,
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('./useInviteUserSearch', () => ({
  useInviteUserSearch: () => mocks.search,
}));

const memberships: Record<string, string> = {};
const roomState = {
  isSpace: false,
  powerLevels: {
    users: { '@me:example.org': 100 },
    users_default: 0,
    state_default: 50,
    events: { 'm.room.power_levels': 100 },
  } as Record<string, unknown>,
};
const room = {
  roomId: '!room:example.org',
  client: mockClient,
  isSpaceRoom: () => roomState.isSpace,
  getMember: (userId: string) =>
    memberships[userId] ? { userId, membership: memberships[userId] } : null,
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (eventType: string) =>
        eventType === 'm.room.power_levels'
          ? { getContent: () => roomState.powerLevels }
          : undefined,
    }),
  }),
} as unknown as Room;

const marco = { userId: '@marco:example.org', displayName: 'Marco Rossi' };
const mara = { userId: '@mara:example.org', displayName: 'Mara Lind' };

const section = () => screen.getByRole('group', { name: 'Not in this room' });
// Each row's name comes first and carries its full text as a title, for a name cut short.
const rowNames = () =>
  within(section())
    .getAllByRole('listitem')
    .map((row) => row.querySelector('[title]')?.getAttribute('title'));

const isOff = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';
const inviteButton = (name: string) => screen.getByRole('button', { name: `Invite ${name}` });

describe('MembersInviteSection', () => {
  beforeEach(() => {
    mocks.search = { suggestions: [marco, mara], isFetching: false };
    mocks.invite.mockReset();
    mocks.setPowerLevel.mockReset();
    roomState.isSpace = false;
    roomState.powerLevels = {
      users: { '@me:example.org': 100 },
      users_default: 0,
      state_default: 50,
      events: { 'm.room.power_levels': 100 },
    };
    Object.keys(memberships).forEach((userId) => delete memberships[userId]);
    memberships['@maya:example.org'] = 'join';
  });
  afterEach(cleanup);

  it('lists the directory matches outside the room, each with its own Invite button', () => {
    render(<MembersInviteSection room={room} query="ma" />);

    expect(rowNames()).toEqual(['Marco Rossi', 'Mara Lind']);
    expect(within(section()).getByText('@marco:example.org')).toBeTruthy();
    // The user ID tells apart two people of the same name.
    expect(
      screen.getByRole('button', { name: 'Invite Marco Rossi', description: '@marco:example.org' })
    ).toBeTruthy();
    expect(inviteButton('Mara Lind')).toBeTruthy();
  });

  it('invites on one click and keeps the row in place, marked invited', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.invite.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { rerender } = render(<MembersInviteSection room={room} query="ma" />);

    const button = inviteButton('Mara Lind');
    fireEvent.click(button);
    expect(mocks.invite).toHaveBeenCalledWith('!room:example.org', '@mara:example.org');
    expect(isOff(button)).toBe(true);
    fireEvent.click(button);
    expect(mocks.invite).toHaveBeenCalledTimes(1);

    // The invitation lands: the search no longer offers Mara, but her row stays where it was,
    // with the same button, which keeps the keyboard focus.
    await act(async () => finish({}));
    mocks.search = { suggestions: [marco], isFetching: false };
    rerender(<MembersInviteSection room={room} query="ma" />);

    expect(rowNames()).toEqual(['Marco Rossi', 'Mara Lind']);
    expect(screen.queryByRole('button', { name: 'Invite Mara Lind' })).toBeNull();
    const sent = within(section()).getByRole('button', { name: 'Invited' });
    expect(sent).toBe(button);
    expect(isOff(sent)).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Invited Mara Lind.');

    // A new search starts over, also when it comes back to the first one.
    rerender(<MembersInviteSection room={room} query="mar" />);
    expect(rowNames()).toEqual(['Marco Rossi']);
    rerender(<MembersInviteSection room={room} query="ma" />);
    expect(rowNames()).toEqual(['Marco Rossi']);
  });

  it('shows why an invitation failed under the user ID, and lets it be tried again', async () => {
    mocks.invite.mockRejectedValueOnce(new Error('You are not allowed to invite'));
    const { rerender } = render(<MembersInviteSection room={room} query="ma" />);

    await act(async () => {
      fireEvent.click(inviteButton('Marco Rossi'));
    });

    // The sentence for people, and the error's own text, in full.
    expect(within(section()).getByRole('alert').textContent).toBe(
      'Something went wrong.You are not allowed to invite'
    );
    expect(within(section()).getByText('@marco:example.org')).toBeTruthy();
    expect(isOff(inviteButton('Marco Rossi'))).toBe(false);

    // Invited some other way, he drops out with his failure, and stays out even once he
    // declines, under the same search and later ones.
    memberships['@marco:example.org'] = 'invite';
    mocks.search = { suggestions: [mara], isFetching: false };
    rerender(<MembersInviteSection room={room} query="ma" />);
    expect(rowNames()).toEqual(['Mara Lind']);
    memberships['@marco:example.org'] = 'leave';
    rerender(<MembersInviteSection room={room} query="ma" />);
    expect(rowNames()).toEqual(['Mara Lind']);
    mocks.search = { suggestions: [], isFetching: false };
    rerender(<MembersInviteSection room={room} query="jor" />);
    expect(screen.queryByRole('group', { name: 'Not in this room' })).toBeNull();
  });

  it('keeps an invitation still going in view through a new search, and shows its failure', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    mocks.invite.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { rerender } = render(<MembersInviteSection room={room} query="ma" />);
    fireEvent.click(inviteButton('Mara Lind'));

    // The next name is typed before the invitation is answered.
    mocks.search = { suggestions: [], isFetching: false };
    rerender(<MembersInviteSection room={room} query="jor" />);
    expect(rowNames()).toEqual(['Mara Lind']);
    expect(isOff(inviteButton('Mara Lind'))).toBe(true);

    await act(async () => fail(new Error('The remote server did not answer')));
    rerender(<MembersInviteSection room={room} query="" />);
    expect(within(section()).getByRole('alert').textContent).toContain(
      'The remote server did not answer'
    );
    expect(isOff(inviteButton('Mara Lind'))).toBe(false);
    expect(mocks.invite).toHaveBeenCalledTimes(1);
  });

  it('offers a full user ID the directory does not return, unless it is already in the room', async () => {
    mocks.search = { suggestions: [], isFetching: true };
    const { rerender } = render(<MembersInviteSection room={room} query=" @sam:other.org " />);
    expect(rowNames()).toEqual(['@sam:other.org']);
    expect(inviteButton('@sam:other.org')).toBeTruthy();

    mocks.search = { suggestions: [], isFetching: false };
    rerender(<MembersInviteSection room={room} query="@maya:example.org" />);
    expect(screen.queryByRole('group', { name: 'Not in this room' })).toBeNull();
    rerender(<MembersInviteSection room={room} query="@me:example.org" />);
    expect(screen.queryByRole('group', { name: 'Not in this room' })).toBeNull();

    rerender(<MembersInviteSection room={room} query=" @sam:other.org " />);
    // An invitation to it takes the directory's name for it once the directory answers.
    mocks.invite.mockRejectedValueOnce(new Error('Not now'));
    await act(async () => {
      fireEvent.click(inviteButton('@sam:other.org'));
    });
    mocks.search = {
      suggestions: [{ userId: '@sam:other.org', displayName: 'Sam Lee' }],
      isFetching: false,
    };
    rerender(<MembersInviteSection room={room} query=" @sam:other.org " />);
    expect(rowNames()).toEqual(['Sam Lee']);
    expect(within(section()).getByRole('alert').textContent).toContain('Not now');
  });

  it('says it is searching while the directory has not answered, and hides when nothing matches', () => {
    mocks.search = { suggestions: [], isFetching: true };
    const { rerender } = render(<MembersInviteSection room={room} query="jor" />);
    expect(within(section()).getByText('Searching users')).toBeTruthy();

    mocks.search = { suggestions: [], isFetching: false };
    rerender(<MembersInviteSection room={room} query="jor" />);
    expect(screen.queryByRole('group', { name: 'Not in this room' })).toBeNull();
  });

  it('offers Make moderator after inviting a MindRoom agent and replaces it once granted', async () => {
    const helper = { userId: '@mindroom_helper:example.org', displayName: 'Helper' };
    mocks.search = { suggestions: [helper], isFetching: false };
    mocks.invite.mockResolvedValueOnce({});
    mocks.setPowerLevel.mockResolvedValueOnce({});
    render(<MembersInviteSection room={room} query="help" />);

    expect(screen.queryByRole('button', { name: /Make .* moderator/i })).toBeNull();

    await act(async () => {
      fireEvent.click(inviteButton('Helper'));
    });
    expect(mocks.invite).toHaveBeenCalledWith('!room:example.org', '@mindroom_helper:example.org');
    expect(mocks.setPowerLevel).not.toHaveBeenCalled();

    const makeMod = screen.getByRole('button', { name: 'Make Helper moderator' });
    expect(isOff(makeMod)).toBe(false);

    await act(async () => {
      fireEvent.click(makeMod);
    });
    expect(mocks.setPowerLevel).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_helper:example.org',
      50
    );
    expect(screen.queryByRole('button', { name: 'Make Helper moderator' })).toBeNull();
    const granted = within(section()).getByRole('button', { name: 'Moderator' });
    expect(isOff(granted)).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Gave moderator rights to Helper.');
  });

  it('keeps the invite and shows an error when Make moderator fails', async () => {
    const helper = { userId: '@mindroom_helper:example.org', displayName: 'Helper' };
    mocks.search = { suggestions: [helper], isFetching: false };
    mocks.invite.mockResolvedValueOnce({});
    mocks.setPowerLevel.mockRejectedValueOnce(new Error('Forbidden'));
    render(<MembersInviteSection room={room} query="help" />);

    await act(async () => {
      fireEvent.click(inviteButton('Helper'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make Helper moderator' }));
    });

    expect(within(section()).getByRole('button', { name: 'Invited' })).toBeTruthy();
    expect(within(section()).getByRole('alert').textContent).toContain('Forbidden');
    expect(isOff(screen.getByRole('button', { name: 'Make Helper moderator' }))).toBe(false);
  });

  it.each([
    {
      label: 'human user',
      candidate: { userId: '@marco:example.org', displayName: 'Marco Rossi' },
      setup: () => undefined,
    },
    {
      label: 'owner account',
      candidate: { userId: '@mindroom_router:example.org', displayName: 'Owner' },
      setup: () => undefined,
    },
    {
      label: 'foreign-server agent',
      candidate: { userId: '@mindroom_helper:other.org', displayName: 'Remote Helper' },
      setup: () => undefined,
    },
    {
      label: 'Space room',
      candidate: { userId: '@mindroom_helper:example.org', displayName: 'Helper' },
      setup: () => {
        roomState.isSpace = true;
      },
    },
    {
      label: 'viewer cannot change power levels',
      candidate: { userId: '@mindroom_helper:example.org', displayName: 'Helper' },
      setup: () => {
        roomState.powerLevels = {
          users: { '@me:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 100 },
        };
      },
    },
  ])('hides Make moderator after inviting $label', async ({ candidate, setup }) => {
    setup();
    mocks.search = { suggestions: [candidate], isFetching: false };
    mocks.invite.mockResolvedValueOnce({});
    render(<MembersInviteSection room={room} query="test" />);

    await act(async () => {
      fireEvent.click(inviteButton(candidate.displayName));
    });

    expect(within(section()).getByRole('button', { name: 'Invited' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make .* moderator/i })).toBeNull();
  });
});
