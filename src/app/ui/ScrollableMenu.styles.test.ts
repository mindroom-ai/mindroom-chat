import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import { ScrollableMenu, ScrollableMenuRows } from './ScrollableMenu.css';

const rules = vi.hoisted(() => new Map<string, StyleRule>());
// Capture declarations supplied to the CSS compiler, including their media scope.
vi.mock('@vanilla-extract/css', () => ({
  style: (rule: StyleRule) => {
    const name = `style-${rules.size}`;
    rules.set(name, rule);
    return name;
  },
}));

it('caps the menu height clear of safe areas on all pointers and scrolls its rows internally', () => {
  expect(rules.get(ScrollableMenu)).toMatchObject({
    display: 'flex',
    flexDirection: 'column',
    maxHeight:
      'calc(100dvh - 1.5rem - var(--app-inset-top, env(safe-area-inset-top, 0px)) - env(safe-area-inset-bottom, 0px))',
    '@media': {
      '(pointer: coarse)': {
        maxHeight:
          'calc(100dvh - 4.5rem - var(--app-inset-top, env(safe-area-inset-top, 0px)) - env(safe-area-inset-bottom, 0px))',
      },
    },
  });
  expect(rules.get(ScrollableMenuRows)).toMatchObject({
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  });
});
