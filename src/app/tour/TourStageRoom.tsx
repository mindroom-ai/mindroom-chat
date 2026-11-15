import { useEffect, useLayoutEffect, useRef } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Text,
  type IconSrc,
} from 'folds';
import { IconFilter, IconMessages, IconSortDescending } from '@tabler/icons-react';
import * as activityCss from '../activity/ActivityList.css';
import { getAvatarFallbackStyle } from '../avatars/UserAvatar';
import * as editorCss from '../editor/Editor.css';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { localDigits } from '../lib/localDigits';
import { formatCompactRelativeTime } from '../lib/time';
import * as toolbarCss from '../messages/styles.css';
import * as indicatorCss from '../messages/ThreadIndicator.css';
import { CompactViewIcon } from '../room/CompactViewIcon';
import { SwipeAction } from '../threads/overview/CompactCardSwipe.css';
import { PinnedSection, TitleText } from '../threads/overview/CompactRoomView.css';
import { CompactThreadCard } from '../threads/overview/CompactThreadCard';
import * as overviewCss from '../threads/overview/RoomThreadOverview.css';
import * as bannerCss from '../threads/ThreadContextBanner.css';
import { ThreadStreamingDot } from '../threads/ThreadStreamingDot';
import { IconButton as GlassIconButton, Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
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
  sampleRootMessage,
  sampleUserId,
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
  /** Draws a phone's room: a back chevron, a room menu, no buttons on pointing at a card. */
  phone: boolean;
  /**
   * Whether this is the view the tour is on. A view that is fading out under the next one is
   * drawn without its marks, so each part is in the stage once.
   */
  live: boolean;
  /** The time the sample room counts its ages from. */
  now: number;
};

/** The attribute that names a part of the stage, on the view the tour is on. */
const mark = (live: boolean, part: TourPart) => (live ? { 'data-tour-part': part } : undefined);

/** Nothing in the stage does anything: it shows the room, and the dialog's text explains it. */
const nothing = () => undefined;

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

