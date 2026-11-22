import {
  PureComponent,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import './listMotion.css';

// A row is a stacking context at rest (listMotion.css.ts): one that became one only while it
// played would have the browser lay out the whole list at the start and the end of every play.
const ROW = 'data-motion-row';

// The motion tokens `Slower`, `Slow` and `Normal` with their curves (ui/styles/Motion.css.ts) as
// numbers and text: Web Animations cannot read a custom property.
const GLIDE = { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const ENTER = { duration: 200, easing: 'cubic-bezier(0, 0, 0, 1)' };
const LEAVE = { duration: 160, easing: 'cubic-bezier(0.3, 0, 1, 1)', fill: 'forwards' as const };

/**
 * A list of more rows than this plays nothing and is not read. Starting a play makes the browser
 * work through the page around the rows that move, which grows with the list: in a Compact room
 * of 600 cards a filter change showed its first frame 30 to 85 ms later than without motion
 * (production build), in one of 300 no later.
 */
export const MOST_ROWS_IN_MOTION = 300;

/**
 * A play the browser has not ended after this long is ended: its rows show at their places, and
 * the rows that left are gone. Well past the longest play, also where a busy page starts it
 * late. A browser that never ran an animation would leave every row as the play's first frame
 * shows it: on a phone, cards that had left stayed where they stood.
 */
export const LONGEST_PLAY_MS = 1000;

/** A row and where it showed on the page. */
type Place = { row: HTMLElement; rect: DOMRect };

/** The rows in view before a change, and where the list stood then. */
type Before = { rows: Map<string, Place>; list: DOMRect; scrollTop: number; scrollLeft: number };

/**
 * Whether motion may play at all: the page is seen and the reader did not ask for less. Read
 * through `globalThis`, so a component that asks while rendering outside a page (a unit test in
 * node) does not throw.
 */
export const motionAllowed = (): boolean =>
  // A page nobody sees plays nothing, so a row that left would never finish leaving.
  globalThis.document?.visibilityState !== 'hidden' &&
  !(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Whether a Web Animation on `element` may play: the browser has them and motion is allowed. */
export const playsMotion = (element: HTMLElement): boolean =>
  typeof element.animate === 'function' && motionAllowed();

const rowsOf = (list: HTMLElement): HTMLElement[] => [
  ...list.querySelectorAll<HTMLElement>(`[${ROW}]`),
];

/**
 * Of the list's rows, by key those in view or within half a page of it: the rows that close a
 * gap, or make room, come into view from there. Every row is read: one that plays shows away
 * from its place in the list, so the rows cannot be searched by the order they are held in.
 */
const readRows = (all: HTMLElement[]): Map<string, Place> => {
  const past = window.innerHeight / 2;
  const inView = new Map<string, Place>();
  all.forEach((row) => {
    const key = row.getAttribute(ROW);
    if (!key) return;
    const rect = row.getBoundingClientRect();
    if (rect.bottom > -past && rect.top < window.innerHeight + past) inView.set(key, { row, rect });
  });
  return inView;
};

const readBefore = (list: HTMLElement): Before | undefined => {
  if (!playsMotion(list)) return undefined;
  const all = rowsOf(list);
  if (all.length > MOST_ROWS_IN_MOTION) return undefined;
  const rows = readRows(all);
  if (rows.size === 0) return undefined;
  const { scrollTop, scrollLeft } = list;
  return { rows, list: list.getBoundingClientRect(), scrollTop, scrollLeft };
};

/**
 * A row that left: React has taken it out, so it goes back into the list where it stood, out of
 * the rows' flow and out of reach of pointer, keyboard and screen reader, and fades there.
 */
const leave = (list: HTMLElement, { row, rect }: Place, before: Before): Animation => {
  row.removeAttribute(ROW);
  row.setAttribute('aria-hidden', 'true');
  row.setAttribute('inert', '');
  Object.assign(row.style, {
    position: 'absolute',
    top: `${rect.top - before.list.top - list.clientTop + before.scrollTop}px`,
    // eslint-disable-next-line no-restricted-syntax -- a place read from the page, which measures from the left in every language
    left: `${rect.left - before.list.left - list.clientLeft + before.scrollLeft}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  // First in the list, so the rows that close the gap pass over it.
  list.prepend(row);
  const animation = row.animate(
    [
      { opacity: 1, scale: 1 },
      { opacity: 0, scale: 0.96 },
    ],
    LEAVE
  );
  const remove = () => row.remove();
  animation.finished.then(remove, remove);
  return animation;
};

/** Whether a row shows within half a pixel of where it showed. */
const samePlace = (now: DOMRect, was: DOMRect): boolean =>
  Math.abs(now.left - was.left) < 0.5 && Math.abs(now.top - was.top) < 0.5;

/** Plays the change from `before` to the list as it is now; returns what it started. */
const play = (list: HTMLElement, before: Before, offWindow?: ReadonlySet<string>): Animation[] => {
  const all = rowsOf(list);
  // The change made the list too long.
  if (all.length > MOST_ROWS_IN_MOTION) return [];
  const inView = readRows(all);
  let byKey: Map<string, HTMLElement> | undefined;
  // A row that moved under another parent is a new element there.
  const find = (key: string, was: HTMLElement): HTMLElement | undefined => {
    if (was.isConnected) return was;
    byKey ??= new Map(all.map((row) => [row.getAttribute(ROW) ?? '', row]));
    return byKey.get(key);
  };

  const moves: { row: HTMLElement; dx: number; dy: number }[] = [];
  const left: Place[] = [];
  let stayedCount = 0;
  before.rows.forEach((was, key) => {
    const now = inView.get(key);
    const row = now?.row ?? find(key, was.row);
    if (!row) {
      if (!offWindow?.has(key)) left.push(was);
      return;
    }
    stayedCount += 1;
    const rect = now?.rect ?? row.getBoundingClientRect();
    if (!samePlace(rect, was.rect)) {
      moves.push({ row, dx: was.rect.left - rect.left, dy: was.rect.top - rect.top });
    }
  });
  // No row in view stayed: the list shows something else (another room, another search), and
  // nothing of the old one is left to follow.
  if (stayedCount === 0) return [];

  const started = moves.map(({ row, dx, dy }) =>
    row.animate([{ translate: `${dx}px ${dy}px` }, { translate: 'none' }], GLIDE)
  );
  // The row that travels furthest passes over the others; of rows that swap, the one going up.
  const far = Math.max(0, ...moves.map(({ dy }) => Math.abs(dy)));
  let over = moves.filter(({ dy }) => Math.abs(dy) > far - 1);
  if (over.some(({ dy }) => dy > 0)) over = over.filter(({ dy }) => dy > 0);
  if (over.length < moves.length) {
    over.forEach(({ row }) => started.push(row.animate([{ zIndex: 1 }, { zIndex: 1 }], GLIDE)));
  }
  inView.forEach(({ row }, key) => {
    if (before.rows.has(key)) return;
    started.push(
      row.animate(
        [
          { opacity: 0, translate: '0px -8px', scale: 0.98 },
          { opacity: 1, translate: 'none', scale: 1 },
        ],
        ENTER
      )
    );
  });
  left.forEach((place) => started.push(leave(list, place, before)));
  return started;
};

/**
 * Holds a play where its row shows now. A pause alone takes hold at the browser's next frame,
 * which a busy page draws late: a pressed row glided on until then (17 to 67 px in Chromium).
 * Setting the play's time ends the pending pause at once, but the time WebKit reports can lag
 * what it shows. So a glide starts again from the place the page reports for its row.
 */
const holdNow = (animation: Animation): void => {
  const effect = animation.effect as KeyframeEffect | null;
  const [first] = effect?.getKeyframes() ?? [];
  // A glide: the play that raises its row over the others has no place.
  const shown =
    effect?.target && first && 'translate' in first && getComputedStyle(effect.target).translate;
  if (shown) effect.setKeyframes([{ translate: shown }, { translate: 'none' }]);
  animation.pause();
  // eslint-disable-next-line no-param-reassign -- the one way to end a pause that is pending
  animation.currentTime = 0;
};

/**
 * Whether a play that runs holds a row: a glide, or the play that raises its row. Not a fade:
 * the copy of a row that left holds none, and a row that comes in would stay unseen.
 */
const holdsRow = ({ effect, playState }: Animation): boolean =>
  playState === 'running' &&
  !('opacity' in ((effect as KeyframeEffect | null)?.getKeyframes()[0] ?? {}));

type BeforeChangeProps = {
  order: string;
  read: () => Before | undefined;
  keep: (before: Before | undefined) => void;
};

/**
 * Reads the rows right before React changes them. Only a class is told when that is: an effect
 * runs after the change, when the rows that left are gone and the others have moved.
 */
class BeforeChange extends PureComponent<BeforeChangeProps> {
  override getSnapshotBeforeUpdate(): Before | null {
    const { read } = this.props;
    return read() ?? null;
  }

  override componentDidUpdate(
    _props: BeforeChangeProps,
    _state: unknown,
    before: Before | null
  ): void {
    const { keep } = this.props;
    keep(before ?? undefined);
  }

  override render(): null {
    return null;
  }
}

/**
 * Shows what a change does to a list's rows: a row that moved glides from where it was, a new
 * row fades in, and a row that left fades where it stood while the rows after it close the gap.
 *
 * A row is any element inside the list with `data-motion-row`, whose value names it across
 * renders. `order` is a text that changes whenever rows may have moved, come or gone. Render
 * what the hook returns inside the list's component, and give the list a `position`, which a
 * leaving row is placed against.
 *
 * Only rows in view or within half a page of it play. The rows are read once before and once
 * after a change of `order`, and a render that keeps the order costs nothing. A list of more than
 * `MOST_ROWS_IN_MOTION` rows, before or after the change, plays nothing and changes as it would
 * without the hook. The read after the change makes the browser work out the changed
 * page's style and layout inside the commit, work its next frame would have done. Rows play by
 * `translate`, `scale` and `opacity`, which no layout follows; a row is read while it plays, so
 * keep code that measures rows off the row element itself. A change of `order` while rows play
 * starts the glides of rows that moved again from where they show, lets the plays of rows that
 * show where they did run on, and ends the fades of rows that left at once; a play the browser
 * has not ended after `LONGEST_PLAY_MS` is ended. Nothing plays
 * when no row in view stays, with reduced motion, in a page nobody sees, or without Web
 * Animations. Call it after a hook that scrolls the list in a layout effect: the rows are read
 * where that leaves them.
 *
 * A press in the list holds the plays of its rows where they show until its click or cancel, so
 * the pressed row stays under the pointer and gets the click. A row that glided on took the
 * release to the row beside it, and a click whose press and release hit different elements goes
 * to the element that holds both, here the list (a Compact card pressed while the list sorted
 * itself anew opened nothing). A finger's click is aimed after its pointerup, so the release
 * alone does not let go; a change of `order` after it plays at once (a swipe resolves a card at
 * its release, also one that comes as a touchend alone, and no click follows), and what the
 * press held plays on with it. Before it, and less than `LONGEST_PLAY_MS` into the press, a
 * change starts its plays held at their first frame. A held glide starts again from where its
 * row stood. A press that ends in neither click nor cancel (a drag, a long press) leaves the
 * plays held until `LONGEST_PLAY_MS` ends them. A row that comes in, and the copy of one that
 * left, always fade on.
 */
export const useListMotion = (
  listRef: RefObject<HTMLElement>,
  order: string,
  offWindow?: ReadonlySet<string>
): ReactElement => {
  const beforeRef = useRef<Before>();
  const runningRef = useRef<Animation[]>([]);
  const offWindowRef = useRef(offWindow);
  offWindowRef.current = offWindow;
  // The press that holds plays: its pointer, when it went down, whether it is up, its plays.
  const pressRef = useRef<{ id: number; at: number; up?: boolean; held: Animation[] }>();
  const read = useCallback(
    () => (listRef.current ? readBefore(listRef.current) : undefined),
    [listRef]
  );
  const letGo = useCallback(() => {
    pressRef.current?.held.forEach((animation) => {
      // Not one that ended or was started again meanwhile.
      if (animation.playState === 'paused') animation.play();
    });
    pressRef.current = undefined;
  }, []);
  const keep = useCallback((before: Before | undefined) => {
    beforeRef.current = before;
  }, []);

  useLayoutEffect(() => {
    const before = beforeRef.current;
    beforeRef.current = undefined;
    const list = listRef.current;
    if (!before || !list) return;
    // A row that still shows where it did keeps its play. Started again, a glide the browser has
    // not begun shows its first frame: a Compact room's cards jumped back to where the last
    // filter had them for each chunk of cards a filter change mounted. A row that moved was read
    // where it showed and starts again there; the copies of rows that left end at once.
    const running = runningRef.current.filter(
      ({ playState }) => playState !== 'finished' && playState !== 'idle'
    );
    const stayed = new Set<Element>();
    if (running.length > 0) {
      before.rows.forEach(({ row, rect }) => {
        if (row.isConnected && samePlace(row.getBoundingClientRect(), rect)) stayed.add(row);
      });
    }
    const kept = running.filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target && stayed.has(target)) return true;
      animation.cancel();
      return false;
    });
    const started = play(list, before, offWindowRef.current);
    runningRef.current = [...kept, ...started];
    const press = pressRef.current;
    if (press && !press.up && performance.now() - press.at < LONGEST_PLAY_MS) {
      // At their first frame, which shows each row where it was: a pause holds them there.
      const held = started.filter(holdsRow);
      held.forEach((animation) => animation.pause());
      press.held.push(...held);
      // The release brought this change (a swipe, which no click follows): the rows that kept
      // their place play on with it.
    } else if (press?.up && started.length > 0) letGo();
    // Not cleared: a list that goes mid-play ends its play too. (One that ended is not changed.)
    if (started.length > 0) {
      setTimeout(() => started.forEach((animation) => animation.cancel()), LONGEST_PLAY_MS);
    }
  }, [letGo, listRef, order]);

  useEffect(() => {
    // Rendered outside a page (a unit test in node), there is no press to listen for.
    if (typeof window === 'undefined') return undefined;
    // Only the pointer that pressed ends its press: by its cancel, or by its click after its
    // release (a click names its pointer in some browsers only, and one that does must name
    // this one). The last finger's lift is a release too: a touch can end with no pointerup,
    // and a swipe resolves its card then (CompactCardSwipe).
    const end = (event: Event) => {
      const press = pressRef.current;
      const id = (event as PointerEvent).pointerId;
      const mine = press?.id === id;
      const touch = event.type.startsWith('touch');
      if (touch || event.type === 'pointerup') {
        if (press && (touch ? !(event as TouchEvent).touches.length : mine)) press.up = true;
      } else if (event.type === 'click' ? press?.up && (mine || !(id >= 0)) : mine) letGo();
    };
    const hold = (event: PointerEvent) => {
      const { target, pointerId: id } = event;
      if (event.button !== 0 || !(target instanceof Node)) return;
      if (!listRef.current?.contains(target)) return;
      // Another pointer's press while one is under way holds nothing more: the first holds it all.
      const last = pressRef.current;
      const underWay = last && !last.up && performance.now() - last.at < LONGEST_PLAY_MS;
      if (underWay && last.id !== id) return;
      const pressed = ({ effect }: Animation) =>
        Number(!!(effect as KeyframeEffect | null)?.target?.contains(target));
      // The pressed row first: WebKit takes a millisecond a play, and a row glides on meanwhile.
      const running = runningRef.current.filter(holdsRow).sort((a, b) => pressed(b) - pressed(a));
      running.forEach(holdNow);
      // With the plays of a press that ended in neither a click nor a cancel.
      pressRef.current = { id, at: performance.now(), held: [...(last?.held ?? []), ...running] };
    };
    // On the window, capturing: before the row's handlers act, and for a list that mounts later.
    const ends = ['pointerup', 'pointercancel', 'click', 'touchend', 'touchcancel'];
    window.addEventListener('pointerdown', hold, true);
    ends.forEach((type) => window.addEventListener(type, end, true));
    return () => {
      window.removeEventListener('pointerdown', hold, true);
      ends.forEach((type) => window.removeEventListener(type, end, true));
      letGo();
    };
  }, [letGo, listRef]);

  return <BeforeChange order={order} read={read} keep={keep} />;
};
