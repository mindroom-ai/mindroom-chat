// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoveryDialogAtom } from '../account/encryption/recoveryDialog';
import { tourAtom } from '../navigation/tourState';
import { TourRenderer } from './TourRenderer';
import { QUICK_STEP_COUNT } from './tourSteps';

// jsdom lays nothing out, so every element counts as shown for the dialog's focus trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const store = getDefaultStore();
const dialog = () => document.querySelector<HTMLElement>('[data-tour-dialog]');
const press = (name: string) => {
  const button = dialog()?.querySelector<HTMLElement>(`[data-tour-action="${name}"]`);
  if (!button) throw new Error(`no ${name} button`);
  fireEvent.click(button);
};
const open = (level: 'quick' | 'full') => act(() => store.set(tourAtom, { level }));
const tick = () =>
  act(() => {
    vi.advanceTimersByTime(0);
  });

/** The page under the tour: the control that opened it and, if asked, a room's composer. */
const page = ({ room }: { room: boolean }) => {
  const opener = document.body.appendChild(document.createElement('button'));
  opener.focus();
  if (!room) return { opener, composer: undefined };
  const footer = document.body.appendChild(document.createElement('div'));
  footer.setAttribute('data-room-footer', 'true');
  footer.setAttribute('data-footer-of', 'room');
  const composer = footer.appendChild(document.createElement('div'));
  composer.setAttribute('data-editable-name', 'RoomInput');
  composer.tabIndex = 0;
  return { opener, composer };
};

const finish = () => {
  for (let step = 1; step < QUICK_STEP_COUNT; step += 1) press('next');
  press('done');
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  store.set(tourAtom, undefined);
  store.set(recoveryDialogAtom, undefined);
  document.body.innerHTML = '';
});

describe('TourRenderer', () => {
  it('shows the dialog while the tour is open, at its level', () => {
    render(<TourRenderer />);
    expect(dialog()).toBeNull();

    open('full');
    expect(dialog()?.getAttribute('data-tour-level')).toBe('full');

    act(() => store.set(tourAtom, undefined));
    expect(dialog()).toBeNull();
  });

  it("hands over to the room's composer after Done", () => {
    const { opener, composer } = page({ room: true });
    render(<TourRenderer />);
    open('quick');
    expect(document.activeElement).not.toBe(opener);

    finish();
    expect(store.get(tourAtom)).toBeUndefined();
    expect(dialog()).toBeNull();
    expect(document.querySelector('[data-tour-handoff]')).toBeTruthy();
    tick();
    // Not back to what opened the tour: typing starts a thread.
    expect(document.activeElement).toBe(composer);

    const ring = document.querySelector('[data-tour-handoff]');
    if (!ring) throw new Error('no ring');
    fireEvent.animationEnd(ring);
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
  });

  it('does not hand over under the recovery password dialog, which opens as the tour closes', () => {
    const { composer } = page({ room: true });
    render(<TourRenderer />);
    open('quick');
    for (let step = 1; step < QUICK_STEP_COUNT; step += 1) press('next');
    press('done');
    // The prompt that waited for the tour opens its dialog in the same moment.
    act(() => store.set(recoveryDialogAtom, 'setup'));
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).not.toBe(composer);

    // Nor later, once that dialog has closed: the moment has passed.
    act(() => store.set(recoveryDialogAtom, undefined));
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).not.toBe(composer);
  });

  it('does not hand over when the tour is closed another way', () => {
    const { opener, composer } = page({ room: true });
    render(<TourRenderer />);
    open('quick');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(store.get(tourAtom)).toBeUndefined();
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).not.toBe(composer);
    // The focus is back on what opened the tour.
    expect(document.activeElement).toBe(opener);

    open('quick');
    press('close');
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not hand over for a tour that is opened again and then dismissed', () => {
    const { composer } = page({ room: true });
    render(<TourRenderer />);
    open('quick');
    finish();
    // The handoff of the first tour is still on its way when the tour opens again.
    open('quick');
    press('close');
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).not.toBe(composer);
  });

  it('does nothing after Done without a room on the page', () => {
    const { opener } = page({ room: false });
    render(<TourRenderer />);
    open('quick');
    finish();
    tick();
    expect(document.querySelector('[data-tour-handoff]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('goes on with the Full tour from Keep going, and hands over at its end too', () => {
    const { composer } = page({ room: true });
    render(<TourRenderer />);
    open('quick');
    for (let step = 1; step < QUICK_STEP_COUNT; step += 1) press('next');
    press('keepGoing');

    // The same opening, now at the Full level.
    expect(dialog()?.getAttribute('data-tour-level')).toBe('full');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('snooze');
    for (let step = QUICK_STEP_COUNT + 1; step < 12; step += 1) press('next');
    press('done');
    tick();
    expect(document.activeElement).toBe(composer);
  });

  it('starts at the first step each time it opens', () => {
    render(<TourRenderer />);
    open('quick');
    press('next');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('start');
    press('close');
    open('quick');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('conversation');
  });

  it('starts over when a tour is opened while one is open, as the command palette can', () => {
    render(<TourRenderer />);
    open('quick');
    press('next');
    press('next');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('reply');

    open('full');
    expect(dialog()?.getAttribute('data-tour-level')).toBe('full');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('conversation');
    // The same level again is another opening too.
    press('next');
    open('full');
    expect(dialog()?.getAttribute('data-tour-step')).toBe('conversation');
  });
});