/** A sample person's avatar: no picture, so the app's fallback in the color of their ID. */
function PersonAvatar({ sender, letter }: { sender: SampleSender; letter?: boolean }) {
  const { t } = useTranslation();
  const name = sampleName(sender, t);
  return (
    <Avatar size="300" radii={letter ? '400' : 'Pill'}>
      <AvatarFallback style={getAvatarFallbackStyle(sampleUserId(sender))}>
        {letter ? (
          <Text as="span" size="H6">
            {Array.from(name)[0]?.toUpperCase()}
          </Text>
        ) : (
          <Icon size="100" src={Icons.User} filled />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

function HeaderButton({
  label,
  icon,
  active = false,
  part,
}: {
  label: string;
  icon: IconSrc;
  active?: boolean;
  part?: { 'data-tour-part': TourPart };
}) {
  return (
    <IconButton
      size="400"
      radii="300"
      variant={active ? 'Primary' : 'Surface'}
      fill={active ? 'Soft' : 'None'}
      aria-label={label}
      {...part}
    >
      <Icon size="400" src={icon} />
    </IconButton>
  );
}

/** The room's header: its avatar and name, the view switch, the filter button and the menu. */
function RoomHeader({ scene, phone, live }: Omit<RoomProps, 'now'>) {
  const { t } = useTranslation();
  const name = (
    <Text as="span" size="H5" truncate className={css.HeaderName}>
      {t('tour.sample.room')}
    </Text>
  );
  const menuButton = (
    <HeaderButton
      label={t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions')}
      icon={Icons.VerticalDots}
    />
  );
  if (phone) {
    // A phone keeps the view switch and the filter button in the room menu.
    return (
      <div className={classNames(css.Header, css.PhoneHeader)} data-tour-header="">
        <IconButton
          size="400"
          radii="300"
          variant="Surface"
          fill="None"
          aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
        >
          <Icon src={Icons.ChevronLeft} className={css.BackChevron} data-directional />
        </IconButton>
        {name}
        {menuButton}
      </div>
    );
  }
  // Inside a thread the room's view and filters do not apply.
  const inRoom = scene.view !== 'thread';
  return (
    <div className={css.Header} data-tour-header="">
      <Avatar size="300" radii="400">
        <AvatarFallback style={getAvatarFallbackStyle(SAMPLE_ROOM_ID)}>
          <Icon size="200" src={Icons.Hash} filled />
        </AvatarFallback>
      </Avatar>
      {name}
      <div className={css.HeaderButtons}>
        {inRoom && (
          <HeaderButton
            label={t('mindroomUi.threads.mindroomRoomViewHeader.compactView')}
            icon={CompactViewIcon}
            active={scene.view === 'list'}
            part={mark(live, 'viewSwitch')}
          />
        )}
        {inRoom && (
          <HeaderButton
            label={t('mindroomUi.threads.roomThreadOverview.threadFilters')}
            icon={Icons.Filter}
            part={mark(live, 'filterButton')}
          />
        )}
        {menuButton}
      </div>
    </div>
  );
}

/** A phone's room menu, which holds the view switch and the filter button there. */
function RoomMenu({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const { t } = useTranslation();
  const check = <Icon size="100" src={Icons.Check} />;
  return (
    <div className={css.RoomMenu} data-tour-room-menu="">
      <Menu className={glassDenseOverBackdrop}>
        <MenuGroup>
          <MenuEntry
            label={t('mindroomUi.threads.mindroomRoomViewHeader.compactView')}
            icon={CompactViewIcon}
            after={scene.view === 'list' ? check : undefined}
            onSelect={nothing}
            {...mark(live, 'viewSwitch')}
          />
          <MenuEntry
            label={t('mindroomUi.threads.roomThreadOverview.threadFilters')}
            icon={Icons.Filter}
            after={scene.filterBar ? check : undefined}
            onSelect={nothing}
            {...mark(live, 'filterButton')}
          />
          <MenuEntry
            label={t('mindroomUi.messages.showToolCalls')}
            icon={Icons.Terminal}
            onSelect={nothing}
          />
        </MenuGroup>
      </Menu>
    </div>
  );
}

/** The simple thread filters: the count, Unresolved, the sort button and Advanced filters. */
function FilterBar({ count, live }: { count: number; live: boolean }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  return (
    <div className={classNames(overviewCss.Overview, css.Arriving)} {...mark(live, 'filterBar')}>
      <div className={overviewCss.ToolbarHeader}>
        <span className={overviewCss.CompactCount}>
          <IconMessages size={14} stroke={1.8} aria-hidden="true" />
          <Text size="T200">{localDigits(String(count), language)}</Text>
        </span>
        {/* Compact hides resolved threads, so Unresolved is on. */}
        <span className={classNames(overviewCss.SortButton, overviewCss.SortButtonActive)}>
          <Text size="T200">{t('thread.simpleFilter.unresolved')}</Text>
        </span>
        <span className={overviewCss.SortButton}>
          <Text size="T200">{t('mindroomUi.threads.roomThreadOverview.lastReply')}</Text>
          <IconSortDescending size={14} stroke={1.8} aria-hidden="true" />
        </span>
        <span
          className={overviewCss.ToggleButton}
          title={t('mindroomUi.threads.roomThreadOverview.advancedFilters')}
        >
          <IconFilter size={14} stroke={1.8} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/**
 * A thread's menu with the entries of Thread options that the tour's steps name, and the one
 * after them. It leaves out Open thread and Regenerate summary, so that all of it fits a phone's
 * stage.
 */
function CardMenu({ phone, live }: Pick<RoomProps, 'phone' | 'live'>) {
  const { t } = useTranslation();
  return (
    <div className={classNames(css.CardMenu, phone && css.PhoneCardMenu)} data-tour-card-menu="">
      <Menu className={glassDenseOverBackdrop}>
        <MenuGroup>
          <MenuEntry label={t('threadActions.tags')} icon={Icons.Bookmark} onSelect={nothing} />
          <MenuEntry
            label={t('threadActions.editSummary')}
            icon={Icons.Pencil}
            onSelect={nothing}
          />
          <MenuEntry label={t('thread.resolve')} icon={Icons.CheckTwice} onSelect={nothing} />
          <MenuEntry
            label={t('thread.snooze')}
            icon={Icons.Clock}
            onSelect={nothing}
            {...mark(live, 'menuSnooze')}
          />
          <MenuEntry label={t('threadNav.pin')} icon={Icons.Pin} onSelect={nothing} />
          <MenuEntry label={t('threadActions.copy')} icon={Icons.Link} onSelect={nothing} />
        </MenuGroup>
      </Menu>
    </div>
  );
}

type SampleCardRowProps = RoomProps & {
  card: SceneCard;
  pinned: boolean;
  /** Fades in and settles: a card of the list as it first shows. */
  arriving: boolean;
};

/** One thread: the app's card with sample data, and around it the card's buttons and menu. */
function SampleCardRow({ card, scene, phone, live, now, pinned, arriving }: SampleCardRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const shellRef = useRef<HTMLDivElement>(null);
  const { id, state } = card;
  const viewModel = sampleCard(id, state, t, now, language);
  const menuOpen = scene.menuOn === id;
  // A wider screen shows a card's buttons under the pointer; a touch screen swipes the card.
  const pointed = !phone && scene.actionsOn === id;
  const swiped = phone && scene.actionsOn === id;
  const moreLabel = t('threadActions.more');

  // The card draws its own title, so its mark is set on the element the card rendered.
  useLayoutEffect(() => {
    const title = shellRef.current?.getElementsByClassName(TitleText)[0];
    if (live) title?.setAttribute('data-tour-part', `title:${id}`);
    else title?.removeAttribute('data-tour-part');
  });

  return (
    <div
      ref={shellRef}
      className={classNames(
        css.CardShell,
        phone && css.PhoneCardShell,
        pointed && css.CardShellHovered,
        menuOpen && css.CardShellRaised,
        arriving && css.Arriving
      )}
      data-flip-key={id}
      data-tour-card={id}
      {...mark(live, `card:${id}`)}
    >
      {swiped && (
        <div className={SwipeAction} data-armed="true" data-tour-swipe="">
          <Icon size="200" src={Icons.Check} />
          <Text size="B300">{t('thread.resolve')}</Text>
        </div>
      )}
      <div className={classNames(css.SwipeTrack, swiped && css.Swiped)}>
        <CompactThreadCard viewModel={viewModel} onClick={nothing} />
        {phone && (
          <IconButton
            className={css.CardMenuButton}
            size="300"
            variant="Secondary"
            fill="None"
            radii="300"
            aria-label={moreLabel}
          >
            <Icon size="100" src={Icons.HorizontalDots} />
          </IconButton>
        )}
        {pointed && (
          <div className={css.CardActions}>
            {/* A pinned or resolved thread has no Resolve button, as in the app. */}
            {!pinned && !state.resolved && (
              <IconButton
                size="300"
                variant="Secondary"
                fill="None"
                radii="300"
                aria-label={t('thread.resolve')}
                {...mark(live, 'resolveButton')}
              >
                <Icon size="100" src={Icons.Check} />
              </IconButton>
            )}
            <IconButton
              size="300"
              variant="Secondary"
              fill="None"
              radii="300"
              aria-label={t('threadNav.pin')}
            >
              <Icon size="100" src={Icons.Pin} filled={pinned} />
            </IconButton>
            <IconButton
              size="300"
              variant="Secondary"
              fill="None"
              radii="300"
              aria-label={moreLabel}
            >
              <Icon size="100" src={Icons.HorizontalDots} />
            </IconButton>
          </div>
        )}
      </div>
      {menuOpen && <CardMenu phone={phone} live={live} />}
    </div>
  );
}

/** The Compact view: the filter bar when it shows, the Pinned section, then the other cards. */
function CardList(props: RoomProps) {
  const { scene, live } = props;
  const { t } = useTranslation();
  const paneRef = useRef<HTMLDivElement>(null);
  const ids = scene.cards.map(({ id }) => id);
  // The cards glide when their order changes, a card is pinned, or the bar moves them down.
  useFlipList(paneRef, [ids.join(','), scene.pinned.join(','), scene.filterBar].join('|'));
  // Only the cards the list first shows arrive; one that changes its section just moves.
  const arriving = useRef(true);
  useEffect(() => {
    arriving.current = false;
  }, []);

  const isPinned = (id: SampleThreadId) => scene.pinned.includes(id);
  const renderCard = (card: SceneCard) => (
    <SampleCardRow
      key={card.id}
      {...props}
      card={card}
      pinned={isPinned(card.id)}
      arriving={arriving.current}
    />
  );
  const pinnedCards = scene.cards.filter(({ id }) => isPinned(id));

  return (
    // The cards' places count from here, so the bar above them moves them too.
    <div ref={paneRef} className={css.Body}>
      {scene.filterBar && <FilterBar count={scene.cards.length} live={live} />}
      <div className={css.CardList} data-tour-cards="">
        {pinnedCards.length > 0 && (
          <Box direction="Column" gap="100" className={PinnedSection} data-tour-pinned="">
            <div className={css.PinnedHeading}>
              <Icon src={Icons.Pin} size="100" />
              <Text as="span" size="L400">
                {t('threadNav.pinned')}
              </Text>
            </div>
            {pinnedCards.map(renderCard)}
          </Box>
        )}
        {scene.cards.filter(({ id }) => !isPinned(id)).map(renderCard)}
      </div>
    </div>
  );
}

type MessageRowProps = {
  message: SampleMessage;
  /** When it was sent. */
  ts: number;
  /** The replies of the thread it starts, shown under it as the Threads view does. */
  replyCount?: number;
};

/** A message as the timeline shows it: avatar, name, time and text. */
function MessageRow({ message, ts, replyCount = 0 }: MessageRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const text: SampleTextKey = message.text;
  return (
    <div className={classNames(css.Message, css.Arriving)} data-tour-message={message.sender}>
      <PersonAvatar sender={message.sender} letter />
      <div className={css.MessageBody}>
        <div className={css.MessageHead}>
          <Text as="span" size="T300">
            <b>{sampleName(message.sender, t)}</b>
          </Text>
          <Text as="span" size="T200" priority="300">
            {new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(ts)}
          </Text>
        </div>
        <Text as="span" size="T400" className={css.MessageText}>
          {t(`tour.sample.${text}`)}
          {message.streaming && <ThreadStreamingDot aria-hidden="true" />}
        </Text>
        {replyCount > 0 && (
          <span
            className={classNames(indicatorCss.ThreadIndicator, css.ReplyChip)}
            data-tour-reply-count=""
          >
            <Icon size="50" src={Icons.Thread} />
            <Text as="span" className={indicatorCss.ThreadIndicatorLabel} size="L400">
              {t('thread.replyCount', { count: replyCount })}
            </Text>
          </span>
        )}
      </div>
    </div>
  );
}

/** The Threads view: each thread's first message with its reply count, the newest thread first. */
function MessageList({ scene, now }: Pick<RoomProps, 'scene' | 'now'>) {
  return (
    <div className={css.Body}>
      <div className={css.Messages}>
        {scene.cards.map(({ id, state }) => (
          <MessageRow
            key={id}
            message={sampleRootMessage(id)}
            ts={sampleActivityTs(id, state, now)}
            replyCount={sampleReplyCount(id, state)}
          />
        ))}
      </div>
    </div>
  );
}

/** The open thread: its banner with Back and its title, then its messages. */
function ThreadPane({ scene, phone, live, now }: RoomProps) {
  const { t } = useTranslation();
  const backLabel = t('thread.back');
  return (
    <div className={css.Body}>
      <div className={css.Thread} {...mark(live, 'thread')}>
        <div className={bannerCss.Banner}>
          <div className={bannerCss.TitleRow}>
            {phone ? (
              <IconButton
                size="400"
                radii="300"
                variant="Surface"
                fill="None"
                aria-label={backLabel}
                {...mark(live, 'back')}
              >
                <Icon src={Icons.ChevronLeft} className={css.BackChevron} data-directional />
              </IconButton>
            ) : (
              <IconButton
                className={toolbarCss.MessageOptionsButton}
                variant="SurfaceVariant"
                fill="None"
                aria-label={backLabel}
                {...mark(live, 'back')}
              >
                <Icon data-directional src={Icons.ArrowLeft} />
              </IconButton>
            )}
            <div className={bannerCss.TitleColumn}>
              {/* Until an agent writes a title, a thread is named by its first message. */}
              <div className={bannerCss.EyebrowRow} />
              <div className={bannerCss.SubtitleRow}>
                <Text as="span" className={bannerCss.SummaryText} size="T300" truncate>
                  {t('tour.sample.typed')}
                </Text>
              </div>
            </div>
            <IconButton
              className={toolbarCss.MessageOptionsButton}
              variant="SurfaceVariant"
              fill="None"
              aria-label={t('threadActions.more')}
            >
              <Icon src={Icons.VerticalDots} size="100" />
            </IconButton>
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

function ComposerButton({ icon, primary = false }: { icon: IconSrc; primary?: boolean }) {
  return (
    <GlassIconButton variant={primary ? 'Primary' : 'SurfaceVariant'} radii="300" size="300">
      <Icon src={icon} data-directional={primary || undefined} />
    </GlassIconButton>
  );
}

/** The composer: its buttons around the placeholder, or around what is typed so far. */
function Composer({ scene, phone, live }: Omit<RoomProps, 'now'>) {
  const { t } = useTranslation();
  const typed = sampleGraphemes(t('tour.sample.typed')).slice(0, scene.typed).join('');
  return (
    // In an open thread the same box writes a reply.
    <div
      className={css.Composer}
      {...mark(live, scene.view === 'thread' ? 'replyBox' : 'composer')}
    >
      <div className={classNames(editorCss.Editor, glassDenseOverBackdrop)}>
        <Box alignItems="Center">
          <Box shrink="No" gap="100" alignItems="Center" className={editorCss.EditorOptions}>
            <ComposerButton icon={Icons.PlusCircle} />
            <ComposerButton icon={Icons.Mic} />
            {!phone && <ComposerButton icon={Icons.Text} />}
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
            {!phone && <ComposerButton icon={Icons.Smile} />}
            <ComposerButton icon={Icons.Send} primary />
          </Box>
        </Box>
      </div>
    </div>
  );
}

/** The bell's count: red, as something waits for an answer. */
function BellCount() {
  const language = useAppLanguageCode();
  return (
    <Badge variant="Critical" fill="Solid" radii="Pill" size="400">
      <Text as="span" size="L400">
        {localDigits(String(ACTIVITY_ROWS.length), language)}
      </Text>
    </Badge>
  );
}

/** The icon rail with the Activity bell, as wider screens have it beside the page. */
function Rail({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  return (
    <Sidebar as="div" className={css.Rail} data-tour-rail="">
      <SidebarStack>
        <SidebarItem active>
          <SidebarAvatar outlined>
            <Icon src={Icons.Home} filled />
          </SidebarAvatar>
        </SidebarItem>
        <SidebarItem>
          <SidebarAvatar outlined {...mark(live, 'bell')}>
            <Icon src={Icons.Bell} filled={scene.activity} />
          </SidebarAvatar>
          <SidebarItemBadge hasCount>
            <BellCount />
          </SidebarItemBadge>
        </SidebarItem>
      </SidebarStack>
    </Sidebar>
  );
}

/** A phone's top bar, which holds the bell there: menu, search, bell and account. */
function PhoneBar({ scene, live }: Pick<RoomProps, 'scene' | 'live'>) {
  const { t } = useTranslation();
  return (
    <div className={css.PhoneBar} data-tour-phone-bar="">
      <IconButton
        size="400"
        radii="300"
        variant="Background"
        aria-label={t('featureUi.phoneNav.navigation')}
      >
        <Icon src={MenuIcon} />
      </IconButton>
      <div className={css.PhoneSearch}>
        <Icon size="100" src={Icons.Search} />
      </div>
      <div className={css.BellFrame}>
        <IconButton
          size="400"
          radii="Pill"
          variant="Background"
          aria-label={t('activity.bellLabel')}
          {...mark(live, 'bell')}
        >
          <Icon size="200" src={Icons.Bell} filled={scene.activity} />
        </IconButton>
        <span className={css.BellBadge}>
          <BellCount />
        </span>
      </div>
      <PersonAvatar sender="you" />
    </div>
  );
}

type ActivityKind = 'approval' | 'finished' | 'mention';

type ActivityRow = {
  kind: ActivityKind;
  sender: SampleSender;
  thread: SampleThreadId;
  /** The row's second line: a key of the sample room, or the tool an approval is for. */
  preview: SampleTextKey | 'approval';
  /** How many ms ago it happened. */
  age: number;
};

// What waits for an answer comes first, then the newest.
const ACTIVITY_ROWS: readonly ActivityRow[] = [
  { kind: 'approval', sender: 'analyst', thread: 'budget', preview: 'approval', age: 3 * 60_000 },
  { kind: 'finished', sender: 'writer', thread: 'launch', preview: 'launchReply', age: 60_000 },
  { kind: 'mention', sender: 'ana', thread: 'vendor', preview: 'vendorReply', age: 2 * 3_600_000 },
];

const ACTIVITY_MARKS: Record<ActivityKind, { icon: IconSrc; className: string }> = {
  approval: { icon: Icons.Lock, className: activityCss.KindAttention },
  finished: { icon: Icons.Check, className: activityCss.KindDone },
  mention: { icon: Icons.Mention, className: activityCss.KindMention },
};

/** A row of Activity: who did what, a preview, its thread and room, and its answer buttons. */
function ActivityRowItem({ row, now }: { row: ActivityRow; now: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const kind = ACTIVITY_MARKS[row.kind];
  const waits = row.kind === 'approval';
  return (
    <div
      className={classNames(activityCss.Row, waits && activityCss.RowNeedsYou)}
      data-tour-activity-row={row.kind}
    >
      <div className={activityCss.AvatarSlot}>
        <PersonAvatar sender={row.sender} />
        <span className={classNames(activityCss.KindBadge, kind.className)}>
          <Icon size="50" src={kind.icon} />
        </span>
      </div>
      <div className={activityCss.Body}>
        <span className={activityCss.Line}>
          <Text as="span" size="T300" className={activityCss.Sentence}>
            <b>{t(`activity.sentence.${row.kind}`, { name: sampleName(row.sender, t) })}</b>
          </Text>
          <Text as="span" size="T200" priority="300">
            {formatCompactRelativeTime(now - row.age, language)}
          </Text>
          <span className={activityCss.UnreadDot} />
        </span>
        <Text as="span" size="T200" priority="400" className={activityCss.Preview}>
          {t(`tour.sample.${row.preview}`)}
        </Text>
        <span className={activityCss.Context}>
          <Text as="span" size="T200" priority="300" truncate>
            {t(`tour.sample.${row.thread}Title`)}
          </Text>
          <Text as="span" size="T200" priority="300">
            ·
          </Text>
          <Text as="span" size="T200" priority="300" truncate>
            {t('tour.sample.room')}
          </Text>
        </span>
        {waits && (
          <div className={activityCss.Actions}>
            <Button size="300" variant="Success" fill="Soft" radii="300">
              <Text size="B300">{t('activity.actions.approve')}</Text>
            </Button>
            <Button size="300" variant="Secondary" fill="Soft" radii="300">
              <Text size="B300">{t('activity.actions.deny')}</Text>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The bell's list: beside the rail on a wider screen, a sheet from the bottom on a phone. The
 * stage draws it over the spotlight's shade, so the list stays as clear as the bell it opens from.
 */
export function TourStageActivity({ phone, now }: Pick<RoomProps, 'phone' | 'now'>) {
  const { t } = useTranslation();
  const list = (
    <>
      <Text as="span" size="H5" className={css.ActivityTitle}>
        {t('activity.title')}
      </Text>
      <div className={activityCss.Rows}>
        {ACTIVITY_ROWS.map((row) => (
          <ActivityRowItem key={row.kind} row={row} now={now} />
        ))}
      </div>
    </>
  );
  if (phone) {
    return (
      <div className={css.ActivitySheet} data-tour-activity="">
        <div className={css.SheetHandle} />
        <Box direction="Column">{list}</Box>
      </div>
    );
  }
  return (
    <div className={css.ActivityPanel} data-tour-activity="">
      <Menu className={glassDenseOverBackdrop}>
        <Box direction="Column">{list}</Box>
      </Menu>
    </div>
  );
}

/**
 * Draws one scene of the tour's sample room at the app's own sizes: the header, then the cards,
 * an open thread or the messages, then the composer, with the menus, the filter bar and the bell
 * a scene asks for (the bell's list is `TourStageActivity`). The cards are the app's; the rest is drawn with its icons, labels and
 * styles. It needs no Matrix client and does nothing when pressed.
 */
export function TourStageRoom(props: RoomProps) {
  const { scene, phone, live } = props;
  // A phone's open thread has its banner for a header: one Back, not two.
  const header = scene.header && !(phone && scene.view === 'thread');
  return (
    <>
      {scene.bell && !phone && <Rail scene={scene} live={live} />}
      <div className={css.Page}>
        {scene.bell && phone && <PhoneBar scene={scene} live={live} />}
        {header && <RoomHeader scene={scene} phone={phone} live={live} />}
        {scene.view === 'list' && <CardList {...props} />}
        {scene.view === 'thread' && <ThreadPane {...props} />}
        {scene.view === 'messages' && <MessageList scene={scene} now={props.now} />}
        {scene.composer && <Composer scene={scene} phone={phone} live={live} />}
        {scene.roomMenu && <RoomMenu scene={scene} live={live} />}
      </div>
    </>
  );
}
