import { type CSSProperties, type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, Text, color, config } from 'folds';
import { ThreadApprovalQueue } from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { BackgroundJobsBar } from '../background-jobs/BackgroundJobsBar';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { FailedSendActions } from '../messages/FailedSendActions';
import { RoomViewFollowing } from '../timeline/RoomViewFollowing';
import { RoomViewTyping } from '../timeline/typing/RoomViewTyping';
import { SurfaceProvider } from '../ui/glass/SurfaceContext';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { RoomTombstone } from './RoomTombstone';
import * as css from './RoomView.css';

// The box is the positioning box of the floating header, dock and footer.
const AREA_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
};
// Collapsed (the room under its thread filling the page), it takes no room in its row.
const COLLAPSED_STYLE: CSSProperties = {
  ...AREA_STYLE,
  flex: '0 0 0',
  contentVisibility: 'hidden',
};
const TIMELINE_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };
// Groups what a plugin's cover hides, without a box of its own in the layout.
const CONVERSATION_STYLE: CSSProperties = { display: 'contents' };
// Background jobs and approvals float just above the composer.
const DOCK_STYLE: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  bottom: 'var(--room-composer-height, 0px)',
  zIndex: 5,
  pointerEvents: 'none',
};
const DOCK_CONTENT_STYLE: CSSProperties = { pointerEvents: 'auto' };
// Where the composer would be: why it is not there; or above it, what to do about the unsent root.
const NOTICE_GAP = config.space.S400;
const NOTICE_STYLE: CSSProperties = {
  background: color.SurfaceVariant.Container,
  margin: `0 ${NOTICE_GAP} ${NOTICE_GAP}`,
  color: color.SurfaceVariant.OnContainer,
  padding: `${config.space.S300} ${NOTICE_GAP}`,
  borderRadius: config.radii.R400,
};

/**
 * Keeps the heights of the floating header and footer on the box, where the scroll areas read
 * them (`--room-header-height`, `--room-footer-height`) to pad their content clear of both. The
 * parts mount anew with each `parts` key (another thread, a header that comes or goes), so they
 * are measured again whenever it changes.
 */
const useOverlayInsets = (
  areaRef: RefObject<HTMLElement>,
  headerRef: RefObject<HTMLElement>,
  footerRef: RefObject<HTMLElement>,
  dockRef: RefObject<HTMLElement>,
  parts: string
) => {
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const header = headerRef.current?.offsetHeight ?? 0;
      const composer = footerRef.current?.offsetHeight ?? 0;
      const dock = dockRef.current?.offsetHeight ?? 0;
      area.style.setProperty('--room-header-height', `${header}px`);
      area.style.setProperty('--room-composer-height', `${composer}px`);
      area.style.setProperty('--room-footer-height', `${composer + dock}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [headerRef, footerRef, dockRef].forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });
    return () => observer.disconnect();
  }, [areaRef, dockRef, footerRef, headerRef, parts]);
};

/**
 * Where the composer would be, why it is not there: an upgraded room or no permission to post;
 * or above it, the Retry and Delete of a thread's root that did not send.
 */
export function ComposerNotice({
  room,
  failedRoot,
  tombstone,
  canMessage,
}: {
  room: Room;
  failedRoot?: MatrixEvent;
  tombstone?: MatrixEvent;
  canMessage: boolean;
}) {
  const { t } = useTranslation();
  if (failedRoot) return <FailedSendActions room={room} event={failedRoot} style={NOTICE_STYLE} />;
  if (tombstone) return <RoomTombstone tombstone={tombstone} style={NOTICE_STYLE} />;
  if (canMessage) return null;
  return (
    <Box justifyContent="Center" style={NOTICE_STYLE}>
      <Text size="T300" priority="300">
        {t('mindroomUi.threads.mindroomRoomView.youDoNotHavePermissionToPostInThisRoom')}
      </Text>
    </Box>
  );
}

export type ConversationLayoutProps = {
  room: Room;
  /** The thread it shows; none for the room's own messages. */
  threadId?: string;
  /** The box: positions the header, dock and footer, measures their insets, takes `useInert`. */
  areaRef: RefObject<HTMLDivElement>;
  /** The floating header's contents, given the header's element (for the plugins' slot). */
  header?: (headerRef: RefObject<HTMLDivElement>) => ReactNode;
  timeline: ReactNode;
  focusConversation: () => void;
  canCancelJobs: boolean;
  notice?: ReactNode;
  composer?: ReactNode;
  /** Takes no room in its row and shows only `children` (the room under a filling thread). */
  collapsed?: boolean;
  /** The element a plugin's cover hides: timeline, dock and footer. */
  conversationRef?: RefObject<HTMLDivElement>;
  /** Layers over the conversation, under the header: the plugin cover. */
  children?: ReactNode;
};

/**
 * One conversation, the room's own messages or a thread, as the room page shows it: the timeline
 * under a floating header (when it has one) and a floating footer with the typing notice, the
 * composer (or why there is none) and read receipts, with background jobs and the thread's
 * approvals above the composer. The room area and the thread view (`ThreadView`) both draw
 * through it, so a thread looks the same wherever it shows.
 */
export function ConversationLayout({
  room,
  threadId,
  areaRef,
  header,
  timeline,
  focusConversation,
  canCancelJobs,
  notice,
  composer,
  collapsed = false,
  conversationRef,
  children,
}: ConversationLayoutProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const shownHeader = !collapsed && header;
  useOverlayInsets(
    areaRef,
    headerRef,
    footerRef,
    dockRef,
    `${threadId ?? ''}|${collapsed}|${!!shownHeader}`
  );

  return (
    <div ref={areaRef} className={css.RoomArea} style={collapsed ? COLLAPSED_STYLE : AREA_STYLE}>
      {shownHeader && (
        // The element draws the header's surface; the row inside shows it and paints none.
        <div
          ref={headerRef}
          data-glass-flat="true"
          className={classNames(
            overlay.Header,
            css.HeaderInShortArea,
            threadId && overlay.HeaderInThread
          )}
        >
          <SurfaceProvider value>{shownHeader(headerRef)}</SurfaceProvider>
        </div>
      )}
      {!collapsed && (
        <div ref={conversationRef} style={CONVERSATION_STYLE}>
          <ThreadApprovalProvider
            room={room}
            // A message not yet on the server has no approvals, and no relations to ask for.
            threadId={isConfirmedMatrixEventId(threadId) ? threadId : undefined}
            focusConversation={focusConversation}
          >
            <Box grow="Yes" direction="Column" style={TIMELINE_STYLE}>
              {timeline}
            </Box>
            <div ref={dockRef} style={DOCK_STYLE}>
              <div style={DOCK_CONTENT_STYLE}>
                <BackgroundJobsBar
                  room={room}
                  threadId={threadId ?? null}
                  canCancel={canCancelJobs}
                />
                {threadId && <ThreadApprovalQueue />}
              </div>
            </div>
          </ThreadApprovalProvider>
          {/* Outside the approval provider: opening a thread must not remount the composer. */}
          <div ref={footerRef} className={overlay.Footer} data-room-footer="true">
            <RoomViewTyping room={room} threadId={threadId} />
            {notice}
            {composer}
            <RoomViewFollowing room={room} threadId={threadId} />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
