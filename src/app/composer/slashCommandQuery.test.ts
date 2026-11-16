import type { Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { readActingCommand, readUnknownCommand } from './slashCommandQuery';
import type { SlashCommand } from './commands/useCommands';

const commands = {
  me: { name: 'me', description: 'Send an action.' },
  kick: { name: 'kick', description: 'Kick a user.', run: async () => undefined },
  // MindRoom's commands, which the room's agents answer, are sent as typed.
  list_schedules: { name: 'list_schedules', description: 'List all scheduled tasks.' },
  'reload-plugins': { name: 'reload-plugins', description: 'Reload configured plugins.' },
  e2ee: { name: 'e2ee', description: 'Show encryption diagnostics.' },
} as unknown as Record<string, SlashCommand>;

const line = (...children: unknown[]) => ({ type: 'paragraph', children } as Descendant);

describe('readUnknownCommand', () => {
  it('names a leading /word that is no command', () => {
    expect(readUnknownCommand([line({ text: '/foobar unknown command' })], commands)).toBe(
      'foobar'
    );
    expect(readUnknownCommand([line({ text: '/kik @ada:example.org' })], commands)).toBe('kik');
    expect(readUnknownCommand([line({ text: '/constructor' })], commands)).toBe('constructor');
    expect(readUnknownCommand([line({ text: '/zz' })], commands)).toBe('zz');
    expect(readUnknownCommand([line({ text: '/list_jobs now' })], commands)).toBe('list_jobs');
    expect(readUnknownCommand([line({ text: '/reload-all' })], commands)).toBe('reload-all');
    expect(readUnknownCommand([line({ text: '/e2e' })], commands)).toBe('e2e');
    // Only MindRoom's commands match in any case; a built-in keeps its exact name.
    expect(readUnknownCommand([line({ text: '/Me waves' })], commands)).toBe('Me');
  });

  it("knows MindRoom's commands in any case, as MindRoom reads them", () => {
    ['/Schedule in 5 min do x', '/LIST_SCHEDULES', '/Reload-Plugins', '/E2ee'].forEach((text) =>
      expect(readUnknownCommand([line({ text })], commands), text).toBeUndefined()
    );
  });

  it('leaves commands, paths, quotes and text that does not start with a slash alone', () => {
    [
      '/me waves',
      '/kick @ada:example.org',
      '/list_schedules',
      '/reload-plugins',
      '/e2ee',
      '//foobar escaped',
      '/2024 was a year',
      '/usr/bin is a path',
      '/ alone',
      ' /foobar after a space',
      'see /foobar',
      '> /foobar',
    ].forEach((text) =>
      expect(readUnknownCommand([line({ text })], commands), text).toBeUndefined()
    );
    const codeBlock = {
      type: 'code-block',
      children: [{ type: 'code-line', children: [{ text: '/foobar' }] }],
    };
    expect(readUnknownCommand([codeBlock as unknown as Descendant], commands)).toBeUndefined();
  });
});

describe('readActingCommand', () => {
  it('runs only commands that act, and leaves the others, MindRoom ones included, to send', () => {
    expect(readActingCommand([line({ text: '/kick @ada:example.org' })], commands)).toMatchObject({
      args: '@ada:example.org',
    });
    ['/me waves', '/list_schedules', '/reload-plugins', '/e2ee now'].forEach((text) =>
      expect(readActingCommand([line({ text })], commands), text).toBeUndefined()
    );
  });
});
