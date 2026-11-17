import { describe, expect, it } from 'vitest';
import { conversationToShow } from './subagentsPanel';

describe('conversationToShow', () => {
  it('shows the thread of a job from another conversation', () => {
    expect(conversationToShow('$a', undefined, false)).toBe('$a');
    expect(conversationToShow('$a', '$b', false)).toBe('$a');
  });

  it("shows the room's timeline for a job of the room beside an open thread", () => {
    expect(conversationToShow(null, '$b', false)).toBeNull();
  });

  it('stays while the panel already lists the run', () => {
    expect(conversationToShow('$a', '$a', false)).toBeUndefined();
    expect(conversationToShow(null, undefined, false)).toBeUndefined();
    // The Classic view lists every run; a panel opened for none stays too.
    expect(conversationToShow('$a', undefined, true)).toBeUndefined();
    expect(conversationToShow(undefined, '$b', false)).toBeUndefined();
  });
});
