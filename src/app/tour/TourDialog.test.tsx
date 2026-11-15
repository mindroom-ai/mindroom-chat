// @vitest-environment jsdom
import { type ComponentProps, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { TourLevel } from '../navigation/tourState';
import { mockMedia, restoreMedia } from './__tests__/media';
import { TourDialog } from './TourDialog';
import { SCENE_START_DELAY_MS, TOUR_STEPS } from './tourSteps';

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

const onClose = vi.fn<(how: 'done' | 'dismissed') => void>();
const onLevelChange = vi.fn<(level: TourLevel) => void>();

function Tour({ level: first = 'quick', phone = false }: { level?: TourLevel; phone?: boolean }) {
  const [level, setLevel] = useState(first);
  return (
    <ScreenSizeProvider value={phone ? ScreenSize.Mobile : ScreenSize.Desktop}>
      <button type="button">Opener</button>
      <TourDialog
        level={level}
        onLevelChange={(next) => {
          onLevelChange(next);
          setLevel(next);
        }}
        onClose={onClose}
      />
    </ScreenSizeProvider>
  );
}

const dialog = () => {
  const root = document.querySelector<HTMLElement>('[data-tour-dialog]');
  if (!root) throw new Error('no tour dialog');
  return root;
};
const stage = () => dialog().querySelector<HTMLElement>('[data-tour-stage]') as HTMLElement;
const stepId = () => dialog().getAttribute('data-tour-step');
const action = (name: string) =>
  dialog().querySelector<HTMLButtonElement>(`[data-tour-action="${name}"]`);
const press = (name: string) => {
  const button = action(name);
  if (!button) throw new Error(`no ${name} button`);
  fireEvent.click(button);
};
const key = (name: string) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: name });
const liveRegion = () => dialog().querySelector<HTMLElement>('[aria-live="polite"]') as HTMLElement;
const goTo = (id: string) => {
  for (let moves = 0; stepId() !== id; moves += 1) {
    if (moves > TOUR_STEPS.length) throw new Error(`never reached ${id}`);
    press('next');
  }
};

/** What the Tab key can reach, in order: what a browser skips for `inert` is left out. */
const tabStops = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')
  ).filter(
    (element) =>
      element.tabIndex >= 0 && !element.hasAttribute('disabled') && !element.closest('[inert]')
  );

/** Presses Tab as a browser does: to the next stop, unless the page moved the focus itself. */
const pressTab = () => {
  const from = document.activeElement as HTMLElement;
  if (!fireEvent.keyDown(from, { key: 'Tab', code: 'Tab', keyCode: 9 })) return;
  const stops = tabStops();
  stops[(stops.indexOf(from) + 1) % stops.length]?.focus();
};

