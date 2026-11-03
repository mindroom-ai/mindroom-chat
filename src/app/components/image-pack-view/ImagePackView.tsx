import React, {
  MouseEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Box,
  Button,
  Chip,
  Icon,
  Icons,
  PopOut,
  type RectCords,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import {
  ClientEvent,
  EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { Header, IconButton, Menu, MenuItem } from '../glass/GlassPrimitives';
import { PageScroll } from '../page';
import { readImagePackUpload } from './imagePackUpload';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useAlive } from '../../hooks/useAlive';
import { ImageUsage, type PackAddress } from '../../plugins/custom-emoji';
import { UploadStatus } from '../../state/upload';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { StateEvent } from '../../../types/matrix/room';
import type { IImageInfo } from '../../../types/matrix/common';
import { mxcUrlToHttp } from '../../utils/matrix';
import { selectFile } from '../../utils/dom';
import { getAccountData, getStateEvent } from '../../utils/room';
import { stopPropagation } from '../../utils/keyboard';

/** Where a room pack lives: the room and the state key of its `im.ponies.room_emotes` event. */
export type ImagePackAddress = PackAddress;

type PackImageDraft = {
  url: string;
  body?: string;
  usage?: string[];
  info?: IImageInfo;
};

type PackDraft = {
  pack?: {
    display_name?: string;
    avatar_url?: string;
    usage?: string[];
    attribution?: string;
  };
  images?: Record<string, PackImageDraft>;
};

type UsageOption = 'emoticon' | 'sticker' | 'both';

const usageToOption = (usage: string[] | undefined): UsageOption => {
  const emoticon = usage?.includes(ImageUsage.Emoticon);
  const sticker = usage?.includes(ImageUsage.Sticker);
  if (emoticon && !sticker) return 'emoticon';
  if (sticker && !emoticon) return 'sticker';
  return 'both';
};

const optionToUsage = (option: UsageOption): string[] => {
  if (option === 'emoticon') return [ImageUsage.Emoticon];
  if (option === 'sticker') return [ImageUsage.Sticker];
  return [ImageUsage.Emoticon, ImageUsage.Sticker];
};

const readPack = (mx: MatrixClient, address: ImagePackAddress | undefined): PackDraft => {
  if (!address) {
    return (getAccountData(mx, AccountDataEvent.PoniesUserEmotes)?.getContent() as PackDraft) ?? {};
  }
  const room = mx.getRoom(address.roomId);
  if (!room) return {};
  return (
    (getStateEvent(
      room,
      StateEvent.PoniesRoomEmotes,
      address.stateKey
    )?.getContent() as PackDraft) ?? {}
  );
};

const canEditPack = (mx: MatrixClient, address: ImagePackAddress | undefined): boolean => {
  if (!address) return true;
  const state = mx.getRoom(address.roomId)?.getLiveTimeline().getState(EventTimeline.FORWARDS);
  return !!state?.maySendStateEvent(StateEvent.PoniesRoomEmotes, mx.getSafeUserId());
};

type UsageSelectorProps = {
  value: UsageOption;
  disabled?: boolean;
  onChange: (value: UsageOption) => void;
};

function UsageSelector({ value, disabled, onChange }: UsageSelectorProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const labels: Record<UsageOption, string> = {
    emoticon: t('sharedUi.imageUsage.emoji'),
    sticker: t('sharedUi.imageUsage.sticker'),
    both: t('sharedUi.imageUsage.both'),
  };

  const open: MouseEventHandler<HTMLButtonElement> = (evt) =>
    setAnchor(evt.currentTarget.getBoundingClientRect());
  const select = (option: UsageOption) => {
    setAnchor(undefined);
    onChange(option);
  };
  const closeMenu = () => setAnchor(undefined);

  return (
    <PopOut
      anchor={anchor}
      offset={4}
      align="End"
      position="Bottom"







            onDeactivate: closeMenu,
          }}
        >
          <Menu>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {(Object.keys(labels) as UsageOption[]).map((option) => (
                <MenuItem
                  key={option}
                  size="300"
                  radii="300"
                  aria-pressed={option === value}
                  variant={option === value ? 'Primary' : 'Surface'}
                  fill={option === value ? 'Soft' : 'None'}
                  onClick={() => select(option)}
                >
                  <Text size="T300">{labels[option]}</Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <Chip
        type="button"
        variant="SurfaceVariant"
        radii="Pill"
        size="400"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        after={<Icon size="100" src={Icons.ChevronBottom} />}
        onClick={open}
      >
        <Text as="span" size="B300">
          {labels[value]}
        </Text>
      </Chip>
    </PopOut>
  );
}

/** A titled row: label and description on the left, its control on the right. */
function SettingRow({
  title,
  description,
  after,
}: {
  title: string;
  description?: string;
  after?: ReactNode;
}) {
  return (
    <Box alignItems="Center" gap="300">
      <Box grow="Yes" direction="Column" gap="100" style={{ minWidth: 0 }}>
        <Text size="T300">{title}</Text>
        {description && (
          <Text size="T200" priority="300">
            {description}
          </Text>
        )}
      </Box>
      {after}
    </Box>
  );
}

/**
 * The pack as the client has it now. It reads again whenever sync brings a new version of the
 * personal pack (account data) or of this room pack (state event), so applied edits and edits
 * from other devices show up.
 */
const useSavedPack = (mx: MatrixClient, address: ImagePackAddress | undefined): PackDraft => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!address) {
      const handleAccountData = (event: MatrixEvent) => {
        if (event.getType() !== AccountDataEvent.PoniesUserEmotes) return;








    const room = mx.getRoom(address.roomId);
    const state = room?.getLiveTimeline().getState(EventTimeline.FORWARDS);
    if (!state) return undefined;
    const handleStateEvent = (event: MatrixEvent) => {
      if (
        event.getType() === StateEvent.PoniesRoomEmotes &&
        event.getStateKey() === address.stateKey
      ) {
        setVersion((v) => v + 1);
      }
    };
    state.on(RoomStateEvent.Events, handleStateEvent);
    return () => {
      state.removeListener(RoomStateEvent.Events, handleStateEvent);
    };
  }, [mx, address]);

  return useMemo(() => {
    void version;
    return readPack(mx, address);
  }, [mx, address, version]);
};

