import { useLayoutEffect, useRef, type RefObject } from 'react';
import classNames from 'classnames';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  AvatarFallback,
  Box,
  Icon,
  IconButton,
  Icons,
  Line,
  Text,
  type IconSrc,
} from 'folds';
import { ActivityBadge } from '../activity/ActivityBadge';
import * as activityCss from '../activity/ActivityList.css';
import {
  ActivityApprovalButtons,
  ActivityListHeader,
  ActivityListTabs,
  ActivityRowView,
} from '../activity/ActivityListChrome';
import { getAvatarFallbackStyle } from '../avatars/UserAvatar';
import { ComposerIconButton } from '../composer/ComposerIconButton';
import * as editorCss from '../editor/Editor.css';
import { createDefaultThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { formatCompactRelativeTime } from '../lib/time';
import {
  AvatarBase,
  MessageBase,
  MessageTextBody,
  ModernLayout,
  Username,
  UsernameBold,
} from '../messages/layout/layout';
import * as toolbarCss from '../messages/styles.css';
import {
  ThreadIndicatorChip,
  type ThreadIndicatorParticipant,
} from '../messages/ThreadIndicatorChip';
import { Time } from '../messages/Time';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { CompactViewIcon } from '../room/CompactViewIcon';
import {
  HeaderActionButton,
  HeaderActionEntry,
  type RoomHeaderAction,
} from '../room/roomHeaderActions';
import * as headerLayoutCss from '../room/RoomViewHeaderLayout.css';
import { CompactCardSwipeStrip } from '../threads/overview/CompactCardSwipe';
import { SwipeTrack } from '../threads/overview/CompactCardSwipe.css';
import * as compactCss from '../threads/overview/CompactRoomView.css';
import { CompactThreadCard } from '../threads/overview/CompactThreadCard';
import {
  CompactCardActions,
  PinnedThreadsSection,
} from '../threads/overview/CompactThreadCardChrome';
import { RoomThreadOverview } from '../threads/overview/RoomThreadOverview';
import {
  buildThreadActionMenuGroups,
  ThreadActionsMenuContent,
} from '../threads/ThreadActionsMenuContent';
import { ThreadBannerActions, ThreadBannerBackButton } from '../threads/ThreadBannerChrome';
import * as bannerCss from '../threads/ThreadContextBanner.css';
import { ThreadRootTitle } from '../threads/ThreadRootTitle';
import { ThreadStreamingDot } from '../threads/ThreadStreamingDot';
import { DialogCloseButton } from '../ui/DialogChrome';
import { Header, Menu } from '../ui/glass/GlassPrimitives';
import { MenuGroup, MenuSwitchEntry } from '../ui/MenuEntry';
import { PageHeader } from '../ui/page/Page';
import * as scrollableMenuCss from '../ui/ScrollableMenu.css';
import * as searchFieldCss from '../ui/SearchField.css';
import * as phoneBarCss from '../ui/sidebar/PhoneTopBar.css';
import {
  Sidebar,
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarStack,
} from '../ui/sidebar/SidebarItem';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import {
  SAMPLE_ROOM_ID,
  sampleActivityTs,
  sampleCard,
  sampleGraphemes,
  sampleName,
  sampleReplyCount,
  sampleReplyParticipants,
  sampleRootMessage,
  sampleUserId,
  type SampleCardState,
  type SampleMessage,
  type SampleSender,
  type SampleTextKey,
  type SampleThreadId,
} from './tourSample';
import type { SceneCard, TourPart, TourScene } from './tourScenes';
import * as css from './TourStage.css';
import { useFlipList } from './useFlipList';

type RoomProps = {
  scene: TourScene;
  /** Draws a phone's room chrome: phone top bar, room menu, and phone thread banner. */
  phone: boolean;
  /** Uses touch card actions (`phone || hasNoHover()`) instead of desktop hover buttons. */
  touchCards?: boolean;
  /**
   * Whether this is the view the tour is on. A view that is fading out under the next one is
   * drawn without its marks, so each part is in the stage once.
   */
  live: boolean;
  /** The time the sample room counts its ages from. */
  now: number;
};

const mark = (live: boolean, part: TourPart) => (live ? { 'data-tour-part': part } : undefined);
const nothing = () => undefined;
const DEFAULT_FILTER = createDefaultThreadFilterState();

/** Marks real app sub-elements inside `containerRef` with `data-tour-part` while `live`. */
const useTourMarks = (
  containerRef: RefObject<HTMLElement | null>,
  live: boolean,
  marks: ReadonlyArray<readonly [selector: string, part: TourPart | undefined]>
) => {
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    for (const [selector, part] of marks) {
      const element = root.querySelector(selector);
      if (!element) continue;
      if (live && part) element.setAttribute('data-tour-part', part);
      else element.removeAttribute('data-tour-part');
    }
  });
};

