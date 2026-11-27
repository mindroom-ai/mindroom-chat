import React, {
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RectCords } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { LazyCallRow } from '../../calls/transcription/LazyCallRow';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { MessageRowBoundary } from '../../messages/content/MessageRowBoundary';
import { SecondThreadContext, setThreadDragData } from '../../navigation/secondThread';
import { useSnoozeNow } from '../tags/useSnoozeNow';
import { useInitializeShownThread } from '../useInitializeShownThread';
import { CompactCardSwipe } from './CompactCardSwipe';
import * as css from './CompactRoomView.css';
import { CompactThreadCard } from './CompactThreadCard';
import { CompactCardActions } from './CompactThreadCardChrome';
import { ThreadCardBadges } from './ThreadCardBadges';
import { useThreadRootLiveCallRow } from './useThreadRootLiveCallRow';

export type ThreadActionsMenuState = {
  roomId: string;
  rootId: string;
  anchor: RectCords;
  trigger?: HTMLElement;
  viewModel: CompactThreadCardViewModel;
  initialDialog?: 'snooze';
};

export type CompactCardRowActionsInput = {
  rootId: string;
  isResolved: boolean;
  pinned: boolean;
  canToggle: boolean;
  canPin: boolean;
  resolving: boolean;
  pinning: boolean;
  menuOpen: boolean;
};

export type CompactCardRowActions = {
  showResolveAction: boolean;
  showPinAction: boolean;
  swipeEnabled: boolean;
  actionsDisabled: boolean;
};

/** Computes hover-button visibility, swipe eligibility, and disabled state for a compact card row. */
export const getCompactCardRowActions = ({
  rootId,
  isResolved,
  pinned,
  canToggle,
  canPin,
  resolving,
  pinning,
  menuOpen,
}: CompactCardRowActionsInput): CompactCardRowActions => {
  const confirmed = isConfirmedMatrixEventId(rootId);
  const showResolveAction = canToggle && !isResolved && !pinned && confirmed;
  const showPinAction = canPin && confirmed;
  const swipeEnabled = canToggle && !menuOpen && !pinned && confirmed && !resolving;
  const actionsDisabled = (showResolveAction || showPinAction) && (pinning || resolving);
  return { showResolveAction, showPinAction, swipeEnabled, actionsDisabled };
};

