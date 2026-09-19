import { useTranslation } from 'react-i18next';
import React, {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { color, config } from 'folds';
import type { IContent } from 'matrix-js-sdk';
import { useExpandLongMessagesByDefault } from '../../settings/useMindroomAccountSettings';
import {
  CollapsibleMessageStateProvider,
  collapseAllMessages,
  expandAllMessages,
} from '../CollapsibleMessage';
import { useTimelineBulkExpansionAnchor } from '../useTimelineBulkExpansionAnchor';
import { consumeLiveExpandOnceId, getCollapsibleMessageMode } from '../threadCollapsibleMessages';

export const useTimelineMessageExpansion = (
  roomId: string,
  threadId: string | undefined,
  scrollRef: RefObject<HTMLDivElement>
) => {
  const { t } = useTranslation();
  const expandLongMessagesByDefault = useExpandLongMessagesByDefault();
  // The owning timeline is keyed by room:thread; manual choices reset on remount.
  const [expandAllOverride, setExpandAllOverride] = useState<boolean>();
  const expandAll = expandAllOverride ?? expandLongMessagesByDefault;
  const manualExpansionState = useRef(new Map<string, boolean>());
  const liveExpandOnceIds = useRef(new Set<string>());
  const restoreBulkExpansionAnchor = useTimelineBulkExpansionAnchor(expandAll, scrollRef);
  useEffect(() => {
    liveExpandOnceIds.current.clear();
  }, [roomId, threadId]);

  const markLiveExpansionCandidate = useCallback((eventId: string) => {
    liveExpandOnceIds.current.add(eventId);
  }, []);
  const getExpansion = (eventId: string, content: IContent) => {
    const collapseMode = getCollapsibleMessageMode(eventId, content, liveExpandOnceIds.current);
    return {
      collapseMode,
      onInitialExpandConsumed:
        collapseMode === 'initially-expanded'
          ? () => {
              consumeLiveExpandOnceId(liveExpandOnceIds.current, eventId);
            }
          : undefined,
    } as const;
  };
  const wrapExpansion = (children: ReactNode, deferOverflowMeasurement = false) => (
    <CollapsibleMessageStateProvider
      expandAllInit={expandAll}
      manualExpansionState={manualExpansionState.current}
      onExpansionLayoutChange={restoreBulkExpansionAnchor}
      deferOverflowMeasurement={deferOverflowMeasurement}
    >
      {children}
    </CollapsibleMessageStateProvider>
  );
  const expansionControl = (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        manualExpansionState.current.clear();
        if (expandAll) {
          collapseAllMessages();
          setExpandAllOverride(false);
        } else {
          expandAllMessages();
          setExpandAllOverride(true);
        }
      }}
      style={{
        position: 'absolute',
        top: config.space.S200,
        right: config.space.S400,
        zIndex: 2,
        color: color.Primary.Main,
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontFamily: 'var(--font-mono)',
        opacity: 0.7,
        background: 'none',
        border: 'none',
        padding: 0,
      }}
    >
      {expandAll
        ? t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all')
        : t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all2')}
    </button>
  );
  return { markLiveExpansionCandidate, getExpansion, wrapExpansion, expansionControl };
};
