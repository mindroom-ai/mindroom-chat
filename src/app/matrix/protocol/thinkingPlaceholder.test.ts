import { describe, expect, it } from 'vitest';
import { isThinkingPlaceholderBody } from './thinkingPlaceholder';

describe('isThinkingPlaceholderBody', () => {
  it('matches only the exact MindRoom thinking placeholder body', () => {
    expect(isThinkingPlaceholderBody({ body: 'Thinking...' })).toBe(true);
    expect(isThinkingPlaceholderBody({ body: 'Thinking' })).toBe(false);
    expect(isThinkingPlaceholderBody({ body: ' Thinking...' })).toBe(false);
    expect(isThinkingPlaceholderBody({ body: 'Thinking...\n' })).toBe(false);
  });

  it('uses m.new_content body when an edit wrapper is present', () => {
    expect(
      isThinkingPlaceholderBody({
        body: 'old text',
        'm.new_content': {
          body: 'Thinking...',
        },
      })
    ).toBe(true);

    expect(
      isThinkingPlaceholderBody({
        body: 'Thinking...',
        'm.new_content': {
          body: 'real answer',
        },
      })
    ).toBe(false);
  });
});
