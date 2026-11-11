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
} from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent } from '@tabler/icons-react';
import { Room } from 'matrix-js-sdk';
import { type Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import * as threadIndicatorCss from '../messages/ThreadIndicator.css';
import { useThreadHeaderInfo } from './useThreadHeaderInfo';
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
import { useShortcut } from '../shortcuts/useShortcut';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { PhoneBackButton } from '../ui/page/PhoneBackButton';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { ownDirectionLine, revealDirectionControls } from '../ui/directional';
import { getThreadRootTitle, ThreadRootTitle } from './ThreadRootTitle';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';

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
  /** Shows the thread in a column beside the room's messages, from their place (button, More). */
  onShowBeside?: () => void;
  /** Show beside is offered but refused: the composer holds a reply, files or a recording. */
  showBesideBlocked?: boolean;
  /** Fills the room page with the thread's column. */
  onShowFull?: () => void;
  /** Takes the thread's column back beside the room's messages from filling the page. */
  onRestore?: () => void;
}

const DESKTOP_MAX_PILLS = 3;
const MOBILE_MAX_PILLS = 2;

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
  showBesideBlocked,
  onShowFull,
  onRestore,
}: ThreadContextBannerProps) {
  const { t, i18n } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const bannerRef = useRef<HTMLDivElement>(null);
  const glassRef = useLiquidGlass<HTMLDivElement>(bannerRef);
  const [collapsed, setCollapsed] = useSetting(settingsAtom, 'threadBannerCollapsed');
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, cronDescription, scheduledDisplayText } =
    useThreadHeaderInfo(room, threadId);
  const { tags, isResolved, canEdit, availableTags } = useThreadTags(room, rootEventId);
  const { addTag, removeTag, setResolved, updating, error } = useMutateThreadTags(room);
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
      addTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, addTag]
  );

  const handleRemoveTag = useCallback(
    (name: string) => {
      if (!mutableThreadRootId) return;
      removeTag(mutableThreadRootId, name);
    },
    [mutableThreadRootId, removeTag]
  );

  const handleToggleResolve = useCallback(() => {
    if (!mutableThreadRootId || isPinned) return;
    setResolved(mutableThreadRootId, !headerModel.isResolved);
  }, [mutableThreadRootId, headerModel.isResolved, setResolved, isPinned]);
  const resolveDisabled = !headerModel.canEdit || headerModel.pickerDisabled || pinning.updating;
  // Not a thread that a side panel in the conversation's place hides.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  useShortcut('resolveThread', () => {
    if (behindPanel || resolveDisabled || !mutableThreadRootId || isPinned) return false;
    handleToggleResolve();
    return true;
  });

  const hasTags = headerModel.displayTags.length > 0;
  const hasScheduled = !!(headerModel.bannerScheduledText && headerModel.scheduledLabel);
  // Without an AI summary, the start of the thread's first message is its title.
  const rootTitle = getThreadRootTitle(room, headerRecord.presentation, t);
  const hasSubtitle = !!headerModel.summaryText || !!rootTitle || hasScheduled;
  // A pinned thread shows the pin instead of the resolve chip and its byline.
  const showResolver = !isPinned && !!resolvedByDisplayName;
  // The Resolved button is described by the byline, also on short screens,
  // which hide it.
  const resolverBylineId = useId();

  // The column's button: fill the page with it, or take it (or the thread in the messages' place)
  // beside the messages. Only from the messages' place does it wait, while their composer is busy.
  const toBeside = onRestore ?? onShowBeside;
  const columnToggle = onShowFull
    ? { label: t('thread.showFull'), icon: ExpandIcon, onClick: onShowFull, blocked: false }
    : toBeside && {
        label: t('thread.showBeside'),
        icon: ShrinkIcon,
        onClick: toBeside,
        blocked: !onRestore && !!showBesideBlocked,
      };

  const backButton = phone ? (
    <PhoneBackButton label={t('thread.back')} onBack={onExitThread} />
  ) : (
    // At the banner's start, so its tooltip opens toward the banner, not past it.
    // folds aligns to physical edges, and right-to-left puts the button on the right.
    <IconTooltip label={t('thread.back')} align={i18n.dir() === 'rtl' ? 'End' : 'Start'}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={t('thread.back')}
          onClick={onExitThread}
        >
          <Icon data-directional src={Icons.ArrowLeft} />
        </IconButton>
      )}
    </IconTooltip>
  );

  return (
    <>
      <div
        ref={glassRef}
        className={classNames(
          headerModel.isResolved ? css.BannerResolved : css.Banner,
          collapsed && css.Collapsed
        )}
        data-thread-context-banner="true"
        tabIndex={-1}
        onContextMenu={(event) => {
          if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(
            { x: event.clientX, y: event.clientY, width: 0, height: 0 },
            event.currentTarget
          );
        }}
        onKeyDown={(event) => {
          if (!canOpenMenu || !event.currentTarget.contains(event.target as Node)) return;
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.currentTarget.getBoundingClientRect(), event.target as HTMLElement);
        }}
      >
        {collapsed ? (
          // Collapsed to back and Show details; the tint still says resolved, and
          // auto-approval and an active permissions grant stay in view.
          <Box alignItems="Center" gap="100">
            {backButton}
            <AutoApproveChip room={room} threadId={threadId} />
            <ThreadApprovalPermissions />
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
                {/* More adds the first tag; + tag joins the ones already set. */}
                {hasTags && (
                  <div className={classNames(css.TagsRow, css.DesktopOnlyTags, css.CompactHidden)}>
                    <TagPills
                      tags={headerModel.displayTags}
                      maxPills={DESKTOP_MAX_PILLS}
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
                  </div>
                )}
              </Box>
              {(hasSubtitle || showResolver) && (
                <div className={css.SubtitleRow}>
                  {headerModel.summaryText && (
                    <Text
                      // Remounting replays the tint for each new summary.
                      key={headerModel.summaryText}
                      as="span"
                      data-thread-context-summary="true"
                      className={classNames(
                        css.SummaryText,
                        summaryChanged && css.SummaryTextChanged
                      )}
                      onAnimationEnd={() =>
                        setShownSummary((shown) => ({ ...shown, changed: false }))
                      }
                      size="T300"
                      truncate
                      title={revealDirectionControls(headerModel.summaryText)}
                      {...ownDirectionLine}
                    >
                      {revealDirectionControls(headerModel.summaryText)}
                    </Text>
                  )}
                  {rootTitle && <ThreadRootTitle text={rootTitle} />}
                  {hasScheduled && (
                    <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
                      {(headerModel.summaryText || rootTitle) && (
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
                  )}
                  {showResolver && (
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
                      {hasSubtitle && (
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
                      <Text
                        as="span"
                        className={css.ResolverName}
                        size="T200"
                        priority="300"
                        truncate
                      >
                        {t('thread.resolvedByShort', { name: resolvedByDisplayName })}
                      </Text>
                    </Box>
                  )}
                </div>
              )}
            </div>
            <Box alignItems="Center" gap="100" shrink="No">
              {columnToggle && (
                <IconTooltip
                  label={columnToggle.label}
                  hint={columnToggle.blocked ? t('thread.showBesideBlocked') : undefined}
                >
                  {(triggerRef) => (
                    // Waiting, it keeps its focus and name, and its tooltip says why.
                    <IconButton
                      ref={triggerRef}
                      className={toolbarCss.MessageOptionsButton}
                      variant="SurfaceVariant"
                      fill="None"
                      aria-label={columnToggle.label}
                      aria-disabled={columnToggle.blocked || undefined}
                      onClick={columnToggle.blocked ? undefined : columnToggle.onClick}
                    >
                      <Icon size="100" src={columnToggle.icon} />
                    </IconButton>
                  )}
                </IconTooltip>
              )}
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
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                      openMenu(event.currentTarget.getBoundingClientRect(), event.currentTarget)
                    }
                  >
                    <Icon src={Icons.VerticalDots} size="100" />
                  </IconButton>
                )}
              </IconTooltip>
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
                      onClick={() => pinning.setPinned(mutableThreadRootId, !isPinned)}
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
              {!isPinned && (
                // Resolve is in More, but a resolved status stays visible for readers.
                <IconTooltip
                  label={
                    headerModel.isResolved
                      ? resolvedByLabel ?? t('thread.resolved')
                      : t('thread.resolve')
                  }
                  hint={
                    headerModel.isResolved && headerModel.canEdit
                      ? t('threadActions.reopen')
                      : undefined
                  }
                  shortcut={resolveDisabled ? undefined : 'resolveThread'}
                >
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      aria-label={t(headerModel.isResolved ? 'thread.resolved' : 'thread.resolve')}
                      className={classNames(
                        toolbarCss.MessageOptionsButton,
                        headerModel.isResolved ? css.ResolvedButton : css.CompactHidden
                      )}
                      variant="SurfaceVariant"
                      fill="None"
                      aria-describedby={showResolver ? resolverBylineId : undefined}
                      onClick={handleToggleResolve}
                      disabled={resolveDisabled}
                      {...shortcutAttributes(resolveDisabled ? undefined : 'resolveThread')}
                    >
                      <Icon src={Icons.Check} size="100" />
                    </IconButton>
                  )}
                </IconTooltip>
              )}
            </Box>
            {/* Mobile: tags in a row of their own, under the title and the actions */}
            {hasTags && (
              <div className={classNames(css.MobileOnlyTags, css.CompactHidden)}>
                <TagPills
                  tags={headerModel.displayTags}
                  maxPills={MOBILE_MAX_PILLS}
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
              </div>
            )}
          </div>
        )}
        {!!pinning.error && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
      </div>
      {activeMenu && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${room.roomId}:${threadRootId}`}
            room={room}
            rootId={threadRootId}
            summaryText={headerModel.summaryText}
            onHideDetails={collapsed ? undefined : () => toggleCollapsed(true)}
            onShowBeside={onShowBeside}
            showBesideBlocked={showBesideBlocked}
            anchor={activeMenu.anchor}
            onClose={() => closeMenu(activeMenu)}
          />
        </Suspense>
      )}
    </>
  );
}
