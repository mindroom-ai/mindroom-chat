import { Avatar, Icon, Icons, Spinner, Text, type IconSrc } from 'folds';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import { UnreadBadge } from '../ui/UnreadBadge';
import { ownDirectionLine, revealDirectionControls } from '../ui/directional';
import { UserAvatar } from '../avatars/UserAvatar';
import { nameInitials } from '../lib/common';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { makeHighlightRegex } from '../search/highlightRegex';
import type {
  CommandPaletteItem,
  CommandPaletteMessageItem,
  CommandPaletteSectionId,
  CommandPaletteStartChatItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';
import * as css from './CommandPalette.css';

/** A quiet line in a section, such as its loading state or why some rooms are missing. */
export type CommandPaletteListNote = {
  id: string;
  text: string;
  busy?: boolean;
};

export type CommandPaletteListSection = {
  id: CommandPaletteSectionId;
  title: string;
  items: CommandPaletteItem[];
  /** Lines between the title and the rows. */
  notes?: CommandPaletteListNote[];
  /** Lines after the rows, so rows already shown stay where they are when one appears. */
  trailingNotes?: CommandPaletteListNote[];
  /** More rows may still arrive: a spinner beside the title. */
  busy?: boolean;
};

type CommandPaletteListProps = {
  id: string;
  label: string;
  sections: readonly CommandPaletteListSection[];
  selectedItemId?: string;
  onSelect: (item: CommandPaletteItem) => void;
  onHighlight: (itemId: string) => void;
};

export const getCommandPaletteOptionId = (listId: string, itemId: string): string =>
  listId + '-' + encodeURIComponent(itemId);

const getItemTitle = (item: CommandPaletteItem, t: TFunction): string => {
  switch (item.kind) {
    case 'action':
      return item.title;
    case 'room':
    case 'space':
      return revealDirectionControls(item.name);
    case 'user':
      return item.typedId
        ? t('commandPalette.peopleSearch.messageUserId', { userId: item.userId })
        : item.displayName;
    case 'start-chat':
      return t('commandPalette.startChat.title', { name: item.displayName });
    case 'thread':
      return revealDirectionControls(item.summaryText);
    case 'message':
      return item.senderName;
    default:
      return item.term;
  }
};

const getItemDescription = (item: CommandPaletteItem, t: TFunction): string | undefined => {
  switch (item.kind) {
    case 'action':
      return item.description;
    case 'room':
    case 'space':
      return revealDirectionControls(item.topic ?? item.canonicalAlias ?? '') || undefined;
    case 'user':
      // A typed ID is the title already; under it goes the name its profile has, if any.
      if (item.typedId) return item.displayName === item.localpart ? undefined : item.displayName;
      return item.userId;
    case 'start-chat':
      return t('commandPalette.startChat.description', { userId: item.userId });
    case 'thread':
      return revealDirectionControls(item.roomName);
    case 'message':
      return item.snippet;
    default:
      return undefined;
  }
};

const getItemIcon = (item: CommandPaletteItem): IconSrc => {
  switch (item.kind) {
    case 'action':
      return Icons.Terminal;
    case 'thread':
      return Icons.Message;
    case 'room':
      return Icons.Hash;
    case 'space':
      return Icons.Space;
    case 'message':
      return Icons.Message;
    default:
      return Icons.Search;
  }
};

/** The snippet with each word the server matched marked. */
const markMatches = (text: string, highlights: readonly string[]): ReactNode => {
  const pattern = makeHighlightRegex([...highlights]);
  if (!pattern) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (match[0].length === 0) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={start} className={css.Match}>
        {match[0]}
      </mark>
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

type PersonItem = CommandPaletteUserItem | CommandPaletteStartChatItem;

const isPerson = (item: CommandPaletteItem): item is PersonItem =>
  item.kind === 'user' || item.kind === 'start-chat';

/** A person's picture, or the first letter of their name in their color. */
function PersonAvatar({ item }: { item: PersonItem }) {
  return (
    <Avatar size="300" radii="Pill">
      <UserAvatar
        userId={item.userId}
        src={item.avatarUrl}
        alt=""
        renderFallback={() => (
          <Text as="span" size="L400">
            {nameInitials(item.displayName)}
          </Text>
        )}
      />
    </Avatar>
  );
}

function SectionNote({ note }: { note: CommandPaletteListNote }) {
  return (
    <div className={css.Note} role="presentation" data-note={note.id}>
      {note.busy && <Spinner size="50" variant="Secondary" />}
      {note.text}
    </div>
  );
}

function MessageTime({ timestamp }: { timestamp: number }) {
  const label = useRelativeTime(timestamp, 'compact');
  return (
    <time className={css.RowTime} dateTime={new Date(timestamp).toISOString()}>
      {label}
    </time>
  );
}

function MessageRowText({ item }: { item: CommandPaletteMessageItem }) {
  const { t } = useTranslation();
  const thread =
    item.threadName === undefined
      ? undefined
      : item.threadName || t('commandPalette.messageSearch.thread');
  return (
    <span className={css.RowText}>
      <span className={css.RowHeading}>
        <span className={css.RowTitle} {...ownDirectionLine}>{item.senderName}</span>
        {/* Room, then thread, in the interface's order; each name keeps its own direction. */}
        <span className={css.RowPlace}>
          <bdi>{revealDirectionControls(item.roomName)}</bdi>
          {thread !== undefined && <> › <bdi>{thread}</bdi></>}
        </span>
        <MessageTime timestamp={item.timestamp} />
      </span>
      <span className={css.RowDescription} {...ownDirectionLine}>{markMatches(revealDirectionControls(item.snippet), item.highlights)}</span>
    </span>
  );
}

function ItemText({ item }: { item: CommandPaletteItem }) {
  const { t } = useTranslation();
  if (item.kind === 'message') return <MessageRowText item={item} />;
  if (item.kind === 'search-page') {
    return (
      <span className={css.RowText}>
        <span className={css.RowTitle}>{t('commandPalette.messageSearch.seeAll')}</span>
        <span className={css.RowDescription}>
          {t('commandPalette.messageSearch.seeAllDescription')}
        </span>
      </span>
    );
  }
  const description = getItemDescription(item, t);
  return (
    <span className={css.RowText}>
      <span className={css.RowHeading}>
        <span className={css.RowTitle} {...ownDirectionLine}>{getItemTitle(item, t)}</span>
        {item.kind === 'space' && <span className={css.Tag}>{t('commandPalette.space')}</span>}
        {isPerson(item) && isMindroomAgentUserId(item.userId) && (
          <span className={css.Tag}>{t('threadActions.agent')}</span>
        )}
      </span>
      {description && <span className={css.RowDescription} {...ownDirectionLine}>{description}</span>}
    </span>
  );
}

export function CommandPaletteList({
  id,
  label,
  sections,
  selectedItemId,
  onSelect,
  onHighlight,
}: CommandPaletteListProps) {
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedItemId]);

  return (
    <div id={id} role="listbox" aria-label={label}>
      {sections.map((section) => {
        const count = section.items.filter((item) => item.kind !== 'search-page').length;
        return (
          <div
            key={section.id}
            className={css.Group}
            role="group"
            aria-labelledby={id + '-' + section.id}
            aria-busy={section.busy || undefined}
            data-section={section.id}
          >
            <div id={id + '-' + section.id} className={css.GroupTitle} role="presentation">
              {section.title}
              {count > 0 && (
                <span className={css.GroupCount} aria-hidden="true">
                  {count}
                </span>
              )}
              {section.busy && <Spinner size="50" variant="Secondary" />}
            </div>
            {section.notes?.map((note) => (
              <SectionNote key={note.id} note={note} />
            ))}
            {section.items.map((item) => {
              const isSelected = selectedItemId === item.id;
              return (
                // Keyboard activation belongs to the combobox, which retains DOM focus.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={item.id}
                  id={getCommandPaletteOptionId(id, item.id)}
                  ref={isSelected ? selectedRef : undefined}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  className={css.Row}
                  data-item-id={item.id}
                  data-kind={item.kind}
                  data-selected={isSelected}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse' && !isSelected) onHighlight(item.id);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(item)}
                >
                  {isPerson(item) ? (
                    <span className={css.RowAvatar} aria-hidden="true">
                      <PersonAvatar item={item} />
                    </span>
                  ) : (
                    <span className={css.RowIcon} aria-hidden="true">
                      <Icon size="200" src={getItemIcon(item)} />
                    </span>
                  )}
                  <ItemText item={item} />
                  {(item.kind === 'room' || item.kind === 'space') &&
                    item.unreadCount !== undefined && (
                      <UnreadBadge highlight={!!item.unreadHighlight} count={item.unreadCount} />
                    )}
                  <span className={css.RowEnter} aria-hidden="true">
                    ↵
                  </span>
                </div>
              );
            })}
            {section.trailingNotes?.map((note) => (
              <SectionNote key={note.id} note={note} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
