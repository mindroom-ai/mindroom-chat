import { RefCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAccountData } from '../../../hooks/useAccountData';
import { useCanvasesSelected } from '../../../hooks/router/useCanvasesSelected';
import { createSessionId } from '../../../state/sessions';
import { hasCanvases, subscribeCanvasList } from '../../../mindroom/canvas/canvasIndexStore';
import { PINNED_CANVASES_TYPE, readPinnedCanvases } from '../../../mindroom/canvas/pinnedCanvases';
import { getCanvasesPath } from '../../pathUtils';

/** Settles bursts of list writes (an agent sharing several panels) into one read. */
const LIST_CHANGE_DELAY_MS = 100;

/** The last answer per session, so a remounted sidebar shows the tab without waiting. */
const lastHasCanvases = new Map<string, boolean>();

const useSessionHasCanvases = (sessionId: string): boolean => {
  const [listed, setListed] = useState(() => lastHasCanvases.get(sessionId) ?? false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      hasCanvases(sessionId)
        .then((value) => {
          lastHasCanvases.set(sessionId, value);
          if (!cancelled) setListed(value);
        })
        .catch(() => undefined);
    };
    read();
    const unsubscribe = subscribeCanvasList(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, LIST_CHANGE_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [sessionId]);

  return listed;
};

/** The Canvases button of the icon rail, shown once there is a canvas to list. */
export function CanvasesTab() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const active = useCanvasesSelected();
  const { t } = useTranslation();
  const listed = useSessionHasCanvases(createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()));
  const pinEvent = useAccountData(PINNED_CANVASES_TYPE);
  const pinned = useMemo(() => readPinnedCanvases(pinEvent?.getContent()).length > 0, [pinEvent]);
  const label = t('mindroomUi.canvases.title');

  // Stays visible while the Canvases page is open, even after its last canvas went away.
  const visible = listed || pinned || active;
  if (!visible) return null;

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar
      ref={tooltipAnchor}
      as="button"
      aria-label={label}
      outlined
      onClick={() => navigate(getCanvasesPath())}
    >
      <Icon filled={active} src={Icons.Category} />
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={active}>
      <SidebarItemTooltip tooltip={label}>{renderButton}</SidebarItemTooltip>
    </SidebarItem>
  );
}
