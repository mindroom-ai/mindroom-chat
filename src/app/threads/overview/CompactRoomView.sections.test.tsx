// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { type CompactFocusRequest, takeCompactFocusRequest } from './compactFocusRequest';
import type { CompactThreadSection } from './compactThreadSections';
import { clearCompactRoomSectionsStore } from './compactRoomSections';
import { CompactRoomView } from './CompactRoomView';
import { FIRST_SCREEN_CARDS } from './useStagedCardIds';

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const NOW = 1_000;

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  sections: undefined as CompactThreadSection[] | undefined,
  enabled: [] as boolean[],
}));

const viewModel = (threadRootId: string): CompactThreadCardViewModel => ({
  id: { roomId: ROOM_ID, threadRootId },
  titleText: threadRootId,
  displayTitleText: threadRootId,
  previewText: 'No replies yet',
  messageCount: 0,
  messageCountLabel: '0 replies',
  messageCountText: '0',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
});

vi.mock('./useCompactThreadSections', () => ({
  useCompactThreadSections: ({ now }: { now: number | undefined }) => {
    state.enabled.push(now !== undefined);
    return now !== undefined ? state.sections : undefined;
  },
}));
vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({ threadRootIds }: { threadRootIds: string[] }) =>
    threadRootIds.map(viewModel),
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updatingThreadRootIds: new Set(),
    error: undefined,
  }),
}));
vi.mock('../../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    canPin: true,
    pinnedEventIds: state.pinned,
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('../useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('./useThreadRootLiveCallRow', () => ({ useThreadRootLiveCallRow: () => undefined }));
vi.mock('./ThreadCardBadges', () => ({ ThreadCardBadges: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID, myUserId: ME } as unknown as Room;
const view = (threadRootIds: string[], sections = true) => (
  <CompactRoomView
    room={room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
    sectionsNow={sections ? NOW : undefined}
  />
);

/** The list's rows in order: a section's header as `#id count`, a card as its root ID. */
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-compact-section], [data-scroll-anchor]')].map(
    (row) =>
      row.dataset.compactSection !== undefined
        ? `#${row.dataset.compactSection} ${row.textContent?.split(' · ')[1] ?? ''}`
        : row.dataset.scrollAnchor
  );
const header = (id: string) => {
  const row = document.querySelector(`[data-compact-section="${id}"]`);
  const button = row?.querySelector('button');
  if (!button) throw new Error(`no ${id} header`);
  return button;
};

beforeEach(() => {
  state.pinned = [];
  state.enabled = [];
  state.sections = [
    { id: 'needsYou', rootIds: ['$read'] },
    { id: 'working', rootIds: ['$job', '$streaming'] },
    { id: 'later', rootIds: ['$snoozed'] },
    { id: 'done', rootIds: ['$done'] },
  ];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearCompactRoomSectionsStore(ME);
  localStorage.clear();
});

describe('the Compact room in sections', () => {
  it('keeps Working promotions in place while scrolled but applies folds and leaves', () => {
    state.sections = [
      { id: 'needsYou', rootIds: ['$a', '$b'] },
      { id: 'later', rootIds: ['$c'] },
    ];
    const { container, rerender } = render(view(['$a', '$b', '$c']));
    const scrollView = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scrollView.scrollTop = 30;
    fireEvent.scroll(scrollView);
    state.sections = [
      { id: 'working', rootIds: ['$b'] },
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'later', rootIds: ['$c'] },
    ];
    rerender(view(['$a', '$b', '$c']));
    expect(rows()).toEqual(['#needsYou 2', '$a', '$b', '#later 1', '$c']);
    fireEvent.click(header('needsYou'));
    expect(rows()).toEqual(['#needsYou 2', '#later 1', '$c']);
    state.sections = [
      { id: 'working', rootIds: ['$b'] },
      { id: 'later', rootIds: ['$c'] },
    ];
    rerender(view(['$b', '$c']));
    expect(rows()).toEqual(['#needsYou 1', '#later 1', '$c']);
    scrollView.scrollTop = 0;
    fireEvent.scroll(scrollView);
    expect(rows()).toEqual(['#working 1', '$b', '#later 1', '$c']);
  });

  it('joins at the live edge of a section despite a pending move to Working', () => {
    const ids = ['$a', '$b', '$c'];
    state.sections = [{ id: 'needsYou', rootIds: ids }];
    const { container, rerender } = render(view(ids));
    const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scroller.scrollTop = 30;
    fireEvent.scroll(scroller);
    const pill = () => screen.queryByRole('button', { name: /showUpdatedOrder/ });
    const working = { id: 'working' as const, rootIds: ['$c'] };

    state.sections = [working, { id: 'needsYou', rootIds: ['$a', '$b'] }];
    rerender(view(ids));
    expect(rows()).toEqual(['#needsYou 3', '$a', '$b', '$c']);

    const needsYou = { id: 'needsYou' as const, rootIds: ['$new', '$a', '$b'] };
    state.sections = [working, needsYou];
    rerender(view(['$new', ...ids]));
    expect(rows()).toEqual(['#needsYou 4', '$new', '$a', '$b', '$c']);
    expect(pill()).not.toBeNull();

    state.sections = [needsYou];
    rerender(view(needsYou.rootIds));
    expect(rows()).toEqual(['#needsYou 3', '$new', '$a', '$b']);
    expect(pill()).toBeNull();
  });

  it('restores the stored fold when a departed section returns while scrolled', () => {
    localStorage.setItem(
      `compactRoomSections:${ME}`,
      JSON.stringify({ on: true, folded: ['done'] })
    );
    const done = { id: 'done' as const, rootIds: ['$done'] };
    state.sections = [done];
    const { container, rerender } = render(view(done.rootIds));
    const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scroller.scrollTop = 30;
    fireEvent.scroll(scroller);
    expect(rows()).toEqual(['#done 1', '$done']);

    const other = [
      { id: 'needsYou' as const, rootIds: ['$needs'] },
      { id: 'later' as const, rootIds: ['$later'] },
    ];
    state.sections = [...other, done];
    rerender(view(['$needs', '$later', '$done']));
    expect(rows()).toContain('$done');

    state.sections = other;
    rerender(view(['$needs', '$later']));
    expect(rows()).toEqual(['#needsYou 1', '$needs', '#later 1', '$later']);

    state.sections = [...other, { id: 'done', rootIds: ['$newDone'] }];
    rerender(view(['$needs', '$later', '$newDone']));
    expect(header('done').getAttribute('aria-expanded')).toBe('false');
    expect(rows()).toEqual(['#needsYou 1', '$needs', '#later 1', '$later', '#done 1']);
    expect(screen.queryByRole('button', { name: /showUpdatedOrder/ })).toBeNull();
  });

  it('offers changed folded header counts, but not a reorder within a folded section', () => {
    const ids = ['$a', '$b', '$c', '$d'];
    state.sections = [
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'later', rootIds: ['$b', '$c'] },
      { id: 'done', rootIds: ['$d'] },
    ];
    const { container, rerender } = render(view(ids));
    fireEvent.click(header('later'));
    const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scroller.scrollTop = 30;
    fireEvent.scroll(scroller);
    const pill = () => screen.queryByRole('button', { name: /showUpdatedOrder/ });

    state.sections = [
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'later', rootIds: ['$c', '$b'] },
      { id: 'done', rootIds: ['$d'] },
    ];
    rerender(view(ids));
    expect(rows()).toEqual(['#needsYou 1', '$a', '#later 2', '#done 1']);
    expect(pill()).toBeNull();

    state.sections = [
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'later', rootIds: ['$c'] },
      { id: 'done', rootIds: ['$d', '$b'] },
    ];
    rerender(view(ids));
    expect(rows()).toEqual(['#needsYou 1', '$a', '#later 2', '#done 1']);
    expect(pill()).not.toBeNull();
  });

  it('removes an empty section while scrolled without offering a new order', () => {
    state.sections = [
      { id: 'needsYou', rootIds: ['$a', '$b'] },
      { id: 'later', rootIds: ['$c'] },
    ];
    const { container, rerender } = render(view(['$a', '$b', '$c']));
    const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scroller.scrollTop = 30;
    fireEvent.scroll(scroller);

    state.sections = [{ id: 'needsYou', rootIds: ['$a', '$b'] }];
    rerender(view(['$a', '$b']));
    expect(rows()).toEqual(['#needsYou 2', '$a', '$b']);
    expect(screen.queryByRole('button', { name: /showUpdatedOrder/ })).toBeNull();
  });

  it('keeps the departing section header focused while scrolled', () => {
    const needsYou = {
      id: 'needsYou' as const,
      rootIds: Array.from({ length: 24 }, (_, i) => `$need${i}`),
    };
    state.sections = [needsYou, { id: 'later', rootIds: ['$later'] }];
    const { container, rerender } = render(view([...needsYou.rootIds, '$later']));
    const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    scroller.scrollTop = 30;
    fireEvent.scroll(scroller);
    const laterHeader = header('later');
    act(() => laterHeader.focus());
    expect(document.activeElement).toBe(laterHeader);

    state.sections = [needsYou];
    rerender(view(needsYou.rootIds));
    expect(document.activeElement).toBe(laterHeader);
    expect(header('later').textContent).toBe('thread.workflow.later · 0');
    expect(rows()).not.toContain('$later');
    expect(scroller.scrollTop).toBe(30);

    act(() => scroller.focus());
    expect(document.querySelector('[data-compact-section="later"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /showUpdatedOrder/ })).toBeNull();
  });

  it.each([true, false])(
    'preserves focus when a section above leaves (header focused: %s)',
    (focused) => {
      const needsYou = {
        id: 'needsYou' as const,
        rootIds: Array.from({ length: 24 }, (_, i) => `$need${i}`),
      };
      state.sections = [{ id: 'working', rootIds: ['$working'] }, needsYou];
      const withOutside = (ids: string[]) => (
        <>
          <button type="button">Outside focus</button>
          {view(ids)}
        </>
      );
      const { container, rerender } = render(withOutside(['$working', ...needsYou.rootIds]));
      const scroller = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
      scroller.scrollTop = 30;
      fireEvent.scroll(scroller);
      const needsHeader = header('needsYou');
      const target = focused ? needsHeader : screen.getByRole('button', { name: 'Outside focus' });
      act(() => target.focus());
      expect(document.activeElement).toBe(target);

      state.sections = [needsYou];
      rerender(withOutside(needsYou.rootIds));
      expect(document.activeElement).toBe(target);
      expect(scroller.scrollTop).toBe(30);
      if (focused) {
        expect(header('needsYou')).toBe(needsHeader);
        expect(header('working').textContent).toBe('thread.workflow.working · 0');
      } else {
        expect(document.querySelector('[data-compact-section="working"]')).toBeNull();
        expect(document.querySelector('[data-compact-section="needsYou"] button')).toBeNull();
      }
    }
  );

  it('lists the cards under their headers, with counts, and Done folded at first', () => {
    render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));

    expect(rows()).toEqual([
      '#needsYou 1',
      '$read',
      '#working 2',
      '$job',
      '$streaming',
      '#later 1',
      '$snoozed',
      '#done 1',
    ]);
    // Each header names its section as the workflow tab that shows it.
    expect(header('needsYou').textContent).toBe('thread.workflow.needsYou · 1');
    expect(header('working').getAttribute('aria-expanded')).toBe('true');
    expect(header('done').getAttribute('aria-expanded')).toBe('false');
    // A header is no card: the scroll position is never restored against it.
    expect(document.querySelector('[data-compact-section][data-scroll-anchor]')).toBeNull();
  });

  it('folds and opens a section from its header, for the whole account', () => {
    render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));

    act(() => {
      fireEvent.click(header('done'));
      fireEvent.click(header('working'));
    });

    expect(rows()).toEqual([
      '#needsYou 1',
      '$read',
      '#working 2',
      '#later 1',
      '$snoozed',
      '#done 1',
      '$done',
    ]);
    expect(JSON.parse(localStorage.getItem(`compactRoomSections:${ME}`) ?? 'null')).toEqual({
      on: false,
      folded: ['working'],
    });
  });

  it('opens a section that shows alone, as the Done tab shows it, and keeps its stored fold', () => {
    state.sections = [{ id: 'done', rootIds: ['$done'] }];
    render(view(['$done']));

    expect(rows()).toEqual(['#done 1', '$done']);
    // Nothing to fold: the header is a label, and the stored fold waits for the other sections.
    const row = document.querySelector('[data-compact-section="done"]');
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.textContent).toBe('thread.workflow.done · 1');
    expect(localStorage.getItem(`compactRoomSections:${ME}`)).toBeNull();
  });

  it('leads each section with its pinned cards instead of a Pinned list of their own', () => {
    state.pinned = ['$read'];
    render(view(['$read', '$streaming', '$job', '$snoozed', '$done']));

    expect(document.querySelector('[data-pinned-threads]')).toBeNull();
    expect(screen.queryByText('threadNav.pinned')).toBeNull();
    expect(rows()).toContain('$read');
  });

  it('keeps the rows in place while the pointer is on the cards, and regroups after', () => {
    const { rerender } = render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));
    const list = header('working').closest<HTMLElement>('[data-compact-room-view] > div')!;
    act(() => {
      fireEvent.pointerEnter(list);
    });

    // The job ends: its thread needs you now.
    state.sections = [
      { id: 'needsYou', rootIds: ['$job', '$read'] },
      { id: 'working', rootIds: ['$streaming'] },
      { id: 'later', rootIds: ['$snoozed'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    rerender(view(['$streaming', '$job', '$snoozed', '$read', '$done']));
    expect(rows().slice(0, 5)).toEqual([
      '#needsYou 2',
      '$read',
      '#working 1',
      '$job',
      '$streaming',
    ]);

    // jsdom's pointer events carry no pointer type: the pointer lets go at the next click.
    act(() => {
      fireEvent.pointerLeave(list);
      fireEvent.click(document.body);
    });
    expect(rows()).toEqual([
      '#needsYou 2',
      '$job',
      '$read',
      '#working 1',
      '$streaming',
      '#later 1',
      '$snoozed',
      '#done 1',
    ]);
  });

  describe('while the pointer holds the order', () => {
    /** Renders `initial`, holds the order, then gives the list `next` with `added` threads. */
    const holdThenRegroup = (
      initial: CompactThreadSection[],
      next: CompactThreadSection[],
      added: string[] = [],
      hovered?: string
    ) => {
      state.sections = initial;
      const rootIds = initial.flatMap(({ rootIds: ids }) => ids);
      const { rerender } = render(view(rootIds));
      const list = document.querySelector<HTMLElement>(
        '[data-compact-room-view] > div:has([data-scroll-anchor])'
      )!;
      const target = hovered ? list.querySelector(`[data-scroll-anchor="${hovered}"]`)! : list;
      act(() => {
        fireEvent.pointerEnter(target);
      });
      state.sections = next;
      rerender(view([...added, ...rootIds]));
      return () =>
        act(() => {
          fireEvent.pointerLeave(list);
          fireEvent.click(document.body);
        });
    };

    it('puts a leading join before survivors that are held in their old section', () => {
      holdThenRegroup(
        [{ id: 'working', rootIds: ['$y', '$x'] }],
        [
          { id: 'needsYou', rootIds: ['$x'] },
          { id: 'working', rootIds: ['$new', '$y'] },
        ],
        ['$new']
      );

      expect(rows()).toEqual(['#working 2', '$new', '$y', '$x']);
    });

    it('keeps the header of a section its last card left, with no count, until let go', () => {
      const release = holdThenRegroup(
        [
          { id: 'needsYou', rootIds: ['$read'] },
          { id: 'working', rootIds: ['$job'] },
        ],
        [{ id: 'needsYou', rootIds: ['$job', '$read'] }]
      );

      expect(rows()).toEqual(['#needsYou 2', '$read', '#working 0', '$job']);

      release();
      expect(rows()).toEqual(['#needsYou 2', '$job', '$read']);
    });

    it('keeps a card that moves into folded Done in view until let go', () => {
      const release = holdThenRegroup(
        [
          { id: 'needsYou', rootIds: ['$a', '$b'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'done', rootIds: ['$a', '$done'] },
        ]
      );

      expect(rows()).toEqual(['#needsYou 1', '$a', '$b', '#done 2']);

      release();
      expect(rows()).toEqual(['#needsYou 1', '$b', '#done 2']);
    });

    it('shows no header for a section a shown card moves into until let go', () => {
      const release = holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$a', '$b'] }],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'later', rootIds: ['$a'] },
        ]
      );

      expect(rows()).toEqual(['#needsYou 1', '$a', '$b']);

      release();
      expect(rows()).toEqual(['#needsYou 1', '$b', '#later 1', '$a']);
    });

    it('keeps B in place under the pointer while A starts working, until let go', () => {
      const release = holdThenRegroup(
        [
          { id: 'needsYou', rootIds: ['$a', '$b'] },
          { id: 'working', rootIds: ['$w'] },
        ],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'working', rootIds: ['$a', '$w'] },
        ],
        [],
        '$b'
      );

      expect(rows()).toEqual(['#needsYou 1', '$a', '$b', '#working 2', '$w']);

      release();
      expect(rows()).toEqual(['#needsYou 1', '$b', '#working 2', '$a', '$w']);
    });

    it('keeps a lone section open when a new Working card brings a second, until let go', () => {
      localStorage.setItem(
        `compactRoomSections:${ME}`,
        JSON.stringify({ on: true, folded: ['needsYou'] })
      );
      const release = holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$b'] }],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'working', rootIds: ['$a'] },
        ],
        ['$a']
      );

      expect(rows()).toEqual(['#needsYou 1', '$b', '#working 1', '$a']);

      release();
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
    });

    it('keeps only the lone section open: other stored folds still apply while held', () => {
      localStorage.setItem(
        `compactRoomSections:${ME}`,
        JSON.stringify({ on: true, folded: ['working', 'done'] })
      );
      holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$b'] }],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'working', rootIds: ['$a'] },
          { id: 'done', rootIds: ['$d'] },
        ],
        ['$a', '$d']
      );

      expect(rows()).toEqual(['#needsYou 1', '$b', '#working 1', '#done 1']);
    });

    it('folds a held-open section stored open with one click on its header', () => {
      const release = holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$b'] }],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'working', rootIds: ['$a'] },
        ],
        ['$a']
      );

      act(() => {
        fireEvent.click(header('needsYou'));
      });
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
      expect(header('needsYou').getAttribute('aria-expanded')).toBe('false');

      release();
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
    });

    it('folds the held-open section from its header at once, and keeps it folded after', () => {
      localStorage.setItem(
        `compactRoomSections:${ME}`,
        JSON.stringify({ on: true, folded: ['needsYou'] })
      );
      const release = holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$b'] }],
        [
          { id: 'needsYou', rootIds: ['$b'] },
          { id: 'working', rootIds: ['$a'] },
        ],
        ['$a']
      );
      expect(header('needsYou').getAttribute('aria-expanded')).toBe('true');

      act(() => {
        fireEvent.click(header('needsYou'));
      });
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
      expect(header('needsYou').getAttribute('aria-expanded')).toBe('false');

      release();
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
      expect(JSON.parse(localStorage.getItem(`compactRoomSections:${ME}`) ?? 'null')).toEqual({
        on: true,
        folded: ['needsYou'],
      });
    });

    it('keeps a held section in its shown order while a new section comes in before it', () => {
      const release = holdThenRegroup(
        [
          { id: 'working', rootIds: ['$a', '$b'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        // $a finished and a new thread $n came in: both need you now, and Needs you sorts $n first.
        [
          { id: 'needsYou', rootIds: ['$n', '$a'] },
          { id: 'working', rootIds: ['$b'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        ['$n']
      );

      expect(rows()).toEqual(['#needsYou 2', '$n', '#working 1', '$a', '$b', '#done 1']);

      release();
      expect(rows()).toEqual(['#needsYou 2', '$n', '$a', '#working 1', '$b', '#done 1']);
    });

    it('holds no section of the room before when the next room opens under the pointer', () => {
      const { rerender } = render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));
      const list = document.querySelector<HTMLElement>(
        '[data-compact-room-view] > div:has([data-scroll-anchor])'
      )!;
      act(() => {
        fireEvent.pointerEnter(list);
      });

      // The same view shows the next room (Alt+Down), the pointer still on the cards.
      const nextRoom = { roomId: '!next:example.org', myUserId: ME } as unknown as Room;
      state.sections = [{ id: 'needsYou', rootIds: ['$b1', '$b2'] }];
      rerender(
        <CompactRoomView
          room={nextRoom}
          threadRootIds={['$b1', '$b2']}
          threadRecordMap={new Map()}
          onThreadClick={vi.fn()}
          compactRoomScrollStateRef={{ current: new Map() }}
          sectionsNow={NOW}
        />
      );

      expect(rows()).toEqual(['#needsYou 2', '$b1', '$b2']);
    });

    it('shows a new thread under its own header, which comes with it', () => {
      state.sections = [{ id: 'needsYou', rootIds: ['$a'] }];
      const { rerender } = render(view(['$a']));
      const list = document.querySelector<HTMLElement>(
        '[data-compact-room-view] > div:has([data-scroll-anchor])'
      )!;
      act(() => {
        fireEvent.pointerEnter(list);
      });

      state.sections = [
        { id: 'needsYou', rootIds: ['$a'] },
        { id: 'working', rootIds: ['$new'] },
      ];
      rerender(view(['$new', '$a']));

      expect(rows()).toEqual(['#needsYou 1', '$a', '#working 1', '$new']);
    });
  });

  it('shows the header of the section a mounted card moves to while cards still mount', () => {
    const waiting = Array.from({ length: 100 }, (_unused, index) => `$waiting${index}`);
    const ids = ['$a', ...waiting];
    state.sections = [{ id: 'needsYou', rootIds: ids }];
    const { rerender } = render(view(ids));
    expect(rows()).toContain('$a');

    // $a starts working below the Needs you cards before the rest of those cards mount.
    state.sections = [
      { id: 'needsYou', rootIds: waiting },
      { id: 'working', rootIds: ['$a'] },
    ];
    rerender(view(ids));

    expect(document.querySelector('[data-cards-pending]')).not.toBeNull();
    expect(rows().slice(-2)).toEqual(['#working 1', '$a']);
  });

  it('mounts the first screenful on the way back from a card in folded Done', () => {
    const waiting = Array.from({ length: 60 }, (_unused, index) => `$waiting${index}`);
    state.sections = [
      { id: 'needsYou', rootIds: waiting },
      { id: 'done', rootIds: ['$done'] },
    ];
    const place = { scrollTop: 9000, anchors: [{ key: '$done', offset: 0 }] };
    // jsdom has none; the list follows the place the reader left while its cards mount.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    render(
      <CompactRoomView
        room={room}
        threadRootIds={[...waiting, '$done']}
        threadRecordMap={new Map()}
        onThreadClick={vi.fn()}
        compactRoomScrollStateRef={{ current: new Map([[ROOM_ID, place]]) }}
        sectionsNow={NOW}
      />
    );

    // The first screenful of cards, under their headers, and Done stays folded.
    expect(rows().filter((row) => !row?.startsWith('#'))).toHaveLength(FIRST_SCREEN_CARDS);
    expect(rows()).not.toContain('$done');
  });

  it("meets the address's request for a card once the card shows, not while its section is folded", () => {
    const memory: ScrollAnchorMemory = new Map();
    // What a return to the entry finds: the place the reader left, unless its request is unmet.
    const placeOnReturn = (eventId: string) => {
      const left = { scrollTop: 0, anchors: [] };
      memory.set(ROOM_ID, left);
      takeCompactFocusRequest(memory, ROOM_ID, { eventId, entryKey: 'entry' });
      return memory.get(ROOM_ID) === left ? 'left' : 'focused';
    };
    const focusing = (eventId: string) => (
      <CompactRoomView
        room={room}
        threadRootIds={['$read', '$done']}
        threadRecordMap={new Map()}
        onThreadClick={vi.fn()}
        compactRoomScrollStateRef={{ current: memory }}
        focusRequest={{ eventId, entryKey: 'entry' }}
        sectionsNow={NOW}
      />
    );

    const { rerender } = render(focusing('$done'));
    expect(rows()).not.toContain('$done');
    expect(placeOnReturn('$done')).toBe('focused');

    rerender(focusing('$read'));
    expect(rows()).toContain('$read');
    expect(placeOnReturn('$read')).toBe('left');
    expect(placeOnReturn('$done')).toBe('focused');
  });

  it('shows the cards as before while Sections are off', () => {
    render(view(['$streaming', '$job'], false));

    expect(rows()).toEqual(['$streaming', '$job']);
    expect(state.enabled.every((enabled) => !enabled)).toBe(true);
  });
});

