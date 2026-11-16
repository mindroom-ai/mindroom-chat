import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import { ThreadMenu, ThreadMenuRows } from './ThreadActionsMenu.css';

const rules = vi.hoisted(() => new Map<string, StyleRule>());
// Capture declarations supplied to the CSS compiler, including their media scope.
vi.mock('@vanilla-extract/css', () => ({
  style: (rule: StyleRule) => {
    const name = `style-${rules.size}`;
    rules.set(name, rule);
    return name;
  },
}));

it('constrains the menu and scrolls its rows without requiring a coarse pointer', () => {
  expect(rules.get(ThreadMenu)).toMatchObject({
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100dvh - 4.5rem)',
  });
  expect(rules.get(ThreadMenuRows)).toMatchObject({
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  });
});
