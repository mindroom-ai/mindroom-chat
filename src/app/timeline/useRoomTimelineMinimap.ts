import { useTranslation } from 'react-i18next';
import { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { useTimelineMinimapInView } from './TimelineMinimap';
import { TimelineMinimapItem, deriveTimelineMinimapItems } from './timelineMinimapViewModel';
import type { OpenRoomEventHandler } from './roomEventOpenController';

type RoomTimelineMinimapOptions = {
  threadEvents: readonly MatrixEvent[];
  scrollRef: RefObject<HTMLElement>;
  handleOpenEvent: OpenRoomEventHandler;
};

export const useRoomTimelineMinimap = ({
  threadEvents,
  scrollRef,
  handleOpenEvent,
}: RoomTimelineMinimapOptions) => {
  const { t } = useTranslation();
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  // Fine-pointer only (like the reference implementation): touch devices
  // never see the minimap, so skip deriving items and tracking scroll there.
  const hasThreadEvents = threadEvents.length > 0;
  const [minimapPointerFine, setMinimapPointerFine] = useState(false);
  useEffect(() => {
    if (!hasThreadEvents || typeof window === 'undefined') return undefined;
    const queryList = window.matchMedia?.('(pointer: fine)');
    if (!queryList) return undefined;
    const handleChange = () => setMinimapPointerFine(queryList.matches);
    handleChange();
    queryList.addEventListener('change', handleChange);
    return () => queryList.removeEventListener('change', handleChange);
  }, [hasThreadEvents]);
  const minimapEnabled = hasThreadEvents && minimapPointerFine;
  const minimapItems = useMemo(
    () => (minimapEnabled ? deriveTimelineMinimapItems(threadEvents, t) : []),
    [minimapEnabled, threadEvents, t]
  );
  useTimelineMinimapInView(scrollRef, minimapItems, minimapStripMap, minimapEnabled);
  const handleMinimapSelect = useCallback(
    (item: TimelineMinimapItem) => {
      void handleOpenEvent(item.id, false);
    },
    [handleOpenEvent]
  );

  return { minimapStripMap, minimapItems, handleMinimapSelect };
};
