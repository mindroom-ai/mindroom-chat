// @vitest-environment jsdom

import React from 'react';
import type FocusTrap from 'focus-trap-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChoiceButton } from './ChoiceButton';

// jsdom lays nothing out, so every element counts as shown for the trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const CHOICES = [
  { value: 'thread', label: 'Threads' },
  { value: 'room', label: 'Main timeline' },
];
const button = (disabled: boolean) => (
  <ChoiceButton
    label="Thread mode"
    value="thread"
    choices={CHOICES}
    onChoose={() => undefined}
    disabled={disabled}
  />
);

afterEach(cleanup);

it('closes its open menu when the choice becomes disabled, and stays closed when enabled again', () => {
  const { rerender } = render(button(false));
  fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
  expect(screen.getByRole('menuitemradio', { name: 'Main timeline' })).toBeTruthy();

  rerender(button(true));
  expect(screen.queryByRole('menuitemradio')).toBeNull();
  expect(screen.getByRole('button', { name: 'Threads' }).getAttribute('aria-expanded')).toBe(
    'false'
  );

  rerender(button(false));
  expect(screen.queryByRole('menuitemradio')).toBeNull();
});
