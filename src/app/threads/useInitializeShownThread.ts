import { ClientEvent, SyncState, ThreadEvent, type MatrixClient, type Thread } from 'matrix-js-sdk';
import { type RefObject, useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

/** Cards scrolled past within this time do not load their thread. */
export const SHOWN_THREAD_DWELL_MS = 500;

type LiveSync = { count: number; listeners: Set<() => void> };

const liveSyncs = new WeakMap<MatrixClient, LiveSync>();

/** Counts the client's returns to live sync: the first `/sync` response and each reconnect. */
const getLiveSync = (mx: MatrixClient): LiveSync => {
  let liveSync = liveSyncs.get(mx);
  if (!liveSync) {
    const created: LiveSync = {
      count: mx.getSyncState() === SyncState.Syncing ? 1 : 0,
      listeners: new Set(),
    };
    mx.on(ClientEvent.Sync, (state, previous) => {
      if (state !== SyncState.Syncing || previous === SyncState.Syncing) return;
      created.count += 1;
      created.listeners.forEach((listener) => listener());
    });
    liveSyncs.set(mx, created);
    liveSync = created;
  }
  return liveSync;
};

// Thread lists render every card, so one shared observer reports which are on screen, and one per
// list which are near its view.
type Observed = {
  observer: IntersectionObserver;
  listeners: Map<Element, (visible: boolean) => void>;
};

const createObserved = (options?: IntersectionObserverInit): Observed => {
  const listeners = new Map<Element, (visible: boolean) => void>();
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => listeners.get(entry.target)?.(entry.isIntersecting)),
    options
  );
  return { observer, listeners };
};

let viewportObserved: Observed | undefined;
const listObserved = new WeakMap<Element, Observed>();

/** A card a list's height above or below the list's view counts as near it. */
const observedFor = (list: Element | undefined): Observed => {
  if (!list) {
    viewportObserved ??= createObserved();
    return viewportObserved;
  }
  let observed = listObserved.get(list);
  if (!observed) {
    observed = createObserved({ root: list, rootMargin: '100% 0px' });
    listObserved.set(list, observed);
  }
  return observed;
};

const observeVisibility = (
  element: Element,
  onChange: (visible: boolean) => void,
  list?: Element
) => {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => undefined;
  }
  const { observer, listeners } = observedFor(list);
  listeners.set(element, onChange);
  observer.observe(element);
  return () => {
    listeners.delete(element);
    observer.unobserve(element);
  };
};

type ListScroll = { scrolled: boolean; listeners: Set<() => void> };
const listScrolls = new WeakMap<Element, ListScroll>();

/** Whether the list has scrolled since it was first shown, and who to tell when it does. */
const getListScroll = (list: Element): ListScroll => {
  let state = listScrolls.get(list);
  if (!state) {
    const created: ListScroll = { scrolled: false, listeners: new Set() };
    list.addEventListener(
      'scroll',
      () => {
        created.scrolled = true;
        created.listeners.forEach((listener) => listener());
      },
      { once: true, passive: true }
    );
    listScrolls.set(list, created);
    state = created;
  }
  return state;
};

/**
 * The SDK leaves listed threads summary-only until they are opened or shown.
 * A card on screen needs the thread's latest page, edits and counts, so load it once the client is live,
 * which keeps `/sync` ahead of it, and again after a reconnect if that attempt failed.
 * Returns the ref for an element of the card. A card in a list view passes the view as
 * `scrollRoot`: once the reader scrolls the list, a card within a list's height above or below
 * the view counts as shown too, so its thread loads before the card scrolls in and its title and
 * preview, and its height with them, do not change while the reader looks at it. A list that has
 * not scrolled loads only the cards on screen, as a reader who opens it and reads the top needs.
 */
export const useInitializeShownThread = (
  roomId: string,
  threadRootId: string | undefined,
  scrollRoot?: RefObject<Element>
) => {
  const mx = useMatrixClient();
  const liveSync = getLiveSync(mx);
  const liveSyncCount = useSyncExternalStore(
    (onChange) => {
      liveSync.listeners.add(onChange);
      return () => {
        liveSync.listeners.delete(onChange);
      };
    },
    () => liveSync.count
  );
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => (element ? observeVisibility(element, setVisible) : undefined), [element]);
  const [listScrolled, setListScrolled] = useState(false);
  useEffect(() => {
    const list = scrollRoot?.current;
    if (!list) return undefined;
    const state = getListScroll(list);
    if (state.scrolled) {
      setListScrolled(true);
      return undefined;
    }
    const onScrolled = () => setListScrolled(true);
    state.listeners.add(onScrolled);
    return () => {
      state.listeners.delete(onScrolled);
    };
  }, [scrollRoot]);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const list = scrollRoot?.current;
    return element && list && listScrolled ? observeVisibility(element, setNear, list) : undefined;
  }, [element, listScrolled, scrollRoot]);
  const shown = visible || near;
  const room = mx.getRoom(roomId);
  const thread = threadRootId ? room?.getThread(threadRootId) : undefined;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // A card can render before the SDK creates its thread.
  useEffect(() => {
    if (thread || !room || !threadRootId) return undefined;
    const onNewThread = (created: Thread) => {
      if (created.id === threadRootId) rerender();
    };
    room.on(ThreadEvent.New, onNewThread);
    if (room.getThread(threadRootId)) rerender();
    return () => {
      room.removeListener(ThreadEvent.New, onNewThread);
    };
  }, [room, thread, threadRootId]);

  useEffect(() => {
    if (!thread || !shown || liveSyncCount === 0) return undefined;
    const timer = setTimeout(() => {
      void thread.initialize();
    }, SHOWN_THREAD_DWELL_MS);
    return () => clearTimeout(timer);
  }, [thread, shown, liveSyncCount]);

  return setElement;
};
