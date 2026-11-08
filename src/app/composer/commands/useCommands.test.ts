import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import en from '../../i18n/englishResources';
import { CommandRefusedError } from './commandRefusal';
import { Command, type CommandContext, isActingCommand, runCommandAction } from './useCommands';

type FakeMember = { userId: string; membership: string };

const ME = '@me:home.org';

/** A room with `members` and the given state events, by type and state key. */
const fakeRoom = (members: FakeMember[], state: Record<string, unknown> = {}) =>
  ({
    roomId: '!room:home.org',
    getMembers: () => members,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    findEventById: () => undefined,
    currentState: {
      getStateEvents: (type: string, key: string) => {
        const content = state[`${type}|${key}`];
        return content ? { getContent: () => content } : null;
      },
    },
  } as unknown as Room);

const fakeClient = (overrides: Record<string, unknown> = {}) => {
  let direct: Record<string, string[]> = {};
  let ignored: string[] = ['@troll:else.org'];
  const mx = {
    getSafeUserId: () => ME,
    getDomain: () => 'home.org',
    invite: vi.fn(async () => ({})),
    kick: vi.fn(async (_roomId: string, _userId: string, _reason?: string) => ({})),
    ban: vi.fn(async () => ({})),
    unban: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})),
    joinRoom: vi.fn(async (address: string) => ({ roomId: `!joined-${address}` })),
    sendStateEvent: vi.fn(async () => ({})),
    redactEvent: vi.fn(async () => ({})),
    createMessagesRequest: vi.fn(async () => ({ chunk: [] })),
    getAccountData: () => ({ getContent: () => direct }),
    setAccountData: vi.fn(async (_type: string, content: Record<string, string[]>) => {
      direct = content;
    }),
    getIgnoredUsers: () => ignored,
    setIgnoredUsers: vi.fn(async (users: string[]) => {
      ignored = users;
    }),
    ...overrides,
  };
  return { mx, direct: () => direct, ignored: () => ignored };
};

const contextFor = (mx: unknown, room: Room): CommandContext => ({
  mx: mx as MatrixClient,
  room,
  openRoom: vi.fn(),
  openPath: vi.fn(),
});

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof CommandRefusedError ? error.refusal : error)
  );

const members: FakeMember[] = [
  { userId: ME, membership: 'join' },
  { userId: '@ann:spam.org', membership: 'join' },
  { userId: '@bo:spam.org', membership: 'invite' },
  { userId: '@cy:home.org', membership: 'join' },
  { userId: '@di:spam.org', membership: 'ban' },
];

