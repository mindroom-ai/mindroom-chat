import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Direction, EventType, type IRoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCallActions } from '../../calls/callStore';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import {
  addRoomIdToMDirect,
  getMxIdServer,
  isUserId,
  removeRoomIdFromMDirect,
} from '../../matrix/matrix';
import { getDirectCreatePath, getHomePath, withSearchParam } from '../../routes/pathUtils';
import { readableReason } from '../../lib/errorReason';
import { matchesEnum } from '../../lib/matchesEnum';
import { registeredPlugins } from '../../plugins/registry';
import { usePluginSlashCommands } from '../../plugins/slashCommands';
import { CommandRefusedError, usage } from './commandRefusal';

/**
 * The composer's slash commands, by the name typed after the `/`. The first group changes the
 * message being sent; the others act on the room or the account and send nothing.
 */
export const Command = {
  Me: 'me',
  Notice: 'notice',
  Plain: 'plain',
  Html: 'html',
  Shrug: 'shrug',
  TableFlip: 'tableflip',
  UnFlip: 'unflip',
  Join: 'join',
  Leave: 'leave',
  Invite: 'invite',
  DisInvite: 'disinvite',
  Kick: 'kick',
  Ban: 'ban',
  UnBan: 'unban',
  Delete: 'delete',
  Acl: 'acl',
  MyRoomNick: 'myroomnick',
  MyRoomAvatar: 'myroomavatar',
  ConvertToDm: 'converttodm',
  ConvertToRoom: 'converttoroom',
  StartDm: 'startdm',
  Ignore: 'ignore',
  UnIgnore: 'unignore',
} as const;

export type Command = (typeof Command)[keyof typeof Command];

/** The shrug `/shrug` puts before the message. */
export const SHRUG = '¯\\_(ツ)_/¯';
/** The flipped table of `/tableflip`. */
export const TABLEFLIP = '(╯°□°)╯︵ ┻━┻';
/** The table set back on its feet, for `/unflip`. */
export const UNFLIP = '┬─┬ノ( º _ ºノ)';

/** The text each face command puts before the message. */
export const COMMAND_FACES: Partial<Record<Command, string>> = {
  [Command.Shrug]: SHRUG,
  [Command.TableFlip]: TABLEFLIP,
  [Command.UnFlip]: UNFLIP,
};

/** What a command acts on, and how it opens what it leads to. */
export type CommandContext = {
  mx: MatrixClient;
  room: Room;
  openRoom: (roomId: string) => void;
  openPath: (path: string) => void;
  /** Leaves a room, ending this device's call in it first (`useCallActions`). */
  leaveRoom: (roomId: string) => Promise<void>;
};

type CommandAction = (context: CommandContext, args: string) => Promise<void>;

export type SlashCommand = {
  /** A built-in command, or one a plugin adds (`src/app/plugins/slashCommands.ts`). */
  name: string;
  description: string;
  /** For commands that act instead of sending a message; message commands have none. */
  run?: (args: string) => Promise<void>;
  /**
   * A plugin's command, which runs in the composer's thread: like a message, it waits for a root
   * the server has not confirmed yet.
   */
  inThread?: true;
};

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

/** The words before a `-r` flag, and everything after it as the reason. */
const splitReason = (args: string): { words: string[]; reason?: string } => {
  const flag = /(?:^|\s)-r(?:\s|$)/.exec(args);
  if (!flag) return { words: wordsOf(args) };
  const reason = args.slice(flag.index + flag[0].length).trim();
  return { words: wordsOf(args.slice(0, flag.index)), reason: reason || undefined };
};

/** Takes each `-flag value` pair out of `words`; the other words keep their order. */
const takeFlags = (words: string[], flags: readonly string[]) => {
  const pairs: Array<[flag: string, value: string]> = [];
  const rest: string[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at] ?? '';
    if (flags.includes(word)) {
      const value = words[at + 1];
      if (value === undefined) throw usage();
      pairs.push([word, value]);
      at += 1;
    } else rest.push(word);
  }
  return { pairs, rest };
};

const nonEmpty = <T>(items: T[]): T[] => {
  if (items.length === 0) throw usage();
  return items;
};

