import React, {
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useId,
} from 'react';
import { useTranslation } from 'react-i18next';
import { countCacheProbe } from '../event-store/cache/cacheProbe';
import {
  ExpandAllInitContext,
  ManualExpansionStateContext,
  rememberManualExpansionState,
} from '../messages/manualExpansionState';
import * as css from './CollapsibleMessage.css';

const MAX_HEIGHT = '11em';
/** How far up from its bottom a folded message fades out, in em (the mask in its CSS). */
const FADE_EM = 4;
/** What keeps its own click in a folded message's faded lines. */
const OWN_CLICK = 'a, button, input, select, textarea, summary, [role="button"], [role="link"]';

const ExpansionLayoutChangeContext = React.createContext<(() => void) | undefined>(undefined);

export function CollapsibleMessageStateProvider({
  children,
  expandAllInit,
  manualExpansionState,
  onExpansionLayoutChange,
}: {
  children: ReactNode;
  expandAllInit: boolean | undefined;
  manualExpansionState: Map<string, boolean>;
  onExpansionLayoutChange?: () => void;
}) {
  return (
    <ManualExpansionStateContext.Provider value={manualExpansionState}>
      <ExpansionLayoutChangeContext.Provider value={onExpansionLayoutChange}>
        <ExpandAllInitContext.Provider value={expandAllInit}>
          {children}
        </ExpandAllInitContext.Provider>
      </ExpansionLayoutChangeContext.Provider>
    </ManualExpansionStateContext.Provider>
  );
}

const MAX_HEIGHT_VALUE = Number.parseFloat(MAX_HEIGHT);

const getRootFontCacheKey = (): string => {
  if (typeof document === 'undefined') return '';
  return `${document.documentElement.style.fontSize}|${document.documentElement.className}|${document.body?.className ?? ''}`;
};

type CachedFontSize = {
  key: string;
  compute: typeof globalThis.getComputedStyle;
  fontSize: number | undefined;
};

let sharedFontSizeCache: CachedFontSize | undefined;
const inlineFontSizeCache = new WeakMap<HTMLDivElement, CachedFontSize>();

const getElementFontSize = (el: HTMLDivElement): number | undefined => {
  const compute = globalThis.getComputedStyle;
  if (typeof compute !== 'function') return undefined;
  const rootKey = getRootFontCacheKey();
  const inlineFontSize = el.style?.fontSize ?? '';
  if (!inlineFontSize) {
    if (
      sharedFontSizeCache &&
      sharedFontSizeCache.key === rootKey &&
      sharedFontSizeCache.compute === compute
    ) {
      return sharedFontSizeCache.fontSize;
    }
    const parsed = Number.parseFloat(compute(el).fontSize);
    const fontSize = Number.isFinite(parsed) ? parsed : undefined;
    sharedFontSizeCache = { key: rootKey, compute, fontSize };
    return fontSize;
  }
  const key = `${rootKey}|${inlineFontSize}`;
  const cached = inlineFontSizeCache.get(el);
  if (cached && cached.key === key && cached.compute === compute) {
    return cached.fontSize;
  }
  const parsed = Number.parseFloat(compute(el).fontSize);
  const fontSize = Number.isFinite(parsed) ? parsed : undefined;
  inlineFontSizeCache.set(el, { key, compute, fontSize });
  return fontSize;
};

const getCollapsedMaxHeight = (el: HTMLDivElement): number | undefined => {
  if (MAX_HEIGHT.endsWith('px')) {
    return Number.isFinite(MAX_HEIGHT_VALUE) ? MAX_HEIGHT_VALUE : undefined;
  }

  if (!MAX_HEIGHT.endsWith('em')) {
    return undefined;
  }

  const fontSize = getElementFontSize(el);
  if (fontSize === undefined) return undefined;

  return MAX_HEIGHT_VALUE * fontSize;
};

/**
 * Returns whether the element's content overflows the collapsed max-height.
 * Returns `null` when the element hasn't been laid out yet (scrollHeight === 0),
 * so callers can preserve their current assumption instead of recording a
 * false negative.
 */
