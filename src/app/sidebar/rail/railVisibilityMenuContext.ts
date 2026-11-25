import { createContext, useContext, type MouseEvent } from 'react';
import type { RectCords } from 'folds';
import { useLongPress } from '../../lib/hooks/useLongPress';
import type { RailButton } from '../../settings/railButtons';

export type RailMenuTarget = RailButton | 'empty';

export type RailButtonContextMenuProps = ReturnType<typeof useLongPress> & {
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  'data-menu-open'?: 'true';
};

export type RailVisibilityMenuContextValue = {
  openTarget?: RailMenuTarget;
  openMenu: (target: RailMenuTarget, anchor: RectCords, toggle?: boolean) => void;
};

export const RailVisibilityMenuContext = createContext<RailVisibilityMenuContextValue | undefined>(
  undefined
);

type TriggerOptions = {
  disabled?: boolean;
  onBeforeOpen?: () => void;
};

/**
 * Right-click and touch long-press props for a configurable icon rail button. Returns undefined
 * outside `RailVisibilityMenuProvider` or when disabled so standalone tabs and phone top-bar
 * triggers stay untouched.
 */
export function useRailVisibilityMenuTrigger(
  button: RailButton,
  options?: TriggerOptions
): RailButtonContextMenuProps | undefined {
  const context = useContext(RailVisibilityMenuContext);
  const active = Boolean(context) && !options?.disabled;
  const longPress = useLongPress(
    (_x, _y, element) => {
      options?.onBeforeOpen?.();
      context?.openMenu(button, element.getBoundingClientRect(), false);
    },
    () => active
  );
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!active || !context) return;
    event.preventDefault();
    options?.onBeforeOpen?.();
    const finger = (event.nativeEvent as Partial<PointerEvent>).pointerType === 'touch';
    context.openMenu(button, event.currentTarget.getBoundingClientRect(), !finger);
  };
  if (!active || !context) return undefined;
  return {
    ...longPress,
    onContextMenu,
    'data-menu-open': context.openTarget === button ? 'true' : undefined,
  };
}

/**
 * True only when `target` is inside the rail's DOM subtree (ignoring React portals mounted
 * elsewhere in the document) and outside any rail button or `SidebarItem` wrapper.
 */
const isEmptyRailTarget = (rail: HTMLElement, target: EventTarget | null): boolean => {
  if (!(target instanceof Node) || !rail.contains(target)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return !element?.closest('button, [data-sidebar-item]');
};

/**
 * Right-click and touch long-press props for empty space on the icon rail; ignores portal events
 * and any rail button or item so dialogs, badges, Home, Activity, Spaces, Account, Call, and
 * Unverified keep their own behavior.
 */
export function useRailEmptyContextMenu() {
  const context = useContext(RailVisibilityMenuContext);
  const longPress = useLongPress(
    (_x, y, rail) => {
      const rect = rail.getBoundingClientRect();
      context?.openMenu('empty', { x: rect.left, y, width: rect.width, height: 0 });
    },
    (event) => Boolean(context) && isEmptyRailTarget(event.currentTarget, event.target)
  );
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (
      !context ||
      event.defaultPrevented ||
      !isEmptyRailTarget(event.currentTarget, event.target)
    ) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    context.openMenu('empty', { x: rect.left, y: event.clientY, width: rect.width, height: 0 });
  };
  return context ? { ...longPress, onContextMenu } : undefined;
}
