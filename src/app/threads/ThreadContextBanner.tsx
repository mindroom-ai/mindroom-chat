import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent, IconClock } from '@tabler/icons-react';
import { Room } from 'matrix-js-sdk';
import { type Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import * as threadIndicatorCss from '../messages/ThreadIndicator.css';
import { useThreadHeaderInfo } from './useThreadHeaderInfo';
import { useSnoozedUntilText } from './tags/useSnoozedUntilText';
import { buildThreadHeaderViewModelFromRecord } from './threadHeaderViewModel';
import { buildThreadRecord } from '../event-store/threads/threadRecord';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useCachedThreadRoot } from '../event-store/sdk/cachedThreadRoots';
import { useThreadTags } from './tags/useThreadTags';
import { useMutateThreadTags } from './tags/useMutateThreadTags';
import { ThreadTagPill } from './tags/ThreadTagPill';
import { ThreadTagPicker } from './tags/ThreadTagPicker';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { getThreadResolverDisplayName } from './threadResolutionAttribution';
import * as css from './ThreadContextBanner.css';
import * as toolbarCss from '../messages/styles.css';
import { IconTooltip } from '../ui/IconTooltip';
import { ThreadApprovalPermissions } from '../approvals/ThreadApprovalControls';
import { AutoApproveChip } from '../approvals/auto-approve/AutoApproveChip';
import { useThreadPinning } from '../event-store/threads/useThreadPinning';
import { useLiquidGlass } from '../ui/glass/liquid/useLiquidGlass';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
import { focusedCompactCard } from './overview/compactCardKeys';
import { useShortcut } from '../shortcuts/useShortcut';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { PhoneBackButton } from '../ui/page/PhoneBackButton';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { ownDirectionBlock, ownDirectionLine, revealDirectionControls } from '../ui/directional';
import { getThreadRootTitle, ThreadRootTitle } from './ThreadRootTitle';
import { InlineThreadTitleEditor } from './InlineThreadTitleEditor';
import { ThreadHeaderSlot } from './ThreadHeaderSlot';

const ThreadActionsMenu = lazy(() =>
  import('./ThreadActionsMenu').then((module) => ({ default: module.ThreadActionsMenu }))
);

type BannerMenuState = {
  roomId: string;
  threadId: string;
  rootId: string;
  anchor: RectCords;
  trigger: HTMLElement;
};

export interface ThreadContextBannerProps {
  room: Room;
  threadId: string;
  summaryInfo?: ThreadSummaryInfo;
  onExitThread: () => void;
  /** Takes the thread's column beside the room's messages from filling the page (More menu). */
  onShowBeside?: () => void;
  /** Fills the room page with the thread's column (More menu). */
  onShowFull?: () => void;
  /** Given, the banner starts with a Close button in place of Back (a second thread's view). */
  onClose?: () => void;
  /** Given, the banner draws as the rows of a phone's room header instead of its card. */
  phoneHeader?: PhoneThreadHeader;
}

/** What a phone's room header gives the thread that fills its page, whose rows it shows. */
export type PhoneThreadHeader = {
  /** The room's name, which leads back to the room as the chevron before it does. */
  roomName: string;
  /** The header's own row buttons (the call buttons), which follow Resolve. */
  actions?: ReactNode;
  /** Opens the room's menu where the thread's menu was; that menu offers it. */
  onRoomMenu: (anchor: RectCords) => void;
  /** Drawn on More while the room's menu holds what a button of its own would mark. */
  menuBadge?: ReactNode;
};

const DESKTOP_MAX_PILLS = 3;
const MOBILE_MAX_PILLS = 2;
/** Whether a phone's header shows the tags in a row under the title; put away, More edits them. */
const PHONE_HEADER_TAGS = false;

function TagPills({
  tags,
  maxPills,
  allTags,
  canEdit,
  onRemove,
}: {
  tags: string[];
  maxPills: number;
  allTags: string[];
  canEdit: boolean;
  onRemove: (name: string) => void;
}) {
  const visible = tags.slice(0, maxPills);
  const overflowCount = tags.length - visible.length;

  return (
    <>
      {visible.map((tag) => (
        <ThreadTagPill key={tag} name={tag} onRemove={canEdit ? () => onRemove(tag) : undefined} />
      ))}
      {overflowCount > 0 && (
        <span className={css.OverflowChip} title={allTags.slice(maxPills).join(', ')}>
          +{overflowCount}
        </span>
      )}
    </>
  );
}

