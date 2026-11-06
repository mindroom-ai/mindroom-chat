import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type KeyboardEventHandler,
  type Ref,
  type RefCallback,
} from 'react';

// The WAI-ARIA menu pattern for every menu built on the shared Menu and MenuItem: the menu is a
// `menu`, its rows are `menuitem`s (or say they are checkbox or radio items), and ArrowDown,
// ArrowUp, Home and End move between the rows, also from the button that opened the menu with a
// pointer, which keeps focus. Focus on opening a menu from the keyboard and focus back to its
// button after Escape are lib/overlayFocus.ts's, as for every layer.

const MenuRoleContext = createContext<string | undefined>(undefined);

/** Tells the rows inside a menu surface which role the surface has. */
export const MenuRoleProvider = MenuRoleContext.Provider;

/** A menu row's role: the one it names, else `menuitem` inside a `menu`. */
export const useMenuItemRole = (role: string | undefined): string | undefined => {
  const menuRole = useContext(MenuRoleContext);
  return role ?? (menuRole === 'menu' ? 'menuitem' : undefined);
};

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** The rows of `menu` a reader can reach, in order, without those of a menu inside it. */
const menuItems = (menu: HTMLElement): HTMLElement[] =>
  Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (item) =>
      item.closest('[role="menu"]') === menu &&
      !item.matches(':disabled, [aria-disabled="true"]') &&
      // A row a menu hides (display: none) is skipped; without checkVisibility every row counts.
      (item.checkVisibility?.() ?? true)
  );

const editsText = (element: Element): boolean =>
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'range', 'reset', 'submit'].includes(element.type)) ||
  (element instanceof HTMLElement && element.isContentEditable);

type NavigationKey = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'defaultPrevented' | 'key' | 'metaKey' | 'shiftKey' | 'target'
> & { preventDefault: () => void };

/**
 * Moves focus between the rows of `menu` for ArrowDown and ArrowUp (wrapping at the ends), Home
 * and End. From outside the rows, ArrowDown and Home go to the first row, ArrowUp and End to the
 * last. Other keys and keys in a text field pass through.
 */
export const moveMenuFocus = (event: NavigationKey, menu: HTMLElement): void => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.shiftKey || !NAVIGATION_KEYS.has(event.key)) return;
  const target = event.target as Element | null;
  if (target && editsText(target)) return;
  const items = menuItems(menu);
  if (items.length === 0) return;
  const current = items.findIndex((item) => !!target && item.contains(target));
  const last = items.length - 1;
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = last;
  else if (event.key === 'ArrowDown') next = current < 0 || current === last ? 0 : current + 1;
  else next = current <= 0 ? last : current - 1;
  event.preventDefault();
  items[next]?.focus();
};

/**
 * The menu behaviour for an element with `role`; only a `menu` gets it. Returns a ref that also
 * fills `forwardedRef`, and the caller's key handler wrapped with the menu's own.
 */
export const useMenuBehaviour = <T extends HTMLElement>(
  role: string | undefined,
  forwardedRef: Ref<T> | undefined,
  onKeyDown: KeyboardEventHandler<T> | undefined
) => {
  const isMenu = role === 'menu';
  const element = useRef<T | null>(null);

  const ref: RefCallback<T> = useCallback(
    (node: T | null) => {
      element.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: T | null }).current = node;
    },
    [forwardedRef]
  );

  // A menu opened with a pointer leaves focus where it was (its button, or the page); the arrow
  // keys there go into the menu.
  useEffect(() => {
    const menu = element.current;
    if (!isMenu || !menu) return undefined;
    const opener = document.activeElement;
    const enter = (event: KeyboardEvent) => {
      const { target } = event;
      if (target !== opener && target !== document.body) return;
      if (target instanceof Node && menu.contains(target)) return;
      moveMenuFocus(event, menu);
    };
    document.addEventListener('keydown', enter);
    return () => document.removeEventListener('keydown', enter);
  }, [isMenu]);

  return {
    ref,
    onKeyDown: (event: ReactKeyboardEvent<T>) => {
      onKeyDown?.(event);
      if (isMenu) moveMenuFocus(event, event.currentTarget);
    },
  };
};
