// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
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
    { id: 'working', rootIds: ['$job', '$streaming'] },
    { id: 'needsYou', rootIds: ['$read'] },
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
  it('lists the cards under their headers, with counts, and Done folded at first', () => {
    render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));

    expect(rows()).toEqual([
      '#working 2',
      '$job',
      '$streaming',
      '#needsYou 1',
      '$read',
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
      '#working 2',
      '#needsYou 1',
      '$read',
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
      { id: 'working', rootIds: ['$streaming'] },
      { id: 'needsYou', rootIds: ['$job', '$read'] },
      { id: 'later', rootIds: ['$snoozed'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    rerender(view(['$streaming', '$job', '$snoozed', '$read', '$done']));
    expect(rows().slice(0, 3)).toEqual(['#working 1', '$job', '$streaming']);

    // jsdom's pointer events carry no pointer type: the pointer lets go at the next click.
    act(() => {
      fireEvent.pointerLeave(list);
      fireEvent.click(document.body);
    });
    expect(rows()).toEqual([
      '#working 1',
      '$streaming',
      '#needsYou 2',
      '$job',
      '$read',
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
      added: string[] = []
    ) => {
      state.sections = initial;
      const rootIds = initial.flatMap(({ rootIds: ids }) => ids);
      const { rerender } = render(view(rootIds));
      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
      act(() => {
        fireEvent.pointerEnter(list);
      });
      state.sections = next;
      rerender(view([...added, ...rootIds]));
      return () =>
        act(() => {
          fireEvent.pointerLeave(list);
          fireEvent.click(document.body);
        });
    };

    it('keeps the header of a section its last card left, with no count, until let go', () => {
      const release = holdThenRegroup(
        [
          { id: 'working', rootIds: ['$job'] },
          { id: 'needsYou', rootIds: ['$read'] },
        ],
        [{ id: 'needsYou', rootIds: ['$job', '$read'] }]
      );

      expect(rows()).toEqual(['#working 0', '$job', '#needsYou 2', '$read']);

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

    it('moves a card an agent starts working on to Working at once, its header with it', () => {
      holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$a', '$b'] }],
        [
          { id: 'working', rootIds: ['$a'] },
          { id: 'needsYou', rootIds: ['$b'] },
        ]
      );

      expect(rows()).toEqual(['#working 1', '$a', '#needsYou 1', '$b']);
    });

    it('moves a card an agent starts working on into a shown Working where the live order puts it', () => {
      holdThenRegroup(
        [
          { id: 'working', rootIds: ['$w'] },
          { id: 'needsYou', rootIds: ['$a', '$b'] },
        ],
        [
          { id: 'working', rootIds: ['$b', '$w'] },
          { id: 'needsYou', rootIds: ['$a'] },
        ]
      );

      expect(rows()).toEqual(['#working 2', '$b', '$w', '#needsYou 1', '$a']);
    });

    it('keeps a lone section open when a card moving to Working brings a second, until let go', () => {
      localStorage.setItem(
        `compactRoomSections:${ME}`,
        JSON.stringify({ on: true, folded: ['needsYou'] })
      );
      const release = holdThenRegroup(
        [{ id: 'needsYou', rootIds: ['$a', '$b'] }],
        [
          { id: 'working', rootIds: ['$a'] },
          { id: 'needsYou', rootIds: ['$b'] },
        ]
      );

      expect(rows()).toEqual(['#working 1', '$a', '#needsYou 1', '$b']);

      release();
      expect(rows()).toEqual(['#working 1', '$a', '#needsYou 1']);
    });

    it('keeps a held section in its shown order while a new section comes in after it', () => {
      const release = holdThenRegroup(
        [
          { id: 'working', rootIds: ['$a', '$b'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        // $a finished and a new thread $n came in: both need you now, and Needs you sorts $n first.
        [
          { id: 'working', rootIds: ['$b'] },
          { id: 'needsYou', rootIds: ['$n', '$a'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        ['$n']
      );

      expect(rows()).toEqual(['#working 1', '$a', '$b', '#needsYou 2', '$n', '#done 1']);

      release();
      expect(rows()).toEqual(['#working 1', '$b', '#needsYou 2', '$n', '$a', '#done 1']);
    });

    it('holds no section of the room before when the next room opens under the pointer', () => {
      const { rerender } = render(view(['$streaming', '$job', '$snoozed', '$read', '$done']));
      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
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
      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
      act(() => {
        fireEvent.pointerEnter(list);
      });

      state.sections = [
        { id: 'working', rootIds: ['$new'] },
        { id: 'needsYou', rootIds: ['$a'] },
      ];
      rerender(view(['$new', '$a']));

      expect(rows()).toEqual(['#working 1', '$new', '#needsYou 1', '$a']);
    });
  });

  it('shows the header of the section a mounted card moves to while cards still mount', () => {
    const working = Array.from({ length: 100 }, (_unused, index) => `$w${index}`);
    state.sections = [{ id: 'working', rootIds: ['$a', ...working] }];
    const { rerender } = render(view(['$a', ...working]));
    expect(rows()).toContain('$a');

    // $a finishes before the rest of the cards have mounted: it opens a Needs you section.
    state.sections = [
      { id: 'working', rootIds: working },
      { id: 'needsYou', rootIds: ['$a'] },
    ];
    rerender(view(['$a', ...working]));

    expect(rows().slice(-2)).toEqual(['#needsYou 1', '$a']);
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

  it('shows the cards as before while Sections are off', () => {
    render(view(['$streaming', '$job'], false));

    expect(rows()).toEqual(['$streaming', '$job']);
    expect(state.enabled.every((enabled) => !enabled)).toBe(true);
  });
});