describe('slash commands', () => {
  it('has a description in English for every command', () => {
    const commands = en.sharedUi.commands as Record<string, string>;
    Object.keys(Command).forEach((key) => {
      expect(commands[`Command${key}`], key).toBeTruthy();
    });
  });

  it('acts only for the commands that do not change the message', () => {
    expect(
      Object.values(Command)
        .filter((name) => !isActingCommand(name))
        .sort()
    ).toEqual(['html', 'me', 'notice', 'plain', 'shrug', 'tableflip', 'unflip']);
  });

  it('invites each user with the reason after -r', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Invite, context, '@x:a.org @y:b.org -r join us here');
    expect(mx.invite.mock.calls).toEqual([
      ['!room:home.org', '@x:a.org', 'join us here'],
      ['!room:home.org', '@y:b.org', 'join us here'],
    ]);
  });

  it('refuses a moderation command without anyone to act on', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    expect(await refusalOf(runCommandAction(Command.Kick, context, '-r bye'))).toEqual({
      code: 'usage',
    });
    expect(mx.kick).not.toHaveBeenCalled();
  });

  it('kicks the joined members of a named server, never the user', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Kick, context, 'spam.org home.org');
    expect(mx.kick.mock.calls.map(([, userId]) => userId)).toEqual([
      '@ann:spam.org',
      '@cy:home.org',
    ]);
  });

  it('bans members of a server who joined, are invited or left, and unbans the banned', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Ban, context, 'spam.org -r spam');
    expect(mx.ban.mock.calls).toEqual([
      ['!room:home.org', '@ann:spam.org', 'spam'],
      ['!room:home.org', '@bo:spam.org', 'spam'],
    ]);
    await runCommandAction(Command.UnBan, context, 'spam.org');
    expect(mx.unban.mock.calls).toEqual([['!room:home.org', '@di:spam.org']]);
  });

  it('withdraws only invitations', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.DisInvite, context, '@bo:spam.org @ann:spam.org');
    expect(mx.kick.mock.calls).toEqual([['!room:home.org', '@bo:spam.org', undefined]]);
  });

  it('names every target that failed in one error, after trying them all', async () => {
    const invite = vi.fn(async (_roomId: string, userId: string) => {
      if (userId === '@x:a.org') throw new Error('M_FORBIDDEN: not allowed');
      return {};
    });
    const { mx } = fakeClient({ invite });
    const context = contextFor(mx, fakeRoom(members));
    const error = await refusalOf(runCommandAction(Command.Invite, context, '@x:a.org @y:b.org'));
    expect(String(error)).toContain('@x:a.org: M_FORBIDDEN: not allowed');
    expect(invite).toHaveBeenCalledTimes(2);
  });

  it('joins each address through its server and opens the first room', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Join, context, '#lobby:far.org #other:near.org');
    expect(mx.joinRoom).toHaveBeenCalledWith('#lobby:far.org', { viaServers: ['far.org'] });
    expect(context.openRoom).toHaveBeenCalledWith('!joined-#lobby:far.org');
  });

  it('leaves the room and goes Home', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Leave, context, '');
    expect(mx.leave).toHaveBeenCalledWith('!room:home.org');
    expect(context.openPath).toHaveBeenCalledWith('/home/');
  });

  it('changes the name and picture in this room only, keeping the rest', async () => {
    const { mx } = fakeClient();
    const own = { membership: 'join', displayname: 'Me', avatar_url: 'mxc://home.org/old' };
    const context = contextFor(mx, fakeRoom(members, { [`m.room.member|${ME}`]: own }));
    await runCommandAction(Command.MyRoomNick, context, '  Captain Me ');
    expect(mx.sendStateEvent).toHaveBeenLastCalledWith(
      '!room:home.org',
      'm.room.member',
      { ...own, displayname: 'Captain Me' },
      ME
    );
    await runCommandAction(Command.MyRoomAvatar, context, 'mxc://home.org/new');
    expect(mx.sendStateEvent).toHaveBeenLastCalledWith(
      '!room:home.org',
      'm.room.member',
      { ...own, avatar_url: 'mxc://home.org/new' },
      ME
    );
    expect(await refusalOf(runCommandAction(Command.MyRoomAvatar, context, 'https://x'))).toEqual({
      code: 'usage',
    });
  });

  it('ignores and unignores users, keeping the others', async () => {
    const { mx, ignored } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Ignore, context, '@ann:spam.org @troll:else.org');
    expect(ignored()).toEqual(['@troll:else.org', '@ann:spam.org']);
    await runCommandAction(Command.UnIgnore, context, '@troll:else.org');
    expect(ignored()).toEqual(['@ann:spam.org']);
  });

  it('lists the room as a direct chat with the others, and takes it out again', async () => {
    const { mx, direct } = fakeClient();
    const room = fakeRoom([
      { userId: ME, membership: 'join' },
      { userId: '@friend:home.org', membership: 'join' },
      { userId: '@gone:home.org', membership: 'leave' },
    ]);
    await runCommandAction(Command.ConvertToDm, contextFor(mx, room), '');
    expect(direct()).toEqual({ '@friend:home.org': ['!room:home.org'] });
    await runCommandAction(Command.ConvertToRoom, contextFor(mx, room), '');
    expect(direct()).toEqual({});
  });

  it('opens a direct chat with a user', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.StartDm, context, '@friend:home.org');
    expect(context.openPath).toHaveBeenCalledWith('/direct/create/?userId=%40friend%3Ahome.org');
  });

  it('adds and removes servers on the ACL, and refuses to shut out its own server', async () => {
    const { mx } = fakeClient();
    const acl = { allow: ['*'], deny: ['old.org'], allow_ip_literals: false };
    const context = contextFor(mx, fakeRoom(members, { 'm.room.server_acl|': acl }));
    await runCommandAction(Command.Acl, context, '-d spam.org -rd old.org');
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!room:home.org',
      'm.room.server_acl',
      { allow: ['*'], deny: ['spam.org'], allow_ip_literals: false },
      ''
    );
    expect(await refusalOf(runCommandAction(Command.Acl, context, '-d *.org'))).toEqual({
      code: 'ownServer',
      server: 'home.org',
    });
    expect(await refusalOf(runCommandAction(Command.Acl, context, '-ra * -a far.org'))).toEqual({
      code: 'ownServer',
      server: 'home.org',
    });
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it('deletes what the named senders sent within the window, of the given type', async () => {
    const now = Date.now();
    const events = [
      { event_id: '$1', sender: '@ann:spam.org', type: 'm.room.message', origin_server_ts: now },
      { event_id: '$2', sender: '@cy:home.org', type: 'm.room.message', origin_server_ts: now },
      { event_id: '$3', sender: '@bo:spam.org', type: 'm.reaction', origin_server_ts: now },
      {
        event_id: '$4',
        sender: '@bo:spam.org',
        type: 'm.room.message',
        origin_server_ts: now - 1000,
        unsigned: { redacted_because: {} },
      },
      {
        event_id: '$5',
        sender: '@bo:spam.org',
        type: 'm.room.message',
        origin_server_ts: now - 7_200_000,
      },
    ];
    const createMessagesRequest = vi.fn(async () => ({ chunk: events, end: 'more' }));
    const { mx } = fakeClient({ createMessagesRequest });
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Delete, context, 'spam.org -past 1h -t m.room.message -r spam');
    expect(mx.redactEvent.mock.calls).toEqual([
      ['!room:home.org', '$1', undefined, { reason: 'spam' }],
    ]);
    // The last page already reached past the window, so no older page is read.
    expect(createMessagesRequest).toHaveBeenCalledTimes(1);
    expect(await refusalOf(runCommandAction(Command.Delete, context, 'spam.org'))).toEqual({
      code: 'usage',
    });
  });
});
