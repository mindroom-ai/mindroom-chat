import { useEffect, useRef } from 'react';
import type { ShortcutId } from './shortcuts';

/**
 * Performs a shortcut's action. Returns false when the action is not available now (no thread
 * open, nothing to move to), so the key keeps its browser meaning.
 */
export type ShortcutHandler = (event: KeyboardEvent) => boolean;

type HandlerRef = { current: ShortcutHandler };

const handlers = new Map<ShortcutId, HandlerRef[]>();

export const hasShortcutHandler = (id: ShortcutId): boolean => (handlers.get(id)?.length ?? 0) > 0;

/**
 * Runs the handlers of `id`, the one mounted last first (a thread's over its room's), until one
 * acts. True when one did.
 */
export const runShortcut = (id: ShortcutId, event: KeyboardEvent): boolean =>
  [...(handlers.get(id) ?? [])].reverse().some((ref) => ref.current(event));

/** Gives the shortcut `id` its action while the calling component is mounted. */
export const useShortcut = (id: ShortcutId, handler: ShortcutHandler): void => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const stack = handlers.get(id) ?? [];
    stack.push(ref);
    handlers.set(id, stack);
    return () => {
      const remaining = (handlers.get(id) ?? []).filter((entry) => entry !== ref);
      if (remaining.length > 0) handlers.set(id, remaining);
      else handlers.delete(id);
    };
  }, [id]);
};
