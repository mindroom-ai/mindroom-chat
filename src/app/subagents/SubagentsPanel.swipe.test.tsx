// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentFrame, SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import { loadLiveMarkdown } from '../messages/live/liveMarkdown';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { SWIPE_PRIORITY } from '../navigation/interactiveSwipe';
import { finishSwipeTransitions } from '../navigation/__tests__/swipeTransitions';
import { RoomPanelEdgeSwipeContext } from '../navigation/roomPanelEdgeSwipeContext';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { SubagentsPanel } from './SubagentsPanel';

const ROOM_ID = '!room:example.org';
const VIEWER = '@ann:example.org';
const SENDER = '@mindroom_lead:example.org';
const SID = '1762790000123-0a1b2c3d';
const NOW = 1_762_790_600;

vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomThread: vi.fn(),
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
  }),
}));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/hooks/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: [], total: 0 }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));

const MEMBERS: Record<string, string> = {
  '@mindroom_lead:example.org': 'Lead',
  '@mindroom_researcher:example.org': 'Research Desk',
  '@mindroom_writer:example.org': 'Writer',
};
const member = (userId: string) => ({
  userId,
  name: MEMBERS[userId],
  rawDisplayName: MEMBERS[userId],
  membership: 'join',
  getMxcAvatarUrl: () => undefined,
});
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) => (MEMBERS[userId] ? member(userId) : null),
  getJoinedMembers: () => Object.keys(MEMBERS).map(member),
  getMembers: () => [],
  getEventForTxnId: () => undefined,
  membersLoaded: () => true,
  loadMembersIfNeeded: () => Promise.resolve(true),
  hasEncryptionStateEvent: () => false,
} as unknown as Room;

const mx = {
  sendEvent: vi.fn(),
  makeTxnId: () => 'txn',
  getUserId: () => VIEWER,
  getSafeUserId: () => VIEWER,
  getRoom: () => room,
  getHomeserverUrl: () => 'https://example.org',
  mxcUrlToHttp: (mxc: string) => `https://media.example.org/${mxc.slice('mxc://'.length)}`,
} as unknown as MatrixClient;

type RunMeta = Omit<SubagentMeta, 'subagent'> & { subagent?: string };
const meta = (status: SubagentStatus, extra: Partial<SubagentMeta> = {}): RunMeta => ({
  agent: 'researcher',
  caller: 'lead',
  root: 'lead',
  parent: null,
  threadId: '$thread:example.org',
  source: 'delegate',
  status,
  startedAt: NOW - 45,
  endedAt: status === 'running' ? null : NOW,
  ...extra,
});

const docs = (md: string): LiveDocs => ({
  md,
  reasoning: '',
  tools: [],
  status: 'pending',
  activity: '',
  segments: [],
});

const seqs = new Map<string, number>();
const ingest = (run: string, runMeta: RunMeta, runDocs: LiveDocs) => {
  const seq = (seqs.get(run) ?? -1) + 1;
  seqs.set(run, seq);
  const frame: SubagentFrame = {
    run,
    sid: SID,
    seq,
    meta: { subagent: run, ...runMeta },
    snapshot: runDocs,
  };
  act(() => getSubagentRunStore(mx).ingest(ROOM_ID, SENDER, frame, Date.now()));
};