describe('a focus request on the mounted Compact room', () => {
  const ROW_HEIGHT = 100;
  const VIEW_HEIGHT = 300;
  const cards = Array.from({ length: 10 }, (_unused, index) => `$card${index}`);
  let scrollTop = 0;

  // jsdom lays nothing out: each card is ROW_HEIGHT tall, one under the other, in a list
  // VIEW_HEIGHT tall that scrolls.
  beforeEach(() => {
    scrollTop = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
      this: HTMLElement
    ) {
      if (this.dataset.compactRoomView) return new DOMRect(0, 0, 300, VIEW_HEIGHT);
      const index = [...document.querySelectorAll('[data-scroll-anchor]')].indexOf(this);
      return new DOMRect(0, index * ROW_HEIGHT - scrollTop, 300, index < 0 ? 0 : ROW_HEIGHT);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation((value: number) => {
      scrollTop = Math.min(Math.max(0, value), cards.length * ROW_HEIGHT - VIEW_HEIGHT);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const memory: ScrollAnchorMemory = new Map();
  const at = (focusRequest?: CompactFocusRequest) => {
    // What the room does as it renders the address.
    if (focusRequest) takeCompactFocusRequest(memory, ROOM_ID, focusRequest);
    return (
      <CompactRoomView
        room={room}
        threadRootIds={cards}
        threadRecordMap={new Map()}
        onThreadClick={vi.fn()}
        compactRoomScrollStateRef={{ current: memory }}
        focusRequest={focusRequest}
      />
    );
  };
  const topOf = (key: string) =>
    document.querySelector(`[data-scroll-anchor="${key}"]`)!.getBoundingClientRect().top;

  it('brings a card out of view to its place below the top, once, and leaves one in view', () => {
    memory.clear();
    // The list was left earlier with the card in view, and the reader is now at its top.
    memory.set(ROOM_ID, { scrollTop: 700, anchors: [{ key: '$card8', offset: 100 }] });
    const { rerender } = render(at());
    scrollTop = 0;

    rerender(at({ eventId: '$card8', entryKey: 'pin', pushed: true }));
    expect(topOf('$card8')).toBe(160);

    // The reader scrolls on; another render of that address keeps their place.
    scrollTop = 100;
    rerender(at({ eventId: '$card8', entryKey: 'pin', pushed: true }));
    expect(scrollTop).toBe(100);

    // A card in view stays where it is.
    rerender(at({ eventId: '$card2', entryKey: 'next', pushed: true }));
    expect(scrollTop).toBe(100);

    // Back to the first entry keeps the reader's place: its request was met.
    rerender(at({ eventId: '$card8', entryKey: 'pin' }));
    expect(scrollTop).toBe(100);
  });

  it('stays where the reader is for a request of an entry the router replaced', () => {
    memory.clear();
    const { rerender } = render(at({ eventId: '$card1', entryKey: 'pin', pushed: true }));
    scrollTop = 500;

    // A thread opened beside the list closes: its entry gives way to the pin's address.
    rerender(at({ eventId: '$card1', entryKey: 'replaced' }));
    expect(scrollTop).toBe(500);
  });

  it('keeps the place the list was left at for a card in view', () => {
    const left = { scrollTop: 100, anchors: [{ key: '$card2', offset: 100 }] };
    memory.clear();
    memory.set(ROOM_ID, left);
    const { rerender } = render(at());

    rerender(at({ eventId: '$card2', entryKey: 'pin', pushed: true }));
    expect(scrollTop).toBe(100);
    expect(memory.get(ROOM_ID)).toBe(left);
  });
});
