// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import {
  type CompactFocusRequest,
  isCompactFocusRequestOpen,
  takeCompactFocusRequest,
} from './compactFocusRequest';
import type { CompactThreadSection } from './compactThreadSections';
import { clearCompactRoomSectionsStore } from './compactRoomSections';
import { CompactRoomView } from './CompactRoomView';
import { stubCompactLayout, tickFrames } from './compactBlocks.test.shared';
import * as scrollFallback from './useCompactScrollFallback';

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const NOW = 1_000;

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  sections: undefined as CompactThreadSection[] | undefined,
  enabled: [] as boolean[],
  lastViewModelIds: [] as string[],
  unreachable: false,
}));
vi.mock('../../matrix/client/homeserverReachability', () => ({
  useHomeserverUnreachable: () => state.unreachable,
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
  useCompactThreadCardViewModels: ({ threadRootIds }: { threadRootIds: string[] }) => {
    state.lastViewModelIds = threadRootIds;
    return threadRootIds.map(viewModel);
  },
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
const viewMemory: ScrollAnchorMemory = new Map();
const view = (
  threadRootIds: string[],
  sections = true,
  activeRoom = room,
  singleBucketTab?: ThreadWorkflowBucket,
  columnsMode = false
) => (
  <CompactRoomView
    room={activeRoom}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: viewMemory }}
    sectionsNow={sections ? NOW : undefined}
    columnsMode={columnsMode}
    singleBucketTab={singleBucketTab}
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
  viewMemory.clear();
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
  it('keeps a 730-card room bounded on every commit while discovering its extent', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const ids = Array.from({ length: 730 }, (_, index) => `$card${index}`);
    state.sections = [
      { id: 'needsYou', rootIds: ids.slice(0, 40) },
      { id: 'done', rootIds: ids.slice(40) },
    ];
    localStorage.setItem(`compactRoomSections:${ME}`, JSON.stringify({ on: true, folded: [] }));
    stubCompactLayout({
      width: () => 390,
      clientHeight: 810,
      gap: 4.25,
      rowHeight: (row) =>
        row.hasAttribute('data-scroll-anchor')
          ? 81.25 + (Number(row.dataset.scrollAnchor?.slice(5)) % 3) * 7.5
          : Number.parseFloat(row.style.height) || 32.25,
    });
    const commits: number[] = [];
    try {
      render(
        <Profiler
          id="compact"
          onRender={() => {
            commits.push(document.querySelectorAll('button[data-thread-root-id]').length);
          }}
        >
          {view(ids)}
        </Profiler>
      );
      tickFrames(75);
      expect(header('needsYou').textContent).toContain('· 40');
      expect(header('done').textContent).toContain('· 690');
      expect(document.querySelector('[data-cards-pending]')).toBeNull();
      expect(Math.max(...commits)).toBeLessThanOrEqual(60);
    } finally {
      cleanup();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  }, 30_000);

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
      v: 3,
      on: false,
      columns: false,
      folded: ['quiet', 'working'],
      order: ['needsYou', 'working', 'later', 'quiet', 'done'],
    });
  });

  it('opens the section of a single-bucket tab, as the Done tab shows it, and restores its stored fold when cleared', () => {
    state.sections = [{ id: 'done', rootIds: ['$done'] }];
    const { rerender } = render(view(['$done'], true, room, 'done'));

    expect(rows()).toEqual(['#done 1', '$done']);
    // Under the Done tab the header is a plain label, and Done's stored fold is left untouched.
    const row = document.querySelector('[data-compact-section="done"]');
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.textContent).toBe('thread.workflow.done · 1');
    expect(localStorage.getItem(`compactRoomSections:${ME}`)).toBeNull();

    // Returning to All (no singleBucketTab) restores Done's stored fold.
    rerender(view(['$done'], true, room, undefined));
    expect(rows()).toEqual(['#done 1']);
    expect(header('done').getAttribute('aria-expanded')).toBe('false');
  });

  it('starts Quiet folded and expands on click, including under the Needs you tab', () => {
    state.sections = [
      { id: 'needsYou', rootIds: ['$active'] },
      { id: 'quiet', rootIds: ['$old'] },
    ];
    const { rerender } = render(view(['$active', '$old'], true, room, 'needsYou'));

    expect(rows()).toEqual(['#needsYou 1', '$active', '#quiet 1']);
    expect(document.querySelector('[data-compact-section="needsYou"] button')).toBeNull();
    expect(header('quiet').getAttribute('aria-expanded')).toBe('false');

    act(() => {
      fireEvent.click(header('quiet'));
    });
    expect(rows()).toEqual(['#needsYou 1', '$active', '#quiet 1', '$old']);
    expect(header('quiet').getAttribute('aria-expanded')).toBe('true');

    // When all threads on the Needs you tab are quiet, only the collapsed Quiet header shows.
    act(() => {
      fireEvent.click(header('quiet'));
    });
    state.sections = [{ id: 'quiet', rootIds: ['$old', '$older'] }];
    rerender(view(['$old', '$older'], true, room, 'needsYou'));
    expect(rows()).toEqual(['#quiet 2']);
    expect(header('quiet').getAttribute('aria-expanded')).toBe('false');

    act(() => {
      fireEvent.click(header('quiet'));
    });
    expect(rows()).toEqual(['#quiet 2', '$old', '$older']);
  });

  it('allows collapsing a lone section when not on a single-bucket tab and persists the fold', () => {
    state.sections = [{ id: 'working', rootIds: ['$job', '$streaming'] }];
    render(view(['$job', '$streaming']));

    expect(rows()).toEqual(['#working 2', '$job', '$streaming']);
    expect(header('working').getAttribute('aria-expanded')).toBe('true');

    act(() => {
      fireEvent.click(header('working'));
    });

    expect(rows()).toEqual(['#working 2']);
    expect(header('working').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(`compactRoomSections:${ME}`) ?? 'null')).toEqual({
      v: 3,
      on: false,
      columns: false,
      folded: ['quiet', 'done', 'working'],
      order: ['needsYou', 'working', 'later', 'quiet', 'done'],
    });
  });

  it('starts a lone section folded when its bucket is stored folded and opens it on click', () => {
    localStorage.setItem(
      `compactRoomSections:${ME}`,
      JSON.stringify({ on: true, folded: ['working', 'done'] })
    );
    state.sections = [{ id: 'working', rootIds: ['$job'] }];
    render(view(['$job']));

    expect(rows()).toEqual(['#working 1']);
    expect(header('working').getAttribute('aria-expanded')).toBe('false');

    act(() => {
      fireEvent.click(header('working'));
    });

    expect(rows()).toEqual(['#working 1', '$job']);
    expect(header('working').getAttribute('aria-expanded')).toBe('true');
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
      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
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

    it('keeps a folded lone section folded when a second section arrives while held and after release', () => {
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

      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
      expect(header('needsYou').getAttribute('aria-expanded')).toBe('false');

      release();
      expect(rows()).toEqual(['#needsYou 1', '#working 1', '$a']);
      expect(header('needsYou').getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps a folded section folded when two sections shrink to one under hold and release', () => {
      const release = holdThenRegroup(
        [
          { id: 'needsYou', rootIds: ['$a'] },
          { id: 'done', rootIds: ['$done'] },
        ],
        [{ id: 'done', rootIds: ['$a', '$done'] }]
      );

      expect(rows()).toEqual(['#needsYou 0', '$a', '#done 2']);
      expect(header('done').getAttribute('aria-expanded')).toBe('false');

      release();
      expect(rows()).toEqual(['#done 2']);
      expect(header('done').getAttribute('aria-expanded')).toBe('false');
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

    it('starts live for the new bucket tab when switching singleBucketTab under the pointer', () => {
      localStorage.setItem(
        `compactRoomSections:${ME}`,
        JSON.stringify({ on: true, folded: ['working', 'done'] })
      );
      state.sections = [{ id: 'working', rootIds: ['$a'] }];
      const { rerender } = render(view(['$a']));
      expect(rows()).toEqual(['#working 1']);

      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
      act(() => {
        fireEvent.pointerEnter(list);
      });

      state.sections = [{ id: 'done', rootIds: ['$a'] }];
      rerender(view(['$a'], true, room, 'done'));

      expect(rows()).toEqual(['#done 1', '$a']);
      expect(document.querySelector('[data-compact-section="done"] button')).toBeNull();
    });

    it('shows a new thread under its own header, which comes with it', () => {
      state.sections = [{ id: 'needsYou', rootIds: ['$a'] }];
      const { rerender } = render(view(['$a']));
      const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
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

  it('retains the first visible card when it moves to a different section during discovery', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function row(this: HTMLElement) {
        return new DOMRect(
          0,
          this.hasAttribute('data-scroll-anchor') && this.dataset.scrollAnchor !== '$a' ? 500 : 0,
          390,
          100
        );
      });
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
    bounds.mockRestore();
    height.mockRestore();
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
    expect(rows().filter((row) => !row?.startsWith('#'))).toHaveLength(24);
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

  it('renders Columns board when columnsMode is true, passes only open column card IDs to view models, and preserves empty state & single-bucket fallback', () => {
    const { rerender } = render(
      view(['$read', '$job', '$streaming', '$snoozed', '$done'], true, room, undefined, true)
    );
    expect(document.querySelector('[data-compact-columns-board="true"]')).not.toBeNull();
    // Done starts folded -> 0 cards mounted in Done and $done is omitted from view models!
    expect(
      document.querySelector('[data-compact-column="done"][data-collapsed="true"]')
    ).not.toBeNull();
    expect(state.lastViewModelIds).toEqual(['$read', '$job', '$streaming', '$snoozed']);
    expect(state.lastViewModelIds).not.toContain('$done');

    // Clicking the collapsed Done rail expands it and requests $done view model.
    fireEvent.click(document.querySelector('[data-compact-column-rail="done"]')!);
    expect(state.lastViewModelIds).toContain('$done');

    // Empty list falls back to empty state instead of an empty board.
    rerender(view([], true, room, undefined, true));
    expect(document.querySelector('[data-compact-columns-board]')).toBeNull();
    expect(screen.getByText('mindroomUi.threads.compactRoomView.noThreads')).toBeTruthy();

    // Single-bucket tab falls back to vertical section rendering.
    rerender(view(['$done'], true, room, 'done', true));
    expect(document.querySelector('[data-compact-columns-board]')).toBeNull();
    expect(document.querySelector('[data-compact-section="done"]')).not.toBeNull();
  });

  it('renders Columns mode with real layout geometry without render loops, preserves per-column scroll, releases touch pointerCancel hold, reveals End/focusRequest past 40 cards', () => {
    const manyIds = Array.from({ length: 75 }, (_, i) => `$col-${i}`);
    state.sections = [
      { id: 'needsYou', rootIds: ['$need-0'] },
      { id: 'working', rootIds: manyIds },
    ];
    stubCompactLayout({
      width: () => 1000,
      clientHeight: 700,
      gap: 4,
      rowHeight: () => 84,
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const commits: number[] = [];
    const renderView = (columnsMode: boolean, focusRequest?: CompactFocusRequest) => (
      <Profiler id="columns-loop-guard" onRender={() => commits.push(1)}>
        <CompactRoomView
          room={room}
          threadRootIds={['$need-0', ...manyIds]}
          threadRecordMap={new Map()}
          onThreadClick={vi.fn()}
          compactRoomScrollStateRef={{ current: viewMemory }}
          sectionsNow={NOW}
          columnsMode={columnsMode}
          focusRequest={focusRequest}
        />
      </Profiler>
    );

    const { rerender } = render(renderView(true));
    // Nonzero card/viewport geometry must NOT trigger a virtualizer render loop.
    expect(commits.length).toBeLessThanOrEqual(4);
    expect(document.querySelectorAll('button[data-thread-root-id]')).toHaveLength(41);

    // Complete pointerHandlers forwarding: pointerCancel and prevented touchEnd release orderHeld.
    const board = document.querySelector<HTMLElement>('[data-compact-columns-board="true"]')!;
    fireEvent.pointerDown(board, { pointerType: 'touch' });
    expect(board.getAttribute('data-order-held')).toBe('true');
    fireEvent.pointerCancel(board, { pointerType: 'touch' });
    fireEvent.pointerLeave(board, { pointerType: 'touch' });
    expect(board.getAttribute('data-order-held')).toBeNull();

    fireEvent.pointerDown(board, { pointerType: 'touch' });
    expect(board.getAttribute('data-order-held')).toBe('true');
    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
    touchEnd.preventDefault();
    act(() => {
      board.dispatchEvent(touchEnd);
    });
    expect(board.getAttribute('data-order-held')).toBeNull();

    // Pressing End from the first card expands the last open column past 40 cards and focuses $col-74.
    expect(document.querySelector('button[data-thread-root-id="$col-74"]')).toBeNull();
    const firstCard = document.querySelector<HTMLButtonElement>(
      'button[data-thread-root-id="$need-0"]'
    )!;
    act(() => firstCard.focus());
    fireEvent.keyDown(firstCard, { key: 'End' });
    const lastCard = document.querySelector<HTMLButtonElement>(
      'button[data-thread-root-id="$col-74"]'
    )!;
    expect(lastCard).not.toBeNull();
    expect(document.activeElement).toBe(lastCard);

    // Per-column scrollTop is preserved across Columns -> Vertical -> Columns remounts.
    const workingBody = document.querySelector<HTMLDivElement>(
      '[data-compact-column-body="working"]'
    )!;
    workingBody.scrollTop = 320;
    fireEvent.scroll(workingBody);
    rerender(renderView(false));
    expect(document.querySelector('[data-compact-columns-board]')).toBeNull();
    rerender(renderView(true));
    expect(
      document.querySelector<HTMLDivElement>('[data-compact-column-body="working"]')?.scrollTop
    ).toBe(320);

    // Deep-link focusRequest targeting a card beyond the initial 40-card cap reveals & meets it.
    expect(document.querySelector('button[data-thread-root-id="$col-65"]')).toBeNull();
    const req: CompactFocusRequest = { eventId: '$col-65', entryKey: 'pin-link', pushed: true };
    takeCompactFocusRequest(viewMemory, ROOM_ID, req);
    expect(isCompactFocusRequestOpen(viewMemory, req)).toBe(true);
    rerender(renderView(true, req));
    expect(document.querySelector('button[data-thread-root-id="$col-65"]')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(isCompactFocusRequestOpen(viewMemory, req)).toBe(false);
  });

  it('shows the cards as before while Sections are off', () => {
    render(view(['$streaming', '$job'], false));

    expect(rows()).toEqual(['$streaming', '$job']);
    expect(state.enabled.every((enabled) => !enabled)).toBe(true);
  });
});

describe('Compact order when the view switches under the pointer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const hold = () => {
    const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
    act(() => {
      fireEvent.pointerEnter(list);
    });
    return () =>
      act(() => {
        fireEvent.pointerLeave(list);
        fireEvent.click(document.body);
      });
  };

  it('starts a flat room in its live order and holds that order on the next update', () => {
    const fallback = vi.spyOn(scrollFallback, 'useCompactScrollFallback');
    const { rerender } = render(view(['$a', '$b'], false));
    hold();
    rerender(view(['$b', '$a'], false));
    expect(rows()).toEqual(['$a', '$b']);

    const nextRoom = { roomId: '!next:example.org', myUserId: ME } as unknown as Room;
    const nextIds = ['$d', '$c'];
    rerender(view(nextIds, false, nextRoom));
    expect(fallback.mock.lastCall?.[0]).toBe(nextIds);
    expect(rows()).toEqual(['$d', '$c']);
    rerender(view(['$c', '$d'], false, nextRoom));
    expect(rows()).toEqual(['$d', '$c']);
  });

  it('switches from Sections to flat using only the rows left after folding', () => {
    state.sections = [
      { id: 'working', rootIds: ['$a', '$b'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    const ids = ['$done', '$b', '$a'];
    const { rerender } = render(view(ids));
    hold();
    expect(rows()).toEqual(['#working 2', '$a', '$b', '#done 1']);

    rerender(view(ids, false));
    // The folded card is a newcomer, so it leads, while $a and $b keep their shown order.
    expect(rows()).toEqual(['$done', '$a', '$b']);
  });

  it('reuses the section rows for scroll anchoring when the pointer lets go after a switch', () => {
    const fallback = vi.spyOn(scrollFallback, 'useCompactScrollFallback');
    state.sections = [
      { id: 'needsYou', rootIds: ['$a'] },
      { id: 'done', rootIds: ['$done'] },
    ];
    const ids = ['$a', '$done'];
    const { rerender } = render(view(ids, false));
    const release = hold();
    rerender(view(ids));
    const sectionRows = fallback.mock.lastCall?.[0];
    expect(sectionRows).toEqual(['section:needsYou', '$a', 'section:done']);

    fallback.mockClear();
    release();
    expect(fallback.mock.lastCall?.[0]).toBe(sectionRows);
  });

  it('switches from flat to live Sections, then holds those sections on the next update', () => {
    const ids = ['$a', '$b', '$c'];
    const { rerender } = render(view(ids, false));
    hold();
    state.sections = [
      { id: 'needsYou', rootIds: ['$b', '$a'] },
      { id: 'working', rootIds: ['$c'] },
    ];
    rerender(view(ids));
    expect(rows()).toEqual(['#needsYou 2', '$b', '$a', '#working 1', '$c']);

    state.sections = [{ id: 'needsYou', rootIds: ['$c', '$a', '$b'] }];
    rerender(view(ids));
    expect(rows()).toEqual(['#needsYou 3', '$b', '$a', '#working 0', '$c']);
  });
});

describe('a focus request on the mounted Compact room', () => {
  const ROW_HEIGHT = 100;
  const VIEW_HEIGHT = 300;
  const cards = Array.from({ length: 10 }, (_unused, index) => `$card${index}`);
  let inset = 0;
  let layout: ReturnType<typeof stubCompactLayout>;

  beforeEach(() => {
    inset = 0;
    state.unreachable = false;
    // jsdom 31 reports CSS.supports('overflow-anchor', 'auto') === true without scroll anchoring.
    vi.stubGlobal('CSS', { supports: (property: string) => property !== 'overflow-anchor' });
    layout = stubCompactLayout({
      width: () => 300,
      clientHeight: VIEW_HEIGHT,
      inset: () => inset,
      clampScrollTop: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const memory: ScrollAnchorMemory = new Map();
  const at = (
    focusRequest?: CompactFocusRequest,
    ids = cards,
    indexPending = false,
    records = new Map<string, ThreadRecord>()
  ) => {
    if (focusRequest) takeCompactFocusRequest(memory, ROOM_ID, focusRequest);
    return (
      <CompactRoomView
        room={room}
        threadRootIds={ids}
        threadRecordMap={records}
        onThreadClick={vi.fn()}
        compactRoomScrollStateRef={{ current: memory }}
        focusRequest={focusRequest}
        indexPending={indexPending}
      />
    );
  };
  const topOf = (key: string) =>
    document.querySelector(`[data-scroll-anchor="${key}"]`)!.getBoundingClientRect().top;
  const scroller = () => document.querySelector<HTMLElement>('[data-compact-room-view]')!;
  const inView = () =>
    [...document.querySelectorAll<HTMLElement>('[data-scroll-anchor]')]
      .filter((card) => {
        const { top, bottom } = card.getBoundingClientRect();
        return bottom > 0 && top < VIEW_HEIGHT;
      })
      .map((card) => card.dataset.scrollAnchor);

  it('brings a card out of view to its place below the top, once, and leaves one in view', () => {
    memory.clear();
    memory.set(ROOM_ID, { scrollTop: 700, anchors: [{ key: '$card8', offset: 100 }] });
    const { rerender } = render(at());
    layout.scrollTop = 0;

    rerender(at({ eventId: '$card8', entryKey: 'pin', pushed: true }));
    expect(topOf('$card8')).toBe(160);

    layout.scrollTop = 100;
    rerender(at({ eventId: '$card8', entryKey: 'pin', pushed: true }));
    expect(layout.scrollTop).toBe(100);

    rerender(at({ eventId: '$card2', entryKey: 'next', pushed: true }));
    expect(layout.scrollTop).toBe(100);

    rerender(at({ eventId: '$card8', entryKey: 'pin' }));
    expect(layout.scrollTop).toBe(100);
  });

  describe('with an already measured window', () => {
    const large = Array.from({ length: 120 }, (_, index) => `$card${index}`);
    const measure = () => {
      let prevScroll = 0;
      let prevExtent = layout.extent();
      for (let i = 0; i < 16; i += 1) {
        const view = document.querySelector('[data-compact-room-view]');
        if (view && layout.scrollTop !== prevScroll) {
          prevScroll = layout.scrollTop;
          act(() => {
            fireEvent.scroll(view);
          });
        }
        tickFrames(1);
        if (layout.extent() !== prevExtent) {
          prevExtent = layout.extent();
          act(() => layout.resize());
        }
      }
    };
    const leaveAt = (top: number) => {
      memory.clear();
      const { unmount } = render(at(undefined, large));
      measure();
      layout.scroll(scroller(), top);
      unmount();
      layout.scrollTop = 0;
    };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('keeps an off-window pushed target mounted for placement', () => {
      memory.clear();
      const { rerender } = render(at(undefined, large));
      measure();
      expect(document.querySelector('[data-scroll-anchor="$card100"]')).toBeNull();
      rerender(at({ eventId: '$card100', entryKey: 'deep-push', pushed: true }, large));
      expect(layout.scrollTop).toBe(9840);
      expect(topOf('$card100')).toBe(160);
      rerender(at({ eventId: '$card100', entryKey: 'deep-push', pushed: true }, large));
      expect(document.querySelector('[data-scroll-anchor="$card100"]')).not.toBeNull();
    });

    it.each([
      ['reader wheel', true, 150],
      ['browser scroll without reader input', false, 9840],
    ])('handles a waiting far link after %s', (_, withWheel, expectedTop) => {
      memory.clear();
      const cold = large.map((id) => `${id}-${withWheel ? 'cold' : 'unseen'}`);
      const far = { eventId: cold[100]!, entryKey: `far-${withWheel}`, pushed: true };
      const { rerender } = render(at(undefined, cold));
      rerender(at(far, cold));
      expect(layout.scrollTop).toBe(0);
      if (withWheel) fireEvent.wheel(scroller());
      layout.scrollTop = 150;
      measure();
      rerender(at(far, cold));
      expect(layout.scrollTop).toBe(expectedTop);
      if (!withWheel) expect(topOf(cold[100]!)).toBe(160);
    });

    it.each([
      [
        '48 unseen roots prepended',
        () => [...Array.from({ length: 48 }, (_, i) => `$new${i}`), ...large],
        false,
        undefined,
        '$card60',
        0,
        undefined,
      ],
      [
        'one saved card deleted while indexPending',
        () => large.filter((id) => id !== '$card61'),
        true,
        6000,
        '$card60',
        0,
        undefined,
      ],
      [
        'one saved card left, one moved far down, and 36 measured roots shifted above',
        () => {
          const head = large.slice(84);
          const rest = large.slice(0, 84).filter((id) => id !== '$card60' && id !== '$card62');
          return [...head, ...rest, '$card60'];
        },
        false,
        9500,
        '$card61',
        ROW_HEIGHT,
        ['$card59', '$card61', '$card63'],
      ],
    ] as const)(
      'places warm Back in its first commit when %s',
      (_, nextIds, indexPending, expectedTop, card, cardTop, visible) => {
        leaveAt(6000);
        expect(memory.get(ROOM_ID)?.anchors.map(({ key }) => key)).toEqual([
          '$card60',
          '$card61',
          '$card62',
        ]);
        render(at(undefined, nextIds(), indexPending));
        if (expectedTop !== undefined) expect(layout.scrollTop).toBe(expectedTop);
        else expect(layout.scrollTop).toBeGreaterThan(0);
        expect(topOf(card)).toBe(cardTop);
        if (visible) expect(inView()).toEqual(visible);
        measure();
        if (expectedTop !== undefined) expect(layout.scrollTop).toBe(expectedTop);
        expect(topOf(card)).toBe(cardTop);
      }
    );

    it('goes Back when all saved cards left, waiting only for cards above the saved screen and counting inset', () => {
      leaveAt(6000);
      const rest = large.filter((id) => !['$card60', '$card61', '$card62'].includes(id));
      const below = Array.from({ length: 72 }, (_, i) => `$below${i}`);
      const first = render(at(undefined, [...rest, ...below]));
      // Unseen cards below the saved screen do not hold Back up.
      expect(layout.scrollTop).toBe(6000);
      expect(inView()).toEqual(['$card63', '$card64', '$card65']);
      expect(document.querySelector('[data-cards-pending]')).not.toBeNull();
      measure();
      expect(document.querySelector('[data-cards-pending]')).toBeNull();
      expect(layout.scrollTop).toBe(6000);
      expect(inView()).toEqual(['$card63', '$card64', '$card65']);
      first.unmount();

      // Unseen cards above move the saved offset: Back waits for them, then places before the tail.
      const above = Array.from({ length: 24 }, (_, i) => `$above${i}`);
      const more = Array.from({ length: 48 }, (_, i) => `$more${i}`);
      memory.set(ROOM_ID, { scrollTop: 6000, anchors: [{ key: '$gone', offset: 0 }] });
      layout.scrollTop = 0;
      const waited = render(at(undefined, [...above, ...rest, ...more]));
      expect(layout.scrollTop).toBe(0);
      tickFrames(2);
      expect(layout.scrollTop).toBe(6000);
      expect(document.querySelector('[data-cards-pending]')).not.toBeNull();
      waited.unmount();

      // Space above the cards (header + filter inset) counts toward the saved screen end.
      inset = 160;
      leaveAt(11560);
      const left = ['$card114', '$card115', '$card116'];
      expect(memory.get(ROOM_ID)?.anchors.map(({ key }) => key)).toEqual(left);
      render(at(undefined, [...large.filter((id) => !left.includes(id)), ...below]));
      expect(layout.scrollTop).toBe(11560);
      expect(inView()).toEqual(['$card117', '$card118', '$card119']);
    });

    it('takes the native end for a link to the last cached card while the homeserver is out of reach', () => {
      memory.clear();
      const last = { eventId: '$card9', entryKey: 'offline' };
      const { unmount } = render(at(last, cards, true));
      measure();
      expect(layout.scrollTop).toBe(0);
      unmount();
      state.unreachable = true;
      render(at({ ...last, entryKey: 'offline-2' }, cards, true));
      expect(layout.scrollTop).toBe(700);
      expect(inView()).toEqual(['$card7', '$card8', '$card9']);
    });

    it.each([
      ['measured', new Map(large.map((id) => [id, {} as ThreadRecord])), false],
      ['still to be measured', new Map<string, ThreadRecord>(), false],
      ['reader scrolled away', new Map(large.map((id) => [id, {} as ThreadRecord])), true],
    ])(
      'handles a cleared filter revealing the addressed card (%s)',
      (_, records, scrolled) => {
        memory.clear();
        const first = render(at(undefined, large, false, records));
        measure();
        first.unmount();
        memory.clear();
        const hidden = { eventId: '$card100', entryKey: `filtered-${records.size}-${scrolled}` };
        const { rerender } = render(at(hidden, large.slice(0, 10), false, records));
        measure();
        if (scrolled) {
          layout.scroll(scroller(), 200);
          rerender(at(hidden, large, false, records));
          measure();
          expect(layout.scrollTop).toBe(200);
          expect(document.querySelector('[data-scroll-anchor="$card100"]')).toBeNull();
          return;
        }
        expect(layout.scrollTop).toBeLessThanOrEqual(1);
        rerender(at(hidden, large, false, records));
        const seen = new Set<number>([layout.scrollTop]);
        for (let frame = 0; frame < 12; frame += 1) {
          tickFrames(1);
          act(() => layout.resize());
          seen.add(layout.scrollTop);
        }
        expect([...seen]).toEqual([1, 9840]);
        expect(topOf('$card100')).toBe(160);
      },
      20_000
    );

    it('keeps visible cards on live order changes and mounts the new top on Back with scrollTop 0', () => {
      memory.clear();
      const { rerender, unmount } = render(at(undefined, large));
      measure();
      rerender(at(undefined, [...large].reverse()));
      expect(layout.scrollTop).toBe(0);
      expect(inView()).toEqual(['$card119', '$card118', '$card117']);

      rerender(at(undefined, large));
      measure();
      layout.scroll(scroller(), 6000);
      rerender(at(undefined, [...Array.from({ length: 48 }, (_, i) => `$above${i}`), ...large]));
      expect(inView()).toEqual(['$card60', '$card61', '$card62']);
      expect(document.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(60);
      unmount();

      // Back to the top mounts the cards now at index 0, though the old top cards moved far down.
      leaveAt(0);
      expect(memory.get(ROOM_ID)?.scrollTop).toBe(0);
      render(at(undefined, [...large.slice(60), ...large.slice(0, 60)]));
      expect(layout.scrollTop).toBe(0);
      expect(document.querySelector('[data-scroll-anchor="$card60"]')).not.toBeNull();
      expect([60, 61, 62].map((row) => topOf(`$card${row}`) || 0)).toEqual([0, 100, 200]);
    });

    it('releases a clamped pending Back restore on touch/scroll without wheel', () => {
      memory.clear();
      memory.set(ROOM_ID, {
        scrollTop: 3800,
        anchors: [
          { key: '$card38', offset: 0 },
          { key: '$card39', offset: 100 },
        ],
      });
      render(at(undefined, large.slice(0, 40), true));
      measure();
      expect(layout.scrollTop).toBe(3700);
      layout.scroll(scroller(), 0);
      expect(document.querySelector('[data-scroll-anchor="$card0"]')).not.toBeNull();
    });

    it('pins content minHeight across card/spacer swaps when overflow-anchor is absent', () => {
      memory.clear();
      const origCSS = globalThis.CSS;
      Object.defineProperty(globalThis, 'CSS', {
        configurable: true,
        value: { supports: () => false },
      });
      try {
        render(at(undefined, large.slice(0, 36)));
        measure();
        const content = scroller().firstElementChild as HTMLElement;
        const observed: string[] = [];
        const removeChild = content.removeChild.bind(content);
        vi.spyOn(content, 'removeChild').mockImplementation((child) => {
          observed.push(content.style.minHeight);
          return removeChild(child);
        });
        layout.scroll(scroller(), 3300);
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.every((v) => v === '3600px')).toBe(true);
        expect(content.style.minHeight).toBe('');
      } finally {
        Object.defineProperty(globalThis, 'CSS', { configurable: true, value: origCSS });
      }
    });
  });

  it('stays where the reader is for a request of an entry the router replaced', () => {
    memory.clear();
    const { rerender } = render(at({ eventId: '$card1', entryKey: 'pin', pushed: true }));
    layout.scrollTop = 500;
    rerender(at({ eventId: '$card1', entryKey: 'replaced' }));
    expect(layout.scrollTop).toBe(500);
  });

  it('leaves the first restore unconsumed until the saved anchor hydrates', () => {
    memory.clear();
    memory.set(ROOM_ID, { scrollTop: 600, anchors: [{ key: '$card7', offset: 83 }] });
    const { rerender } = render(at(undefined, cards.slice(0, 4), true));
    expect(layout.scrollTop).toBe(0);
    rerender(at(undefined, [cards[1]!, cards[0]!, ...cards.slice(2)]));
    expect(topOf('$card7')).toBe(83);
  });

  it('places cached addresses during a pending index read, without replaying A on POP', () => {
    memory.clear();
    const a = { eventId: '$card6', entryKey: 'A' };
    const { rerender } = render(at(a, cards, true));
    expect(topOf(a.eventId)).toBe(160);
    rerender(at({ eventId: '$card8', entryKey: 'B', pushed: true }, cards, true));
    expect(topOf('$card8')).toBe(160);
    layout.scroll(scroller(), 250);
    rerender(at(a));
    expect(layout.scrollTop).toBe(250);
  });

  it('retires a waiting Back when a newer address arrives, whether in view or deep', () => {
    vi.useFakeTimers();
    try {
      memory.clear();
      memory.set(ROOM_ID, { scrollTop: 600, anchors: [{ key: '$late', offset: 83 }] });
      const first = render(at(undefined, cards, true));
      first.rerender(at({ eventId: '$card1', entryKey: 'in-view', pushed: true }, cards, true));
      expect(layout.scrollTop).toBe(0);
      tickFrames(1);
      first.unmount();
      expect(memory.get(ROOM_ID)?.scrollTop).toBe(0);
      expect(memory.get(ROOM_ID)?.anchors[0]?.key).toBe('$card0');

      memory.clear();
      memory.set(ROOM_ID, { scrollTop: 600, anchors: [{ key: '$late', offset: 83 }] });
      const second = render(at(undefined, cards, true));
      expect(layout.scrollTop).toBe(0);
      const b = { eventId: '$card8', entryKey: 'newer', pushed: true };
      second.rerender(at(b, cards, true));
      expect(topOf('$card8')).toBe(160);
      const top = layout.scrollTop;
      second.rerender(at(b, [...cards, '$late']));
      expect(layout.scrollTop).toBe(top);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the place the list was left at for a card in view', () => {
    const left = { scrollTop: 100, anchors: [{ key: '$card2', offset: 100 }] };
    memory.clear();
    memory.set(ROOM_ID, left);
    const { rerender } = render(at());

    rerender(at({ eventId: '$card2', entryKey: 'pin', pushed: true }));
    expect(layout.scrollTop).toBe(100);
    expect(memory.get(ROOM_ID)).toBe(left);
  });
});
