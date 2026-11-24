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
  type RefObject,
} from 'react';
import classNames from 'classnames';
import { shortViewport } from '../ui/styles/shortViewport';
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
import { focusedCompactCard } from './overview/compactCardKeys';
import { useShortcut } from '../shortcuts/useShortcut';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { ThreadBannerActions, ThreadBannerBackButton } from './ThreadBannerChrome';
import { useShortViewport } from '../ui/page/floatingCards';
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
}

const DESKTOP_MAX_PILLS = 3;

// A banner narrower than this takes a phone's layout: the tags and the pin in More, the whole
// title, the buttons beside it stacked. Narrower are a thread column or a second thread beside the
// messages (456 px of banner until resized), a conversation beside the members panel on a tablet
// (388 px at 1024 by 768, 544 px at 1180 by 820) and a portrait tablet's beside the room list
// (458 px at 820 wide). Wider, and keeping the tags, are a tablet's held sideways beside the room
// list (662 px at 1024 by 768) and a desktop's, also beside the members panel (644 px at 1280 by
// 800). A phone takes the compact layout at any width: a 750 px one has 726 px of banner, more than
// that tablet, so no width tells them apart. In rem, as the row's, since Page Zoom scales what the
// banner holds.
const COMPACT_BANNER_REM = 36;

const rootFontSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const inlineSpace = (style: CSSStyleDeclaration, side: 'margin' | 'padding') =>
  (parseFloat(style[`${side}Left`]) || 0) + (parseFloat(style[`${side}Right`]) || 0);

/**
 * Whether the banner is narrower than COMPACT_BANNER_REM. Measured from the banner's slot, the
 * width the banner has expanded, so a collapsed pill gets the same answer; again as the slot
 * resizes and as Page Zoom changes the root's font size. A hidden slot (no width) keeps the last
 * answer. Not measured while `skip`. Assumes the parent is `ThreadTimelineHeader`'s block-level
 * content box (`display: flow-root`), whose width does not depend on the banner's.
 */
const useNarrowBanner = (banner: RefObject<HTMLElement | null>, skip: boolean) => {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const node = banner.current;
    const slot = node?.parentElement;
    if (skip || !node || !slot) return undefined;
    const measure = () => {
      const width =
        slot.clientWidth -
        inlineSpace(getComputedStyle(slot), 'padding') -
        inlineSpace(getComputedStyle(node), 'margin');
      if (width > 0) setNarrow(width < COMPACT_BANNER_REM * rootFontSize());
    };
    measure();
    const zoom =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(measure);
    zoom?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    resize?.observe(slot);
    return () => {
      zoom?.disconnect();
      resize?.disconnect();
    };
  }, [banner, skip]);
  return narrow;
};

// A compact banner's row narrower than this (a small phone, a narrow pane, Page Zoom) gives the
// title the row under its buttons, after them in the tab order too. In rem, since Page Zoom scales
// the root font size and so the buttons, while the banner keeps its px width.
const NARROW_PHONE_ROW_REM = 19;

type RowLayout = 'row' | 'stacked' | 'narrow';

/**
 * A compact banner's title row:
 * - `narrow`: too narrow to hold the title beside its buttons, which take the line above it.
 * - `stacked`: when the title, beside the buttons side by side, is at least as tall as the buttons
 *   one above the other, they stack and the title gets their width; the card gets no taller.
 *   Each is measured in its own layout, whichever the row shows, so the answer does not depend on
 *   the layout it picks and cannot flip back and forth.
 * - `row`: the buttons side by side, beside a short title, and always on a short screen held
 *   sideways, whose one-line row hides an unresolved Resolve (CompactHidden): stacked, the last
 *   button shown would not be the column's last.
 * Measured again when the row, the title or the buttons resize, when the root's style changes
 * (Page Zoom sets the root font size, which moves 19rem while the row can keep its width), and
 * when the title's `text` changes: a new title can need more lines beside the row while every box
 * shown keeps its size.
 */