const HEADER_MARKS = [
  ['[data-room-view-switch]', 'viewSwitch'],
  ['[data-thread-filter-bar-toggle]', 'filterButton'],
] as const;

const FILTER_MARKS = [
  ['[data-room-thread-overview]', 'filterBar'],
  ['[data-simple-unresolved-toggle]', 'filterUnresolved'],
] as const;

const CARD_MENU_MARKS = [
  ['[data-thread-action="tags"]', 'menuTags'],
  ['[data-thread-action="snooze"]', 'menuSnooze'],
  ['[data-thread-action="pin"]', 'menuPin'],
] as const;

/** Three bars, the usual sign of a menu that slides in, as a phone's top bar draws it. */
const MenuIcon: IconSrc = () => (
  <path
    d="M4 6h16M4 12h16M4 18h16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  />
);

/** The room header and phone room menu actions in `RoomViewHeader.tsx` order. */
const roomHeaderActions = (scene: TourScene, t: TFunction) => {
  const a = (
    id: string,
    label: string,
    icon: IconSrc,
    extra?: Partial<RoomHeaderAction>
  ): RoomHeaderAction => ({ id, label, icon, placement: 'auto', run: nothing, ...extra });
  const h = 'mindroomUi.threads.mindroomRoomViewHeader';
  const compact = scene.view === 'list';
  return {
    viewSwitch: a('viewSwitch', t(`${h}.compactView`), CompactViewIcon, {
      active: compact,
      pressed: compact,
      marker: 'data-room-view-switch',
    }),
    filterBar: a(
      'filterBar',
      t('mindroomUi.threads.roomThreadOverview.threadFilters'),
      Icons.Filter,
      {
        pressed: scene.filterBar,
        marker: 'data-thread-filter-bar-toggle',
      }
    ),
    schedules: a('schedules', t('roomSchedules.openLabel', { total: 0 }), Icons.Clock, {
      popup: 'dialog',
    }),
    members: a('members', t(`${h}.showMembers`), Icons.User),
    moreOptions: a('moreOptions', t(`${h}.moreOptions`), Icons.VerticalDots, {
      placement: 'row',
      popup: 'menu',
      marker: 'data-room-more-options',
    }),
  };
};

/** The room's header: real `PageHeader` with `HeaderActionButton` in `RoomViewHeader.tsx` order. */
function RoomHeader({ scene, phone, live }: Omit<RoomProps, 'now' | 'touchCards'>) {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLElement>(null);
  const a = roomHeaderActions(scene, t);
  useTourMarks(headerRef, live, HEADER_MARKS);
  const rowActions = phone
    ? [a.members, a.moreOptions]
    : scene.view !== 'thread'
      ? [a.viewSwitch, a.filterBar, a.schedules, a.members, a.moreOptions]
      : [a.schedules, a.members, a.moreOptions];
  return (
    <PageHeader ref={headerRef} outlined className={headerLayoutCss.Header} data-tour-header="">
      <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
        {!phone && (
          <Avatar size="300" radii="400" style={{ flexShrink: 0 }}>
            <AvatarFallback style={getAvatarFallbackStyle(SAMPLE_ROOM_ID)}>
              <Icon size="200" src={Icons.Hash} filled />
            </AvatarFallback>
          </Avatar>
        )}
        <Text as="span" size="H5" truncate>
          {t('tour.sample.room')}
        </Text>
      </Box>
      <Box shrink="No" alignItems="Center" gap="100">
        {rowActions.map((action) => (
          <HeaderActionButton key={action.id} action={action} />
        ))}
      </Box>
    </PageHeader>
  );
}

