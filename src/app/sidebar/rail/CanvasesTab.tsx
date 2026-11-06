import { RefCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../ui/sidebar/SidebarItem';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAccountData } from '../../matrix/hooks/useAccountData';
import { useCanvasesSelected } from '../../routes/useCanvasesSelected';
import { createSessionId } from '../../matrix/session/sessions';
import { hasCanvases, subscribeCanvasList } from '../../canvas/canvasIndexStore';
import { PINNED_CANVASES_TYPE, readPinnedCanvases } from '../../canvas/pinnedCanvases';
import { getCanvasesPath } from '../../routes/pathUtils';

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

/** Whether the account has a canvas to list: one in this session's index, or a pinned one. */
export function useHasCanvases(): boolean {
  const mx = useMatrixClient();
  const listed = useSessionHasCanvases(createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()));
  const pinEvent = useAccountData(PINNED_CANVASES_TYPE);
  const pinned = useMemo(() => readPinnedCanvases(pinEvent?.getContent()).length > 0, [pinEvent]);
  return listed || pinned;
}

/** The Canvases button of the icon rail, shown once there is a canvas to list. */
export function CanvasesTab() {
  const navigate = useNavigate();
  const active = useCanvasesSelected();
  const { t } = useTranslation();
  const hasCanvases = useHasCanvases();
  const label = t('mindroomUi.canvases.title');

  // Stays visible while the Canvases page is open, even after its last canvas went away.
  const visible = hasCanvases || active;
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
