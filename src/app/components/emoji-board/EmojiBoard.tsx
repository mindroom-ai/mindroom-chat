import React, {
  ChangeEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
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
import * as css from './components/styles.css';
import { VirtualTile } from '../virtualizer';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRelevantImagePacks } from '../../hooks/useImagePacks';
import { useRecentEmoji } from '../../hooks/useRecentEmoji';
import { useFilePicker } from '../../hooks/useFilePicker';
import { addRecentEmoji } from '../../plugins/recent-emoji';
import { EmojiGroupId, type IEmoji, emojiGroups } from '../../plugins/emoji';
import { type ImagePack, ImageUsage, PackImageReader } from '../../plugins/custom-emoji';
import { mxcUrlToHttp } from '../../utils/matrix';
import { mobileOrTablet } from '../../utils/user-agent';
import { stopPropagation } from '../../utils/keyboard';























const EMOJI_GROUP_LABEL_KEYS = {
  [EmojiGroupId.People]: 'sharedUi.emojiGroups.smileysPeople',
  [EmojiGroupId.Nature]: 'sharedUi.emojiGroups.animalsNature',
  [EmojiGroupId.Food]: 'sharedUi.emojiGroups.foodDrinks',
  [EmojiGroupId.Activity]: 'sharedUi.emojiGroups.activity',
  [EmojiGroupId.Travel]: 'sharedUi.emojiGroups.travelPlaces',
  [EmojiGroupId.Object]: 'sharedUi.emojiGroups.objects',
  [EmojiGroupId.Symbol]: 'sharedUi.emojiGroups.symbols',
  [EmojiGroupId.Flag]: 'sharedUi.emojiGroups.flags',
} as const;

type BoardItem =
  | { type: EmojiType.Emoji; data: string; shortcode: string; label: string }
  | {
      type: EmojiType.CustomEmoji | EmojiType.Sticker;
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
};

const toUnicodeItem = (emoji: IEmoji): BoardItem => ({
  type: EmojiType.Emoji,
  data: emoji.unicode,
  shortcode: emoji.shortcode,
  label: emoji.label || emoji.shortcode,
});

const toImageItem = (
  image: PackImageReader,
  type: EmojiType.CustomEmoji | EmojiType.Sticker
): BoardItem => ({
  type,
  data: image.url,
  shortcode: image.shortcode,
  label: image.body || image.shortcode,
});

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
  return { type, data, shortcode, label: button.getAttribute('title') ?? shortcode } as BoardItem;
};

const imageSrc = (mx: MatrixClient, mxc: string, useAuthentication: boolean, size: number) =>
  mxcUrlToHttp(mx, mxc, useAuthentication, size, size, 'scale') ?? undefined;

type ItemButtonProps = {
  item: BoardItem;
  mx: MatrixClient;
  useAuthentication: boolean;
};

function ItemButton({ item, mx, useAuthentication }: ItemButtonProps) {
  const common = {
    type: 'button' as const,
    title: item.label,
    'aria-label': item.label,
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
      <img
        className={sticker ? css.StickerImg : css.CustomEmojiImg}
        src={imageSrc(mx, item.data, useAuthentication, sticker ? 160 : 64)}
        alt={item.shortcode}
        loading="lazy"
      />
    </button>
  );
}

/** Picks report the image's `mxc://` URI and shortcode; unicode picks the character itself. */
type EmojiPickHandlers = {



};

type EmojiBoardProps = EmojiPickHandlers & {
  /** Rooms whose emoji and sticker packs the board offers. */



  /** Keep the board open after a pick (as reactions do with Shift or Alt held). */
  keepOpenOnSelect?: boolean;
  returnFocusOnDeactivate?: boolean;
  requestClose: () => void;
};

