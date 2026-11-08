import { Suspense, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { ClientEvent, KnownMembership, RoomEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { revealDirectionControls } from '../../ui/directional';
import { callPanelRoomAtom, isActiveCallShownIn, useActiveCall } from '../callStore';
import { CallPanelPart } from '../CallPanelPart';
import { useCallViewFloats, useExpandCallWindow } from './callWindowState';
import { FloatingCallWindow } from './FloatingCallWindow';

/** The call view of `room` in the floating window, with the room's power levels it reads. */
function FloatingCall({ room, onClose }: { room: Room; onClose: () => void }) {
  const powerLevels = usePowerLevels(room);
  const label = revealDirectionControls(useRoomName(room));
  return (
    <FloatingCallWindow label={label}>
      <PowerLevelsContextProvider value={powerLevels}>
        <Suspense fallback={null}>
          <CallPanelPart room={room} onClose={onClose} />
        </Suspense>
      </PowerLevelsContextProvider>
    </FloatingCallWindow>
  );
}

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
  const seen = useRef({ panelRoomId, active });
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { panelRoomId, active };
    if (!floats || !panelRoomId) return;
    const ended =
      !!before.active &&
      active !== before.active &&
      isActiveCallShownIn(before.active, panelRoomId);
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
  return <FloatingCall key={room.roomId} room={room} onClose={close} />;
}
