// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { EnabledSlashCommand } from '../../plugins/slashCommands';
import { getCommandSuggestions } from '../slashCommandQuery';
import { useCommands } from './useCommands';

const plugins = vi.hoisted(() => ({ commands: [] as EnabledSlashCommand[] }));

vi.mock('../../plugins/slashCommands', () => ({
  usePluginSlashCommands: () => plugins.commands,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({} as MatrixClient),
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => () => undefined,
}));

const room = { roomId: '!room:example.org' } as Room;

const pluginCommand = (name: string): EnabledSlashCommand => ({
  name,
  description: `Plugin ${name}`,
  run: vi.fn(async () => undefined),
});

describe('useCommands with plugin commands', () => {
  it("offers a plugin's command in the command menu and runs it with the room and its arguments", async () => {
    const greet = pluginCommand('greet');
    plugins.commands = [greet];
    const { result } = renderHook(() => useCommands(room));

    expect(getCommandSuggestions(Object.values(result.current), 'gr')).toEqual([
      expect.objectContaining({ name: 'greet', description: 'Plugin greet' }),
    ]);
    await result.current.greet?.run?.('hello there');
    expect(greet.run).toHaveBeenCalledWith({ room, args: 'hello there', threadId: undefined });
  });

  it("runs a plugin's command in the composer's thread, which the built-in commands ignore", async () => {
    const greet = pluginCommand('greet');
    plugins.commands = [greet];
    const { result } = renderHook(() => useCommands(room, '$root:example.org'));

    await result.current.greet?.run?.('hello thread');
    expect(greet.run).toHaveBeenCalledWith({
      room,
      args: 'hello thread',
      threadId: '$root:example.org',
    });
    expect(result.current.greet?.inThread).toBe(true);
    expect(result.current.invite?.inThread).toBeUndefined();
  });

  it("keeps a built-in command when a plugin's command has its name", () => {
    const join = pluginCommand('join');
    const me = pluginCommand('me');
    plugins.commands = [join, me];
    const { result } = renderHook(() => useCommands(room));

    expect(result.current.join?.description).not.toBe('Plugin join');
    expect(result.current.me?.description).not.toBe('Plugin me');
    // `/me` changes the message being sent, which a plugin's command never does.
    expect(result.current.me?.run).toBeUndefined();
    void result.current.join?.run?.('#lobby:example.org').catch(() => undefined);
    expect(join.run).not.toHaveBeenCalled();
  });
});
