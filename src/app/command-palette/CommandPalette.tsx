import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import {
  ChangeEventHandler,
  KeyboardEventHandler,
  useEffect,
  useId,
  useRef,
  useMemo,
  useState,
} from 'react';
import { getCommandPaletteSectionLimit, getCommandPaletteSectionOrder } from './commandPaletteQuery';
import type {
  CommandPaletteSource,
  ExecutableCommandPaletteItem,
  ExecutableCommandPaletteUserItem,
} from './commandPaletteItems';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';
import { rankCommandPalettePeople } from './commandPalettePeopleRanking';
import {
  CommandPaletteList,
  getCommandPaletteOptionId,
  type CommandPaletteListNote,
  type CommandPaletteListSection,
} from './CommandPaletteList';
import * as css from './CommandPalette.css';
import { InlineScrollFade } from '../ui/inlineScrollFade.css';
import { useInlineScrollFade } from '../ui/useInlineScrollFade';
import {
  getCommandPaletteHighlightIndex,
  getCommandPaletteTabStep,
  getNextCommandPaletteTab,
} from './commandPaletteNavigation';
import { getCommandPaletteShortcutLabel } from './commandPaletteShortcut';
import {
  COMMAND_PALETTE_TABS,
  type CommandPaletteRoomItem,
  type CommandPaletteSectionId,
  type CommandPaletteTab,
} from './commandPaletteTypes';
import type {
  CommandPaletteMessages,
  UseCommandPaletteMessages,
} from './useCommandPaletteMessages';
import type { CommandPalettePeople, UseCommandPalettePeople } from './useCommandPalettePeople';

type CommandPaletteProps = {
  requestClose: () => void;
  source: CommandPaletteSource;
  /** Server message search: a hook, called on every render with the typed text. */
  useMessages: UseCommandPaletteMessages;
  /** The server's user directory: a hook, called on every render with the typed text. */
  usePeople: UseCommandPalettePeople;
  /** The tab it opens on; it remembers no tab between openings. */
  initialTab?: CommandPaletteTab;
  mobileSheet?: boolean;
};

const TAB_LABEL_KEYS = {
  all: 'commandPalette.all',
  rooms: 'commandPalette.sections.rooms',
  threads: 'commandPalette.sections.threads',
  users: 'commandPalette.people',
  messages: 'commandPalette.sections.messages',
  actions: 'commandPalette.sections.actions',
} as const satisfies Record<CommandPaletteTab, string>;

type RoomItems = readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];

const getLocalSectionItems = ({
  sectionId,
  tab,
  searchText,
  source,
  starterRooms,
}: {
  sectionId: Exclude<CommandPaletteSectionId, 'messages'>;
  tab: CommandPaletteTab;
  searchText: string;
  source: CommandPaletteSource;
  starterRooms: RoomItems;
}): ExecutableCommandPaletteItem[] => {
  const limit = getCommandPaletteSectionLimit(sectionId, tab);
  switch (sectionId) {
    case 'actions':
      return searchCommandPaletteSection({
        items: source.actions,
        query: searchText,
        config: { ...commandPaletteSearchConfig.actions, limit },
      });
    case 'threads':
      return searchCommandPaletteSection({
        items: source.threads,
        query: searchText,
        config: { ...commandPaletteSearchConfig.threads, limit },
      });
    case 'rooms':
      return searchCommandPaletteSection({
        // All's starter list is for switching rooms; spaces match by name, and Rooms lists them.
        items: tab === 'all' && !searchText ? starterRooms : source.rooms,
        query: searchText,
        config: { ...commandPaletteSearchConfig.rooms, limit },
      });
    default: {
      const hasSearchText = searchText.length > 0;
      // Every match, ranked by how well it matches before the limit takes the best ones.
      const people = searchCommandPaletteSection({
        items: source.getUsers({
          exhaustive: hasSearchText,
          includeRelatedRooms: tab === 'users' || hasSearchText,
        }),
        query: searchText,
        config: { ...commandPaletteSearchConfig.users, limit: Number.POSITIVE_INFINITY },
      });
      return rankCommandPalettePeople(people, searchText).slice(0, limit);
    }
  }
};

/**
 * The server's hits for the text, then See all results. Until they arrive the section holds only
 * a quiet line, so nothing in it can be highlighted and moved; once they do, they sit below
 * every other section.
 */
