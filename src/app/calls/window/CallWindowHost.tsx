import { Suspense, useCallback, useLayoutEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { PowerLevelsContextProvider, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { revealDirectionControls } from '../../ui/directional';
import { callPanelRoomAtom } from '../callStore';
import { CallPanelPart } from '../CallPanelPart';
import { isBar } from './callWindowGeometry';
import { expandedSettings, useCallWindowSettings } from './callWindowState';
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

/**
 * The floating call window on desktop: the open call view (`callPanelRoomAtom`) over every page,
 * whatever the route, unless the person docked it into the room's side panel. Phones show it in
 * the room's side panel, and a room this client no longer knows shows none.
 */
export function CallWindowHost() {
  const mx = useMatrixClient();
  const desktop = useScreenSizeContext() !== ScreenSize.Mobile;
  const [settings, setSettings] = useCallWindowSettings();
  const [panelRoomId, setPanelRoomId] = useAtom(callPanelRoomAtom);
  const room = panelRoomId ? mx.getRoom(panelRoomId) : null;
  const floats = desktop && settings.mode === 'floating' && !!room;

  // A call view that opens (from none, or another room's) shows the call, not the bar it was
  // minimized to; before the first paint, so the bar never shows.
  const shownRoomId = useRef(panelRoomId);
  useLayoutEffect(() => {
    const before = shownRoomId.current;
    shownRoomId.current = panelRoomId;
    if (!floats || panelRoomId === before || !settings.rect || !isBar(settings.rect)) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setSettings(expandedSettings(settings, settings.rect, viewport));
  }, [floats, panelRoomId, setSettings, settings]);

  const close = useCallback(() => setPanelRoomId(undefined), [setPanelRoomId]);
  if (!floats || !room) return null;
  return <FloatingCall key={room.roomId} room={room} onClose={close} />;
}
