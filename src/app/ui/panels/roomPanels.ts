import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** One of a room's side panels, as the rule between them sees it. */
export type RoomPanel = {
  /** Names the panel to the rule and to the place it shows in. */
  id: string;
  /** Whether its own state has it open; it shows unless an open panel listed before it does. */
  open: boolean;
  /** Closes it in its own state. */
  close: () => void;
  /** The panels it stays open behind, hidden, when they open; any other panel closes it. */
  yieldsTo?: readonly string[];
  /**
   * Its state also opens it from outside the room (the call, from a ring or a call started
   * elsewhere); such an opening closes the others as a request in the room would.
   */
  opensElsewhere?: boolean;
};

/** Closes every panel but `id` that does not yield to it. */
const makeRoomFor = (panels: readonly RoomPanel[], id: string) =>
  panels.forEach((panel) => {
    if (panel.id !== id && !panel.yieldsTo?.includes(id)) panel.close();
  });

/**
 * The rule of a room's side panels: one shows at a time, the first open one in the order of
 * `panels`. `request(id, show)` opens one: it closes every other panel that does not yield to it,
 * then calls `show`, which opens it in its own state.
 */
export function useRoomPanels<Panel extends RoomPanel>(panels: readonly Panel[]) {
  const latest = useRef(panels);
  useLayoutEffect(() => {
    latest.current = panels;
  });
  const request = useCallback((id: string, show: () => void) => {
    makeRoomFor(latest.current, id);
    show();
  }, []);

  const wasOpen = useRef<ReadonlySet<string>>();
  useEffect(() => {
    const open = new Set(panels.filter((panel) => panel.open).map((panel) => panel.id));
    const before = wasOpen.current ?? open;
    wasOpen.current = open;
    panels.forEach((panel) => {
      if (panel.opensElsewhere && panel.open && !before.has(panel.id)) {
        makeRoomFor(panels, panel.id);
      }
    });
  });

  return { shown: panels.find((panel) => panel.open), request };
}