const dispatchEdgeTouch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Array<{ clientX: number; clientY: number }>,
  timeStamp: number
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map((p, i) => ({ identifier: i, clientX: p.clientX, clientY: p.clientY }));
  Object.defineProperty(event, 'touches', { value: list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  window.dispatchEvent(event);
};

const flushMicrotasks = async () => {
  await act(async () => {
    finishSwipeTransitions();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mockWidth = (element: HTMLElement, width: number) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 700,
    top: 0,
    left: 0,
    right: width,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
};

function RoomSwipeHarness({
  onRoomClose,
  handledByRoom,
  children,
}: {
  onRoomClose: () => void;
  handledByRoom: boolean;
  children: React.ReactNode;
}) {
  useEdgeSwipeBack(onRoomClose, handledByRoom, { priority: SWIPE_PRIORITY.PANEL });
  return <RoomPanelEdgeSwipeContext value={handledByRoom}>{children}</RoomPanelEdgeSwipeContext>;
}

describe('SubagentsPanel interactive inner detail swipes', () => {
  let store: ReturnType<typeof createStore>;

  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame'],
      now: NOW * 1000,
    });
    store = createStore();
    seqs.clear();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    cleanup();
    getSubagentRunStore(mx).clear();
    vi.useRealTimers();
  });

  const renderPanel = (handledByRoom = true) => {
    const onClose = vi.fn();
    const onRoomClose = vi.fn();
    const utils = render(
      <Provider store={store}>
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <ScreenSizeProvider value={ScreenSize.Mobile}>
              <RoomSwipeHarness onRoomClose={onRoomClose} handledByRoom={handledByRoom}>
                <SubagentsPanel room={room} onClose={onClose} />
              </RoomSwipeHarness>
            </ScreenSizeProvider>
          </MatrixClientProvider>
        </ClientConfigProvider>
      </Provider>
    );
    return { ...utils, onClose, onRoomClose };
  };

  it('outranks Room PANEL swipe in detail view, reveals inert list, cancels cleanly, and commits with focus restoration', async () => {
    ingest('parent', meta('completed'), docs('Done researching.'));
    const { container, onClose, onRoomClose } = renderPanel(true);

    const panel = container.querySelector<HTMLElement>('[data-testid="subagents-panel"]')!;
    mockWidth(panel, 360);

    // Open the detail run.
    const runCard = container.querySelector<HTMLElement>('[data-subagent="parent"]')!;
    act(() => runCard.click());
    const detailLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-detail]')!;
    expect(detailLayer).not.toBeNull();
    const backButton = detailLayer.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!;
    expect(document.activeElement).toBe(backButton);

    // Drag short distance (lock at 20 -> 92 = 72px, 20% < 35%) -> cancel.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 92, clientY: 200 }], 300);
      vi.advanceTimersToNextFrame();
    });

    const underLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-under]')!;
    expect(underLayer).not.toBeNull();
    expect(underLayer.inert).toBe(true);
    expect(underLayer.getAttribute('aria-hidden')).toBe('true');
    expect(detailLayer.hasAttribute('data-swiping')).toBe(true);
    expect(detailLayer.hasAttribute('data-swipe-shadow')).toBe(true);
    expect(detailLayer.style.translate).toBe('72px');
    expect(underLayer.style.translate).toBe('-86.4px');

    act(() => {
      dispatchEdgeTouch('touchend', [], 400);
    });
    await flushMicrotasks();

    // Cancelled drag leaves detail open, focus untouched, and under-layer removed.
    expect(container.querySelector('[data-subagents-swipe-under]')).toBeNull();
    expect(container.querySelector('[data-subagents-swipe-detail]')).not.toBeNull();
    expect(detailLayer.style.translate).toBe('');
    expect(detailLayer.hasAttribute('data-swiping')).toBe(false);
    expect(document.activeElement).toBe(backButton);
    expect(onRoomClose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Drag past threshold (lock at 20 -> 200 = 180px, 50% >= 35%) -> commit back to list.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 500);
      dispatchEdgeTouch('touchmove', [{ clientX: 200, clientY: 200 }], 650);
      vi.advanceTimersToNextFrame();
      dispatchEdgeTouch('touchend', [], 680);
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-subagents-swipe-detail]')).toBeNull();
    expect(container.querySelector('[data-subagents-swipe-under]')).toBeNull();
    expect(onRoomClose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Focus restored to the card of the closed sub-agent.
    const restoredCard = container.querySelector<HTMLElement>('[data-subagent="parent"]')!;
    expect(document.activeElement).toBe(restoredCard);

    // Now on the list inside Room: start-edge swipe belongs to Room's PANEL handler.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 700);
      dispatchEdgeTouch('touchmove', [{ clientX: 140, clientY: 200 }], 800);
      dispatchEdgeTouch('touchend', [], 820);
    });
    await flushMicrotasks();

    expect(onRoomClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('peeks parent run underneath nested child without stealing focus on cancel, and restores child card focus on commit', async () => {
    ingest('parent', meta('completed'), docs('Asked writer.'));
    ingest(
      'child',
      meta('completed', { agent: 'writer', parent: 'parent', task: 'Write draft.' }),
      docs('Draft ready.')
    );
    const { container, onRoomClose } = renderPanel(true);

    const panel = container.querySelector<HTMLElement>('[data-testid="subagents-panel"]')!;
    mockWidth(panel, 360);

    act(() => container.querySelector<HTMLElement>('[data-subagent="parent"]')!.click());
    act(() => container.querySelector<HTMLElement>('[data-subagent="child"]')!.click());

    const detailLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-detail]')!;
    const childBackButton = detailLayer.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]'
    )!;
    expect(document.activeElement).toBe(childBackButton);

    // Drag slightly to reveal parent run under-layer, then cancel.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 70, clientY: 200 }], 300);
      vi.advanceTimersToNextFrame();
    });

    const underLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-under]')!;
    expect(underLayer).not.toBeNull();
    expect(underLayer.textContent).toContain('Research Desk');
    // Peeking parent SubagentRunView must NOT steal focus from active child run.
    expect(document.activeElement).toBe(childBackButton);

    act(() => {
      dispatchEdgeTouch('touchend', [], 400);
    });
    await flushMicrotasks();

    expect(container.querySelector('[data-subagents-swipe-under]')).toBeNull();
    expect(document.activeElement).toBe(childBackButton);

    // Commit drag -> returns to parent run and focuses child card.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 500);
      dispatchEdgeTouch('touchmove', [{ clientX: 210, clientY: 200 }], 650);
      vi.advanceTimersToNextFrame();
      dispatchEdgeTouch('touchend', [], 680);
    });
    await flushMicrotasks();

    expect(onRoomClose).not.toHaveBeenCalled();
    expect(container.querySelector('header h2')?.textContent).toBe('Research Desk');
    const childCard = container.querySelector<HTMLElement>('[data-subagent="child"]')!;
    expect(document.activeElement).toBe(childCard);
  });

  it('closes panel from list when mounted standalone outside Room', async () => {
    ingest('parent', meta('completed'), docs('Done.'));
    const { onClose, onRoomClose } = renderPanel(false);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 130, clientY: 200 }], 200);
      dispatchEdgeTouch('touchend', [], 220);
    });
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRoomClose).not.toHaveBeenCalled();
  });

  it('unmounts the inert under-layer and skips stale back() when the open run changes mid-settle', async () => {
    ingest('parent', meta('completed'), docs('Asked writer.'));
    ingest(
      'child',
      meta('completed', { agent: 'writer', parent: 'parent', task: 'Write draft.' }),
      docs('Draft ready.')
    );
    const { container, onClose, onRoomClose } = renderPanel(true);

    const panel = container.querySelector<HTMLElement>('[data-testid="subagents-panel"]')!;
    mockWidth(panel, 360);

    act(() => container.querySelector<HTMLElement>('[data-subagent="parent"]')!.click());
    act(() => container.querySelector<HTMLElement>('[data-subagent="child"]')!.click());

    // Drag child detail past commit threshold and release so settle(true) is pending.
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 210, clientY: 200 }], 200);
      vi.advanceTimersToNextFrame();
      dispatchEdgeTouch('touchend', [], 220);
    });
    const detailLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-detail]')!;
    const underLayer = container.querySelector<HTMLElement>('[data-subagents-swipe-under]')!;
    expect(underLayer).not.toBeNull();
    expect(detailLayer.style.transition).toContain('translate');
    expect(underLayer.style.transition).toContain('translate');

    // Navigate from child to parent mid-settle via the detail Back button so openId changes
    // while a detail run (parent) remains open.
    act(() => {
      detailLayer.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click();
    });
    expect(container.querySelector('header h2')?.textContent).toBe('Research Desk');

    // Resolve the pending settle animations: stale commit() must NOT call back() again to the list,
    // and cleanup() must unmount the inert under-layer preview.
    await flushMicrotasks();

    expect(container.querySelector('header h2')?.textContent).toBe('Research Desk');
    expect(container.querySelector('[data-subagents-swipe-detail]')).not.toBeNull();
    expect(container.querySelector('[data-subagents-swipe-under]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRoomClose).not.toHaveBeenCalled();
  });
});
