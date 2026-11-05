const FIND_ATTEMPTS = 40;
const FIND_INTERVAL_MS = 50;
const HIGHLIGHT_MS = 2000;
const HIGHLIGHT_ATTRIBUTE = 'data-settings-highlight';

// Controls that take focus without opening a phone's keyboard.
const CONTROL = 'button:not([disabled]), [role="switch"], input[type="checkbox"]';

/**
 * Scrolls the setting `id` inside `container` into view, highlights it for a moment and moves
 * focus to its first control. A page that loads its settings (sessions, packs) gets about two
 * seconds to show it. Returns a cleanup that stops looking and ends the highlight.
 */
export const revealSetting = (container: HTMLElement | null, id: string): (() => void) => {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let found: Element | null = null;

  const look = () => {
    found = container?.querySelector(`[data-setting-id="${CSS.escape(id)}"]`) ?? null;
    if (!found) {
      attempts += 1;
      if (attempts < FIND_ATTEMPTS) timer = setTimeout(look, FIND_INTERVAL_MS);
      return;
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    found.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    found.setAttribute(HIGHLIGHT_ATTRIBUTE, '');
    found.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: true });
    timer = setTimeout(() => found?.removeAttribute(HIGHLIGHT_ATTRIBUTE), HIGHLIGHT_MS);
  };
  look();

  return () => {
    clearTimeout(timer);
    found?.removeAttribute(HIGHLIGHT_ATTRIBUTE);
  };
};