const usePhoneRowLayout = (row: HTMLElement | null, text: string | undefined): RowLayout => {
  const [layout, setLayout] = useState<RowLayout>('row');
  useLayoutEffect(() => {
    if (!row) return undefined;
    const title = row.querySelector<HTMLElement>(`:scope > .${css.TitleColumn}`);
    const actions = row.querySelector<HTMLElement>(`:scope > .${css.RowActions}`);
    const measure = () => {
      if (row.getBoundingClientRect().width <= NARROW_PHONE_ROW_REM * rootFontSize()) {
        setLayout('narrow');
        return;
      }
      const compact = typeof matchMedia === 'function' && matchMedia(shortViewport).matches;
      if (!title || !actions || compact) {
        setLayout('row');
        return;
      }
      // Lay the row out each way for a moment (no paint in between), measure, and restore.
      const shown = row.className;
      row.classList.remove(css.NarrowPhoneTitleRow, css.StackedPhoneTitleRow);
      const titleHeight = title.getBoundingClientRect().height;
      row.classList.add(css.StackedPhoneTitleRow);
      const fits = actions.getBoundingClientRect().height <= titleHeight;
      row.className = shown;
      setLayout(fits ? 'stacked' : 'row');
    };
    measure();
    const zoom =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(measure);
    zoom?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    resize?.observe(row);
    if (title) resize?.observe(title);
    // A plugin's marker joins the buttons after the banner shows.
    if (actions) resize?.observe(actions);
    return () => {
      zoom?.disconnect();
      resize?.disconnect();
    };
  }, [row, text]);
  return row ? layout : 'row';
};

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
}: ThreadContextBannerProps) {
  const { t, i18n } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const bannerRef = useRef<HTMLDivElement>(null);
  const glassRef = useLiquidGlass<HTMLDivElement>(bannerRef);
  const [titleRow, setTitleRow] = useState<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useSetting(settingsAtom, 'threadBannerCollapsed');
  // A phone always gets the phone layout, so it looks as before whatever its width or zoom. Other
  // screens get it when the banner is narrow: the tags and the pin move to More, and, unless the
  // screen is short and keeps one row, the title shows whole and the buttons can stack.
  const narrow = useNarrowBanner(bannerRef, phone);
  const short = useShortViewport();
  const compact = phone || narrow;
  const wholeTitle = phone || (narrow && !short);
  const rootEventId = useThreadRootEvent(room, threadId);
  const { scheduledTaskCount, nextScheduledTs, cronDescription, scheduledDisplayText } =
    useThreadHeaderInfo(room, threadId);
  const { tags, isResolved, canEdit, availableTags } = useThreadTags(room, rootEventId);
  const { addTag, removeTag, setResolved, unsnooze, updating, error } = useMutateThreadTags(room);
  const threadRootId = rootEventId ?? threadId;
  const canOpenMenu = isConfirmedMatrixEventId(threadRootId);
  const [menu, setMenu] = useState<BannerMenuState>();
  const menuRef = useRef<BannerMenuState>(undefined);
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

  // A compact banner leaves the tags and the pin to More, so the whole title has the room.
  const hasTags = !compact && headerModel.displayTags.length > 0;
  const hasScheduled = !!(headerModel.bannerScheduledText && headerModel.scheduledLabel);
  // Without an AI summary, the start of the thread's first message is its title.
  const rootTitle = getThreadRootTitle(room, headerRecord.presentation, t);
  const title = headerModel.summaryText || rootTitle;
  const rowLayout = usePhoneRowLayout(wholeTitle ? titleRow : null, title);
  const narrowRow = rowLayout === 'narrow';
  const inRowOrder = (items: [title: React.ReactNode, actions: React.ReactNode]) =>
    narrowRow ? [items[1], items[0]] : items;
  const snoozedText = useSnoozedUntilText(headerModel.snoozedUntilTs);
  const hasSubtitle = !!headerModel.summaryText || !!rootTitle || hasScheduled || !!snoozedText;
  // A pinned thread shows the pin instead of the resolve chip and its byline.
  const showResolver = !isPinned && !!resolvedByDisplayName;
  // The Resolved button is described by the byline, also on short screens,
  // which hide it.
  const resolverBylineId = useId();
  // Plugins' controls, for a thread the server has, as the menu's details are.
  const pluginControls = canOpenMenu ? (
    <ThreadHeaderSlot room={room} threadId={threadRootId} />
  ) : null;

  const backButton = (
    <ThreadBannerBackButton
      phone={phone}
      label={t('thread.back')}
      closeLabel={t('thread.close')}
      shortcut="leaveThread"
      rtl={i18n.dir() === 'rtl'}
      onBack={onExitThread}
      onClose={onClose}
    />
  );

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
          <div
            ref={setTitleRow}
            className={classNames(
              css.TitleRow,
              wholeTitle && css.PhoneTitleRow,
              narrowRow && css.NarrowPhoneTitleRow,
              rowLayout === 'stacked' && css.StackedPhoneTitleRow
            )}
          >
            {backButton}
            {/* Keyed, so a title under the buttons follows them in the DOM and keeps its state. */}
            {inRowOrder([
              <div key="title" className={css.TitleColumn}>
                <Box className={css.EyebrowRow} direction="Row" alignItems="Center" gap="200">
                  {!hasSubtitle && (
                    <Text className={css.ViewLabel} size="L400" priority="300">
                      {t('thread.view')}
                    </Text>
                  )}
                  <AutoApproveChip room={room} threadId={threadId} />
                  <ThreadApprovalPermissions />
                  {/* More adds the first tag; + tag joins the ones already set. */}
                  {hasTags && (
                    <div className={classNames(css.TagsRow, css.CompactHidden)}>
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
                    {title && (
                      <InlineThreadTitleEditor room={room} rootId={threadRootId} text={title}>
                        {({ onDoubleClick, hint }) =>
                          headerModel.summaryText ? (
                            <Text
                              // Remounting replays the tint for each new summary.
                              key={headerModel.summaryText}
                              as="span"
                              data-thread-context-summary="true"
                              className={classNames(
                                wholeTitle ? css.PhoneTitle : css.SummaryText,
                                summaryChanged && css.SummaryTextChanged
                              )}
                              // A title taller than its bound scrolls, also from the keyboard.
                              tabIndex={wholeTitle ? 0 : undefined}
                              onAnimationEnd={() =>
                                setShownSummary((shown) => ({ ...shown, changed: false }))
                              }
                              onDoubleClick={onDoubleClick}
                              size="T300"
                              truncate={!wholeTitle}
                              title={revealDirectionControls(hint ? `${title}\n${hint}` : title)}
                              {...(wholeTitle ? ownDirectionBlock : ownDirectionLine)}
                            >
                              {revealDirectionControls(headerModel.summaryText)}
                            </Text>
                          ) : (
                            <ThreadRootTitle
                              text={title}
                              hint={hint}
                              onDoubleClick={onDoubleClick}
                              whole={wholeTitle}
                            />
                          )
                        }
                      </InlineThreadTitleEditor>
                    )}
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
                    {snoozedText && (
                      <Box as="span" className={css.ScheduledWrap} alignItems="Center" gap="100">
                        {(headerModel.summaryText || rootTitle || hasScheduled) && (
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
              </div>,
              <ThreadBannerActions
                key="actions"
                before={pluginControls}
                moreLabel={t('threadActions.more')}
                moreButtonRef={moreButtonRef}
                canOpenMenu={canOpenMenu}
                menuOpen={!!activeMenu}
                onOpenMenu={(event) =>
                  openMenu(event.currentTarget.getBoundingClientRect(), event.currentTarget)
                }
                showPinButton={!compact && pinning.canPin && !!mutableThreadRootId}
                isPinned={isPinned}
                pinLabel={t(isPinned ? 'threadNav.unpin' : 'threadNav.pin')}
                pinnedLabel={t('threadNav.pinned')}
                pinDisabled={pinning.updating || updating}
                onTogglePin={() =>
                  mutableThreadRootId && void pinning.setPinned(mutableThreadRootId, !isPinned)
                }
                showResolveButton={!isPinned}
                isResolved={headerModel.isResolved}
                resolveLabel={
                  headerModel.isResolved
                    ? (resolvedByLabel ?? t('thread.resolved'))
                    : t('thread.resolve')
                }
                resolveAriaLabel={t(headerModel.isResolved ? 'thread.resolved' : 'thread.resolve')}
                resolveHint={
                  headerModel.isResolved && headerModel.canEdit
                    ? t('threadActions.reopen')
                    : undefined
                }
                resolveShortcut={resolveShortcut}
                resolveDescribedBy={showResolver ? resolverBylineId : undefined}
                resolveDisabled={resolveDisabled}
                onToggleResolve={handleToggleResolve}
              />,
            ])}
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
            onShowFull={onShowFull}
            shortcutless={!!onClose}
            tagsAtTop={compact}
            anchor={activeMenu.anchor}
            onClose={() => closeMenu(activeMenu)}
          />
        </Suspense>
      )}
    </>
  );
}
