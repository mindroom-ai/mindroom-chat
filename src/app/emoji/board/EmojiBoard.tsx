import {
  ChangeEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { FocusTrap } from 'focus-trap-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Input,
  Scroll,
  Text,
  config,
  type IconSrc,
} from 'folds';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { AddCustomEmoji } from './components/AddCustomEmoji';
import { SkinToneButton, SkinToneOptions } from './components/SkinToneChooser';
import * as css from './components/styles.css';
import { VirtualTile } from '../../ui/VirtualTile';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRelevantImagePacks } from '../useImagePacks';
import { useRecentEmoji } from '../useRecentEmoji';
import { useFilePicker } from '../../lib/hooks/useFilePicker';
import { addRecentEmoji, isNamedEmoji } from '../recent-emoji-list';
import { EmojiGroupId, type IEmoji, emojiGroups, withSkinTone } from '../emoji';
import { ImageUsage } from '../custom/types';
import { type ImagePack, PackImageReader } from '../custom/ImagePack';
import { emojiSkinToneAtom } from '../emojiSkinTone';
import { AuthenticatedImage } from '../../avatars/AuthenticatedImage';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { mobileOrTablet } from '../../lib/user-agent';
import { makeTrapOptions } from './boardFocusTrap';

/** The two boards of the picker; only callers that take stickers offer the switch. */
export const EmojiBoardTab = { Emoji: 'Emoji', Sticker: 'Sticker' } as const;
export type EmojiBoardTab = (typeof EmojiBoardTab)[keyof typeof EmojiBoardTab];

/** What a board item inserts, kept in each item button's `data-emoji-type`. */
const EmojiType = {
  Emoji: 'emoji',
  CustomEmoji: 'customEmoji',
  Sticker: 'sticker',
} as const;
type EmojiType = (typeof EmojiType)[keyof typeof EmojiType];

/** How each unicode group appears in the board: its rail icon and the key of its section title. */
const EMOJI_GROUP_PRESENTATION = {
  [EmojiGroupId.People]: { icon: Icons.Smile, labelKey: 'sharedUi.emojiGroups.smileysPeople' },
  [EmojiGroupId.Nature]: { icon: Icons.Leaf, labelKey: 'sharedUi.emojiGroups.animalsNature' },
  [EmojiGroupId.Food]: { icon: Icons.Cup, labelKey: 'sharedUi.emojiGroups.foodDrinks' },
  [EmojiGroupId.Activity]: { icon: Icons.Ball, labelKey: 'sharedUi.emojiGroups.activity' },
  [EmojiGroupId.Travel]: { icon: Icons.Globe, labelKey: 'sharedUi.emojiGroups.travelPlaces' },
  [EmojiGroupId.Object]: { icon: Icons.Bulb, labelKey: 'sharedUi.emojiGroups.objects' },
  [EmojiGroupId.Symbol]: { icon: Icons.Peace, labelKey: 'sharedUi.emojiGroups.symbols' },
  [EmojiGroupId.Flag]: { icon: Icons.Flag, labelKey: 'sharedUi.emojiGroups.flags' },
} as const satisfies Record<EmojiGroupId, { icon: IconSrc; labelKey: string }>;

type BoardItem = {
  type: EmojiType;
  data: string;
  shortcode: string;
  label: string;
};

type BoardGroup = {
  id: string;
  label: string;
  icon?: IconSrc;
  avatarMxc?: string;
  items: BoardItem[];
  /**
   * The group continues the one before it: another pack of the same room with the same name, as
   * the client opens one when a pack is full. It has no sidebar button or label of its own.
   */
  continued?: boolean;
};

const toUnicodeItem = (emoji: IEmoji): BoardItem => ({
  type: EmojiType.Emoji,
  data: emoji.unicode,
  shortcode: emoji.shortcode,
  label: emoji.label || emoji.shortcode,
});

const toImageItem = (image: PackImageReader, type: EmojiType): BoardItem => ({
  type,
  data: image.url,
  shortcode: image.shortcode,
  label: image.body || image.shortcode,
});

/** Packs of one room that share a name read as one pack; others stand alone. */
const packSetKey = (pack: ImagePack): string =>
  pack.address && pack.meta.name !== undefined
    ? JSON.stringify([pack.address.roomId, pack.meta.name])
    : `pack:${pack.id}`;