const buildMessageSection = (
  messages: CommandPaletteMessages,
  searchText: string,
  tab: CommandPaletteTab,
  t: TFunction
): CommandPaletteListSection => {
  const notes: CommandPaletteListNote[] = [];
  const settled = messages.status === 'done' || messages.status === 'error';
  if (!searchText) {
    notes.push({ id: 'hint', text: t('commandPalette.messageSearch.hint') });
  } else if (messages.status === 'loading') {
    notes.push({ id: 'loading', text: t('commandPalette.messageSearch.searching'), busy: true });
  } else if (messages.status === 'error') {
    notes.push({ id: 'error', text: t('mindroomUi.message-search.messageSearch.searchFailed') });
  } else if (messages.items.length === 0) {
    notes.push({
      id: 'none',
      text: t('mindroomUi.message-search.messageSearch.noResultsFor', { term: searchText }),
    });
  }
  if (messages.encryptedRooms) {
    notes.push({ id: 'encrypted', text: t('commandPalette.messageSearch.encrypted') });
  }

  const items: ExecutableCommandPaletteItem[] =
    searchText && messages.status === 'done'
      ? messages.items.slice(0, getCommandPaletteSectionLimit('messages', tab))
      : [];
  if (searchText && settled) {
    items.push({
      id: 'search-page',
      kind: 'search-page',
      term: searchText,
      onSelect: () => messages.openSearchPage(searchText),
    });
  }
  return { id: 'messages', title: t(TAB_LABEL_KEYS.messages), items, notes };
};

/**
 * The people found locally and the server's people the palette does not list already, ranked
 * together by how well they match the text: equal matches keep the local ones above, so those
 * rows stay put, while the server's exact match goes above near local ones. All takes only as
 * many as fit its limit, plus a Matrix ID typed in full. A spinner beside the title shows while
 * the server is asked, and a failed search adds one quiet line after the rows.
 */
const buildPeopleSection = (
  local: ExecutableCommandPaletteItem[],
  people: CommandPalettePeople,
  source: CommandPaletteSource,
  tab: CommandPaletteTab,
  searchText: string,
  t: TFunction
): CommandPaletteListSection | undefined => {
  let items = local;
  if (people.items.length > 0) {
    const listed = new Set(
      source.getUsers({ exhaustive: true, includeRelatedRooms: true }).map((user) => user.userId)
    );
    const found = people.items.filter((item) => !listed.has(item.userId));
    const limit = Math.max(getCommandPaletteSectionLimit('users', tab), local.length);
    items = [
      ...rankCommandPalettePeople(
        [...local, ...found.filter((item) => !item.typedId)],
        searchText
      ).slice(0, limit),
      ...found.filter((item) => item.typedId),
    ];
  }
  const busy = people.status === 'loading';
  const trailingNotes =
    people.status === 'error'
      ? [{ id: 'people-error', text: t('commandPalette.peopleSearch.failed') }]
      : undefined;
  if (items.length === 0 && !busy && !trailingNotes) return undefined;
  return { id: 'users', title: t(TAB_LABEL_KEYS.users), items, busy, trailingNotes };
};

/** Asking before a direct chat starts, then starting it; a failure can be retried. */
type ChatStart = {
  person: ExecutableCommandPaletteUserItem;
  state: 'asking' | 'starting' | 'failed';
};

/** The one row that asks whether to start the chat, which sends the person an invite. */
const buildStartChatSection = (
  { person, state }: ChatStart,
  t: TFunction
): CommandPaletteListSection => ({
  id: 'users',
  title: t(TAB_LABEL_KEYS.users),
  items: [
    {
      id: `start-chat:${person.userId}`,
      kind: 'start-chat',
      userId: person.userId,
      displayName: person.displayName,
      avatarUrl: person.avatarUrl,
    },
  ],
  busy: state === 'starting',
  trailingNotes:
    state === 'failed'
      ? [{ id: 'start-chat-error', text: t('featureUi.createChat.failed') }]
      : undefined,
});

const getResultCountLabel = (items: readonly ExecutableCommandPaletteItem[], t: TFunction) => {
  const count = items.filter((item) => item.kind !== 'search-page').length;
  if (count === 0) return t('commandPalette.noResults');
  return t('commandPalette.resultCount', { count });
};

