// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/i18n';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import * as indicatorCss from '../messages/ThreadIndicator.css';
import * as overviewCss from '../threads/overview/RoomThreadOverview.css';
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

const show = (id: TourStepId, phase = lastPhase(id), phone = false, touchCards = phone) =>
  render(stageOf(sceneOf(id, phase, phone, TYPED, touchCards), phone));

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
const activityRowKinds = () =>
  Array.from(
    stage().querySelectorAll<HTMLElement>('[data-tour-activity-row]'),
    (row) => row.dataset.tourActivityRow
  );
const buttonLabels = (selector: string) =>
  Array.from(stage().querySelectorAll(`${selector} button`), (button) =>
    button.getAttribute('aria-label')
  );

beforeEach(() => mockLayout(10));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  restoreLayout();
  restoreMedia();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  document.documentElement.style.fontSize = '';
});

/** Gives every element this height, as a frame that is laid out has one. */
const layOutAt = (height: number) =>
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
/** How much the stage scales its room down. */
const scale = () => stage().parentElement?.style.getPropertyValue('--tour-stage-scale');

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

  it('scales the room down to a frame lower than it, by the page zoom too, and not below 0.6', () => {
    // A wide room is 490 px tall at the browser's font size.
    layOutAt(441);
    show('conversation');
    expect(scale()).toBe('0.9');
    cleanup();

    // The page zoomed to 150 %: the room is 735 px tall, and the same frame holds less of it.
    document.documentElement.style.fontSize = '24px';
    show('conversation');
    expect(scale()).toBe('0.6');
    cleanup();

    // A frame lower still cuts the room off rather than making it unreadable.
    layOutAt(200);
    show('conversation');
    expect(scale()).toBe('0.6');
    cleanup();

    // A frame with room to spare leaves the room at its size.
    layOutAt(900);
    show('conversation');
    expect(scale()).toBe('1');
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

  it('marks the Thread options button of the card whose menu `snooze` opens', () => {
    [false, true].forEach((phone) => {
      show('snooze', 0, phone);
      const button = parts('options:launch');
      expect(button).toHaveLength(1);
      expect(button[0]?.getAttribute('aria-label')).toBe('Thread options');
      cleanup();
    });
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
    // Unresolved is a control of the bar, on as the app has it.
    const unresolved = parts('filterUnresolved')[0];
    expect(unresolved?.textContent).toBe('Unresolved');
    expect(unresolved?.closest('[data-tour-part="filterBar"]')).toBe(bar);
    expect(unresolved?.classList.contains(overviewCss.SortButtonActive)).toBe(true);
    cleanup();

    show('filters', 0, true);
    const menu = stage().querySelector('[data-tour-room-menu]');
    expect(menu?.textContent).toContain('Compact view');
    expect(parts('filterButton')[0]?.textContent).toBe('Thread filters');
    expect(parts('filterButton')[0]?.closest('[data-tour-room-menu]')).toBe(menu);
  });

  it('brings the resolved thread back while Unresolved is off, and counts it', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
    /** The cards that fade in, by the first keyframe of what each plays. */
    const fadedIn = () =>
      animate.mock.contexts
        .filter((_, call) => (animate.mock.calls[call]?.[0] as Keyframe[])[0]?.opacity === 0)
        .map((card) => (card as HTMLElement).dataset.tourCard);
    try {
      const at = (phase: number) => stageOf(sceneOf('filters', phase, false, TYPED));
      const count = () => parts('filterBar')[0]?.querySelector('[data-thread-count]')?.textContent;
      const isOn = () =>
        parts('filterUnresolved')[0]?.classList.contains(overviewCss.SortButtonActive);
      const { rerender } = render(at(1));
      expect(isOn()).toBe(true);
      expect(cardIds()).toEqual(['launch', 'budget', 'website']);
      expect(count()).toBe('3');
      // The cards the list starts with do not fade in.
      expect(fadedIn()).toEqual([]);

      rerender(at(2));
      // Off, the control looks like the bar's other controls.
      expect(isOn()).toBe(false);
      expect(cardIds()).toEqual(['vendor', 'launch', 'budget', 'website']);
      expect(count()).toBe('4');
      const vendor = stage().querySelector('[data-tour-card="vendor"]');
      expect(vendor?.querySelector('[data-compact-card-resolved-badge]')).toBeTruthy();
      expect(fadedIn()).toEqual(['vendor']);

      // The card stays as it is while the ring moves to it.
      animate.mockClear();
      rerender(at(3));
      expect(stage().querySelector('[data-tour-card="vendor"]')).toBe(vendor);
      expect(animate).not.toHaveBeenCalled();

      rerender(at(4));
      expect(isOn()).toBe(true);
      expect(cardIds()).toEqual(['launch', 'budget', 'website']);
      expect(count()).toBe('3');
      expect(fadedIn()).toEqual([]);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it("shows each thread's first message with its real reply chip and participants in the Threads view", () => {
    show('views');
    expect(cardIds()).toEqual([]);
    const chips = Array.from(stage().querySelectorAll('[data-tour-reply-count]'));
    const counts = chips.map(
      (chip) => chip.querySelector(`.${indicatorCss.ThreadIndicatorLabel}`)?.textContent
    );
    // The newest thread first, as the Threads view of a room with agents lists them.
    expect(counts).toEqual(['1 reply', '4 replies', '6 replies']);
    expect(
      chips.map((chip) => chip.querySelectorAll(`.${indicatorCss.ThreadParticipant}`).length)
    ).toEqual([1, 2, 2]);
    expect(stage().textContent).toContain('Draft the spring launch email');
  });

  it('puts the bell on the rail, or in the top bar of a phone, with three rows in its list', () => {
    show('activity');
    expect(parts('bell')[0]?.closest('[data-tour-rail]')).toBeTruthy();
    expect(activityRowKinds()).toEqual(['approval', 'finished', 'mention']);
    expect(stage().querySelector('[data-tour-activity]')?.textContent).toContain(
      'Analyst needs approval'
    );
    expect(stage().querySelector('[data-tour-activity]')?.textContent).toContain('Approve');
    cleanup();

    show('activity', 0, true);
    expect(parts('bell')[0]?.closest('[data-tour-phone-bar]')).toBeTruthy();
    expect(stage().querySelector('[data-tour-rail]')).toBeNull();
    expect(activityRowKinds()).toEqual([]);
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

  it('walks through pinAndTag phases with real pin, pinned section, and pinned Thread options rules', () => {
    // Phase 0 desktop: hover Pin button on untagged budget card.
    show('pinAndTag', 0, false);
    expect(parts('pinButton')[0]?.getAttribute('aria-label')).toBe('Pin thread');
    expect(stage().querySelector('[data-tour-card="budget"]')?.textContent).not.toContain(
      'finance'
    );
    expect(stage().querySelector('[data-tour-card="launch"]')?.textContent).toContain('launch');
    cleanup();

    // Phase 0 phone: Thread options menu open on unpinned budget with Pin, Resolve, Snooze.
    show('pinAndTag', 0, true);
    expect(parts('menuPin')[0]?.textContent).toBe('Pin thread');
    const unpinnedMenu = stage().querySelector('[data-tour-card-menu]');
    expect(unpinnedMenu?.querySelector('[data-thread-action="resolve"]')).toBeTruthy();
    expect(unpinnedMenu?.querySelector('[data-thread-action="snooze"]')).toBeTruthy();
    cleanup();

    // Phase 1: Pinned section spotlighted with budget inside.
    show('pinAndTag', 1, false);
    const section = parts('pinnedSection')[0];
    expect(section?.getAttribute('data-pinned-threads')).toBe('true');
    expect(section && cardIds(section)).toEqual(['budget']);
    cleanup();

    // Phase 2: Thread options open on pinned budget (Edit tags & Unpin, no Resolve or Snooze).
    show('pinAndTag', 2, false);
    expect(parts('menuTags')[0]?.textContent).toBe('Edit tags');
    const pinnedMenu = stage().querySelector('[data-tour-card-menu]');
    expect(pinnedMenu?.querySelector('[data-thread-action="pin"]')?.textContent).toBe(
      'Unpin thread'
    );
    expect(pinnedMenu?.querySelector('[data-thread-action="resolve"]')).toBeNull();
    expect(pinnedMenu?.querySelector('[data-thread-action="snooze"]')).toBeNull();
    expect(pinnedMenu?.textContent).toContain('Details');
    expect(pinnedMenu?.textContent).toContain('Share');
    expect(pinnedMenu?.textContent).toContain('View');
    expect(
      pinnedMenu?.querySelector('[data-thread-action="toolCalls"]')?.getAttribute('role')
    ).toBe('menuitemcheckbox');
    cleanup();

    // Touch tablet (wide room chrome + touch card actions): desktop header with menuPin on Phase 0.
    show('pinAndTag', 0, false, true);
    expect(parts('pinButton')).toHaveLength(0);
    expect(parts('menuPin')[0]?.textContent).toBe('Pin thread');
    expect(stage().querySelector('[data-tour-header] [data-room-view-switch]')).toBeTruthy();
    cleanup();

    // Phone RoomMenu preserves #870 View + Preferences groups with Show Tool Calls switch.
    show('filters', 0, true);
    const roomMenu = stage().querySelector('[data-tour-room-menu]');
    expect(roomMenu?.textContent).toContain('View');
    expect(roomMenu?.textContent).toContain('Preferences');
    expect(
      Array.from(
        roomMenu?.querySelectorAll('[role="menuitemcheckbox"]') ?? [],
        (el) => el.textContent
      )
    ).toEqual(['Compact view', 'Thread filters', 'Show Tool Calls']);
  });

  it('renders real room header, thread banner, and activity list chrome', () => {
    // Desktop list header matches RoomViewHeader order.
    show('conversation', 0, false);
    expect(buttonLabels('[data-tour-header]')).toEqual([
      'Compact view',
      'Thread filters',
      'Scheduled tasks (0)',
      'Show Members',
      'More Options',
    ]);
    cleanup();

    // Desktop open thread shows real banner with ThreadRootTitle, More, Pin, and Resolve;
    // room header omits Compact view and Thread filters.
    show('start');
    expect(buttonLabels('[data-tour-header]')).toEqual([
      'Scheduled tasks (0)',
      'Show Members',
      'More Options',
    ]);
    expect(
      stage().querySelector('[data-thread-context-banner] [data-thread-context-root-title]')
        ?.textContent
    ).toBe('Draft the spring launch email');
    expect(buttonLabels('[data-thread-context-banner]')).toEqual([
      'Back',
      'Thread options',
      'Pin thread',
      'Resolve',
    ]);
    cleanup();

    // Phone open thread banner keeps Back, More, and Resolve (omits Pin, matching ThreadContextBanner).
    show('start', lastPhase('start'), true);
    expect(buttonLabels('[data-thread-context-banner]')).toEqual([
      'Back',
      'Thread options',
      'Resolve',
    ]);
    cleanup();

    // Activity panel renders real header, tabs (including Replies 1), Today divider, and ActivityBadge.
    // Opening the popover keeps only Home selected in the rail (never both Home and Activity).
    show('activity');
    const activity = stage().querySelector('[data-tour-activity]');
    const tablistText = activity?.querySelector('[role="tablist"]')?.textContent;
    expect(tablistText).toContain('Mentions');
    expect(tablistText).toContain('Replies1');
    expect(activity?.textContent).toContain('Unread');
    expect(activity?.textContent).toContain('Today');
    expect(stage().querySelector('[data-activity-badge="needs-you"]')?.textContent).toBe('3');
    expect(stage().querySelectorAll('[data-tour-rail] [data-active="true"]')).toHaveLength(1);
    cleanup();

    // Phone Activity sheet renders two complete representative rows without clipping.
    show('activity', lastPhase('activity'), true);
    expect(activityRowKinds()).toEqual(['approval', 'finished']);
    cleanup();

    // Phone top bar renders search placeholder and real ActivityBadge.
    show('activity', 0, true);
    expect(stage().querySelector('[data-tour-phone-bar]')?.textContent).toContain('Find anything');
    expect(stage().querySelector('[data-activity-badge="needs-you"]')?.textContent).toBe('3');
  });

  it('respects locale 24-hour clock on messages and localized digits on ActivityBadge', async () => {
    const previousLanguage = i18n.language;
    try {
      await act(async () => {
        await i18n.changeLanguage('de');
      });
      show('start');
      const times = Array.from(stage().querySelectorAll('time'), (el) => el.textContent ?? '');
      expect(times.length).toBeGreaterThan(0);
      expect(times.every((text) => /^\d{2}:\d{2}$/.test(text))).toBe(true);
      cleanup();

      await act(async () => {
        await i18n.changeLanguage('bn');
      });
      show('activity');
      expect(stage().querySelector('[data-activity-badge="needs-you"]')?.textContent).toBe('৩');
      const bnTabs = stage().querySelector('[role="tablist"]')?.textContent ?? '';
      expect(bnTabs).toContain('৩');
      expect(bnTabs).toContain('১');
      expect(bnTabs).not.toMatch(/[0-9]/);
    } finally {
      await act(async () => {
        await i18n.changeLanguage(previousLanguage);
      });
    }
  });

  it('changes the view at once with reduced motion', () => {
    mockMedia({ reducedMotion: true });
    const { rerender } = show('reply', 1);
    rerender(stageOf(sceneOf('reply', 2, false, TYPED)));
    expect(stage().querySelectorAll('[data-tour-message]')).toHaveLength(0);
    expect(cardIds()).toHaveLength(4);
  });
});