/** Orders a room's packs by state key, the way new packs are numbered: "", then 2, 3, and so on. */
const compareStateKeys = (a: ImagePack, b: ImagePack): number =>
  (a.address?.stateKey ?? '').localeCompare(b.address?.stateKey ?? '', undefined, {
    numeric: true,
  });

/**
 * Collects the packs into sets of same-named packs of one room, each at its first pack's place and
 * in state key order, since the room's state lists them in the order the client first saw them.
 */
const groupPackSets = (packs: ImagePack[]): ImagePack[][] => {
  const sets = new Map<string, ImagePack[]>();
  packs.forEach((pack) => {
    const key = packSetKey(pack);
    const set = sets.get(key);
    if (set) set.push(pack);
    else sets.set(key, [pack]);
  });
  return [...sets.values()].map((set) => set.sort(compareStateKeys));
};

const matchesQuery = (item: BoardItem, query: string): boolean => {
  const needle = query.toLocaleLowerCase();
  return (
    item.shortcode.toLocaleLowerCase().includes(needle) ||
    item.label.toLocaleLowerCase().includes(needle)
  );
};

/** Reads the board item a click or hover landed on, from the button's data attributes. */
const getItemFromEvent = (evt: ReactMouseEvent): BoardItem | undefined => {
  const path = evt.nativeEvent.composedPath?.() ?? [];
  const button = path.find(
    (target): target is Element =>
      typeof (target as Element).matches === 'function' && (target as Element).matches('button')
  );
  if (!button) return undefined;
  const type = button.getAttribute('data-emoji-type') as EmojiType | null;
  const data = button.getAttribute('data-emoji-data');
  const shortcode = button.getAttribute('data-emoji-shortcode');
  if (!type || !data || !shortcode) return undefined;
  return { type, data, shortcode, label: button.getAttribute('title') ?? shortcode };
};

const imageSrc = (client: MatrixClient, mxc: string, authMedia: boolean, size: number) =>
  mxcUrlToHttp(client, mxc, authMedia, size, size, 'scale') ?? undefined;

type ItemButtonProps = {
  item: BoardItem;
  client: MatrixClient;
  authMedia: boolean;
};

function ItemButton({ item, client, authMedia }: ItemButtonProps) {
  const { t } = useTranslation();
  const common = {
    type: 'button' as const,
    title: item.label,
    'aria-label': t('sharedUi.item.value1Emoji', { value1: item.label }),
    'data-emoji-type': item.type,
    'data-emoji-data': item.data,
    'data-emoji-shortcode': item.shortcode,
  };
  if (item.type === EmojiType.Emoji) {
    return (
      <button className={css.EmojiItem} {...common}>
        {item.data}
      </button>
    );
  }
  const sticker = item.type === EmojiType.Sticker;
  return (
    <button className={sticker ? css.StickerItem : css.EmojiItem} {...common}>
      <AuthenticatedImage
        client={client}
        className={sticker ? css.StickerImg : css.CustomEmojiImg}
        src={imageSrc(client, item.data, authMedia, sticker ? 160 : 64)}
        alt={item.shortcode}
        loading="lazy"
      />
    </button>
  );
}

/** Reports a unicode pick: the character itself and its shortcode. */
type UnicodePick = (unicode: string, shortcode: string) => void;

/** Reports an image pick: the image's `mxc://` URI and its shortcode. */
type ImagePick = (mxc: string, shortcode: string) => void;

type EmojiPickHandlers = {
  onEmojiSelect?: UnicodePick;
  onCustomEmojiSelect?: ImagePick;
  /** `label` is the sticker's description, sent as the body of the sticker event. */
  onStickerSelect?: (mxc: string, shortcode: string, label: string) => void;
  /** Offered by reaction pickers: the search text itself, sent as a reaction. */
  onTextReaction?: (text: string) => void;
};

type EmojiBoardProps = EmojiPickHandlers & {
  /** Rooms whose emoji and sticker packs the board offers. */
  imagePackRooms: Room[];
  /** The board shown; the emoji board unless a caller that takes stickers picks one. */
  tab?: EmojiBoardTab;
  onTabChange?: (next: EmojiBoardTab) => void;
  /** Keep the board open after a pick (as reactions do with Shift or Alt held). */
  keepOpenOnSelect?: boolean;
  returnFocusOnDeactivate?: boolean;
  requestClose: () => void;
  /** The tallest the board may be, as a CSS length: the room its pop-out has. Its groups scroll. */
  maxHeight?: string;
};