/** Acts on each target in turn; every failure, named by its target, ends up in one error. */
const eachTarget = async (targets: string[], act: (target: string) => Promise<unknown>) => {
  const failures: string[] = [];
  await targets.reduce(
    (previous, target) =>
      previous.then(() =>
        act(target).then(
          () => undefined,
          (error: unknown) => {
            failures.push(`${target}: ${readableReason(error)}`);
          }
        )
      ),
    Promise.resolve()
  );
  if (failures.length > 0) throw new Error(failures.join('; '));
};

/**
 * The users a moderation command names: user IDs as written, and for a bare server name every
 * other member of the room on that server whose membership is one of `memberships`.
 */
const usersNamed = (
  { mx, room }: CommandContext,
  words: string[],
  memberships: readonly string[]
): string[] => {
  const ownId = mx.getSafeUserId();
  const found = new Set<string>();
  words.forEach((word) => {
    if (isUserId(word)) {
      found.add(word);
      return;
    }
    room.getMembers().forEach((member) => {
      const fromServer = getMxIdServer(member.userId) === word;
      if (fromServer && member.userId !== ownId && memberships.includes(member.membership ?? '')) {
        found.add(member.userId);
      }
    });
  });
  return nonEmpty([...found]);
};

const moderate =
  (
    memberships: readonly string[],
    act: (mx: MatrixClient, roomId: string, userId: string, reason?: string) => Promise<unknown>
  ): CommandAction =>
  (context, args) => {
    const { words, reason } = splitReason(args);
    const users = usersNamed(context, words, memberships);
    return eachTarget(users, (userId) => act(context.mx, context.room.roomId, userId, reason));
  };

/** The fields of `m.room.member` that `/myroomnick` and `/myroomavatar` change. */
type OwnMemberChange = { displayname: string } | { avatar_url: string };

/** Changes the user's own member event in this room only (Matrix spec, `m.room.member`). */
const setOwnMember = async ({ mx, room }: CommandContext, change: OwnMemberChange) => {
  const ownId = mx.getSafeUserId();
  const current = room.currentState.getStateEvents(EventType.RoomMember, ownId)?.getContent();
  const content = { ...current, membership: 'join', ...change };
  await mx.sendStateEvent(room.roomId, EventType.RoomMember, content as never, ownId);
};

