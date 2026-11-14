// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityOverlay } from './SecurityOverlay';

type Press = { target: EventTarget | null; preventDefault: () => void };
type PressOutside = (event: Press) => boolean;

const trap = vi.hoisted(() => ({ pressOutside: undefined as PressOutside | undefined }));

// jsdom lays nothing out, so focus-trap finds no tabbable node; the options it is given are tested.
vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children: ReactNode;
    focusTrapOptions: { clickOutsideDeactivates: PressOutside };
  }) => {
    // focus-trap-react reads its options once, as the trap starts.
    trap.pressOutside ??= focusTrapOptions.clickOutsideDeactivates;
    return children;
  },
}));

afterEach(() => {
  cleanup();
  trap.pressOutside = undefined;
});

const overlay = (dismissible?: boolean) => (
  <SecurityOverlay onClose={vi.fn()} dismissible={dismissible}>
    <div role="dialog">Unlock your messages</div>
  </SecurityOverlay>
);

/** What a press beside the dialog lands on: the centering layer and the dimmed backdrop. */
const besideDialog = () => {
  const center = screen.getByRole('dialog').parentElement?.parentElement;
  const backdrop = center?.previousElementSibling;
  if (!center || !backdrop) throw new Error('no layer around the dialog');
  return [center, backdrop];
};

/** Whether a press on `target` closes, and whether it is cancelled so no click follows it. */
const pressOn = (target: EventTarget) => {
  if (!trap.pressOutside) throw new Error('no focus trap');
  const preventDefault = vi.fn();
  const closes = trap.pressOutside({ target, preventDefault });
  return { closes, cancelled: preventDefault.mock.calls.length > 0 };
};

describe('SecurityOverlay', () => {
  it('closes on a press beside the dialog and cancels it, so its tap clicks nothing beneath', () => {
    render(overlay());
    for (const target of besideDialog()) {
      expect(pressOn(target)).toEqual({ closes: true, cancelled: true });
    }
  });

  it('stays open on a press beside the dialog while closing would lose something', () => {
    const { rerender } = render(overlay());
    rerender(overlay(false));
    for (const target of besideDialog()) {
      expect(pressOn(target)).toEqual({ closes: false, cancelled: false });
    }
  });

  it('stays open on a press outside its layer, such as in a popover opened from inside', () => {
    render(overlay());
    const popover = document.body.appendChild(document.createElement('div'));
    expect(pressOn(popover)).toEqual({ closes: false, cancelled: false });
  });
});
