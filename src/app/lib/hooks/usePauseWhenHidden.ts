import { useEffect, useState, type RefObject } from 'react';
import { usePaneCollapsed } from './usePaneCollapsed';
import './usePauseWhenHidden.css';

type VisibilityListener = (visible: boolean) => void;

let sharedObserver: IntersectionObserver | undefined;
let listeningVisibility = false;
const elementEntries = new Map<
  Element,
  { intersecting: boolean; listeners: Set<VisibilityListener> }
>();
const docListeners = new Set<() => void>();

const isDocumentHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

const notifyVisibilityChange = () => {
  const hidden = isDocumentHidden();
  elementEntries.forEach(({ intersecting, listeners }) => {
    const visible = !hidden && intersecting;
    listeners.forEach((listener) => listener(visible));
  });
  docListeners.forEach((listener) => listener());
};

const ensureDocListener = () => {
  if (listeningVisibility || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', notifyVisibilityChange);
  listeningVisibility = true;
};

const releaseDocListenerIfIdle = () => {
  if (!listeningVisibility || elementEntries.size > 0 || docListeners.size > 0) return;
  document.removeEventListener('visibilitychange', notifyVisibilityChange);
  listeningVisibility = false;
};

/**
 * Observes `element` with one shared IntersectionObserver and one shared document visibilitychange
 * listener. Invokes `onChange(visible)` whenever intersection or tab visibility changes.
 */
export const observeElementVisibility = (
  element: Element,
  onChange: VisibilityListener
): (() => void) => {
  let entry = elementEntries.get(element);
  if (!entry) {
    entry = { intersecting: true, listeners: new Set() };
    elementEntries.set(element, entry);
    if (typeof IntersectionObserver === 'function') {
      sharedObserver ??= new IntersectionObserver((entries) => {
        const hidden = isDocumentHidden();
        entries.forEach(({ target, isIntersecting }) => {
          const current = elementEntries.get(target);
          if (!current) return;
          current.intersecting = isIntersecting;
          const visible = !hidden && isIntersecting;
          current.listeners.forEach((listener) => listener(visible));
        });
      });
      sharedObserver.observe(element);
    }
    ensureDocListener();
  }
  entry.listeners.add(onChange);

  return () => {
    const current = elementEntries.get(element);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size > 0) return;
    sharedObserver?.unobserve(element);
    elementEntries.delete(element);
    if (elementEntries.size === 0) {
      sharedObserver?.disconnect();
      sharedObserver = undefined;
    }
    releaseDocListenerIfIdle();
  };
};

/**
 * Sets `data-animation-paused="true"` on `ref.current` while `active` is true and the element is
 * scrolled off-screen, the tab is hidden, or its pane is collapsed. Mutates the attribute directly
 * so scrolling never triggers React re-renders.
 */
export const usePauseAnimationWhenHidden = (
  ref: RefObject<HTMLElement | null>,
  active = true
): void => {
  const collapsed = usePaneCollapsed();
  useEffect(() => {
    const element = ref.current;
    if (!element?.dataset) return undefined;
    if (!active) {
      delete element.dataset.animationPaused;
      return undefined;
    }
    const apply = (visible: boolean) => {
      if (collapsed || !visible) element.dataset.animationPaused = 'true';
      else delete element.dataset.animationPaused;
    };
    if (collapsed || isDocumentHidden()) element.dataset.animationPaused = 'true';
    else delete element.dataset.animationPaused;
    if (collapsed) return undefined;
    return observeElementVisibility(element, apply);
  }, [active, collapsed, ref]);
};

/**
 * Returns whether an element is active and visible (not collapsed, tab visible, and on screen).
 * Intended for timer-driven components that pause ticks when hidden and resync on resume.
 */
export const useActiveWhenVisible = (
  ref: RefObject<HTMLElement | null>,
  active = true
): boolean => {
  const collapsed = usePaneCollapsed();
  const [visible, setVisible] = useState(() => !isDocumentHidden());
  useEffect(() => {
    if (!active || collapsed) return undefined;
    setVisible(!isDocumentHidden());
    const element = ref.current;
    if (element) {
      return observeElementVisibility(element, setVisible);
    }
    const onDocChange = () => setVisible(!isDocumentHidden());
    docListeners.add(onDocChange);
    ensureDocListener();
    return () => {
      docListeners.delete(onDocChange);
      releaseDocListenerIfIdle();
    };
  }, [active, collapsed, ref]);
  return active && !collapsed && visible;
};
