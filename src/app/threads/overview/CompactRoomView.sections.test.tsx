// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import type { CompactThreadSection } from './compactThreadSections';
import { clearCompactRoomSectionsStore } from './compactRoomSections';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';

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
  useCompactThreadSections: ({ enabled }: { enabled: boolean }) => {
    state.enabled.push(enabled);
    return enabled ? state.sections : undefined;
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
    sections={sections}
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
    { id: 'snoozed', rootIds: ['$snoozed'] },
    { id: 'idle', rootIds: ['$idle'] },
    { id: 'resolved', rootIds: ['$done'] },
  ];
});

afterEach(() => {
  cleanup();
  clearCompactRoomSectionsStore(ME);
  localStorage.clear();
});

describe('the Compact room in sections', () => {
  it('lists the cards under their headers, with counts, and Resolved folded at first', () => {
    render(view(['$streaming', '$job', '$snoozed', '$idle', '$done']));

    expect(rows()).toEqual([
      '#working 2',
      '$job',
      '$streaming',
      '#snoozed 1',
      '$snoozed',
      '#idle 1',
      '$idle',
      '#resolved 1',
    ]);
    expect(header('working').getAttribute('aria-expanded')).toBe('true');
    expect(header('resolved').getAttribute('aria-expanded')).toBe('false');
    // A header is no card: the scroll position is never restored against it.
    expect(document.querySelector('[data-compact-section][data-scroll-anchor]')).toBeNull();
  });

  it('folds and opens a section from its header, for the whole account', () => {
    render(view(['$streaming', '$job', '$snoozed', '$idle', '$done']));

    act(() => {
      fireEvent.click(header('resolved'));
      fireEvent.click(header('working'));
    });

    expect(rows()).toEqual([
      '#working 2',
      '#snoozed 1',
      '$snoozed',
      '#idle 1',
      '$idle',
      '#resolved 1',
      '$done',
    ]);
    expect(JSON.parse(localStorage.getItem(`compactRoomSections:${ME}`) ?? 'null')).toEqual({
      on: false,
      folded: ['working'],
    });
  });

  it('leads each section with its pinned cards instead of a Pinned list of their own', () => {
    state.pinned = ['$idle'];
    render(view(['$idle', '$streaming', '$job', '$snoozed', '$done']));

    expect(document.querySelector('[data-pinned-threads]')).toBeNull();
    expect(screen.queryByText('threadNav.pinned')).toBeNull();
    expect(rows()).toContain('$idle');
  });

  it('keeps the rows in place while the pointer is on the cards, and regroups after', () => {
    const { rerender } = render(view(['$streaming', '$job', '$snoozed', '$idle', '$done']));
    const list = header('working').closest<HTMLElement>('[data-compact-room-view] > div')!;
    act(() => {
      fireEvent.pointerEnter(list);
    });

    // The job ends: its thread is Idle now.
    state.sections = [
      { id: 'working', rootIds: ['$streaming'] },
      { id: 'snoozed', rootIds: ['$snoozed'] },
      { id: 'idle', rootIds: ['$job', '$idle'] },
      { id: 'resolved', rootIds: ['$done'] },
    ];
    rerender(view(['$streaming', '$job', '$snoozed', '$idle', '$done']));
    expect(rows().slice(0, 3)).toEqual(['#working 1', '$job', '$streaming']);

    // jsdom's pointer events carry no pointer type: the pointer lets go at the next click.
    act(() => {
      fireEvent.pointerLeave(list);
      fireEvent.click(document.body);
    });
    expect(rows()).toEqual([
      '#working 1',
      '$streaming',
      '#snoozed 1',
      '$snoozed',
      '#idle 2',
      '$job',
      '$idle',
      '#resolved 1',
    ]);
  });

  it('shows the cards as before while Sections are off', () => {
    render(view(['$streaming', '$job'], false));

    expect(rows()).toEqual(['$streaming', '$job']);
    expect(state.enabled.every((enabled) => !enabled)).toBe(true);
  });
});