beforeEach(() => {
  // jsdom keeps `inert` as a plain property; a browser reflects it in the attribute.
  Object.defineProperty(HTMLElement.prototype, 'inert', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('inert');
    },
    set(this: HTMLElement, value: boolean) {
      this.toggleAttribute('inert', value);
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  restoreMedia();
  Reflect.deleteProperty(HTMLElement.prototype, 'inert');
  document.documentElement.removeAttribute('dir');
  onClose.mockReset();
  onLevelChange.mockReset();
});

describe('TourDialog', () => {
  it('opens on the first step, named after its level, with the focus on Next', () => {
    render(<Tour />);
    expect(screen.getByRole('dialog', { name: 'Quick tour' })).toBeTruthy();
    expect(dialog().getAttribute('data-tour-level')).toBe('quick');
    expect(stepId()).toBe('conversation');
    expect(dialog().textContent).toContain('Step 1 of 6');
    expect(dialog().textContent).toContain('The basics');
    expect(action('next')?.textContent).toBe('Next');
    expect(document.activeElement).toBe(action('next'));
    expect(action('back')).toBeNull();
    expect(action('keepGoing')).toBeNull();
  });

  it('moves with Next and Back, and puts the focus on the main button after each step', () => {
    render(<Tour />);
    press('next');
    expect(stepId()).toBe('start');
    expect(dialog().textContent).toContain('Step 2 of 6');
    expect(document.activeElement).toBe(action('next'));

    action('back')?.focus();
    press('back');
    expect(stepId()).toBe('conversation');
    expect(action('back')).toBeNull();
    expect(document.activeElement).toBe(action('next'));
  });

  it('ends the Quick tour in Done, with Keep going beside it', () => {
    render(<Tour />);
    goTo('states');
    expect(action('next')).toBeNull();
    expect(action('done')?.textContent).toBe('Done');
    expect(document.activeElement).toBe(action('done'));
    expect(action('keepGoing')?.textContent).toBe('Keep going (6 more steps)');

    press('done');
    expect(onClose.mock.calls).toEqual([['done']]);
  });

  it('goes on with the Full tour from Keep going', () => {
    render(<Tour />);
    goTo('states');
    press('keepGoing');

    expect(onLevelChange.mock.calls).toEqual([['full']]);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().getAttribute('data-tour-level')).toBe('full');
    expect(stepId()).toBe('resolve');
    expect(dialog().textContent).toContain('Step 7 of 12');
    expect(dialog().textContent).toContain('Keeping the list tidy');
    expect(screen.getByRole('dialog', { name: 'Full tour' })).toBeTruthy();
    expect(document.activeElement).toBe(action('next'));
    expect(action('keepGoing')).toBeNull();
  });

  it('ends the Full tour in Done alone', () => {
    render(<Tour level="full" />);
    expect(dialog().textContent).toContain('Step 1 of 12');
    goTo('activity');
    expect(action('keepGoing')).toBeNull();
    press('done');
    expect(onClose.mock.calls).toEqual([['done']]);
  });

  it('moves a step with the arrow keys and stops at both ends', () => {
    render(<Tour />);
    key('ArrowLeft');
    expect(stepId()).toBe('conversation');
    key('ArrowRight');
    expect(stepId()).toBe('start');
    key('ArrowRight');
    expect(stepId()).toBe('reply');
    key('ArrowLeft');
    expect(stepId()).toBe('start');

    goTo('states');
    key('ArrowRight');
    // The end of the level: going on with the Full tour is a choice, not a key.
    expect(stepId()).toBe('states');
    expect(onClose).not.toHaveBeenCalled();
    expect(onLevelChange).not.toHaveBeenCalled();
  });

  it('mirrors the arrow keys in a right-to-left language', () => {
    document.documentElement.dir = 'rtl';
    render(<Tour />);
    key('ArrowRight');
    expect(stepId()).toBe('conversation');
    key('ArrowLeft');
    expect(stepId()).toBe('start');
    key('ArrowLeft');
    expect(stepId()).toBe('reply');
    key('ArrowRight');
    expect(stepId()).toBe('start');
  });

  it('leaves an arrow key with a modifier to the browser', () => {
    render(<Tour />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowRight', altKey: true });
    expect(stepId()).toBe('conversation');
  });

  it('closes as dismissed on Escape and from the close button', () => {
    render(<Tour />);
    key('Escape');
    expect(onClose.mock.calls).toEqual([['dismissed']]);
    cleanup();
    onClose.mockReset();

    render(<Tour />);
    expect(action('close')?.getAttribute('aria-label')).toBe('Close tour');
    press('close');
    expect(onClose.mock.calls).toEqual([['dismissed']]);
  });

  it('never lets Tab reach a control of the stage', () => {
    render(<Tour />);
    goTo('title');
    // The stage holds the app's cards and buttons, and none of them is a stop.
    expect(stage().querySelectorAll('button').length).toBeGreaterThan(4);
    expect(stage().getAttribute('aria-hidden')).toBe('true');

    const reached = new Set<Element>();
    for (let presses = 0; presses < 12; presses += 1) {
      pressTab();
      const focused = document.activeElement as HTMLElement;
      expect(dialog().contains(focused)).toBe(true);
      expect(stage().contains(focused)).toBe(false);
      reached.add(focused);
    }
    expect(reached).toEqual(new Set([action('close'), action('back'), action('next')]));
  });

  it('describes the dialog by the step it opens with, which a live region would not say', () => {
    render(<Tour />);
    const described = dialog().closest('[role="dialog"]')?.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')).toBe(liveRegion());
    expect(liveRegion().textContent).toContain('A thread is one conversation');
  });

  it("reads each step's title and text in a live region", () => {
    render(<Tour />);
    const region = liveRegion();
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(
      within(region).getByRole('heading', { name: 'A thread is one conversation' })
    ).toBeTruthy();
    expect(region.textContent).toContain('Each card is one thread');

    press('next');
    // The same region with the next step's text, so a screen reader announces it.
    expect(liveRegion()).toBe(region);
    expect(region.textContent).toContain('Type to start a new thread');
    expect(region.textContent).toContain('That starts a new thread, and it opens right away.');
    expect(region.textContent).not.toContain('Each card is one thread');
    // The other steps' texts only hold the block's height.
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Quick tour',
      'Type to start a new thread',
    ]);
  });

  it('explains the four states in rows, each under its label', () => {
    render(<Tour />);
    goTo('states');
    const text = liveRegion().textContent;
    ['Streaming', 'Unread', 'Resolved', 'Snoozed'].forEach((label) =>
      expect(text).toContain(label)
    );
    expect(text).toContain('An agent is replying now.');
    expect(text).toContain('Hidden until its time, then back by itself.');
    expect(liveRegion().querySelectorAll('[data-tour-state]')).toHaveLength(4);
  });

  it('shows the progress as one segment per step, for sighted people only', () => {
    render(<Tour level="full" />);
    goTo('snooze');
    const bar = dialog().querySelector('[data-tour-progress]');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    const segments = Array.from(bar?.children ?? [], (segment) =>
      segment.getAttribute('data-tour-segment')
    );
    expect(segments).toEqual([
      ...Array<string>(8).fill('reached'),
      ...Array<string>(4).fill('ahead'),
    ]);
  });

  it('plays the scene of a step, then offers Replay, which starts it over', () => {
    vi.useFakeTimers();
    render(<Tour />);
    goTo('title');
    expect(stage().getAttribute('data-tour-phase')).toBe('0');
    expect(stage().hasAttribute('data-tour-settled')).toBe(false);
    expect(action('replay')).toBeNull();
    expect(stage().textContent).toContain('Draft the spring launch email');

    act(() => {
      vi.advanceTimersByTime(SCENE_START_DELAY_MS + 1300);
    });
    expect(stage().getAttribute('data-tour-phase')).toBe('1');
    expect(stage().hasAttribute('data-tour-settled')).toBe(true);
    expect(stage().querySelector('[data-tour-part="title:launch"]')?.textContent).toBe(
      'Spring launch email'
    );

    // Outside the stage, which is inert, so it can be pressed.
    expect(stage().contains(action('replay'))).toBe(false);
    expect(action('replay')?.textContent).toBe('Replay');
    press('replay');
    expect(stage().getAttribute('data-tour-phase')).toBe('0');
    expect(stage().hasAttribute('data-tour-settled')).toBe(false);
    expect(action('replay')).toBeNull();
    // Replay left the page, so the focus is back on the main button and the keys still work.
    expect(document.activeElement).toBe(action('next'));
  });

  it('offers no Replay for a scene of one phase', () => {
    render(<Tour />);
    expect(stage().hasAttribute('data-tour-settled')).toBe(true);
    expect(action('replay')).toBeNull();
  });

  it('shows the end of each scene at once with reduced motion, without Replay', () => {
    mockMedia({ reducedMotion: true });
    render(<Tour />);
    goTo('start');
    expect(stage().hasAttribute('data-tour-settled')).toBe(true);
    expect(stage().querySelector('[data-tour-part="thread"]')).toBeTruthy();
    expect(action('replay')).toBeNull();
    goTo('title');
    expect(stage().querySelector('[data-tour-part="title:launch"]')?.textContent).toBe(
      'Spring launch email'
    );
    expect(action('replay')).toBeNull();
  });

  it('types the sample message into the composer of `start`', () => {
    vi.useFakeTimers();
    render(<Tour />);
    goTo('start');
    const typed = () => stage().querySelector('[data-tour-composer-text]')?.textContent;
    expect(typed()).toBe('Send a message...');
    act(() => {
      vi.advanceTimersByTime(SCENE_START_DELAY_MS + 350);
    });
    act(() => {
      vi.advanceTimersByTime(28 * 5);
    });
    expect(typed()).toBe('Draft');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(typed()).toBe('Draft the spring launch email');
  });

  it("draws a phone's room on a phone", () => {
    render(<Tour phone />);
    const header = stage().querySelector('[data-tour-header]');
    expect(header?.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(header?.querySelector('[aria-label="Compact view"]')).toBeNull();
    cleanup();
    render(<Tour />);
    expect(stage().querySelector('[data-tour-header] [aria-label="Compact view"]')).toBeTruthy();
  });
});
