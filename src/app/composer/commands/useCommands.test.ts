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
  leaveRoom: vi.fn(async () => undefined),
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
    ).toEqual(['me', 'notice', 'plain']);
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

  it("leaves the room with the context's leaveRoom and goes Home", async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Leave, context, '');
    expect(context.leaveRoom).toHaveBeenCalledWith('!room:home.org');
    expect(mx.leave).not.toHaveBeenCalled();
    expect(context.openPath).toHaveBeenCalledWith('/home/');
  });

  it('ignores and unignores users, keeping the others', async () => {
    const { mx, ignored } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.Ignore, context, '@ann:spam.org @troll:else.org');
    expect(ignored()).toEqual(['@troll:else.org', '@ann:spam.org']);
    await runCommandAction(Command.UnIgnore, context, '@troll:else.org');
    expect(ignored()).toEqual(['@ann:spam.org']);
  });

  it('opens a direct chat with a user', async () => {
    const { mx } = fakeClient();
    const context = contextFor(mx, fakeRoom(members));
    await runCommandAction(Command.StartDm, context, '@friend:home.org');
    expect(context.openPath).toHaveBeenCalledWith('/direct/create/?userId=%40friend%3Ahome.org');
  });
});
