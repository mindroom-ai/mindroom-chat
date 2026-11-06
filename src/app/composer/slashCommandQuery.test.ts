import type { Descendant } from 'slate';
import { describe, expect, it } from 'vitest';
import { readUnknownCommand } from './slashCommandQuery';
import type { SlashCommand } from './commands/useCommands';

const commands = {
  me: { name: 'me', description: 'Send an action.' },
  kick: { name: 'kick', description: 'Kick a user.', run: async () => undefined },
} as unknown as Record<string, SlashCommand>;

const line = (...children: unknown[]) => ({ type: 'paragraph', children } as Descendant);

describe('readUnknownCommand', () => {
  it('names a leading /word that is no command', () => {
    expect(readUnknownCommand([line({ text: '/foobar unknown command' })], commands)).toBe(
      'foobar'
    );
    expect(readUnknownCommand([line({ text: '/kik @ada:example.org' })], commands)).toBe('kik');
    expect(readUnknownCommand([line({ text: '/constructor' })], commands)).toBe('constructor');
  });

  it('leaves commands, paths, quotes and text that does not start with a slash alone', () => {
    [
      '/me waves',
      '/kick @ada:example.org',
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
