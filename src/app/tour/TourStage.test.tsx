// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { mockLayout, restoreLayout } from './__tests__/layout';
import { mockMedia, restoreMedia } from './__tests__/media';
import { VIEW_FADE_MS } from './tourMotion';
import { sceneOf, type TourScene } from './tourScenes';
import { TourStage } from './TourStage';
import { TOUR_STEPS, type TourStepId } from './tourSteps';

const TYPED = 12;

const stageOf = (scene: TourScene, phone = false) => (
  <ScreenSizeProvider value={phone ? ScreenSize.Mobile : ScreenSize.Desktop}>
    <TourStage scene={scene} phone={phone} phase={0} settled={false} />
  </ScreenSizeProvider>
);

const lastPhase = (id: TourStepId): number =>
  (TOUR_STEPS.find((step) => step.id === id)?.phases.length ?? 1) - 1;

const show = (id: TourStepId, phase = lastPhase(id), phone = false) =>
  render(stageOf(sceneOf(id, phase, phone, TYPED), phone));

const stage = () => {
  const root = document.querySelector<HTMLElement>('[data-tour-stage]');
  if (!root) throw new Error('no stage');
  return root;
};
const parts = (part: string) => stage().querySelectorAll(`[data-tour-part="${part}"]`);
const cardIds = (within: ParentNode = stage()) =>
  Array.from(
    within.querySelectorAll<HTMLElement>('[data-tour-card]'),
    (card) => card.dataset.tourCard
  );

beforeEach(() => mockLayout(10));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  restoreLayout();
  restoreMedia();
});

