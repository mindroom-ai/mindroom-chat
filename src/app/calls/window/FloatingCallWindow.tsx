import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { clampToViewport, defaultRect, fitToViewport, isBar, keyStep } from './callWindowGeometry';
import { moveRect, resizeRect, snapToCorner } from './callWindowGeometry';
import type { ResizeEdge, ViewportSize, WindowRect } from './callWindowGeometry';
import { expandedSettings, minimizedSettings, useCallWindowSettings } from './callWindowState';
import { CallWindowFrameContext, CallWindowSizeContext } from './callWindowFrame';
import type { CallWindowFrame } from './callWindowFrame';
import * as css from './FloatingCallWindow.css';

const EDGES: readonly ResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const ARROWS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const isArrow = (key: string): key is Arrow => ARROWS.includes(key);
// A press on one of these in the title bar is theirs (a button, a link, a menu), never a move.
const PRESSABLE = 'button, a, input, [role="menuitem"]';
// The arrows move the window and Shift with them sizes it, while its handle has the focus.
const HANDLE_KEYS = [...ARROWS, ...ARROWS.map((key) => `Shift+${key}`)].join(' ');

const readViewport = (): ViewportSize => ({ width: window.innerWidth, height: window.innerHeight });

const sameRect = (a: WindowRect, b: WindowRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

type Drag = {
  pointerId: number;
  /** The grip being dragged; none while the title bar moves the whole window. */
  edge: ResizeEdge | undefined;
  startX: number;
  startY: number;
  start: WindowRect;
  rect: WindowRect;
};

/** What a press on `target` drags: a grip resizes from its edge, the title bar moves. */
const dragFrom = (target: EventTarget): { edge: ResizeEdge | undefined } | undefined => {
  if (!(target instanceof Element)) return undefined;
  const grip = target.closest('[data-call-window-edge]')?.getAttribute('data-call-window-edge');
  const edge = EDGES.find((name) => name === grip);
  if (edge) return { edge };
  if (!target.closest('[data-call-window-handle]') || target.closest(PRESSABLE)) return undefined;
  return { edge: undefined };
};

/**
 * The floating window on desktop: it places its children (the call view) at the account's stored
 * box, moves it by the title bar the call view marks with `handleProps`, resizes it from eight grips
 * and keeps it inside the viewport. It has a fixed name; the call view inside names the call.
 */
export function FloatingCallWindow(props: { children: ReactNode; frameRef?: Ref<HTMLElement> }) {
  const { children, frameRef } = props;
  const { t } = useTranslation();
  const [settings, setSettings] = useCallWindowSettings();
  const [viewport, setViewport] = useState(readViewport);
  const stored = settings.rect;
  // A stored box is fitted from the viewport it was placed in, so it keeps its distance to the
  // nearer edges as the viewport changes and gets its size back when the viewport grows again.
  // Nothing is written meanwhile; a box that arrives from elsewhere counts as placed in this one.
  const [placed, setPlaced] = useState({ rect: stored, viewport });
  if (placed.rect !== stored) setPlaced({ rect: stored, viewport });
  const placedIn = placed.rect === stored ? placed.viewport : viewport;
  const settled = stored
    ? fitToViewport(stored, placedIn, viewport)
    : clampToViewport(defaultRect(viewport, document.dir === 'rtl'), viewport);
  const [preview, setPreview] = useState<WindowRect>();
  const rect = preview ?? settled;
  const bar = isBar(rect);
  const dragRef = useRef<Drag>();

  useEffect(() => {
    const measure = () =>
      setViewport((previous) => {
        const next = readViewport();
        const same = next.width === previous.width && next.height === previous.height;
        return same ? previous : next;
      });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Settings are written when a change ends (a release, a step, Minimize), never per pointer move.
  // A box that a drag or a step turned into the bar remembers the height to expand to, as Minimize
  // does.
  const save = (next: WindowRect, from: WindowRect) => {
    if (sameRect(next, from)) return;
    const entersBar = isBar(next) && !isBar(from);
    setSettings({ ...(entersBar ? minimizedSettings(settings, from) : settings), rect: next });
  };

  // The call view reads the frame from context; these keep their identity across pointer moves so
  // it does not render again for each one.
  const latest = useLatestRef({ settings, rect, viewport, save });
  const minimize = useCallback(() => {
    const current = latest.current;
    if (!isBar(current.rect)) setSettings(minimizedSettings(current.settings, current.rect));
  }, [latest, setSettings]);
  const expand = useCallback(() => {
    const current = latest.current;
    if (isBar(current.rect)) {
      setSettings(expandedSettings(current.settings, current.rect, current.viewport));
    }
  }, [latest, setSettings]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // Only the title bar itself: a button in it keeps its arrows.
      if (event.target !== event.currentTarget || !isArrow(event.key)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const current = latest.current;
      current.save(
        keyStep(current.rect, event.key, event.shiftKey, current.viewport),
        current.rect
      );
    },
    [latest]
  );
  // The handle names the state it moves, so Minimize and Expand are heard where the focus stays.
  const moveLabel = t(bar ? 'featureUi.calls.window.moveMinimized' : 'featureUi.calls.window.move');
  const frame = useMemo<CallWindowFrame>(
    () => ({
      bar,
      minimize,
      expand,
      handleProps: {
        'data-call-window-handle': '',
        tabIndex: 0,
        role: 'group',
        'aria-label': moveLabel,
        'aria-keyshortcuts': HANDLE_KEYS,
        onKeyDown,
      },
    }),
    [bar, expand, minimize, moveLabel, onKeyDown]
  );
  const { width, height } = rect;
  const size = useMemo(() => ({ width, height }), [width, height]);

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    const from = dragFrom(event.target);
    if (!from) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { pointerId, clientX, clientY } = event;
    dragRef.current = { ...from, pointerId, startX: clientX, startY: clientY, start: rect, rect };
    setPreview(rect);
  };
  const followDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.rect = drag.edge
      ? resizeRect(drag.start, drag.edge, dx, dy, viewport)
      : moveRect(drag.start, dx, dy, viewport);
    setPreview(drag.rect);
  };
  const endDrag = (event: PointerEvent<HTMLElement>, released: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreview(undefined);
    // A bar that was moved drops into the nearest corner when let go; a lost pointer leaves the
    // window where it stands.
    const drops = released && !drag.edge && isBar(drag.rect) && !sameRect(drag.rect, drag.start);
    save(drops ? snapToCorner(drag.rect, viewport) : drag.rect, drag.start);
  };

  return (
    <CallWindowFrameContext.Provider value={frame}>
      <section
        ref={frameRef}
        className={css.Frame}
        aria-label={t('featureUi.calls.window.label')}
        data-testid="call-window"
        data-bar={bar || undefined}
        data-dragging={preview ? '' : undefined}
        style={{
          // eslint-disable-next-line no-restricted-syntax -- the window is placed by viewport coordinates, not by a reading side.
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
        onPointerDown={startDrag}
        onPointerMove={followDrag}
        onPointerUp={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        onLostPointerCapture={(event) => endDrag(event, false)}
      >
        <div className={css.Box}>
          <CallWindowSizeContext.Provider value={size}>{children}</CallWindowSizeContext.Provider>
        </div>
        {EDGES.map((edge) => (
          <span key={edge} className={css.Edge[edge]} data-call-window-edge={edge} aria-hidden />
        ))}
      </section>
    </CallWindowFrameContext.Provider>
  );
}