/** Emoji and sticker picker with search, recent emoji, custom packs, and adding a custom emoji. */
export function EmojiBoard(props: EmojiBoardProps) {
  const {
    imagePackRooms,
    tab = EmojiBoardTab.Emoji,
    onTabChange,
    onEmojiSelect,
    onCustomEmojiSelect,
    onStickerSelect,
    onTextReaction,
    keepOpenOnSelect,
    returnFocusOnDeactivate,
    requestClose,
    maxHeight,
  } = props;
  const client = useMatrixClient();
  const authMedia = useMediaAuthentication();
  const { t } = useTranslation();
  const stickerTab = tab === EmojiBoardTab.Sticker;
  const usage = stickerTab ? ImageUsage.Sticker : ImageUsage.Emoticon;
  const packs: ImagePack[] = useRelevantImagePacks(usage, imagePackRooms);
  const recentEmoji = useRecentEmoji(client, 21, packs);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<BoardItem>();
  // The preview belongs to the board it was hovered on.
  useEffect(() => setHovered(undefined), [tab]);
  const [addFile, setAddFile] = useState<File>();
  const [tone, setTone] = useAtom(emojiSkinToneAtom);
  const [choosingTone, setChoosingTone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pickFile = useFilePicker(setAddFile, false, 'image/*');

  const groups = useMemo<BoardGroup[]>(() => {
    const imageType = stickerTab ? EmojiType.Sticker : EmojiType.CustomEmoji;
    const packGroups: BoardGroup[] = groupPackSets(packs).flatMap((set) => {
      const avatarMxc = set[0]?.meta.avatar ?? set[0]?.getImages(usage)[0]?.url;
      return set.map((pack, index) => ({
        id: `pack-${pack.id}`,
        label:
          pack.meta.name ??
          (pack.address
            ? t('sharedUi.emojiBoard.unknownPack')
            : t('sharedUi.emojiBoard.personalPack')),
        avatarMxc,
        items: pack.getImages(usage).map((image) => toImageItem(image, imageType)),
        continued: index > 0,
      }));
    });
    if (stickerTab) return packGroups;

    // The board loads with the emoji data, so its Unicode recent emoji all have names.
    const recentItems = recentEmoji.flatMap((item) => {
      if (item instanceof PackImageReader) return [toImageItem(item, EmojiType.CustomEmoji)];
      return isNamedEmoji(item) ? [toUnicodeItem(item)] : [];
    });
    const recentGroups: BoardGroup[] =
      recentItems.length > 0
        ? [
            {
              id: 'recent',
              label: t('sharedUi.emojiBoard.recent'),
              icon: Icons.RecentClock,
              items: recentItems,
            },
          ]
        : [];
    const unicodeGroups: BoardGroup[] = emojiGroups.map((group) => ({
      id: `emoji-${group.id}`,
      label: t(EMOJI_GROUP_PRESENTATION[group.id].labelKey),
      icon: EMOJI_GROUP_PRESENTATION[group.id].icon,
      items: group.emojis.map((emoji) => toUnicodeItem(withSkinTone(emoji, tone))),
    }));

    // Custom packs follow the Unicode groups, so large packs leave the standard emoji in reach.
    return [...recentGroups, ...unicodeGroups, ...packGroups];
  }, [packs, usage, stickerTab, recentEmoji, tone, t]);

  const visibleGroups = useMemo<BoardGroup[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return groups;
    // Custom emoji lead the results, as when packs came before the Unicode groups.
    const isPack = (group: BoardGroup) => group.id.startsWith('pack-');
    const results = [...groups.filter(isPack), ...groups.filter((group) => !isPack(group))]
      .filter((group) => group.id !== 'recent')
      .flatMap((group) => group.items.filter((item) => matchesQuery(item, trimmed)));
    return [{ id: 'search', label: t('sharedUi.emojiBoard.searchResults'), items: results }];
  }, [groups, query, t]);

  // A pack is a group on both boards with other images and another height, so measured heights
  // are kept per board: by index they would place the sticker board's groups at the emoji
  // board's offsets after a switch.
  const groupKey = (group: BoardGroup) => `${tab}:${group.id}`;
  const virtualizer = useVirtualizer({
    count: visibleGroups.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => {
      const group = visibleGroups[index];
      return group ? groupKey(group) : index;
    },
    estimateSize: (index) => {
      const group = visibleGroups[index];
      const items = group?.items ?? [];
      // A label takes 40 px; stickers take four 88 px cells to a row, emoji eight 44 px ones.
      const label = group?.continued ? 0 : 40;
      return stickerTab
        ? label + Math.ceil(items.length / 4) * 88
        : label + Math.ceil(items.length / 8) * 44;
    },
    overscan: 2,
  });

  // Defer sidebar jumps until the full group list and scroll container are committed so
  // TanStack Virtual does not clamp the index against the single search-results group.
  const pendingScrollIndexRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const index = pendingScrollIndexRef.current;
    if (index === undefined || visibleGroups !== groups || addFile !== undefined) return;
    pendingScrollIndexRef.current = undefined;
    virtualizer.scrollToIndex(index, { align: 'start' });
  }, [visibleGroups, groups, addFile, virtualizer]);

  const handlePick = useCallback(
    (item: BoardItem, keepOpen: boolean) => {
      if (item.type === EmojiType.Emoji) {
        onEmojiSelect?.(item.data, item.shortcode);
        void addRecentEmoji(client, item.data);
      } else if (item.type === EmojiType.CustomEmoji) {
        onCustomEmojiSelect?.(item.data, item.shortcode);
        void addRecentEmoji(client, item.data);
      } else {
        onStickerSelect?.(item.data, item.shortcode, item.label);
      }
      if (!keepOpen && !keepOpenOnSelect) requestClose();
    },
    [client, onEmojiSelect, onCustomEmojiSelect, onStickerSelect, keepOpenOnSelect, requestClose]
  );

  const handleItemClick = (evt: ReactMouseEvent) => {
    const item = getItemFromEvent(evt);
    if (item) handlePick(item, evt.altKey || evt.shiftKey);
  };

  const handleItemHover = (evt: ReactMouseEvent) => {
    const item = getItemFromEvent(evt);
    if (item && (item.data !== hovered?.data || item.type !== hovered?.type)) setHovered(item);
  };

  const handleQueryChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setQuery(evt.target.value);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleAdded = (mxc: string, shortcode: string) => {
    setAddFile(undefined);
    onCustomEmojiSelect?.(mxc, shortcode);
    void addRecentEmoji(client, mxc);
  };

  const noStickerPacks = stickerTab && groups.length === 0;
  const textReaction = onTextReaction && !stickerTab ? query.trim() : '';
  const searchLabel = onTextReaction
    ? t('sharedUi.searchInput.searchOrTextReaction').trim()
    : t('sharedUi.searchInput.search');

  let content: ReactNode;
  if (addFile) {
    content = (
      <AddCustomEmoji file={addFile} onCancel={() => setAddFile(undefined)} onAdd={handleAdded} />
    );
  } else {
    content = (
      <>
        <Box className={css.Header}>
          {onStickerSelect && (
            <Box gap="100">
              {[EmojiBoardTab.Emoji, EmojiBoardTab.Sticker].map((option) => (
                <Chip
                  key={option}
                  type="button"
                  radii="Pill"
                  variant={option === tab ? 'Primary' : 'SurfaceVariant'}
                  aria-pressed={option === tab}
                  onClick={() => onTabChange?.(option)}
                >
                  <Text as="span" size="B300">
                    {option === EmojiBoardTab.Emoji
                      ? t('sharedUi.tabs.emoji')
                      : t('sharedUi.tabs.sticker')}
                  </Text>
                </Chip>
              ))}
            </Box>
          )}
          <Input
            variant="SurfaceVariant"
            size="400"
            radii="400"
            placeholder={searchLabel}
            aria-label={searchLabel}
            value={query}
            onChange={handleQueryChange}
            autoFocus={!mobileOrTablet()}
            before={<Icon src={Icons.Search} size="50" />}
            after={
              textReaction ? (
                <Chip
                  type="button"
                  radii="Pill"
                  variant="Primary"
                  onClick={() => {
                    onTextReaction?.(textReaction);
                    if (!keepOpenOnSelect) requestClose();
                  }}
                >
                  <Text as="span" size="B300">
                    {t('sharedUi.searchInput.react')}
                  </Text>
                </Chip>
              ) : undefined
            }
          />
        </Box>
        {noStickerPacks && (
          <Box
            direction="Column"
            alignItems="Center"
            justifyContent="Center"
            gap="200"
            grow="Yes"
            style={{ padding: config.space.S400, textAlign: 'center' }}
          >
            <Icon size="600" src={Icons.Sticker} />
            <Text size="H6">{t('sharedUi.noStickerPacks.noStickerPacks')}</Text>
            <Text size="T200" priority="300">
              {t('sharedUi.noStickerPacks.addStickersFromUserRoomOrSpaceSettings')}
            </Text>
          </Box>
        )}
        <Scroll
          ref={scrollRef}
          size="400"
          visibility="Hover"
          hideTrack
          style={{ flexGrow: 1, display: noStickerPacks ? 'none' : undefined }}
        >
          {/* Items are buttons; this list reads which one was clicked or hovered. */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            style={{ position: 'relative', height: virtualizer.getTotalSize() }}
            onClick={handleItemClick}
            onMouseMove={handleItemHover}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const group = visibleGroups[virtualItem.index];
              if (!group) return null;
              return (
                <VirtualTile
                  key={groupKey(group)}
                  virtualItem={virtualItem}
                  ref={virtualizer.measureElement}
                >
                  <div className={css.EmojiGroup} id={`emoji-board-${group.id}`}>
                    {!group.continued && (
                      <Text className={css.EmojiGroupLabel} size="O400">
                        {group.label}
                      </Text>
                    )}
                    <div className={css.EmojiGroupContent}>
                      {group.items.length === 0 ? (
                        <Text size="T300" priority="300" style={{ padding: config.space.S200 }}>
                          {t('sharedUi.emojiBoard.noResultsFound')}
                        </Text>
                      ) : (
                        group.items.map((item) => (
                          <ItemButton
                            key={`${item.type}-${item.data}-${item.shortcode}`}
                            item={item}
                            client={client}
                            authMedia={authMedia}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </VirtualTile>
              );
            })}
          </div>
        </Scroll>
        <Box className={css.Preview}>
          {stickerTab || !choosingTone ? (
            <>
              {hovered?.type === EmojiType.Emoji && (
                <span className={css.PreviewEmoji}>{hovered.data}</span>
              )}
              {hovered && hovered.type !== EmojiType.Emoji && (
                <AuthenticatedImage
                  client={client}
                  className={css.PreviewImg}
                  src={imageSrc(client, hovered.data, authMedia, 64)}
                  alt={hovered.shortcode}
                />
              )}
              <Text size="H6" truncate style={{ flexGrow: 1, minWidth: 0 }}>
                {hovered ? `:${hovered.shortcode}:` : ''}
              </Text>
            </>
          ) : (
            <SkinToneOptions
              tone={tone}
              onChoose={(next) => {
                setTone(next);
                setChoosingTone(false);
              }}
            />
          )}
          {!stickerTab && !choosingTone && (
            <SkinToneButton tone={tone} onPress={() => setChoosingTone(true)} />
          )}
        </Box>
      </>
    );
  }

  return (
    <FocusTrap focusTrapOptions={makeTrapOptions(requestClose, returnFocusOnDeactivate)}>
      <Box className={css.Base} style={{ maxHeight }}>
        <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
          {content}
        </Box>
        <Box className={css.Sidebar}>
          <div className={css.SidebarContent}>
            <div className={css.SidebarStack}>
              {groups.map((group, index) =>
                group.continued ? null : (
                  <IconButton
                    key={group.id}
                    type="button"
                    size="300"
                    radii="300"
                    variant="SurfaceVariant"
                    aria-label={group.label}
                    title={group.label}
                    onClick={() => {
                      setQuery('');
                      setAddFile(undefined);
                      if (visibleGroups !== groups || addFile !== undefined) {
                        pendingScrollIndexRef.current = index;
                      } else {
                        virtualizer.scrollToIndex(index, { align: 'start' });
                      }
                    }}
                  >
                    {group.avatarMxc ? (
                      <AuthenticatedImage
                        client={client}
                        className={css.SidebarBtnImg}
                        src={imageSrc(client, group.avatarMxc, authMedia, 48)}
                        alt=""
                      />
                    ) : (
                      <Icon size="100" src={group.icon ?? Icons.Smile} />
                    )}
                  </IconButton>
                )
              )}
            </div>
          </div>
          {!stickerTab && (
            <div className={css.SidebarStack}>
              <div className={css.SidebarDivider} />
              <IconButton
                type="button"
                size="300"
                radii="300"
                variant="SurfaceVariant"
                aria-label={t('sharedUi.emojiBoard.addCustomEmoji')}
                title={t('sharedUi.emojiBoard.addCustomEmoji')}
                onClick={() => pickFile()}
              >
                <Icon size="100" src={Icons.SmilePlus} />
              </IconButton>
            </div>
          )}
        </Box>
      </Box>
    </FocusTrap>
  );
}
