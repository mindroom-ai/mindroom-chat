import { ReactNode, useCallback } from 'react';

/** Renders one event; `Args` is the argument list the caller passes for every event. */
export type EventRenderer<Args extends unknown[]> = (...args: Args) => ReactNode;

/** Renderers keyed by Matrix event type (`m.room.message`, `m.room.member`, ...). */
export type EventRendererOpts<Args extends unknown[]> = {
  [eventType: string]: EventRenderer<Args> | undefined;
};

/**
 * Returns a stable dispatcher `(eventType, isStateEvent, ...args)`. A renderer registered for
 * the type wins; otherwise state events fall back to `stateFallback` and the rest to
 * `eventFallback`. Without any of them the dispatcher renders nothing.
 */
export const useMatrixEventRenderer = <Args extends unknown[]>(
  byType: EventRendererOpts<Args>,
  stateFallback?: EventRenderer<Args>,
  eventFallback?: EventRenderer<Args>
) =>
  useCallback(
    (eventType: string, isStateEvent: boolean, ...args: Args): ReactNode => {
      const render = byType[eventType] ?? (isStateEvent ? stateFallback : eventFallback);
      return render ? render(...args) : null;
    },
    [byType, stateFallback, eventFallback]
  );