export type CompactThreadCardRowProps = {
  room: Room;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  viewModel: CompactThreadCardViewModel;
  roomName?: string;
  leadingBadges?: ReactNode;
  pinned: boolean;
  showResolveAction: boolean;
  showPinAction: boolean;
  actionsDisabled: boolean;
  swipeEnabled: boolean;
  menuOpen: boolean;
  resolveLabel: string;
  reopenLabel: string;
  snoozeLabel: string;
  unsnoozeLabel: string;
  onThreadClick: (threadRootId: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onUnsnooze: (threadRootId: string) => void;
  onPin: (threadRootId: string, pinned: boolean) => void;
  onOpenMenu: (menu: ThreadActionsMenuState) => void;
};

export const CompactThreadCardRow = React.memo(
  ({
    room,
    scrollRootRef,
    viewModel,
    roomName,
    leadingBadges,
    pinned,
    showResolveAction,
    showPinAction,
    actionsDisabled,
    swipeEnabled,
    menuOpen,
    resolveLabel,
    reopenLabel,
    snoozeLabel,
    unsnoozeLabel,
    onThreadClick,
    onSetResolved,
    onUnsnooze,
    onPin,
    onOpenMenu,
  }: CompactThreadCardRowProps) => {
    const { roomId } = room;
    const rootId = viewModel.id.threadRootId;
    const shownRef = useInitializeShownThread(roomId, rootId, scrollRootRef);
    const shellRef = useRef<HTMLDivElement>(null);
    const setShellRef = useCallback(
      (node: HTMLDivElement | null) => {
        shellRef.current = node;
        if (typeof shownRef === 'function') shownRef(node);
      },
      [shownRef]
    );
    const snoozeNow = useSnoozeNow([viewModel.snoozedUntilTs]);
    const snoozed = !viewModel.isResolved && isSnoozedAt(viewModel.snoozedUntilTs, snoozeNow);
    // A live call's row shows in its card as in the timeline: who is in the call, Join and
    // Transcript. Once the call ends the card is a thread like any other.
    const callRow = useThreadRootLiveCallRow(room, rootId);
    // Client plugins' marks for the thread, one node per thread so the memoized card does not
    // render again for them. A thread whose first message is still sending has none until the
    // server has confirmed it, so a badge is only ever given the root's own ID.
    const badges = useMemo(() => {
      const confirmed = isConfirmedMatrixEventId(rootId);
      if (!leadingBadges && !confirmed) return undefined;
      if (!leadingBadges) return <ThreadCardBadges room={room} threadId={rootId} />;
      return (
        <>
          {leadingBadges}
          {confirmed && <ThreadCardBadges room={room} threadId={rootId} />}
        </>
      );
    }, [leadingBadges, room, rootId]);

    const handleSnooze = (wasSnoozed: boolean) => {
      if (wasSnoozed) {
        onUnsnooze(rootId);
        return;
      }
      const shell = shellRef.current;
      onOpenMenu({
        roomId,
        rootId,
        viewModel,
        anchor: shell?.getBoundingClientRect?.() ?? { x: 0, y: 0, width: 0, height: 0 },
        trigger: shell?.querySelector?.<HTMLButtonElement>('[data-thread-root-id]') ?? undefined,
        initialDialog: 'snooze',
      });
    };

    const openMenuAt = (x: number, y: number, shell: HTMLElement) => {
      onOpenMenu({
        roomId,
        rootId,
        viewModel,
        anchor: { x, y, width: 0, height: 0 },
        trigger: shell.querySelector<HTMLButtonElement>('[data-thread-root-id]') ?? undefined,
      });
    };
    const longPress = useLongPress(openMenuAt, (evt) =>
      evt.currentTarget.contains(evt.target as Node)
    );
    // A card the room page could show in its second column drags there, pressed with a mouse (a
    // finger or a pen keeps its swipe and long press). A plain click still opens it: a drag needs
    // the mouse to move.
    const offered = !!useContext(SecondThreadContext)?.offers(roomId, rootId);
    const [mousePressed, setMousePressed] = useState(false);
    const draggable = offered && mousePressed;

    return (
      <div
        {...longPress}
        ref={setShellRef}
        className={css.CardShell}
        data-room-id={roomId}
        data-scroll-anchor={rootId}
        // The phone slide can keep just this shell outside the list's clip. Card adornments
        // stay by the row, and popovers that can escape it render in the portal instead.
        data-page-slide-row=""
        draggable={draggable || undefined}
        onPointerDown={
          offered ? (event) => setMousePressed(event.pointerType === 'mouse') : undefined
        }
        onDragStart={(event) => {
          // A drag of something in the card (an avatar) stays its own.
          if (event.target !== event.currentTarget) return;
          if (draggable) setThreadDragData(event.dataTransfer, { roomId, rootId });
          else if (offered) event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenuAt(event.clientX, event.clientY, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            roomId,
            rootId,
            viewModel,
            anchor: event.currentTarget.getBoundingClientRect(),
            trigger: event.target as HTMLElement,
          });
        }}
      >
        {/* What moves when the list changes (`useListMotion`): the element around it stays put,
            so the scroll position is measured on a card at rest. */}
        <div className={css.CardMotion} data-motion-row={rootId}>
          <CompactCardSwipe
            enabled={swipeEnabled}
            resolved={viewModel.isResolved}
            label={viewModel.isResolved ? reopenLabel : resolveLabel}
            snoozed={snoozed}
            snoozeLabel={snoozed ? unsnoozeLabel : snoozeLabel}
            onSwipe={(wasResolved) => onSetResolved(rootId, !wasResolved)}
            onSnooze={viewModel.isResolved ? undefined : handleSnooze}
          >
            <MessageRowBoundary
              render={() => (
                <CompactThreadCard
                  viewModel={viewModel}
                  onClick={onThreadClick}
                  attachment={callRow && <LazyCallRow {...callRow} />}
                  badges={badges}
                  room={room}
                  roomName={roomName}
                />
              )}
            />
            <CompactCardActions
              pinned={pinned}
              showResolveAction={showResolveAction}
              showPinAction={showPinAction}
              actionsDisabled={actionsDisabled}
              menuOpen={menuOpen}
              onResolve={() => onSetResolved(rootId, true)}
              onPin={() => onPin(rootId, pinned)}
              onOpenMenu={(event) =>
                onOpenMenu({
                  roomId,
                  rootId,
                  viewModel,
                  anchor: event.currentTarget.getBoundingClientRect(),
                  trigger: event.currentTarget,
                })
              }
            />
          </CompactCardSwipe>
        </div>
      </div>
    );
  }
);
