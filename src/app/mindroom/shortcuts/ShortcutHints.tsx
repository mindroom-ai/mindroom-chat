import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';
import { createHintHold } from './hintHold';
import { hasTextSelection, openOverlay } from './shortcutDom';
import { formatShortcut, shortcutOfAria, usesCommandKey, type ShortcutId } from './shortcuts';
import * as css from './Shortcuts.css';

const HOLD_MS = 1000;

const hintsAllowed = (): boolean =>
  openOverlay() !== 'other' && !hasTextSelection() && !computerOwnsKeyboardFocus();

/**
 * Whether the hints show: ⌘ (Ctrl elsewhere) held on its own for a second. Another key, a mouse
 * button, the wheel, leaving the window or focus in the Computer screen cancel the hold until
 * the key comes up, so ⌘C, ⌘V and Ctrl+click never show anything.
 */
export const useShortcutHintHold = (enabled: boolean): boolean => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const apple = usesCommandKey();
    const modifier = apple ? 'Meta' : 'Control';
    const hold = createHintHold({
      delayMs: HOLD_MS,
      schedule: (run, ms) => {
        const timer = window.setTimeout(run, ms);
        return () => window.clearTimeout(timer);
      },
      canShow: hintsAllowed,
      onChange: setShown,
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const alone =
        event.key === modifier &&
        !event.shiftKey &&
        !event.altKey &&
        !(apple ? event.ctrlKey : event.metaKey);
      if (alone && !computerOwnsKeyboardEvent(event)) hold.modifierDown(event.repeat);
      else hold.interrupt();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modifier) hold.modifierUp();
    };
    const interrupt = () => hold.interrupt();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hold.interrupt();
    };
    const onFocusIn = () => {
      if (computerOwnsKeyboardFocus()) hold.interrupt();
    };

    // Capture: a widget that stops the key on its way up still cancels the hold.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', interrupt, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('blur', interrupt);
    window.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', interrupt, true);
      window.removeEventListener('wheel', interrupt, { capture: true });
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('visibilitychange', onVisibility);
      hold.modifierUp();
    };
  }, [enabled]);

  return enabled && shown;
};

type Hint = { key: string; id: ShortcutId; x: number; y: number };

const visibleOnScreen = (element: Element, rect: DOMRect): boolean =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < window.innerHeight &&
  rect.left < window.innerWidth &&
  !element.closest('[aria-hidden="true"], [inert]') &&
  (typeof element.checkVisibility !== 'function' ||
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));

/** The controls on screen that name a shortcut in `aria-keyshortcuts`, at their centers. */
const findHints = (): Hint[] =>
  Array.from(document.querySelectorAll('[aria-keyshortcuts]')).flatMap((element, index) => {
    const id = shortcutOfAria(element.getAttribute('aria-keyshortcuts') ?? '');
    const rect = element.getBoundingClientRect();
    if (!id || !visibleOnScreen(element, rect)) return [];
    return [{ key: `${id}-${index}`, id, x: rect.left + rect.width / 2, y: rect.bottom }];
  });

/** Key badges on the visible controls that have a shortcut, and where to find the rest. */
export function ShortcutHints() {
  const { t } = useTranslation();
  const [hints] = useState(findHints);

  return createPortal(
    <div className={css.HintLayer} aria-hidden="true" data-shortcut-hints="">
      {hints.map((hint) => (
        <span
          key={hint.key}
          className={css.HintBadge}
          data-shortcut-hint={hint.id}
          // eslint-disable-next-line no-restricted-syntax -- a measured screen point, physical in every language
          style={{ left: hint.x, top: hint.y }}
        >
          {formatShortcut(hint.id)}
        </span>
      ))}
      <span className={css.HintChip} data-shortcut-hint-chip="">
        {t('shortcuts.hints.chip', { keys: formatShortcut('help') })}
      </span>
    </div>,
    document.body
  );
}
