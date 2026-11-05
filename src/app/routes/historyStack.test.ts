import { describe, expect, it } from 'vitest';
import { advanceHistoryStack, emptyHistoryStack, type HistoryStack } from './historyStack';

const entry = (key: string) => ({ key, pathname: `/${key}/` });
const walk = (...steps: [string, 'PUSH' | 'REPLACE' | 'POP'][]): HistoryStack =>
  steps.reduce(
    (stack, [key, action]) => advanceHistoryStack(stack, entry(key), action),
    emptyHistoryStack
  );
const previous = (stack: HistoryStack) => stack.entries[stack.index - 1]?.pathname;

describe('advanceHistoryStack', () => {
  it('knows the entry before a pushed page', () => {
    expect(previous(walk(['home', 'POP'], ['list', 'PUSH'], ['room', 'PUSH']))).toBe('/list/');
  });

  it('follows back and forward steps to entries it has seen', () => {
    const stack = walk(['home', 'POP'], ['list', 'PUSH'], ['room', 'PUSH'], ['list', 'POP']);
    expect(stack.index).toBe(1);
    expect(previous(stack)).toBe('/home/');
    expect(walk(['home', 'POP'], ['list', 'PUSH'], ['home', 'POP'], ['list', 'POP']).index).toBe(1);
  });

  it('drops the forward entries when a page is pushed after a back step', () => {
    const stack = walk(
      ['home', 'POP'],
      ['list', 'PUSH'],
      ['room', 'PUSH'],
      ['list', 'POP'],
      ['other', 'PUSH']
    );
    expect(stack.entries.map(({ key }) => key)).toEqual(['home', 'list', 'other']);
  });

  it('puts a replacing page in the current entry', () => {
    const stack = walk(['home', 'POP'], ['room', 'PUSH'], ['list', 'REPLACE']);
    expect(stack.entries.map(({ key }) => key)).toEqual(['home', 'list']);
    expect(previous(stack)).toBe('/home/');
  });

  it('starts over at an entry it has not seen, so it never guesses what came before', () => {
    expect(previous(walk(['home', 'POP'], ['list', 'PUSH'], ['unknown', 'POP']))).toBeUndefined();
  });
});