const isContentOverflowing = (el: HTMLDivElement, expanded: boolean): boolean | null => {
  const { scrollHeight } = el;
  if (scrollHeight === 0) return null;

  const collapsedMaxHeight = getCollapsedMaxHeight(el);
  if (collapsedMaxHeight !== undefined) {
    return scrollHeight > collapsedMaxHeight + 1;
  }

  return !expanded && scrollHeight > el.clientHeight + 1;
};

// Task #127: remembered overflow verdicts, keyed by measurementKey.
//
// `overflowing` used to initialize to `true` on EVERY mount, so every
// virtualized remount of a short row rendered capped-with-banner first
// and shrank one layout pass later — a two-pass height per remount.
// Each pass makes the virtualizer re-measure and correct scrollTop for
// rows above the viewport; in regions dense with collapsible rows the
// corrections shift the virtual window, remounting neighbours, whose
// own two-pass heights correct back — the observed rapid oscillation
// between two positions. The same flip firing from the viewport-entry
// IntersectionObserver re-check lands mid-scroll and kills iOS flick
// momentum with a visible small jump.
//
// With the verdict cached, a remounting row renders its final height
// in ONE pass, and viewport-entry re-checks confirm instead of flip.
// Only the first-ever encounter of a row can still two-pass (initial
// guess stays `true`, correct for genuinely-overflowing content).
// Values are booleans keyed by string — no element/event retention.
//
// The cache is a WARM-START HINT for the initial render only; it is
// never the source of truth. Every mount still runs the layout check,
// the ResizeObserver, and the viewport-entry IntersectionObserver,
// each of which re-measures the real DOM and calls
// `applyOverflowVerdict` — so a stale hint (e.g. the same message
// rendered at a different container width) self-corrects within a
// layout pass and updates the cache. `measurementKey` already varies
// by event id, redaction state, edit event id, and collapse mode
// (see getCollapsibleMessageMeasurementKey), so content edits and
// redactions produce a fresh key rather than a stale hit.
type CachedOverflowVerdict = {
  verdict: boolean;
  width: number;
  height: number;
  expanded: boolean;
  fontKey: string;
};

const overflowVerdictCache = new Map<string, CachedOverflowVerdict>();
const OVERFLOW_VERDICT_CACHE_LIMIT = 4000;
const rememberOverflowVerdict = (
  measurementKey: string | undefined,
  entry: CachedOverflowVerdict
) => {
  if (measurementKey === undefined) return;
  // Bounded FIFO eviction rather than a full clear: dropping the whole
  // cache at the limit would make every currently-virtualized row lose
  // its hint at once (a re-measure cliff). Map preserves insertion
  // order, so deleting from the front evicts the oldest keys (least
  // likely to be on screen) while keeping recent verdicts warm.
  if (overflowVerdictCache.size >= OVERFLOW_VERDICT_CACHE_LIMIT) {
    const evictTo = Math.floor(OVERFLOW_VERDICT_CACHE_LIMIT * 0.75);
    for (const key of overflowVerdictCache.keys()) {
      if (overflowVerdictCache.size <= evictTo) break;
      overflowVerdictCache.delete(key);
    }
  }
  overflowVerdictCache.set(measurementKey, entry);
};

const isCachedVerdictReusable = (
  cached: CachedOverflowVerdict | undefined,
  expanded: boolean,
  width: number,
  height: number,
  fontKey: string
): cached is CachedOverflowVerdict =>
  cached !== undefined &&
  cached.width > 0 &&
  cached.height > 0 &&
  width > 0 &&
  height > 0 &&
  (!cached.verdict || cached.expanded === expanded) &&
  cached.fontKey === fontKey &&
  Math.abs(cached.width - width) < 0.5 &&
  Math.abs(cached.height - height) < 0.5;

export type CollapsibleMessageCollapseMode = 'default' | 'always-expanded' | 'initially-expanded';

