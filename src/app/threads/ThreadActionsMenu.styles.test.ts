import type { StyleRule } from '@vanilla-extract/css';
import { expect, it, vi } from 'vitest';
import { ThreadMenu, ThreadMenuDetails, ThreadMenuRows } from './ThreadActionsMenu.css';

const rules = vi.hoisted(() => new Map<string, StyleRule>());
// Capture declarations supplied to the CSS compiler, including their media scope.
vi.mock('@vanilla-extract/css', () => ({
  style: (rule: StyleRule) => {
    const name = `style-${rules.size}`;
    rules.set(name, rule);
    return name;
  },
}));

it('constrains the menu clear of the safe areas and scrolls its rows on every pointer', () => {
  expect(rules.get(ThreadMenu)).toMatchObject({
    display: 'flex',
    flexDirection: 'column',
    maxHeight:
      'calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  });
  expect(rules.get(ThreadMenuRows)).toMatchObject({
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  });
});

it('hides the details and their divider while no detail has content, as the hover card does', () => {
  expect(rules.get(ThreadMenuDetails)).toEqual({
    selectors: {
      '&:not(:has([data-thread-detail]:not(:empty)))': { display: 'none' },
    },
  });
});