/** A server ACL glob (`*` any run of characters, `?` one) as a whole-name pattern. */
const aclPattern = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split('')
      .map((char) => {
        if (char === '*') return '.*';
        if (char === '?') return '.';
        return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      })
      .join('')}$`,
    'i'
  );

const ACL_FLAGS = ['-a', '-d', '-ra', '-rd'] as const;

/**
 * `/acl`: adds (`-a`, `-d`) or removes (`-ra`, `-rd`) servers on the room's allow and deny
 * lists. A room without an ACL allows every server. A change that would shut out the user's own
 * server is refused, since nobody on it could undo it from there.
 */
const changeServerAcl: CommandAction = async ({ mx, room }, args) => {
  const { pairs, rest } = takeFlags(wordsOf(args), ACL_FLAGS);
  if (pairs.length === 0 || rest.length > 0) throw usage();
  const current = room.currentState.getStateEvents(EventType.RoomServerAcl, '')?.getContent();
  const allow = new Set<string>(Array.isArray(current?.allow) ? current.allow : ['*']);
  const deny = new Set<string>(Array.isArray(current?.deny) ? current.deny : []);
  pairs.forEach(([flag, server]) => {
    if (flag === '-a') allow.add(server);
    if (flag === '-d') deny.add(server);
    if (flag === '-ra') allow.delete(server);
    if (flag === '-rd') deny.delete(server);
  });
  const ownServer = mx.getDomain() ?? '';
  const matches = (globs: Set<string>) =>
    [...globs].some((glob) => aclPattern(glob).test(ownServer));
  if (!matches(allow) || matches(deny)) {
    throw new CommandRefusedError({ code: 'ownServer', server: ownServer });
  }
  await mx.sendStateEvent(
    room.roomId,
    EventType.RoomServerAcl,
    { ...current, allow: [...allow], deny: [...deny] },
    ''
  );
};

const DURATION = /^(\d+)([dhms])$/;
const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };
/** How far back `/delete` reads, in pages of 100 events, before it stops looking. */
const DELETE_PAGE_LIMIT = 20;

/** The room's events since `since`, newest first, read from the server page by page. */
const eventsSince = async (mx: MatrixClient, roomId: string, since: number) => {
  const found: IRoomEvent[] = [];
  const readPage = async (from: string | null, page: number): Promise<void> => {
    const response = await mx.createMessagesRequest(roomId, from, 100, Direction.Backward);
    found.push(...response.chunk.filter((event) => event.origin_server_ts >= since));
    const reachedStart = response.chunk.some((event) => event.origin_server_ts < since);
    if (reachedStart || !response.end || response.chunk.length === 0) return;
    if (page + 1 < DELETE_PAGE_LIMIT) await readPage(response.end, page + 1);
  };
  await readPage(null, 0);
  return found;
};

/**
 * `/delete`: removes (redacts) the messages that the named users, or members of the named
 * servers, sent within the given time, optionally of one event type only.
 */
const deleteRecent: CommandAction = async ({ mx, room }, args) => {
  const { words, reason } = splitReason(args);
  const { pairs, rest } = takeFlags(words, ['-past', '-t']);
  const past = DURATION.exec(pairs.find(([flag]) => flag === '-past')?.[1] ?? '');
  const [, amount, unit] = past ?? [];
  if (!amount || !unit) throw usage();
  const since = Date.now() - Number(amount) * (UNIT_MS[unit] ?? 0);
  const types = pairs.filter(([flag]) => flag === '-t').map(([, type]) => type);
  const senders = nonEmpty(rest);
  const sentByTarget = (sender: string) =>
    senders.some((word) => word === sender || (!isUserId(word) && getMxIdServer(sender) === word));
  // An encrypted message is matched by the type the client decrypted it to, when it has.
  const typeOf = (event: IRoomEvent) => room.findEventById(event.event_id)?.getType() ?? event.type;
  const doomed = (await eventsSince(mx, room.roomId, since)).filter(
    (event) =>
      sentByTarget(event.sender) &&
      !matchesEnum(event.type, EventType.RoomRedaction) &&
      !('state_key' in event) &&
      !event.unsigned?.redacted_because &&
      (types.length === 0 || types.includes(typeOf(event)))
  );
  await eachTarget(
    doomed.map((event) => event.event_id),
    (eventId) => mx.redactEvent(room.roomId, eventId, undefined, reason ? { reason } : undefined)
  );
};

const ACTIONS: Partial<Record<Command, CommandAction>> = {
  [Command.Join]: async ({ mx, openRoom }, args) => {
    const joined: string[] = [];
    const joining = eachTarget(nonEmpty(wordsOf(args)), async (address) => {
      const server = getMxIdServer(address);
      const room = await mx.joinRoom(address, server ? { viaServers: [server] } : undefined);
      joined.push(room.roomId);
    });
    await joining.finally(() => {
      if (joined[0]) openRoom(joined[0]);
    });
  },
  [Command.Leave]: async ({ room, leaveRoom, openPath }) => {
    await leaveRoom(room.roomId);
    openPath(getHomePath());
  },
  [Command.Invite]: moderate([], (mx, roomId, userId, reason) => mx.invite(roomId, userId, reason)),
  // Withdrawing an invite is a kick of someone whose membership is still `invite`.
  [Command.DisInvite]: (context, args) => {
    const { words, reason } = splitReason(args);
    const invited = nonEmpty(
      usersNamed(context, words, ['invite']).filter(
        (userId) => context.room.getMember(userId)?.membership === 'invite'
      )
    );
    return eachTarget(invited, (userId) => context.mx.kick(context.room.roomId, userId, reason));
  },
  [Command.Kick]: moderate(['join'], (mx, roomId, userId, reason) =>
    mx.kick(roomId, userId, reason)
  ),
  [Command.Ban]: moderate(['join', 'invite', 'leave'], (mx, roomId, userId, reason) =>
    mx.ban(roomId, userId, reason)
  ),
  [Command.UnBan]: moderate(['ban'], (mx, roomId, userId) => mx.unban(roomId, userId)),
  [Command.Delete]: deleteRecent,
  [Command.Acl]: changeServerAcl,
  [Command.MyRoomNick]: (context, args) => {
    const name = args.trim();
    if (!name) throw usage();
    return setOwnMember(context, { displayname: name });
  },
  [Command.MyRoomAvatar]: (context, args) => {
    const url = args.trim();
    if (!/^mxc:\/\/\S+$/.test(url)) throw usage();
    return setOwnMember(context, { avatar_url: url });
  },
  [Command.ConvertToDm]: async ({ mx, room }) => {
    const ownId = mx.getSafeUserId();
    const others = nonEmpty(
      room
        .getMembers()
        .filter(
          (member) =>
            member.userId !== ownId &&
            (member.membership === 'join' || member.membership === 'invite')
        )
        .map((member) => member.userId)
    );
    await Promise.all(others.map((userId) => addRoomIdToMDirect(mx, room.roomId, userId)));
  },
  [Command.ConvertToRoom]: ({ mx, room }) => removeRoomIdFromMDirect(mx, room.roomId),
  [Command.StartDm]: async ({ openPath }, args) => {
    const [userId] = nonEmpty(wordsOf(args).filter(isUserId));
    openPath(withSearchParam(getDirectCreatePath(), { userId }));
  },
  [Command.Ignore]: async ({ mx }, args) => {
    const users = nonEmpty(wordsOf(args).filter(isUserId));
    await mx.setIgnoredUsers([...new Set([...mx.getIgnoredUsers(), ...users])]);
  },
  [Command.UnIgnore]: async ({ mx }, args) => {
    const users = nonEmpty(wordsOf(args).filter(isUserId));
    await mx.setIgnoredUsers(mx.getIgnoredUsers().filter((userId) => !users.includes(userId)));
  },
};

/** Runs an acting command; resolves once the server took every change it asked for. */
export const runCommandAction = async (
  name: Command,
  context: CommandContext,
  args: string
): Promise<void> => {
  const action = ACTIONS[name];
  if (!action) throw usage();
  await action(context, args);
};

export const isActingCommand = (name: Command): boolean => ACTIONS[name] !== undefined;

/**
 * The slash commands for `room`, by name: each with its description in the person's language,
 * and for commands that act, `run` with the text typed after the name. The plugins' commands
 * follow the built-in ones, which keep their names: a plugin's command of the same name is none.
 * A plugin's command runs in `threadId`, the thread the composer writes to, if any.
 */
export const useCommands = (room: Room, threadId?: string): Record<string, SlashCommand> => {
  const client = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const goTo = useNavigate();
  const { t } = useTranslation();
  const pluginCommands = usePluginSlashCommands(registeredPlugins, useOptionalClientConfig());
  const { leaveRoom } = useCallActions(client);

  return useMemo(() => {
    const context: CommandContext = {
      mx: client,
      room,
      openRoom: (roomId) => navigateRoom(roomId),
      openPath: (path) => goTo(path),
      leaveRoom,
    };
    const entries = (Object.keys(Command) as Array<keyof typeof Command>).map(
      (key): [string, SlashCommand] => {
        const name = Command[key];
        const description = t(`sharedUi.commands.Command${key}`, {
          value1: COMMAND_FACES[name] ?? '',
        });
        const run = isActingCommand(name)
          ? (args: string) => runCommandAction(name, context, args)
          : undefined;
        return [name, { name, description, run }];
      }
    );
    const commands: Record<string, SlashCommand> = Object.fromEntries(entries);
    pluginCommands.forEach(({ name, description, run }) => {
      if (!Object.hasOwn(commands, name)) {
        commands[name] = {
          name,
          description,
          run: (args) => run({ room, args, threadId }),
          inThread: true,
        };
      }
    });
    return commands;
  }, [client, goTo, leaveRoom, navigateRoom, pluginCommands, room, t, threadId]);
};
