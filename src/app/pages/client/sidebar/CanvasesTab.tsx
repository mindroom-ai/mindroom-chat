import React, { useEffect, useMemo, useState } from 'react';
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



  const selected = useCanvasesSelected();
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const listed = useSessionHasCanvases(sessionId);
  const pinEvent = useAccountData(PINNED_CANVASES_TYPE);
  const pinned = useMemo(() => readPinnedCanvases(pinEvent?.getContent()).length > 0, [pinEvent]);

  if (!listed && !pinned && !selected) return null;

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('mindroomUi.canvases.title')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('mindroomUi.canvases.title')}
            onClick={() => navigate(getCanvasesPath())}
          >
            <Icon src={Icons.Category} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
