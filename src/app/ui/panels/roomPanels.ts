import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Where a room's side panel shows: `beside` the conversation (resizable), `filled` across the room
 * in the conversation's place, or `folded` to a tab at the room's edge, still open.
 */
export type PanelLayout = 'beside' | 'filled' | 'folded';

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
 *
 * Each panel of each room (`room`) also has a layout, `layout` for the one shown: it opens beside
 * the conversation, by a request or from elsewhere, and keeps what `setLayout` gives it while it
 * stays open, also while another panel or another conversation hides it.
 */
export function useRoomPanels<Panel extends RoomPanel>(room: string, panels: readonly Panel[]) {
  const latest = useRef({ room, panels });
  useLayoutEffect(() => {
    latest.current = { room, panels };
  });
  const [layouts, setLayouts] = useState<Readonly<Record<string, PanelLayout>>>({});
  const setLayout = useCallback(
    (id: string, layout: PanelLayout) =>
      setLayouts((all) => ({ ...all, [`${latest.current.room}\n${id}`]: layout })),
    []
  );
  const request = useCallback(
    (id: string, show: () => void) => {
      makeRoomFor(latest.current.panels, id);
      setLayout(id, 'beside');
      show();
    },
    [setLayout]
  );

  const wasOpen = useRef<ReadonlySet<string>>();
  useEffect(() => {
    const open = new Set(panels.filter((panel) => panel.open).map((panel) => panel.id));
    const before = wasOpen.current ?? open;
    wasOpen.current = open;
    panels.forEach((panel) => {
      if (panel.opensElsewhere && panel.open && !before.has(panel.id)) {
        makeRoomFor(panels, panel.id);
        setLayout(panel.id, 'beside');
      }
    });
  });

  const shown = panels.find((panel) => panel.open);
  const layout = (shown && layouts[`${room}\n${shown.id}`]) ?? 'beside';
  return { shown, layout, setLayout, request };
}