/** A phone's room menu, matching `RoomActionsMenu.tsx`'s grouped View + Preferences sections. */
function RoomMenu({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const a = roomHeaderActions(scene, t);
  useTourMarks(menuRef, live, HEADER_MARKS);
  return (
    <div ref={menuRef} className={css.RoomMenu} data-tour-room-menu="">
      <Menu
        className={classNames(
          scrollableMenuCss.ScrollableMenu,
          css.StageMenuSurface,
          glassDenseOverBackdrop
        )}
      >
        <div className={scrollableMenuCss.ScrollableMenuRows}>
          <MenuGroup label={t('featureUi.roomActions.viewSection')}>
            {[a.viewSwitch, a.filterBar, a.schedules, a.members].map((action) => (
              <HeaderActionEntry key={action.id} action={action} onSelect={nothing} />
            ))}
          </MenuGroup>
          <Line variant="Surface" size="300" />
          <MenuGroup label={t('featureUi.roomActions.preferencesSection')}>
            <MenuSwitchEntry
              label={t('mindroomUi.messages.showToolCalls')}
              checked={false}
              onToggle={nothing}
            />
          </MenuGroup>
        </div>
      </Menu>
    </div>
  );
}

/** The real simple `RoomThreadOverview` bar, marked for the tour's spotlight. */
function TourFilterBar({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const ref = useRef<HTMLDivElement>(null);
  useTourMarks(ref, live, FILTER_MARKS);
  return (
    <div ref={ref} className={css.Arriving}>
      <RoomThreadOverview
        simpleModeOverride
        hasMindroomAgents
        threadCount={scene.cards.length}
        totalThreadCount={scene.cards.length}
        state={{ ...DEFAULT_FILTER, resolved: scene.unresolvedOnly ? 'exclude' : 'any' }}
        availableTags={[]}
        onSortDirectionChange={nothing}
        onToggleThreadSortFreeze={nothing}
        onToggleForMe={nothing}
        onReset={nothing}
        onAddTag={nothing}
        onRemoveTag={nothing}
        onClearTags={nothing}
        onSearchQueryChange={nothing}
        onToggleThreadSections={nothing}
      />
    </div>
  );
}

type CardMenuProps = Pick<RoomProps, 'phone' | 'live'> & {
  pinned: boolean;
  state: SampleCardState;
};

/** Thread options menu built with `buildThreadActionMenuGroups` and `ThreadActionsMenuContent`. */
function CardMenu({ phone, live, pinned, state }: CardMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useTourMarks(menuRef, live, CARD_MENU_MARKS);
  const groups = buildThreadActionMenuGroups({
    t,
    showTags: true,
    canSummarize: true,
    includeRegenerate: false,
    canEditState: true,
    canPin: true,
    pinned,
    isResolved: state.resolved === true,
    snoozed: state.snoozed === true,
    showCopy: true,
    showToolCalls: false,
  });
  return (
    <div
      ref={menuRef}
      className={classNames(
        css.CardMenu,
        !phone && pinned && css.CardMenuPinned,
        phone && (pinned ? css.PhoneCardMenuPinned : css.PhoneCardMenu)
      )}
      data-tour-card-menu=""
    >
      <ThreadActionsMenuContent
        label={t('threadActions.more')}
        groups={groups}
        className={classNames(css.StageMenuSurface, glassDenseOverBackdrop)}
      />
    </div>
  );
}

type SampleCardRowProps = RoomProps & { card: SceneCard; pinned: boolean; touchCards: boolean };

/** One thread: real `CompactThreadCard`, real `CompactCardActions`, and real swipe chrome. */
function SampleCardRow({ card, scene, touchCards, live, now, pinned }: SampleCardRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const shellRef = useRef<HTMLDivElement>(null);
  const { id, state } = card;
  const menuOpen = scene.menuOn === id;
  const pointed = !touchCards && scene.actionsOn === id;
  const swiped = touchCards && scene.actionsOn === id;

  useTourMarks(shellRef, live, [
    [`.${compactCss.TitleText}`, `title:${id}`],
    ['[data-compact-thread-resolve]', pointed ? 'resolveButton' : undefined],
    ['[data-compact-thread-pin]', pointed ? 'pinButton' : undefined],
    ['[data-compact-thread-more]', touchCards || pointed ? `options:${id}` : undefined],
  ]);

  return (
    <div
      ref={shellRef}
      className={compactCss.CardShell}
      data-touch-actions={touchCards ? 'true' : undefined}
      data-actions-visible={pointed ? 'true' : undefined}
      data-flip-key={id}
      data-tour-card={id}
      {...mark(live, `card:${id}`)}
    >
      {swiped && (
        <CompactCardSwipeStrip
          resolved={false}
          label={t('thread.resolve')}
          armed
          data-tour-swipe=""
        />
      )}
      <div className={classNames(SwipeTrack, swiped && css.Swiped)}>
        <CompactThreadCard viewModel={sampleCard(id, state, t, now, language)} onClick={nothing} />
        <CompactCardActions
          pinned={pinned}
          showResolveAction={!touchCards && !pinned && !state.resolved}
          showPinAction={!touchCards}
          menuOpen={menuOpen}
        />
      </div>
    </div>
  );
}

/** The Compact view: real `RoomThreadOverview`, real `PinnedThreadsSection`, then the other cards. */
function CardList(props: RoomProps & { touchCards: boolean }) {
  const { scene, live } = props;
  const paneRef = useRef<HTMLDivElement>(null);
  const ids = scene.cards.map(({ id }) => id);
  useFlipList(paneRef, [ids.join(','), scene.pinned.join(','), scene.filterBar].join('|'));
  const isPinned = (id: SampleThreadId) => scene.pinned.includes(id);
  const pinnedCards = scene.cards.filter(({ id }) => isPinned(id));
  const unpinnedCards = scene.cards.filter(({ id }) => !isPinned(id));
  const renderCard = (card: SceneCard) => (
    <SampleCardRow key={card.id} {...props} card={card} pinned={isPinned(card.id)} />
  );
  return (
    <div ref={paneRef} className={css.Body}>
      {scene.filterBar && <TourFilterBar scene={scene} live={live} />}
      <div className={css.CardList} data-tour-cards="">
        {pinnedCards.length > 0 && (
          <PinnedThreadsSection data-tour-pinned="" {...mark(live, 'pinnedSection')}>
            {pinnedCards.map(renderCard)}
          </PinnedThreadsSection>
        )}
        {unpinnedCards.map(renderCard)}
      </div>
    </div>
  );
}

type MessageRowProps = {
  message: SampleMessage;
  ts: number;
  replyCount?: number;
  participants?: readonly ThreadIndicatorParticipant[];
  isResolved?: boolean;
};

/** A message rendered with the real timeline primitives (`MessageBase`, `ModernLayout`, `Time`). */
function MessageRow({ message, ts, replyCount = 0, participants, isResolved }: MessageRowProps) {
  const { t } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  return (
    <MessageBase space="300" className={css.Arriving} data-tour-message={message.sender}>
      <ModernLayout
        before={
          <AvatarBase>
            <Avatar size="300">
              <AvatarFallback style={getAvatarFallbackStyle(sampleUserId(message.sender))}>
                <Icon filled size="200" src={Icons.User} />
              </AvatarFallback>
            </Avatar>
          </AvatarBase>
        }
      >
        <Box
          className={toolbarCss.SenderLine}
          gap="300"
          justifyContent="SpaceBetween"
          alignItems="Center"
          grow="Yes"
        >
          <Username>
            <Text as="span" size="T400" truncate>
              <UsernameBold>{sampleName(message.sender, t)}</UsernameBold>
            </Text>
          </Username>
          <Time ts={ts} hour24Clock={hour24Clock} />
        </Box>
        <MessageTextBody>
          {t(`tour.sample.${message.text}`)}
          {message.streaming && (
            <>
              {' '}
              <ThreadStreamingDot aria-hidden="true" />
            </>
          )}
        </MessageTextBody>
        {replyCount > 0 && (
          <ThreadIndicatorChip
            as="span"
            replyCount={replyCount}
            participants={participants}
            isResolved={isResolved}
            className={css.ReplyChip}
            data-tour-reply-count=""
          />
        )}
      </ModernLayout>
    </MessageBase>
  );
}

/** The Threads view: each thread's first message with its reply chip, the newest thread first. */
function MessageList({ scene, now }: Pick<RoomProps, 'scene' | 'now'>) {
  const { t } = useTranslation();
  return (
    <div className={css.Body}>
      <div className={css.Messages}>
        {scene.cards.map(({ id, state }) => (
          <MessageRow
            key={id}
            message={sampleRootMessage(id)}
            ts={sampleActivityTs(id, state, now)}
            replyCount={sampleReplyCount(id, state)}
            participants={sampleReplyParticipants(id, state, t)}
            isResolved={state.resolved}
          />
        ))}
      </div>
    </div>
  );
}

/** The open thread: real banner frame/actions + `ThreadRootTitle`, then its messages. */
function ThreadPane({ scene, phone, live, now }: Omit<RoomProps, 'touchCards'>) {
  const { t, i18n } = useTranslation();
  const bannerRef = useRef<HTMLDivElement>(null);
  useTourMarks(bannerRef, live, [['button', 'back']]);
  return (
    <div className={css.Body}>
      <div className={css.Thread} {...mark(live, 'thread')}>
        <div ref={bannerRef} className={bannerCss.Banner} data-thread-context-banner="true">
          <div className={bannerCss.TitleRow}>
            <ThreadBannerBackButton
              phone={phone}
              label={t('thread.back')}
              rtl={i18n.dir() === 'rtl'}
              onBack={nothing}
            />
            <div className={bannerCss.TitleColumn}>
              <Box className={bannerCss.EyebrowRow} direction="Row" alignItems="Center" gap="200" />
              <div className={bannerCss.SubtitleRow}>
                <ThreadRootTitle text={t('tour.sample.typed')} whole={phone} />
              </div>
            </div>
            <ThreadBannerActions showPinButton={!phone} showResolveButton={!phone} />
          </div>
        </div>
        <div className={css.Messages}>
          {scene.thread?.messages.map((message) => (
            <MessageRow key={message.text} message={message} ts={now} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The composer: real `ComposerIconButton` controls around the placeholder or typed text. */
function Composer({ scene, phone, live }: Omit<RoomProps, 'now' | 'touchCards'>) {
  const { t } = useTranslation();
  const typed = sampleGraphemes(t('tour.sample.typed')).slice(0, scene.typed).join('');
  const before: Array<[string, IconSrc]> = [
    [t('composer.attach'), Icons.PlusCircle],
    [t('composer.dictation.label'), Icons.Mic],
    ...(phone ? [] : [[t('composer.formatting'), Icons.Text] as [string, IconSrc]]),
  ];
  return (
    <div
      className={css.Composer}
      {...mark(live, scene.view === 'thread' ? 'replyBox' : 'composer')}
    >
      <div className={classNames(editorCss.Editor, glassDenseOverBackdrop)}>
        <Box alignItems="Center">
          <Box shrink="No" gap="100" alignItems="Center" className={editorCss.EditorOptions}>
            {before.map(([label, icon]) => (
              <ComposerIconButton key={label} label={label} icon={icon} onPress={nothing} />
            ))}
          </Box>
          <div className={css.ComposerText} data-tour-composer-text="">
            {typed ? (
              <>
                <span>{typed}</span>
                <span className={css.Caret} />
              </>
            ) : (
              <span className={css.ComposerPlaceholder}>{t('composer.placeholder')}</span>
            )}
          </div>
          <Box shrink="No" gap="100" alignItems="Center" className={editorCss.EditorOptions}>
            {!phone && (
              <ComposerIconButton
                label={t('composer.emoji')}
                icon={Icons.Smile}
                onPress={nothing}
              />
            )}
            <ComposerIconButton
              label={t('composer.sendMessage')}
              icon={Icons.Send}
              variant="Primary"
              directional
              onPress={nothing}
            />
          </Box>
        </Box>
      </div>
    </div>
  );
}

/** The icon rail in `SidebarNav.tsx` top stack order: Home, Direct, Activity, Threads. */
function Rail({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const tabs: Array<{ id: string; icon: IconSrc; active?: boolean; bell?: boolean }> = [
    { id: 'home', icon: Icons.Home, active: true },
    { id: 'direct', icon: Icons.User },
    { id: 'activity', icon: Icons.Bell, bell: true },
    { id: 'threads', icon: Icons.Thread },
  ];
  return (
    <Sidebar className={css.Rail} data-tour-rail="">
      <SidebarStack>
        {tabs.map((tab) => (
          <SidebarItem key={tab.id} active={tab.active}>
            <SidebarAvatar
              as="span"
              outlined={tab.bell}
              {...(tab.bell ? mark(live, 'bell') : undefined)}
            >
              <Icon filled={tab.bell ? scene.activity : tab.active} src={tab.icon} />
            </SidebarAvatar>
            {tab.bell && (
              <SidebarItemBadge hasCount>
                <ActivityBadge count={ACTIVITY_ROWS.length} needsYou />
              </SidebarItemBadge>
            )}
          </SidebarItem>
        ))}
      </SidebarStack>
    </Sidebar>
  );
}

/** A phone's top bar, reusing `PhoneTopBar.css` and `SearchField.css`. */
function PhoneBar({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const { t } = useTranslation();
  return (
    <div className={phoneBarCss.PhoneTopBar} data-tour-phone-bar="">
      <div className={phoneBarCss.MenuButtonFrame}>
        <IconButton
          size="400"
          radii="300"
          variant="Background"
          fill="None"
          className={phoneBarCss.BarControl}
        >
          <Icon size="400" src={MenuIcon} />
        </IconButton>
      </div>
      <div
        className={classNames(
          searchFieldCss.SearchField,
          phoneBarCss.SearchField,
          phoneBarCss.BarControl
        )}
      >
        <Icon size="100" src={Icons.Search} />
        <Text as="span" size="T300" truncate className={searchFieldCss.SearchPlaceholder}>
          {t('commandPalette.findAnything')}
        </Text>
      </div>
      <div className={phoneBarCss.BellFrame} {...mark(live, 'bell')}>
        <IconButton
          size="400"
          radii="300"
          variant="Background"
          fill="None"
          className={phoneBarCss.BarControl}
        >
          <Icon size="400" filled={scene.activity} src={Icons.Bell} />
        </IconButton>
        <span className={phoneBarCss.BellBadge}>
          <ActivityBadge count={ACTIVITY_ROWS.length} needsYou />
        </span>
      </div>
      <Avatar size="300" radii="Pill" style={{ flexShrink: 0 }}>
        <AvatarFallback style={getAvatarFallbackStyle(sampleUserId('you'))}>
          <Icon filled size="200" src={Icons.User} />
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

type SampleActivityRow = {
  kind: 'approval' | 'finished' | 'mention';
  sender: SampleSender;
  thread: SampleThreadId;
  preview: SampleTextKey | 'approval';
  age: number;
};

/** One row for each thing the Activity step mentions: an approval waiting, a finished run, a mention. */
const ACTIVITY_ROWS: readonly SampleActivityRow[] = [
  { kind: 'approval', sender: 'analyst', thread: 'budget', preview: 'approval', age: 3 * 60_000 },
  { kind: 'finished', sender: 'writer', thread: 'launch', preview: 'launchReply', age: 60_000 },
  { kind: 'mention', sender: 'ana', thread: 'vendor', preview: 'vendorReply', age: 2 * 3_600_000 },
];
// `approval` is Needs you, `finished` is an unread reply/run in your thread (Replies 1), `mention` is Mentions 1.
const ACTIVITY_TAB_COUNTS = { all: 3, mentions: 1, replies: 1, needsYou: 1 } as const;

/**
 * The bell's list: real `ActivityListHeader`, `ActivityListTabs`, and `ActivityRowView` inside the
 * desktop popover or phone sheet. Drawn over the spotlight's shade so it stays clear.
 */
export function TourStageActivity({ phone, now }: Pick<RoomProps, 'phone' | 'now'>) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const renderRow = (row: SampleActivityRow) => {
    const waits = row.kind === 'approval';
    return (
      <ActivityRowView
        key={row.kind}
        data-tour-activity-row={row.kind}
        kind={row.kind}
        needsYou={waits}
        unread
        avatarUserId={sampleUserId(row.sender)}
        avatarAlt={sampleName(row.sender, t)}
        sentence={t(`activity.sentence.${row.kind}`, { name: sampleName(row.sender, t) })}
        time={formatCompactRelativeTime(now - row.age, language)}
        preview={t(`tour.sample.${row.preview}`)}
        context={{ title: t(`tour.sample.${row.thread}Title`), room: t('tour.sample.room') }}
        actions={
          waits && (
            <div className={activityCss.Actions}>
              <ActivityApprovalButtons />
            </div>
          )
        }
      />
    );
  };

  // On a phone's shorter stage, show two complete representative rows so none clips at the edge.
  const rows = phone ? ACTIVITY_ROWS.slice(0, 2) : ACTIVITY_ROWS;
  const [waiting, ...rest] = rows;
  const list = (
    <div className={activityCss.List}>
      <ActivityListHeader
        variant={phone ? 'sheet' : 'popover'}
        onExpand={phone ? undefined : nothing}
      />
      <ActivityListTabs tab="all" unreadByTab={ACTIVITY_TAB_COUNTS} />
      <div className={activityCss.Rows}>
        {waiting && renderRow(waiting)}
        <Text size="L400" priority="300" className={activityCss.Divider}>
          {t('activity.days.today')}
        </Text>
        {rest.map(renderRow)}
      </div>
    </div>
  );

  if (phone) {
    return (
      <div className={css.ActivitySheet} data-tour-activity="">
        <Header size="500" className={css.SheetHeader}>
          <Box grow="Yes">
            <Text size="H4">{t('activity.title')}</Text>
          </Box>
          <DialogCloseButton label={t('activity.close')} onClick={nothing} />
        </Header>
        {list}
      </div>
    );
  }
  return (
    <div className={css.ActivityPanel} data-tour-activity="">
      <Menu className={classNames(css.ActivityMenu, glassDenseOverBackdrop)}>{list}</Menu>
    </div>
  );
}

/**
 * Draws one scene of the tour's sample room by reusing the app's own presentational components.
 * Needs no Matrix client and does nothing when pressed.
 */
export function TourStageRoom(props: RoomProps) {
  const { scene, phone, live } = props;
  const touchCards = props.touchCards ?? phone;
  // A phone's open thread has its banner for a header: one Back, not two.
  const header = scene.header && !(phone && scene.view === 'thread');
  const menuCard =
    scene.view === 'list' && scene.menuOn
      ? scene.cards.find((card) => card.id === scene.menuOn)
      : undefined;
  return (
    <ScreenSizeProvider value={phone ? ScreenSize.Mobile : ScreenSize.Desktop}>
      {scene.bell && !phone && <Rail scene={scene} live={live} />}
      <div className={css.Page}>
        {scene.bell && phone && <PhoneBar scene={scene} live={live} />}
        {header && <RoomHeader scene={scene} phone={phone} live={live} />}
        {scene.view === 'list' && <CardList {...props} touchCards={touchCards} />}
        {scene.view === 'thread' && <ThreadPane {...props} />}
        {scene.view === 'messages' && <MessageList scene={scene} now={props.now} />}
        {scene.composer && <Composer scene={scene} phone={phone} live={live} />}
        {menuCard && (
          <CardMenu
            phone={phone}
            live={live}
            pinned={scene.pinned.includes(menuCard.id)}
            state={menuCard.state}
          />
        )}
        {scene.roomMenu && <RoomMenu scene={scene} live={live} />}
      </div>
    </ScreenSizeProvider>
  );
}