/** Emoji and sticker picker with search, recent emoji, custom packs, and adding a custom emoji. */







  keepOpenOnSelect,







  const usage = stickerTab ? ImageUsage.Sticker : ImageUsage.Emoticon;
  const packs: ImagePack[] = useRelevantImagePacks(usage, imagePackRooms);
  const recentEmoji = useRecentEmoji(mx, 21, packs);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<BoardItem>();
  const [addFile, setAddFile] = useState<File>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pickFile = useFilePicker(setAddFile, false, 'image/*');

  const groups = useMemo<BoardGroup[]>(() => {
    const imageType = stickerTab ? EmojiType.Sticker : EmojiType.CustomEmoji;
    const packGroups: BoardGroup[] = packs.map((pack) => {
      const images = pack.getImages(usage);
      return {
        id: `pack-${pack.id}`,
        label:
          pack.meta.name ??
          (pack.address
            ? t('sharedUi.emojiBoard.unknownPack')
            : t('sharedUi.emojiBoard.personalPack')),
        avatarMxc: pack.meta.avatar ?? images[0]?.url,
        items: images.map((image) => toImageItem(image, imageType)),
      };
    });
    if (stickerTab) return packGroups;

    const recentItems = recentEmoji.map((item) =>
      item instanceof PackImageReader
        ? toImageItem(item, EmojiType.CustomEmoji)
        : toUnicodeItem(item)
    );
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
      label: t(EMOJI_GROUP_LABEL_KEYS[group.id]),
      icon: EMOJI_GROUP_ICONS[group.id],
      items: group.emojis.map(toUnicodeItem),
    }));

    return [...recentGroups, ...packGroups, ...unicodeGroups];
  }, [packs, usage, stickerTab, recentEmoji, t]);

  const visibleGroups = useMemo<BoardGroup[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return groups;
    const results = groups
      .filter((group) => group.id !== 'recent')
      .flatMap((group) => group.items.filter((item) => matchesQuery(item, trimmed)));
    return [{ id: 'search', label: t('sharedUi.emojiBoard.searchResults'), items: results }];
  }, [groups, query, t]);

  const virtualizer = useVirtualizer({
    count: visibleGroups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => 40 + Math.ceil(visibleGroups[index].items.length / 8) * 44,
    overscan: 2,
  });

  const handlePick = useCallback(
    (item: BoardItem, keepOpen: boolean) => {
      if (item.type === EmojiType.Emoji) {
        onEmojiSelect?.(item.data, item.shortcode);
        addRecentEmoji(mx, item.data);
      } else if (item.type === EmojiType.CustomEmoji) {
        onCustomEmojiSelect?.(item.data, item.shortcode);
        addRecentEmoji(mx, item.data);
      } else {
        onStickerSelect?.(item.data, item.shortcode, item.label);
      }
      if (!keepOpen && !keepOpenOnSelect) requestClose();
    },
    [mx, onEmojiSelect, onCustomEmojiSelect, onStickerSelect, keepOpenOnSelect, requestClose]
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
    addRecentEmoji(mx, mxc);
  };

  const noStickerPacks = stickerTab && groups.length === 0;

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
            placeholder={t('sharedUi.searchInput.search')}
            aria-label={t('sharedUi.searchInput.search')}
            value={query}
            onChange={handleQueryChange}
            autoFocus={!mobileOrTablet()}
            before={<Icon src={Icons.Search} size="50" />}
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
              return (
                <VirtualTile
                  key={group.id}
                  virtualItem={virtualItem}
                  ref={virtualizer.measureElement}
                >
                  <div className={css.EmojiGroup} id={`emoji-board-${group.id}`}>
                    <Text className={css.EmojiGroupLabel} size="O400">
                      {group.label}
                    </Text>
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
                            mx={mx}
                            useAuthentication={useAuthentication}
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
          {hovered?.type === EmojiType.Emoji && (
            <span className={css.PreviewEmoji}>{hovered.data}</span>
          )}
          {hovered && hovered.type !== EmojiType.Emoji && (
            <img
              className={css.PreviewImg}
              src={imageSrc(mx, hovered.data, useAuthentication, 64)}
              alt={hovered.shortcode}
            />
          )}
          <Text size="H6" truncate>
            {hovered ? `:${hovered.shortcode}:` : ''}
          </Text>
        </Box>
      </>
    );
  }

  return (
    <FocusTrap
      focusTrapOptions={{






      }}
    >
      <Box className={css.Base}>
        <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
          {content}
        </Box>
        <Box className={css.Sidebar}>
          <div className={css.SidebarContent}>
            <div className={css.SidebarStack}>
              {groups.map((group, index) => (
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
                    virtualizer.scrollToIndex(index, { align: 'start' });
                  }}
                >
                  {group.avatarMxc ? (
                    <img
                      className={css.SidebarBtnImg}
                      src={imageSrc(mx, group.avatarMxc, useAuthentication, 48)}
                      alt=""
                    />
                  ) : (
                    <Icon size="100" src={group.icon ?? Icons.Smile} />
                  )}
                </IconButton>
              ))}
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
