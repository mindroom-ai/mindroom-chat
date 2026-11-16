import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCallActions } from '../../calls/callStore';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { getMxIdServer, isUserId } from '../../matrix/matrix';
import { getDirectCreatePath, getHomePath, withSearchParam } from '../../routes/pathUtils';
import { readableReason } from '../../lib/errorReason';
import { registeredPlugins } from '../../plugins/registry';
import { usePluginSlashCommands } from '../../plugins/slashCommands';
import { usage } from './commandRefusal';

/**
 * The composer's slash commands, by the name typed after the `/`. The first group changes the
 * message being sent; the others act on the room or the account and send nothing.
 */
export const Command = {
  Me: 'me',
  Notice: 'notice',
  Plain: 'plain',
  Join: 'join',
  Leave: 'leave',
  Invite: 'invite',
  Kick: 'kick',
  Ban: 'ban',
  UnBan: 'unban',
  StartDm: 'startdm',
  Ignore: 'ignore',
  UnIgnore: 'unignore',
} as const;

export type Command = (typeof Command)[keyof typeof Command];

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
  [Command.Kick]: moderate(['join'], (mx, roomId, userId, reason) =>
    mx.kick(roomId, userId, reason)
  ),
  [Command.Ban]: moderate(['join', 'invite', 'leave'], (mx, roomId, userId, reason) =>
    mx.ban(roomId, userId, reason)
  ),
  [Command.UnBan]: moderate(['ban'], (mx, roomId, userId) => mx.unban(roomId, userId)),
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
        const description = t(`sharedUi.commands.Command${key}`);
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