const directionOf = (element: unknown): 'ltr' | 'rtl' =>
  typeof Element !== 'undefined' &&
  element instanceof Element &&
  getComputedStyle(element).direction === 'rtl'
    ? 'rtl'
    : 'ltr';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export function CommandPalette({
  requestClose,
  source,
  useMessages,
  usePeople,
  initialTab = 'all',
  mobileSheet = false,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<CommandPaletteTab>(initialTab);
  // The highlighted row by ID, so rows that arrive later never move it; the index is where it
  // was, for when that row leaves.
  const [highlight, setHighlight] = useState<{ id?: string; index: number }>({ index: 0 });
  const [chatStart, setChatStart] = useState<ChatStart>();
  // Set while a chat is being started, so a second Enter cannot start another.
  const startingRef = useRef(false);
  // True after the up or down arrow, until the person edits or moves the caret.
  const navigatingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  useInlineScrollFade(tabListRef);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const panelId = `${listId}-panel`;
  const tabId = (id: CommandPaletteTab) => `${listId}-tab-${id}`;
  const searchText = query.trim();
  const messages = useMessages(query, tab === 'all' || tab === 'messages');
  const people = usePeople(query, tab === 'all' || tab === 'users');
  const starterRooms = useMemo(
    () => source.rooms.filter((item) => item.kind === 'room'),
    [source.rooms]
  );

  const resultSections = useMemo(
    () =>
      getCommandPaletteSectionOrder(tab, searchText.length > 0)
        .map((sectionId): CommandPaletteListSection | undefined => {
          if (sectionId === 'messages') return buildMessageSection(messages, searchText, tab, t);
          const items = getLocalSectionItems({ sectionId, tab, searchText, source, starterRooms });
          if (sectionId === 'users') {
            return buildPeopleSection(items, people, source, tab, searchText, t);
          }
          if (items.length === 0) return undefined;
          return { id: sectionId, title: t(TAB_LABEL_KEYS[sectionId]), items };
        })
        .filter((section): section is CommandPaletteListSection => section !== undefined),
    [messages, people, searchText, source, starterRooms, t, tab]
  );
  const visibleSections = useMemo(
    () => (chatStart ? [buildStartChatSection(chatStart, t)] : resultSections),
    [chatStart, resultSections, t]
  );
  const visibleItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections]
  );
  const selectedIndex = getCommandPaletteHighlightIndex(
    visibleItems.map((item) => item.id),
    highlight.id,
    highlight.index
  );
  const selectedItem = visibleItems[selectedIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    tabListRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const startOver = () => {
    setHighlight({ index: 0 });
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  const chooseTab = (nextTab: CommandPaletteTab) => {
    if (startingRef.current) return;
    setChatStart(undefined);
    setTab(nextTab);
    startOver();
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    setChatStart(undefined);
    setQuery(event.currentTarget.value);
    navigatingRef.current = false;
    startOver();
  };

  const confirmChat = async () => {
    if (!chatStart || startingRef.current) return;
    const { person } = chatStart;
    startingRef.current = true;
    setChatStart({ person, state: 'starting' });
    try {
      await person.startChat?.();
      setQuery('');
      requestClose();
    } catch {
      setChatStart({ person, state: 'failed' });
    } finally {
      startingRef.current = false;
    }
  };

  const handleSelect = (item: ExecutableCommandPaletteItem) => {
    if (item.kind === 'start-chat') {
      void confirmChat();
      return;
    }
    if (item.kind === 'user' && item.startChat) {
      // The person gets an invite, so the palette asks first. Their row keeps the highlight for
      // when the person goes back.
      setHighlight({ id: item.id, index: visibleItems.indexOf(item) });
      setChatStart({ person: item, state: 'asking' });
      return;
    }
    item.onSelect?.();
    setQuery('');
    requestClose();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (chatStart && event.key === 'Escape') {
      // Back to the results; the dialog must not close on the same key.
      event.preventDefault();
      event.stopPropagation?.();
      if (!startingRef.current) setChatStart(undefined);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // The question is the only row.
      if (chatStart) return;
      navigatingRef.current = true;
      const count = visibleItems.length;
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (Math.max(selectedIndex, 0) + step + count) % count;
      setHighlight({ id: visibleItems[next]?.id, index: next });
      return;
    }

    if (event.key === 'Enter') {
      if (!selectedItem) return;
      event.preventDefault();
      handleSelect(selectedItem);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation?.();
      setQuery('');
      requestClose();
      return;
    }

    const input = event.currentTarget;
    const tabStep = getCommandPaletteTabStep({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      query: input.value ?? query,
      selectionStart: input.selectionStart ?? null,
      selectionEnd: input.selectionEnd ?? null,
      navigating: navigatingRef.current,
      textDirection: directionOf(input),
      tabDirection: directionOf(tabListRef.current),
    });
    if (tabStep !== 0) {
      event.preventDefault();
      // The dialog's focus containment moves focus on Tab from a listener on the document.
      event.stopPropagation?.();
      chooseTab(getNextCommandPaletteTab(COMMAND_PALETTE_TABS, tab, tabStep));
      return;
    }

    // Any other key edits the text or moves the caret.
    if (!MODIFIER_KEYS.has(event.key)) navigatingRef.current = false;
  };

  const shortcutLabel = getCommandPaletteShortcutLabel();

  return (
    <div
      className={css.Palette}
      style={{ paddingBottom: mobileSheet ? 'env(safe-area-inset-bottom, 0px)' : undefined }}
    >
      <div className={css.Search}>
        <Icon src={Icons.Search} size="300" />
        <input
          ref={inputRef}
          dir={query ? 'auto' : undefined}
          className={css.Input}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            selectedItem ? getCommandPaletteOptionId(listId, selectedItem.id) : undefined
          }
          aria-label={t('commandPalette.inputAria')}
          placeholder={t('commandPalette.placeholder')}
          value={query}
          readOnly={chatStart?.state === 'starting'}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPointerDown={() => {
            navigatingRef.current = false;
          }}
        />
        <button
          type="button"
          className={css.Close}
          aria-label={t('commandPalette.closeAria')}
          onClick={requestClose}
        >
          {mobileSheet ? <Icon src={Icons.Cross} size="200" /> : <kbd className={css.Key}>esc</kbd>}
        </button>
      </div>
      <div
        ref={tabListRef}
        className={`${css.Tabs} ${InlineScrollFade}`}
        role="tablist"
        aria-label={t('commandPalette.tabsLabel')}
      >
        {COMMAND_PALETTE_TABS.map((id) => (
          <button
            type="button"
            key={id}
            id={tabId(id)}
            role="tab"
            className={css.Tab}
            aria-selected={tab === id}
            aria-controls={panelId}
            // The field keeps focus and moves between tabs with Tab and the arrows.
            tabIndex={-1}
            data-tab={id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              chooseTab(id);
              inputRef.current?.focus();
            }}
          >
            {t(TAB_LABEL_KEYS[id])}
          </button>
        ))}
      </div>
      <div
        ref={resultsRef}
        id={panelId}
        className={css.Results}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
      >
        <CommandPaletteList
          id={listId}
          label={t('commandPalette.resultsLabel')}
          sections={visibleSections}
          selectedItemId={selectedItem?.id}
          onHighlight={(itemId) => {
            // The question's row must not take the person's highlight away.
            if (chatStart) return;
            setHighlight({ id: itemId, index: visibleItems.findIndex((item) => item.id === itemId) });
          }}
          onSelect={handleSelect}
        />
        {visibleSections.length === 0 && (
          <div className={css.Empty}>
            <Icon src={Icons.Search} size="400" />
            <span className={css.EmptyTitle}>{t('commandPalette.noResults')}</span>
            <span className={css.EmptyDescription}>{t('commandPalette.emptyDescription')}</span>
            {query && (
              <button
                type="button"
                className={css.ClearSearch}
                aria-label={t('commandPalette.clearSearch')}
                onClick={() => {
                  setQuery('');
                  startOver();
                  inputRef.current?.focus();
                }}
              >
                {t('commandPalette.clearSearch')}
              </button>
            )}
          </div>
        )}
      </div>
      <div className={css.Footer}>
        <div className={css.KeyboardHints}>
          <span className={css.Hint}>
            <kbd className={css.Key}>↑</kbd>
            <kbd className={css.Key}>↓</kbd> {t('commandPalette.navigate')}
          </span>
          <span className={css.Hint}>
            <kbd className={css.Key}>↵</kbd> {t('commandPalette.select')}
          </span>
          <span className={css.Hint}>
            <kbd className={css.Key}>Tab</kbd> {t('commandPalette.switchTabs')}
          </span>
          <span className={css.Hint}>
            <kbd className={css.Key}>{shortcutLabel}</kbd>
          </span>
        </div>
        <span role="status" aria-live="polite">
          {getResultCountLabel(visibleItems, t)}
        </span>
      </div>
    </div>
  );
}