describe('TourStage', () => {
  it('is inert and hidden from assistive technology, and says its phase', () => {
    render(
      <TourStage
        scene={sceneOf('reply', 1, false, TYPED)}
        phone={false}
        phase={1}
        settled={false}
      />
    );
    expect(stage().inert).toBe(true);
    expect(stage().getAttribute('aria-hidden')).toBe('true');
    expect(stage().getAttribute('data-tour-phase')).toBe('1');
    expect(stage().hasAttribute('data-tour-settled')).toBe(false);
    // The cards are the app's buttons, which is why nothing in the stage may take the focus.
    cleanup();
    render(<TourStage scene={sceneOf('reply', 2, false, TYPED)} phone={false} phase={2} settled />);
    expect(stage().querySelector('button[data-thread-root-id]')).toBeTruthy();
    expect(stage().hasAttribute('data-tour-settled')).toBe(true);
  });

  it('holds the part of every phase of every step once, and rings it', () => {
    TOUR_STEPS.forEach((step) => {
      step.phases.forEach((_, phase) => {
        [false, true].forEach((phone) => {
          const scene = sceneOf(step.id, phase, phone, TYPED);
          render(stageOf(scene, phone));
          const where = `${step.id} phase ${phase}${phone ? ' on a phone' : ''}`;
          const ring = stage().querySelector('[data-tour-spotlight]');
          if (scene.spotlight) {
            expect(parts(scene.spotlight).length, where).toBe(1);
            expect(ring, where).toBeTruthy();
          } else {
            expect(ring, where).toBeNull();
          }
          cleanup();
        });
      });
    });
  });

  it('draws the cards in the order of the scene, the pinned ones in their section', () => {
    show('order');
    expect(cardIds()).toEqual(['vendor', 'launch', 'budget', 'website']);
    expect(stage().querySelector('[data-tour-pinned]')).toBeNull();
    cleanup();

    show('pinAndTag');
    const pinned = stage().querySelector('[data-tour-pinned]');
    expect(pinned?.textContent).toContain('Pinned');
    expect(pinned && cardIds(pinned)).toEqual(['budget']);
    expect(cardIds()).toEqual(['budget', 'launch', 'website']);
    expect(stage().textContent).toContain('finance');
  });

  it('shows the four states, on a phone without a header or a composer', () => {
    show('states');
    expect(cardIds()).toHaveLength(4);
    expect(stage().querySelector('[data-tour-header]')).toBeTruthy();
    expect(stage().querySelector('[data-tour-composer-text]')).toBeTruthy();
    cleanup();

    show('states', 0, true);
    expect(cardIds()).toHaveLength(4);
    expect(stage().querySelector('[data-tour-header]')).toBeNull();
    expect(stage().querySelector('[data-tour-composer-text]')).toBeNull();
    expect(stage().querySelector('[data-compact-card-resolved-badge]')).toBeTruthy();
    expect(stage().querySelector('[data-thread-snoozed]')).toBeTruthy();
    expect(stage().querySelector('[data-thread-unread="true"]')).toBeTruthy();
    expect(stage().querySelector('[data-attention-state="streaming"]')).toBeTruthy();
  });

  it("types the sample message into the composer under the app's placeholder", () => {
    const { rerender } = show('start', 0);
    const text = () => stage().querySelector('[data-tour-composer-text]')?.textContent;
    expect(text()).toBe('Send a message...');
    rerender(stageOf(sceneOf('start', 1, false, 5)));
    expect(text()).toBe('Draft');
    rerender(stageOf(sceneOf('start', 2, false, 29)));
    expect(text()).toBe('Draft the spring launch email');
  });

  it('opens the new thread with the message and the agent answering', () => {
    show('start');
    expect(parts('thread')[0]?.textContent).toContain('Draft the spring launch email');
    expect(parts('thread')[0]?.textContent).toContain(
      'Here is a first draft with three subject lines.'
    );
    expect(parts('replyBox')).toHaveLength(1);
    expect(parts('composer')).toHaveLength(0);
    expect(parts('back')[0]?.getAttribute('aria-label')).toBe('Back');
    expect(cardIds()).toEqual([]);
  });

  it("marks the new card's title on the card the app drew", () => {
    show('title');
    const title = parts('title:launch')[0];
    expect(title?.textContent).toBe('Spring launch email');
    expect(title?.closest('[data-tour-part="card:launch"]')).toBeTruthy();
  });

  it("shows a card's buttons on a wider screen and swipes the card on a phone", () => {
    show('resolve', 0);
    expect(parts('resolveButton')[0]?.getAttribute('aria-label')).toBe('Resolve');
    expect(stage().querySelector('[data-tour-swipe]')).toBeNull();
    cleanup();

    show('resolve', 0, true);
    expect(parts('resolveButton')).toHaveLength(0);
    expect(stage().querySelector('[data-tour-swipe]')?.textContent).toBe('Resolve');
  });

  it("opens the card's menu with the app's entries", () => {
    show('snooze');
    const menu = stage().querySelector('[data-tour-card-menu]');
    expect(menu?.textContent).toContain('Edit summary');
    expect(menu?.textContent).toContain('Edit tags');
    expect(parts('menuSnooze')[0]?.textContent).toBe('Snooze');
  });

  it('shows the filter bar, and on a phone the room menu that holds its button', () => {
    show('filters');
    const bar = parts('filterBar')[0];
    expect(bar?.textContent).toContain('Unresolved');
    expect(bar?.textContent).toContain('Last Reply');
    expect(parts('filterButton')[0]?.getAttribute('aria-label')).toBe('Thread filters');
    cleanup();

    show('filters', 0, true);
    const menu = stage().querySelector('[data-tour-room-menu]');
    expect(menu?.textContent).toContain('Compact view');
    expect(parts('filterButton')[0]?.textContent).toBe('Thread filters');
    expect(parts('filterButton')[0]?.closest('[data-tour-room-menu]')).toBe(menu);
  });

  it("shows each thread's first message with its reply count in the Threads view", () => {
    show('views');
    expect(cardIds()).toEqual([]);
    const counts = Array.from(
      stage().querySelectorAll('[data-tour-reply-count]'),
      (chip) => chip.textContent
    );
    // The newest thread first, as the Threads view of a room with agents lists them.
    expect(counts).toEqual(['1 reply', '4 replies', '6 replies']);
    expect(stage().textContent).toContain('Draft the spring launch email');
  });

  it('puts the bell on the rail, or in the top bar of a phone, with three rows in its list', () => {
    show('activity');
    expect(parts('bell')[0]?.closest('[data-tour-rail]')).toBeTruthy();
    const rows = () =>
      Array.from(
        stage().querySelectorAll<HTMLElement>('[data-tour-activity-row]'),
        (row) => row.dataset.tourActivityRow
      );
    expect(rows()).toEqual(['approval', 'finished', 'mention']);
    expect(stage().querySelector('[data-tour-activity]')?.textContent).toContain(
      'Analyst needs approval'
    );
    expect(stage().querySelector('[data-tour-activity]')?.textContent).toContain('Approve');
    cleanup();

    show('activity', 0, true);
    expect(parts('bell')[0]?.closest('[data-tour-phone-bar]')).toBeTruthy();
    expect(stage().querySelector('[data-tour-rail]')).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('fades a new view in over the one before it, which loses its marks', () => {
    vi.useFakeTimers();
    const { rerender } = show('reply', 1);
    const messages = () => stage().querySelectorAll('[data-tour-message]').length;
    expect(parts('back')).toHaveLength(1);
    expect(messages()).toBe(2);

    rerender(stageOf(sceneOf('reply', 2, false, TYPED)));
    // The thread is still there under the list, and only the list's parts are marked.
    expect(messages()).toBe(2);
    expect(parts('back')).toHaveLength(0);
    expect(parts('thread')).toHaveLength(0);
    expect(parts('card:launch')).toHaveLength(1);
    expect(stage().querySelectorAll('[data-tour-part^="title:"]')).toHaveLength(4);
    expect(stage().querySelectorAll('[data-tour-view]')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(VIEW_FADE_MS);
    });
    expect(messages()).toBe(0);
    expect(cardIds()).toEqual(['launch', 'budget', 'vendor', 'website']);
  });

  it('changes the view at once with reduced motion', () => {
    mockMedia({ reducedMotion: true });
    const { rerender } = show('reply', 1);
    rerender(stageOf(sceneOf('reply', 2, false, TYPED)));
    expect(stage().querySelectorAll('[data-tour-message]')).toHaveLength(0);
    expect(cardIds()).toHaveLength(4);
  });
});
