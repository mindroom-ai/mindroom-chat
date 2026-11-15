import {
  PureComponent,
  type ReactElement,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react';

const ROW = 'data-motion-row';

// The motion tokens `Slower`, `Slow` and `Normal` with their curves (ui/styles/Motion.css.ts) as
// numbers and text: Web Animations cannot read a custom property.
const GLIDE = { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const ENTER = { duration: 200, easing: 'cubic-bezier(0, 0, 0, 1)' };
const LEAVE = { duration: 160, easing: 'cubic-bezier(0.3, 0, 1, 1)', fill: 'forwards' as const };

/** A row and where it showed on the page. */
type Place = { row: HTMLElement; rect: DOMRect };

/** The rows in view before a change, and where the list stood then. */
type Before = { rows: Map<string, Place>; list: DOMRect; scrollTop: number; scrollLeft: number };

/** Whether a Web Animation on `element` may play: the browser has them and the page is seen. */
export const playsMotion = (element: HTMLElement): boolean =>
  typeof element.animate === 'function' &&
  // A page nobody sees plays nothing, so a row that left would never finish leaving.
  document.visibilityState !== 'hidden' &&
  !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Every row of the list, and those in view by key. */
const readRows = (list: HTMLElement): { all: HTMLElement[]; inView: Map<string, Place> } => {
  const all = [...list.querySelectorAll<HTMLElement>(`[${ROW}]`)];
  // The rows stack in one column: find the first one in view by halving, so a long list costs a
  // few layout reads rather than one per row above the view.
  let low = 0;
  let high = all.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((all[middle]?.getBoundingClientRect().bottom ?? 0) > 0) high = middle;
    else low = middle + 1;
  }
  const inView = new Map<string, Place>();
  for (let index = low; index < all.length; index += 1) {
    const row = all[index];
    const key = row?.getAttribute(ROW);
    const rect = row?.getBoundingClientRect();
    if (!row || !rect || rect.top >= window.innerHeight) break;
    if (key) inView.set(key, { row, rect });
  }
  return { all, inView };
};

const readBefore = (list: HTMLElement): Before | undefined => {
  if (!playsMotion(list)) return undefined;
  const rows = readRows(list).inView;
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

/** Plays the change from `before` to the list as it is now; returns what it started. */
const play = (list: HTMLElement, before: Before): Animation[] => {
  const { all, inView } = readRows(list);
  let byKey: Map<string, HTMLElement> | undefined;
  // A row that moved under another parent is a new element there.
  const find = (key: string, was: HTMLElement): HTMLElement | undefined => {
    if (was.isConnected) return was;
    byKey ??= new Map(all.map((row) => [row.getAttribute(ROW) ?? '', row]));
    return byKey.get(key);
  };

  const moves: { row: HTMLElement; dx: number; dy: number }[] = [];
  const left: Place[] = [];
  before.rows.forEach((was, key) => {
    const now = inView.get(key);
    const row = now?.row ?? find(key, was.row);
    if (!row) {
      left.push(was);
      return;
    }
    const rect = now?.rect ?? row.getBoundingClientRect();
    const dx = was.rect.left - rect.left;
    const dy = was.rect.top - rect.top;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ row, dx, dy });
  });
  // No row in view stayed: the list shows something else (another room, another search), and
  // nothing of the old one is left to follow.
  if (left.length === before.rows.size) return [];

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
 * Only rows in view play, read once before and once after a change of `order`, so a long list
 * costs what its screenful does and a render that keeps the order costs nothing. Rows play by
 * `translate`, `scale` and `opacity`, which no layout follows; a row is read while it plays, so
 * keep code that measures rows off the row element itself. Nothing plays when no row in view
 * stays, with reduced motion, in a page nobody sees, or without Web Animations. Call it after a
 * hook that scrolls the list in a layout effect: the rows are read where that leaves them.
 */
export const useListMotion = (listRef: RefObject<HTMLElement>, order: string): ReactElement => {
  const beforeRef = useRef<Before>();
  const runningRef = useRef<Animation[]>([]);
  const read = useCallback(
    () => (listRef.current ? readBefore(listRef.current) : undefined),
    [listRef]
  );
  const keep = useCallback((before: Before | undefined) => {
    beforeRef.current = before;
  }, []);

  useLayoutEffect(() => {
    const before = beforeRef.current;
    beforeRef.current = undefined;
    const list = listRef.current;
    if (!before || !list) return;
    // A row still moving from the last change was read where it showed; it starts again there.
    runningRef.current.forEach((animation) => animation.cancel());
    runningRef.current = play(list, before);
  }, [listRef, order]);

  return <BeforeChange order={order} read={read} keep={keep} />;
};