type CollapsibleMessageProps = {
  children: ReactNode | ((state: CollapsibleMessageRenderState) => ReactNode);
  collapseMode?: CollapsibleMessageCollapseMode;
  expansionKey?: string;
  forceOverflowing?: boolean;
  measurementKey?: string;
  onInitialExpandConsumed?: () => void;
};

export type CollapsibleMessageRenderState = {
  expanded: boolean;
  loadFullContent: boolean;
};

export function CollapsibleMessage({
  children,
  collapseMode = 'default',
  expansionKey,
  forceOverflowing = false,
  measurementKey,
  onInitialExpandConsumed,
}: CollapsibleMessageProps) {
  const { t } = useTranslation();
  const isExempt = collapseMode === 'always-expanded';
  const contentRef = useRef<HTMLDivElement>(null);
  const measurementKeyRef = useRef(measurementKey);
  const contentId = useId();
  const initialExpandConsumedRef = useRef(onInitialExpandConsumed);
  const previousCollapseModeRef = useRef<CollapsibleMessageCollapseMode | undefined>(undefined);
  const expandAllInit = useContext(ExpandAllInitContext);
  const onExpansionLayoutChange = useContext(ExpansionLayoutChangeContext);
  const previousExpandAllInitRef = useRef(expandAllInit);
  const manualExpansionState = useContext(ManualExpansionStateContext);
  const lastMeasuredRef = useRef<
    { key: string | undefined; entry: CachedOverflowVerdict } | undefined
  >(undefined);
  const [overflowing, setOverflowing] = useState(() => {
    // forceOverflowing is a prop-driven override (lazily-hydrated
    // collapsed content) and must win over any cached verdict. A row
    // that previously cached `false` must still show the affordance
    // when forced. Not cached: it is not a measured verdict.
    if (forceOverflowing) return true;
    if (measurementKey !== undefined) {
      const remembered = overflowVerdictCache.get(measurementKey);
      if (remembered !== undefined) return remembered.verdict;
    }
    return true;
  });
  const applyOverflowVerdict = useCallback(
    (verdict: boolean, width: number, height: number, isExpanded: boolean, fontKey: string) => {
      countCacheProbe(verdict ? 'collapsibleVerdictOverflowing' : 'collapsibleVerdictNotOverflowing');
      const entry: CachedOverflowVerdict = {
        verdict,
        width,
        height,
        expanded: isExpanded,
        fontKey,
      };
      lastMeasuredRef.current = { key: measurementKeyRef.current, entry };
      rememberOverflowVerdict(measurementKeyRef.current, entry);
      setOverflowing(verdict);
    },
    []
  );
  const [expanded, setExpanded] = useState(() => {
    // Live-expand-once rows must mount expanded even under an active
    // collapse-all override; the mount effect would correct this anyway, but
    // only after paint (a visible collapsed flash on virtualized mounts).
    if (collapseMode === 'initially-expanded') {
      return true;
    }
    if (!isExempt && expansionKey !== undefined) {
      const remembered = manualExpansionState?.get(expansionKey);
      if (remembered !== undefined) return remembered;
    }
    if (!isExempt && expandAllInit !== undefined) {
      return expandAllInit;
    }
    return collapseMode !== 'default';
  });
  const hasRenderFunctionChildren = typeof children === 'function';
  const effectiveExpanded = isExempt || expanded;
  const previousEffectiveExpandedRef = useRef(effectiveExpanded);
  const [loadFullContent, setLoadFullContent] = useState(
    () =>
      !hasRenderFunctionChildren || effectiveExpanded || typeof IntersectionObserver === 'undefined'
  );

  initialExpandConsumedRef.current = onInitialExpandConsumed;

  useLayoutEffect(() => {
    measurementKeyRef.current = measurementKey;
    // When an expanded edit keeps the same height, the persistent ResizeObserver
    // will not emit a new entry. Carry the last measured verdict forward under
    // the new key so virtualized remounts stay warm; if height changes, the
    // observer overwrites it after layout.
    if (
      expanded &&
      typeof ResizeObserver !== 'undefined' &&
      !isExempt &&
      !forceOverflowing &&
      measurementKey !== undefined &&
      lastMeasuredRef.current !== undefined &&
      overflowVerdictCache.get(measurementKey) === undefined
    ) {
      rememberOverflowVerdict(measurementKey, lastMeasuredRef.current.entry);
    }
  }, [expanded, forceOverflowing, isExempt, measurementKey]);

  const checkOverflow = useCallback(() => {
    if (isExempt) return;
    if (forceOverflowing) {
      // Prop-driven override, not a detected verdict. Not cached.
      setOverflowing(true);
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    const fontKey = getRootFontCacheKey();
    const key = measurementKeyRef.current;
    if (key !== undefined && typeof ResizeObserver !== 'undefined') {
      const cached = overflowVerdictCache.get(key);
      if (
        cached &&
        cached.width > 0 &&
        (!cached.verdict || cached.expanded === expanded) &&
        cached.fontKey === fontKey
      ) {
        lastMeasuredRef.current = { key, entry: cached };
        setOverflowing(cached.verdict);
        return;
      }
    }
    const result = isContentOverflowing(el, expanded);
    if (result !== null) {
      applyOverflowVerdict(
        result,
        el.clientWidth || 0,
        el.clientHeight || 0,
        expanded,
        fontKey
      );
    }
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt]);

  useEffect(() => {
    if (
      collapseMode === 'initially-expanded' &&
      previousCollapseModeRef.current !== 'initially-expanded'
    ) {
      setExpanded(true);
      initialExpandConsumedRef.current?.();
    }
    previousCollapseModeRef.current = collapseMode;
  }, [collapseMode]);

  useEffect(() => {
    if (previousExpandAllInitRef.current === expandAllInit) return;
    previousExpandAllInitRef.current = expandAllInit;
    if (isExempt || collapseMode === 'initially-expanded' || expandAllInit === undefined) return;
    if (expansionKey !== undefined && manualExpansionState?.has(expansionKey)) return;
    setExpanded(expandAllInit);
  }, [collapseMode, expandAllInit, expansionKey, isExempt, manualExpansionState]);

  useLayoutEffect(() => {
    if (previousEffectiveExpandedRef.current === effectiveExpanded) return;
    previousEffectiveExpandedRef.current = effectiveExpanded;
    onExpansionLayoutChange?.();
  }, [effectiveExpanded, onExpansionLayoutChange]);

  // Full long-text sidecars should load before the user expands a visible
  // row, but not for virtualizer overscan rows that never enter the viewport.
  // Once enabled, keep the full content mounted across collapse/expand cycles.
  useEffect(() => {
    if (!hasRenderFunctionChildren || loadFullContent) return undefined;
    if (effectiveExpanded) {
      setLoadFullContent(true);
      return undefined;
    }

    const el = contentRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setLoadFullContent(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setLoadFullContent(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [effectiveExpanded, hasRenderFunctionChildren, loadFullContent]);

  // Expanded streaming rows have natural height. Let ResizeObserver measure
  // their edits after layout instead of forcing layout during every React commit.
  // Mounts, collapse transitions, and capped rows still need a synchronous check.
  const synchronousMeasurementKey =
    expanded && typeof ResizeObserver !== 'undefined' ? undefined : measurementKey;
  useLayoutEffect(checkOverflow, [checkOverflow, synchronousMeasurementKey]);

  // Keep one ResizeObserver per mounted row and read measurementKeyRef.current
  // inside its callback rather than recreating the observer on every edit.
  useEffect(() => {
    const el = contentRef.current;
    if (isExempt || forceOverflowing || !el || typeof ResizeObserver === 'undefined')
      return undefined;
    const observer = new ResizeObserver((entries) => {
      const fontKey = getRootFontCacheKey();
      const key = measurementKeyRef.current;
      const rect = entries[0]?.contentRect;
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;
      if (key !== undefined) {
        const cached = overflowVerdictCache.get(key);
        if (isCachedVerdictReusable(cached, expanded, width, height, fontKey)) {
          lastMeasuredRef.current = { key, entry: cached };
          setOverflowing(cached.verdict);
          return;
        }
      }
      const result = isContentOverflowing(el, expanded);
      if (result !== null) {
        applyOverflowVerdict(
          result,
          width || el.clientWidth || 0,
          height || el.clientHeight || 0,
          expanded,
          fontKey
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt]);

  // IntersectionObserver: re-check overflow when element enters the viewport.
  // Catches elements that had zero scrollHeight when first measured off-screen.
  useEffect(() => {
    const el = contentRef.current;
    if (
      isExempt ||
      forceOverflowing ||
      !el ||
      expanded ||
      typeof IntersectionObserver === 'undefined'
    )
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const fontKey = getRootFontCacheKey();
        const key = measurementKeyRef.current;
        const last = lastMeasuredRef.current;
        if (last && last.key === key && last.entry.fontKey === fontKey) {
          return;
        }
        const result = isContentOverflowing(el, expanded);
        if (result !== null) {
          applyOverflowVerdict(
            result,
            el.clientWidth || 0,
            el.clientHeight || 0,
            expanded,
            fontKey
          );
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt]);

  const setManualExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (manualExpansionState && expansionKey !== undefined) {
        rememberManualExpansionState(manualExpansionState, expansionKey, nextExpanded);
      }
      setExpanded(nextExpanded);
    },
    [expansionKey, manualExpansionState]
  );

  const handleExpandClick = useCallback(() => {
    setManualExpanded(true);
  }, [setManualExpanded]);

  // A click on the faded lines of a folded message unfolds it, unless it lands on a link or
  // button there or ends a text selection.
  const handleFadeClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const content = contentRef.current;
      // React passes on clicks from the message's portals too, such as an image viewer's.
      if (!content || !event.currentTarget.contains(event.target as Node)) return;
      const ownControl = (event.target as Element).closest(OWN_CLICK);
      if (ownControl && event.currentTarget.contains(ownControl)) return;
      if (globalThis.getSelection?.()?.isCollapsed === false) return;
      const fontSize = getElementFontSize(content);
      if (fontSize !== undefined && event.clientY < content.getBoundingClientRect().bottom - FADE_EM * fontSize) return;
      setManualExpanded(true);
    },
    [setManualExpanded]
  );

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setManualExpanded(false);
    },
    [setManualExpanded]
  );

  const showToggle = !isExempt && overflowing;
  const isCollapsed = showToggle && !expanded;
  const toggleLabel = expanded
    ? t('mindroomUi.notices.showLess')
    : t('mindroomUi.threads.mindroomRoomTimeline.showFullMessage');
  const shouldLoadFullContent = effectiveExpanded || loadFullContent;
  const renderedChildren =
    typeof children === 'function'
      ? children({ expanded: effectiveExpanded, loadFullContent: shouldLoadFullContent })
      : children;

  return (
    // The pill is the control keyboards and screen readers use; a click on the faded lines is a
    // larger target for a pointer.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div className={css.CollapsibleContainer} onClick={isCollapsed ? handleFadeClick : undefined}>
      <div
        id={contentId}
        ref={contentRef}
        className={css.CollapsibleContent({ collapsed: isCollapsed })}
        data-expanded={isExempt ? undefined : expanded}
        style={{
          maxHeight: effectiveExpanded ? undefined : MAX_HEIGHT,
          overflow: effectiveExpanded ? undefined : 'hidden',
        }}
      >
        {renderedChildren}
      </div>
      {showToggle && (
        <div
          data-message-disclosure=""
          className={expanded ? css.CollapsibleStickyFooter : css.CollapsibleFooter}
        >
          <button
            type="button"
            className={css.CollapsiblePill}
            aria-label={toggleLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={expanded ? handleCollapseClick : handleExpandClick}
          >
            <span>{toggleLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
