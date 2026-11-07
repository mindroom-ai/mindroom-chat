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

/** The layout of each panel, by room. */
type Layouts = Readonly<Record<string, Readonly<Record<string, PanelLayout>>>>;

/**
 * `id` opened: beside the conversation, which is what no layout means, in every room; what it was
 * before no longer holds.
 */
const opened = (layouts: Layouts, id: string): Layouts => ({ ...layouts, [id]: {} });

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
 * Each panel of each room (`room`) also has a layout, `layout` for the one shown. A panel opens
 * beside the conversation, by a request or from elsewhere, which forgets its layout in the other
 * rooms; a request for a panel already open that fills the room leaves it so. The layout
 * `setLayout` gives a panel stays while it stays open, also while another panel or another
 * conversation hides it.
 */
export function useRoomPanels<Panel extends RoomPanel>(room: string, panels: readonly Panel[]) {
  const latest = useRef({ room, panels });
  useLayoutEffect(() => {
    latest.current = { room, panels };
  });
  const [layouts, setLayouts] = useState<Layouts>({});
  const setLayout = useCallback(
    (id: string, layout: PanelLayout) =>
      setLayouts((all) => ({ ...all, [id]: { ...all[id], [latest.current.room]: layout } })),
    []
  );
  const request = useCallback((id: string, show: () => void) => {
    const { room: here, panels: current } = latest.current;
    makeRoomFor(current, id);
    const open = current.some((panel) => panel.id === id && panel.open);
    setLayouts((all) => (open && all[id]?.[here] === 'filled' ? all : opened(all, id)));
    show();
  }, []);

  // The panels open when each room last showed: a panel already open when its room shows again
  // did not open elsewhere.
  const wasOpen = useRef<Record<string, ReadonlySet<string>>>({});
  useEffect(() => {
    const open = new Set(panels.filter((panel) => panel.open).map((panel) => panel.id));
    const before = wasOpen.current[room] ?? open;
    wasOpen.current[room] = open;
    panels.forEach((panel) => {
      if (panel.opensElsewhere && panel.open && !before.has(panel.id)) {
        makeRoomFor(panels, panel.id);
        setLayouts((all) => opened(all, panel.id));
      }
    });
  });

  const shown = panels.find((panel) => panel.open);
  // A panel that has just opened elsewhere shows beside the conversation from its first render; the
  // effect above then keeps it so.
  const openedElsewhere = !!shown?.opensElsewhere && !wasOpen.current[room]?.has(shown.id);
  const layout = (shown && !openedElsewhere && layouts[shown.id]?.[room]) || 'beside';
  return { shown, layout, setLayout, request };
}