type ImagePackViewProps = {
  /** A room pack, or undefined for the user's personal pack. */










  const canEdit = canEditPack(mx, address);
  const saved = useSavedPack(mx, address);
  const [draft, setDraft] = useState<PackDraft>();
  // An applied pack shows until sync brings the saved one back, so the view never reverts.
  const [applied, setApplied] = useState<PackDraft>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setApplied(undefined);
  }, [saved]);

  const base = applied ?? saved;
  const current = draft ?? base;
  const images = Object.entries(current.images ?? {});
  const changed = draft !== undefined;
  const packName = current.pack?.display_name || t('sharedUi.packMeta.unknown');

  const edit = useCallback(
    (change: (pack: PackDraft) => PackDraft) => setDraft((previous) => change(previous ?? base)),
    [base]
  );

  const setPackUsage = (option: UsageOption) =>
    edit((pack) => ({ ...pack, pack: { ...pack.pack, usage: optionToUsage(option) } }));

  const removeImage = (shortcode: string) =>
    edit((pack) => {
      const next = { ...pack.images };
      delete next[shortcode];
      return { ...pack, images: next };
    });

  const handleUpload = async () => {
    const files = await selectFile('image/*', true);
    if (files.length === 0) return;
    setUploading(true);
    setError(undefined);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const { content_uri: mxc } = await mx.uploadContent(file, {
            name: file.name,
            type: file.type,
          });
          return readImagePackUpload({ file, mxc, status: UploadStatus.Success });
        })
      );
      if (!alive()) return;
      edit((pack) => {
        const next = { ...pack.images };
        uploaded.forEach((image) => {
          if (!image) return;
          next[image.shortcode] = { url: image.url, body: image.body, info: image.info };
        });
        return { ...pack, images: next };
      });
    } catch {
      if (alive()) setError(t('sharedUi.imagePackContent.uploadFailed'));
    } finally {
      if (alive()) setUploading(false);
    }
  };

  const handleApply = async () => {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    try {
      if (address) {
        await mx.sendStateEvent(
          address.roomId,
          StateEvent.PoniesRoomEmotes as never,
          draft as never,
          address.stateKey
        );
      } else {
        await mx.setAccountData(AccountDataEvent.PoniesUserEmotes as never, draft as never);
      }
      if (!alive()) return;
      setApplied(draft);
      setDraft(undefined);
    } catch {
      if (alive()) setError(t('sharedUi.imagePackContent.failedToApplyChangesPleaseTryAgain'));
    } finally {
      if (alive()) setSaving(false);
    }
  };

  const avatarUrl = current.pack?.avatar_url
    ? mxcUrlToHttp(mx, current.pack.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  return (
    <Box direction="Column" style={{ height: '100%', minHeight: 0 }}>
      <PageScroll
        style={{ flexGrow: 1, minHeight: 0 }}
        header={
          <Header size="500" style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}>
            <Box grow="Yes" style={{ minWidth: 0 }}>
              <Text size="H4" truncate>
                {t('sharedUi.imagePackView.emojisStickers')}
              </Text>
            </Box>
            <IconButton
              size="300"
              radii="300"
              onClick={requestClose}
              aria-label={t('sharedUi.imagePackView.close')}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          </Header>
        }
      >
        <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
          {changed && (
            <Box
              alignItems="Center"
              gap="200"
              wrap="Wrap"
              style={{








              }}
            >
              <Box grow="Yes">
                <Text size="T300">{t('sharedUi.imagePackContent.changesSavedApplyWhenReady')}</Text>
              </Box>
              <Box gap="200">
                <Button
                  type="button"
                  size="300"
                  variant="Warning"
                  fill="Soft"
                  radii="300"
                  disabled={saving}
                  onClick={() => setDraft(undefined)}
                >
                  <Text as="span" size="B300">
                    {t('sharedUi.imagePackContent.reset')}
                  </Text>
                </Button>
                <Button
                  type="button"
                  size="300"
                  variant="Success"
                  radii="300"
                  disabled={saving}
                  onClick={handleApply}
                  before={
                    saving ? <Spinner size="100" variant="Success" fill="Solid" /> : undefined
                  }
                >
                  <Text as="span" size="B300">
                    {t('sharedUi.imagePackContent.applyChanges')}
                  </Text>
                </Button>
              </Box>
            </Box>
          )}
          {error && (
            <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
              {error}
            </Text>
          )}
          <Box direction="Column" gap="200">
            <Text size="L400">{t('sharedUi.imagePackContent.pack')}</Text>
            <Box alignItems="Center" gap="300">
              <Avatar size="500" radii="300">
                {avatarUrl ? (
                  <AvatarImage src={avatarUrl} alt={packName} />
                ) : (
                  <AvatarFallback>
                    <Icon src={Icons.Sticker} />
                  </AvatarFallback>
                )}
              </Avatar>
              <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
                <Text size="H5" truncate>
                  {packName}
                </Text>
                {current.pack?.attribution && (
                  <Text size="T200" priority="300">
                    {current.pack.attribution}
                  </Text>
                )}
              </Box>
            </Box>
            <SettingRow
              title={t('sharedUi.imagePackContent.imagesUsage')}
              description={t(
                'sharedUi.imagePackContent.selectHowTheImagesAreBeingUsedAsEmojisAsStickersOr'
              )}
              after={
                <UsageSelector
                  value={usageToOption(current.pack?.usage)}
                  disabled={!canEdit}
                  onChange={setPackUsage}
                />
              }
            />
          </Box>
          {canEdit && (
            <SettingRow
              title={t('sharedUi.imagePackContent.uploadImages')}
              description={t(
                'sharedUi.imagePackContent.selectImagesFromYourStorageToUploadThemInPack'
              )}
              after={
                <Button
                  type="button"
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  radii="300"
                  disabled={uploading}
                  onClick={handleUpload}
                  before={uploading ? <Spinner size="100" variant="Secondary" /> : undefined}
                >
                  <Text as="span" size="B300">
                    {t('sharedUi.imagePackContent.select')}
                  </Text>
                </Button>
              }
            />
          )}
          <Box direction="Column" gap="100">
            <Text size="L400">{t('sharedUi.imagePackContent.images')}</Text>
            {images.map(([shortcode, image]) => (
              <Box
                key={shortcode}
                alignItems="Center"
                gap="300"
                style={{ padding: `${config.space.S200} 0`, minHeight: toRem(48) }}
              >
                <img
                  src={mxcUrlToHttp(mx, image.url, useAuthentication, 64, 64, 'scale') ?? undefined}
                  alt={shortcode}
                  style={{ width: toRem(32), height: toRem(32), objectFit: 'contain' }}
                  loading="lazy"
                />
                <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
                  <Text size="T300" truncate>{`:${shortcode}:`}</Text>
                  {image.body && image.body !== shortcode && (
                    <Text size="T200" priority="300" truncate>
                      {image.body}
                    </Text>
                  )}
                </Box>
                {canEdit && (
                  <IconButton
                    size="300"
                    radii="300"
                    variant="Critical"
                    onClick={() => removeImage(shortcode)}
                    aria-label={t('sharedUi.imageTile.remove')}
                  >
                    <Icon size="50" src={Icons.Delete} />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </PageScroll>
    </Box>
  );
}
