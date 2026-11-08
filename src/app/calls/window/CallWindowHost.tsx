import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { ClientEvent, KnownMembership, RoomEvent, type Room } from 'matrix-js-sdk';
import { Box, Spinner } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { mainContentFocusTarget } from '../../ui/page/mainContentFocus';
import { callPanelRoomAtom, isActiveCallShownIn, useActiveCall } from '../callStore';
import { CallPanelPart } from '../CallPanelPart';
import { useCallViewFloats, useExpandCallWindow } from './callWindowState';
import { FloatingCallWindow } from './FloatingCallWindow';

// The call view's code loads on first use; the window shows that it comes rather than an empty box.
const loadingCallView = (
  <Box grow="Yes" alignItems="Center" justifyContent="Center" data-call-window-loading="">
    <Spinner size="400" variant="Secondary" />
  </Box>
);

type FloatingCallProps = { room: Room; onClose: () => void; frameRef: RefObject<HTMLElement> };

/** The call view of `room` in the floating window, with the room's power levels it reads. */
function FloatingCall({ room, onClose, frameRef }: FloatingCallProps) {
  const powerLevels = usePowerLevels(room);
  return (
    <FloatingCallWindow frameRef={frameRef}>
      <PowerLevelsContextProvider value={powerLevels}>
        <Suspense fallback={loadingCallView}>
          <CallPanelPart room={room} onClose={onClose} />
        </Suspense>
      </PowerLevelsContextProvider>
    </FloatingCallWindow>
  );
}

/**
 * Where the focus goes when the window closes and takes the focus with it (it was on End, or on
 * Close): the call button of the room on the page, which opens the call view again, else the page
 * itself, where the skip link lands.
 */
const focusAfterCall = (doc: Document) => {
  const callButtons = Array.from(doc.querySelectorAll<HTMLElement>('[data-room-call-button]'));
  const callButton = callButtons.find((button) => !button.closest('[inert]'));
  (callButton ?? mainContentFocusTarget(doc))?.focus();
};

/** Memberships that take the person out of a room. */
const GONE: ReadonlySet<string> = new Set([KnownMembership.Leave, KnownMembership.Ban]);

/**
 * The open call view (`callPanelRoomAtom`) leaves with its room: when the client forgets the room,
 * or the person leaves it or is banned from it.
 */
const useCloseWithRoom = () => {
  const mx = useMatrixClient();
  const setPanelRoomId = useSetAtom(callPanelRoomAtom);
  useEffect(() => {
    const close = (roomId: string) =>
      setPanelRoomId((current) => (current === roomId ? undefined : current));
    const onMembership = (room: Room, membership: string) => {
      if (GONE.has(membership)) close(room.roomId);
    };
    mx.on(ClientEvent.DeleteRoom, close);
    mx.on(RoomEvent.MyMembership, onMembership);
    return () => {
      mx.off(ClientEvent.DeleteRoom, close);
      mx.off(RoomEvent.MyMembership, onMembership);
    };
  }, [mx, setPanelRoomId]);
};

/**
 * The floating call window on desktop: the open call view over every page, whatever the route,
 * unless the person docked it into the room's side panel. Phones show it in the room's side
 * panel, and a room this client does not know shows none. It follows only the account's mode, so
 * the call view does not render again when the window moves or resizes.
 */
export function CallWindowHost() {
  const mx = useMatrixClient();
  const expand = useExpandCallWindow();
  const [panelRoomId, setPanelRoomId] = useAtom(callPanelRoomAtom);
  const active = useActiveCall();
  const room = panelRoomId ? mx.getRoom(panelRoomId) : null;
  const floats = useCallViewFloats() && !!room;
  useCloseWithRoom();

  // A call view shows the call rather than the bar it was minimized to when it opens (from none,
  // or another room's) and when a call starts in it (a ring answered in a room whose view stayed
  // open on the call to join); before the first paint, so the bar does not flash. When the call
  // it shows ends here (left, or dismissed after it failed), the window closes: over every page,
  // the room's call to join again would stay in the way. The side panel stays on it in its room.
  // The focus the closing window had (or the End button that went with the call before it) goes
  // to the page rather than to nothing, as it does when the window closes with the call going on
  // (Close); focus the person put on the page stays there. An agent call's view closes with its
  // call in the call store, so the window may be gone already. Dock hands the focus on itself.
  const frameRef = useRef<HTMLElement>(null);
  const seen = useRef({ panelRoomId, active, floats });
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { panelRoomId, active, floats };
    const callGone = !!before.active && active !== before.active;
    if (before.floats && before.panelRoomId) {
      const endedHere = callGone && isActiveCallShownIn(before.active, before.panelRoomId);
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || frameRef.current?.contains(focused);
      if (lost && (endedHere || !panelRoomId)) focusAfterCall(document);
    }
    if (!floats || !panelRoomId) return;
    const ended = callGone && isActiveCallShownIn(before.active, panelRoomId);
    if (ended) {
      setPanelRoomId((current) => (current === panelRoomId ? undefined : current));
      return;
    }
    const opened = panelRoomId !== before.panelRoomId;
    const started =
      !!active && active !== before.active && isActiveCallShownIn(active, panelRoomId);
    if (opened || started) expand();
  }, [active, expand, floats, panelRoomId, setPanelRoomId]);

  const close = useCallback(() => setPanelRoomId(undefined), [setPanelRoomId]);
  if (!floats || !room) return null;
  return <FloatingCall key={room.roomId} room={room} onClose={close} frameRef={frameRef} />;
}