export function ThreadContextBanner({
  room,
  threadId,
  summaryInfo,
  onExitThread,
  onShowBeside,
  onShowFull,
  onClose,
  phoneHeader,
}: ThreadContextBannerProps) {
  const { t, i18n } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const bannerRef = useRef<HTMLDivElement>(null);
  // The header's rows are its flat chrome: no glass card, and nothing to fold away.
  const glassRef = useLiquidGlass<HTMLDivElement>(bannerRef, !phoneHeader);
  const [bannerCollapsed, setCollapsed] = useSetting(settingsAtom, 'threadBannerCollapsed');
  const collapsed = bannerCollapsed && !phoneHeader;
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, cronDescription, scheduledDisplayText } =
    useThreadHeaderInfo(room, threadId);
  const { tags, isResolved, canEdit, availableTags } = useThreadTags(room, rootEventId);
  const { addTag, removeTag, setResolved, unsnooze, updating, error } = useMutateThreadTags(room);
  const threadRootId = rootEventId ?? threadId;
  const canOpenMenu = isConfirmedMatrixEventId(threadRootId);
  const [menu, setMenu] = useState<BannerMenuState>();
  const menuRef = useRef<BannerMenuState>();
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const openMenu = (anchor: RectCords, trigger: HTMLElement) => {
    if (!canOpenMenu) return;
    const nextMenu = { roomId: room.roomId, threadId, rootId: threadRootId, anchor, trigger };
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  };
  const closeMenu = (selectedMenu: BannerMenuState) => {
    if (menuRef.current !== selectedMenu) return;
    menuRef.current = undefined;
    setMenu(undefined);
    const trigger = selectedMenu.trigger.isConnected ? selectedMenu.trigger : moreButtonRef.current;
    // Focusing inside the sticky banner would otherwise scroll the thread to
    // the banner's place in the flow, its first message.
    trigger?.focus({ preventScroll: true });
  };
  // The button that toggled the banner unmounts with it, so focus moves to the
  // control that toggles it back: Show details, or More, which offers Hide
  // (or the banner while More waits for the thread root to be confirmed).
  const showDetailsRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterToggle = useRef(false);
  const toggleCollapsed = (next: boolean) => {
    focusAfterToggle.current = true;
    setCollapsed(next);
  };
  useLayoutEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    const target = (collapsed ? showDetailsRef : moreButtonRef).current;
    (target && !target.disabled ? target : bannerRef.current)?.focus({ preventScroll: true });
  }, [collapsed]);
  useLayoutEffect(() => {
    menuRef.current = undefined;
    setMenu(undefined);
    return () => {
      menuRef.current = undefined;
    };
  }, [room.roomId, threadId, threadRootId]);
  const activeMenu =
    menu?.roomId === room.roomId && menu.threadId === threadId && menu.rootId === threadRootId
      ? menu
      : undefined;
  const [, refreshThread] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // After a redaction the SDK keeps an unredacted copy of the latest reply
    // until it re-fetches the root; re-render once it does.
    const handleThreadUpdate = (thread: Thread) => {
      if (thread.id === threadRootId) refreshThread();
    };
    room.on(ThreadEvent.Update, handleThreadUpdate);
    return () => {
      room.removeListener(ThreadEvent.Update, handleThreadUpdate);
    };
  }, [room, threadRootId]);
  const pinning = useThreadPinning(room);
  const isPinned = pinning.pinnedEventIds.includes(threadRootId);
  const mutableThreadRootId = isConfirmedMatrixEventId(rootEventId) ? rootEventId : undefined;
  const liveThreadRootEvent =
    room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);
  // Offline, a thread the SDK does not know takes its root from the event cache.
  const cachedThreadRootEvent = useCachedThreadRoot(room, threadRootId, liveThreadRootEvent);
  const threadRootEvent = liveThreadRootEvent ?? cachedThreadRootEvent;
  const headerRecord = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    summaryInfo,
    threadResolution: {
      isResolved,
      tags,
    },
    scheduledStatus: {
      scheduledTaskCount,
      nextScheduledTs,
      cronDescription,
    },
  });
  const pickerDisabled = !mutableThreadRootId || updating;
  const headerModel = buildThreadHeaderViewModelFromRecord({
    record: headerRecord,
    scheduledDisplayText,
    canEdit: canEdit && !!mutableThreadRootId,
    availableTags,
    pickerDisabled,
    t,
  });
  // A summary that changes while the thread is open tints once; opening a thread does not.
  // The collapsed pill shows no title, so it drops a pending tint rather than replay it later.
  const { summaryText } = headerModel;
  const [shownSummary, setShownSummary] = useState({ threadId, summaryText, changed: false });
  if (shownSummary.threadId !== threadId || shownSummary.summaryText !== summaryText) {
    setShownSummary({
      threadId,
      summaryText,
      changed:
        !collapsed &&
        shownSummary.threadId === threadId &&
        !!shownSummary.summaryText &&
        !!summaryText,
    });
  } else if (collapsed && shownSummary.changed) {
    setShownSummary({ ...shownSummary, changed: false });
  }
  const summaryChanged = shownSummary.changed;
  const resolvedByDisplayName = getThreadResolverDisplayName(
    room,
    headerRecord.status.resolvedByUserId
  );
  const resolvedByLabel =
    headerModel.isResolved && resolvedByDisplayName
      ? t('thread.resolvedBy', { name: resolvedByDisplayName })
      : undefined;

  useEffect(() => {
    if (error) {
      console.error('[ThreadContextBanner] Tag mutation failed:', error);
    }
  }, [error]);

  const handleAddTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      void addTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, addTag]
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      void removeTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, removeTag]
  );

  const handleToggleResolve = useCallback(() => {
    if (!mutableThreadRootId || isPinned) return;
    void setResolved(mutableThreadRootId, !headerModel.isResolved);
  }, [mutableThreadRootId, headerModel.isResolved, setResolved, isPinned]);
  const handleUnsnooze = useCallback(() => {
    if (!mutableThreadRootId) return;
    void unsnooze(mutableThreadRootId);
  }, [mutableThreadRootId, unsnooze]);
  const resolveDisabled = !headerModel.canEdit || headerModel.pickerDisabled || pinning.updating;
  // A second thread's view leaves the resolve key to the open thread, and so advertises none.
  const resolveShortcut = resolveDisabled || onClose ? undefined : 'resolveThread';
  // Not a thread that a side panel in the conversation's place hides.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  useShortcut('resolveThread', () => {
    // On a focused card beside the thread, the keys are that card's (CompactRoomView).
    if (focusedCompactCard()) return false;
    if (behindPanel || !resolveShortcut || !mutableThreadRootId || isPinned) return false;
    handleToggleResolve();
    return true;
  });

  const hasTags = headerModel.displayTags.length > 0;
  const hasScheduled = !!(headerModel.bannerScheduledText && headerModel.scheduledLabel);
  // Without an AI summary, the start of the thread's first message is its title.
  const rootTitle = getThreadRootTitle(room, headerRecord.presentation, t);
  const title = headerModel.summaryText || rootTitle;
  const snoozedText = useSnoozedUntilText(headerModel.snoozedUntilTs);
  const hasSubtitle = !!headerModel.summaryText || !!rootTitle || hasScheduled || !!snoozedText;
  // A pinned thread shows the pin instead of the resolve chip and its byline.
  const showResolver = !isPinned && !!resolvedByDisplayName;
  // The Resolved button is described by the byline, also on short screens,
  // which hide it.
  const resolverBylineId = useId();
  // Plugins' controls, for a thread the server has, as the menu's details are.
  // In a phone's header Resolve and More sit beside the header's own, larger icons.
  const headerIcon = phoneHeader ? '200' : '100';
  const pluginControls = canOpenMenu ? (
    <ThreadHeaderSlot room={room} threadId={threadRootId} />
  ) : null;

  const backButton = onClose ? (
    <IconTooltip label={t('thread.close')} align={i18n.dir() === 'rtl' ? 'End' : 'Start'}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={t('thread.close')}
          onClick={onClose}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      )}
    </IconTooltip>
  ) : phone ? (
    <PhoneBackButton label={t('thread.back')} onBack={onExitThread} />
  ) : (
    // At the banner's start, so its tooltip opens toward the banner, not past it.
    // folds aligns to physical edges, and right-to-left puts the button on the right.
    <IconTooltip
      label={t('thread.back')}
      shortcut="leaveThread"
      align={i18n.dir() === 'rtl' ? 'End' : 'Start'}
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={t('thread.back')}
          {...shortcutAttributes('leaveThread')}
          onClick={onExitThread}
        >
          <Icon data-directional src={Icons.ArrowLeft} />
        </IconButton>
      )}
    </IconTooltip>
  );

  // The thread's menu opens on a right-click in the banner (a long press on touch) and on the
  // menu keys.
  const menuKeys = {
    onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu({ x: event.clientX, y: event.clientY, width: 0, height: 0 }, event.currentTarget);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.currentTarget.getBoundingClientRect(), event.target as HTMLElement);
    },
  };
  const tagsEditor = (maxPills: number) => (
    <>
      <TagPills
        tags={headerModel.displayTags}
        maxPills={maxPills}
        allTags={headerModel.displayTags}
        canEdit={headerModel.canEdit}
        onRemove={handleRemoveTag}
      />
      {headerModel.canEdit && (
        <ThreadTagPicker
          availableTags={headerModel.availableTags}
          onAddTag={handleAddTag}
          disabled={headerModel.pickerDisabled}
        />
      )}
    </>
  );
  const titleNode = title && (
    <InlineThreadTitleEditor room={room} rootId={threadRootId} text={title}>
      {({ onDoubleClick, hint }) =>
        headerModel.summaryText ? (
          <Text
            // Remounting replays the tint for each new summary.
            key={headerModel.summaryText}
            as="span"
            data-thread-context-summary="true"
            className={classNames(
              phoneHeader ? css.PhoneTitle : css.SummaryText,
              summaryChanged && css.SummaryTextChanged
            )}
            onAnimationEnd={() => setShownSummary((shown) => ({ ...shown, changed: false }))}
            onDoubleClick={onDoubleClick}
            size={phoneHeader ? 'H5' : 'T300'}
            truncate={!phoneHeader}
            title={revealDirectionControls(hint ? `${title}\n${hint}` : title)}
            {...(phoneHeader ? ownDirectionBlock : ownDirectionLine)}
          >
            {revealDirectionControls(headerModel.summaryText)}
          </Text>
        ) : (
          <ThreadRootTitle text={title} hint={hint} onDoubleClick={onDoubleClick} />
        )
      }
    </InlineThreadTitleEditor>
  );
  const scheduledNode = hasScheduled && (
    <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
      {!phoneHeader && (headerModel.summaryText || rootTitle) && (
        <Text
          as="span"
          className={classNames(css.MetadataDot, css.ScheduledDot)}
          size="T200"
          priority="300"
          aria-hidden="true"
        >
          ·
        </Text>
      )}
      <Box
        as="span"
        className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
        alignItems="Center"
        gap="100"
        role="img"
        aria-label={headerModel.scheduledLabel}
        title={headerModel.scheduledLabel}
      >
        <IconCalendarEvent
          size={12}
          stroke={1.8}
          className={threadIndicatorCss.ThreadScheduledIcon}
          aria-hidden="true"
        />
        <Text as="span" size="T200" priority="300" truncate>
          {headerModel.bannerScheduledText}
        </Text>
      </Box>
    </Box>
  );
  const snoozedNode = snoozedText && (
    <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
      {!phoneHeader && (headerModel.summaryText || rootTitle || hasScheduled) && (
        <Text
          as="span"
          className={classNames(css.MetadataDot, css.ScheduledDot)}
          size="T200"
          priority="300"
          aria-hidden="true"
        >
          ·
        </Text>
      )}
      <Box
        as="span"
        className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
        alignItems="Center"
        gap="100"
        data-thread-snoozed="true"
      >
        <IconClock
          size={12}
          stroke={1.8}
          className={threadIndicatorCss.ThreadScheduledIcon}
          aria-hidden="true"
        />
        <Text as="span" size="T200" priority="300" truncate>
          {snoozedText}
        </Text>
      </Box>
      {headerModel.canEdit && (
        <button
          type="button"
          className={css.SnoozeAction}
          data-thread-unsnooze="true"
          disabled={headerModel.pickerDisabled}
          onClick={handleUnsnooze}
        >
          {t('thread.unsnooze')}
        </button>
      )}
    </Box>
  );
  const resolverNode = showResolver && (
    <Box
      as="span"
      className={classNames(css.ResolutionByline, css.CompactHidden)}
      id={resolverBylineId}
      data-thread-resolution-byline="true"
      alignItems="Center"
      gap="100"
      role="img"
      aria-label={resolvedByLabel}
      title={resolvedByLabel}
    >
      {!phoneHeader && hasSubtitle && (
        <Text
          as="span"
          className={classNames(css.MetadataDot, css.ResolutionBylineDot)}
          size="T200"
          priority="300"
          aria-hidden="true"
        >
          ·
        </Text>
      )}
      <Icon src={Icons.Check} size="50" aria-hidden="true" />
      <Text as="span" className={css.ResolverName} size="T200" priority="300" truncate>
        {t('thread.resolvedByShort', { name: resolvedByDisplayName })}
      </Text>
    </Box>
  );
  const moreButton = (
    <IconTooltip label={t('threadActions.more')}>
      {(triggerRef) => (
        <IconButton
          ref={(node: HTMLButtonElement | null) => {
            triggerRef(node);
            moreButtonRef.current = node;
          }}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={t('threadActions.more')}
          aria-haspopup="menu"
          aria-expanded={!!activeMenu}
          disabled={!canOpenMenu}
          style={phoneHeader?.menuBadge ? { position: 'relative' } : undefined}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            openMenu(event.currentTarget.getBoundingClientRect(), event.currentTarget)
          }
        >
          <Icon src={Icons.VerticalDots} size={headerIcon} />
          {phoneHeader?.menuBadge}
        </IconButton>
      )}
    </IconTooltip>
  );
  const resolveButton = !isPinned && (
    // Resolve is in More, but a resolved status stays visible for readers; a phone's header
    // keeps the button on short screens too.
    <IconTooltip
      label={headerModel.isResolved ? resolvedByLabel ?? t('thread.resolved') : t('thread.resolve')}
      hint={headerModel.isResolved && headerModel.canEdit ? t('threadActions.reopen') : undefined}
      shortcut={resolveShortcut}
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          aria-label={t(headerModel.isResolved ? 'thread.resolved' : 'thread.resolve')}
          className={classNames(
            toolbarCss.MessageOptionsButton,
            headerModel.isResolved ? css.ResolvedButton : !phoneHeader && css.CompactHidden
          )}
          variant="SurfaceVariant"
          fill="None"
          aria-describedby={showResolver ? resolverBylineId : undefined}
          onClick={handleToggleResolve}
          disabled={resolveDisabled}
          {...shortcutAttributes(resolveShortcut)}
        >
          <Icon src={Icons.Check} size={headerIcon} />
        </IconButton>
      )}
    </IconTooltip>
  );
  const pinError = !!pinning.error && (
    <Text role="alert" size="T200">
      {t('thread.pinFailed')}
    </Text>
  );
  const threadMenu = activeMenu && (
    <Suspense fallback={null}>
      <ThreadActionsMenu
        key={`${room.roomId}:${threadRootId}`}
        room={room}
        rootId={threadRootId}
        summaryText={headerModel.summaryText}
        onHideDetails={collapsed || phoneHeader ? undefined : () => toggleCollapsed(true)}
        onShowBeside={onShowBeside}
        onShowFull={onShowFull}
        shortcutless={!!onClose}
        onRoomMenu={phoneHeader && (() => phoneHeader.onRoomMenu(activeMenu.anchor))}
        anchor={activeMenu.anchor}
        onClose={() => closeMenu(activeMenu)}
      />
    </Suspense>
  );

  if (phoneHeader) {
    // A phone's room header (RoomViewHeader) shows the thread that fills its page in its own
    // rows: back, the room's name, the plugins' controls, Resolve, the call buttons and More in
    // the first, and under it the whole title, which wraps as far as it needs. More holds Pin, the
    // tags and the room's menu; a pinned thread shows its pin beside the title.
    return (
      <>
        <div
          ref={glassRef}
          className={css.PhoneHeader}
          data-thread-context-banner="true"
          data-thread-phone-header="true"
          tabIndex={-1}
          {...menuKeys}
        >
          <div className={css.PhoneRow}>
            {backButton}
            <h1 className={css.PhoneRoom}>
              <button
                type="button"
                className={css.PhoneRoomButton}
                title={t('thread.backToRoom')}
                onClick={onExitThread}
              >
                <Text as="span" size="T300" priority="300" truncate {...ownDirectionLine}>
                  {phoneHeader.roomName}
                </Text>
              </button>
            </h1>
            <Box alignItems="Center" gap="100" shrink="No">
              {pluginControls}
              {resolveButton}
              {phoneHeader.actions}
              {moreButton}
            </Box>
          </div>
          {(titleNode || isPinned) && (
            <div className={css.PhoneTitleRow}>
              {titleNode}
              {isPinned && (
                <Box
                  as="span"
                  className={css.PhonePin}
                  role="img"
                  aria-label={t('threadNav.pinned')}
                  title={t('threadNav.pinned')}
                >
                  <Icon src={Icons.Pin} size="50" filled />
                </Box>
              )}
            </div>
          )}
          <div className={css.PhoneStatus}>
            <AutoApproveChip room={room} threadId={threadId} />
            <ThreadApprovalPermissions />
            {scheduledNode}
            {snoozedNode}
            {resolverNode}
          </div>
          {PHONE_HEADER_TAGS && hasTags && (
            <div className={css.PhoneTags}>{tagsEditor(Infinity)}</div>
          )}
          {pinError}
        </div>
        {threadMenu}
      </>
    );
  }

  return (
    <>
      <div
        ref={glassRef}
        className={classNames(
          headerModel.isResolved
            ? css.BannerResolved
            : snoozedText
            ? css.BannerSnoozed
            : css.Banner,
          collapsed && css.Collapsed
        )}
        data-thread-context-banner="true"
        tabIndex={-1}
        {...menuKeys}
      >
        {collapsed ? (
          // Collapsed to back and Show details; the tint still says resolved or snoozed, and
          // auto-approval and an active permissions grant stay in view.
          <Box alignItems="Center" gap="100">
            {backButton}
            <AutoApproveChip room={room} threadId={threadId} />
            <ThreadApprovalPermissions />
            {pluginControls}
            <IconTooltip label={t('thread.showDetails')}>
              {(triggerRef) => (
                <IconButton
                  ref={(node: HTMLButtonElement | null) => {
                    triggerRef(node);
                    showDetailsRef.current = node;
                  }}
                  className={toolbarCss.MessageOptionsButton}
                  variant="SurfaceVariant"
                  fill="None"
                  aria-label={t('thread.showDetails')}
                  onClick={() => toggleCollapsed(false)}
                >
                  <Icon src={Icons.ChevronBottom} size="100" />
                </IconButton>
              )}
            </IconTooltip>
          </Box>
        ) : (
          <div className={css.TitleRow}>
            {backButton}
            <div className={css.TitleColumn}>
              <Box className={css.EyebrowRow} direction="Row" alignItems="Center" gap="200">
                {!hasSubtitle && (
                  <Text className={css.ViewLabel} size="L400" priority="300">
                    {t('thread.view')}
                  </Text>
                )}
                <AutoApproveChip room={room} threadId={threadId} />
                <ThreadApprovalPermissions />
                {/* Desktop: tags inline on title row */}
                {hasTags && (
                  <div className={classNames(css.TagsRow, css.DesktopOnlyTags, css.CompactHidden)}>
                    {tagsEditor(DESKTOP_MAX_PILLS)}
                  </div>
                )}
              </Box>
              {(hasSubtitle || showResolver) && (
                <div className={css.SubtitleRow}>
                  {titleNode}
                  {scheduledNode}
                  {snoozedNode}
                  {resolverNode}
                </div>
              )}
            </div>
            <Box alignItems="Center" gap="100" shrink="No">
              {pluginControls}
              {moreButton}
              {pinning.canPin && mutableThreadRootId ? (
                <IconTooltip label={t(isPinned ? 'threadNav.unpin' : 'threadNav.pin')}>
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      aria-label={t(isPinned ? 'threadNav.unpin' : 'threadNav.pin')}
                      className={classNames(
                        toolbarCss.MessageOptionsButton,
                        !isPinned && css.CompactHidden
                      )}
                      variant="SurfaceVariant"
                      fill="None"
                      aria-pressed={isPinned}
                      disabled={pinning.updating || updating}
                      onClick={() => void pinning.setPinned(mutableThreadRootId, !isPinned)}
                    >
                      <Icon src={Icons.Pin} size="100" filled={isPinned} />
                    </IconButton>
                  )}
                </IconTooltip>
              ) : (
                isPinned && (
                  <Box
                    as="span"
                    role="img"
                    aria-label={t('threadNav.pinned')}
                    title={t('threadNav.pinned')}
                  >
                    <Icon src={Icons.Pin} size="100" filled />
                  </Box>
                )
              )}
              {resolveButton}
            </Box>
            {/* Mobile: tags in a row of their own, under the title and the actions */}
            {hasTags && (
              <div className={classNames(css.MobileOnlyTags, css.CompactHidden)}>
                {tagsEditor(MOBILE_MAX_PILLS)}
              </div>
            )}
          </div>
        )}
        {pinError}
      </div>
      {threadMenu}
    </>
  );
}
