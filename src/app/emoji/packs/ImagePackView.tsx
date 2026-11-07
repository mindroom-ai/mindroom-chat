import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import {
  ClientEvent,
  EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { Page, PageContent, PageHeader } from '../../ui/page/Page';
import { PageScroll } from '../../ui/page/PageScroll';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { scrollHeaderHeight } from '../../ui/page/scrollHeaderInset';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { SettingsBreadcrumb } from '../../ui/settings/SettingsPageFrame';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { readImagePackUpload } from './imagePackUpload';
import {
  addPackImages,
  changePackImage,
  changePackMeta,
  optionToUsage,
  removePackImages,
  type UsageOption,
  usageToOption,
} from './packDraft';
import { PackAvatar, PackMetaEditor } from './PackMetaEditor';
import { PackImageRow } from './PackImageRow';
import { PACK_USAGE_OPTIONS, UsageSelector } from './UsageSelector';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import type { PackAddress, PackContent } from '../custom/types';
import { UploadStatus } from '../../matrix/state/upload';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { StateEvent } from '../../matrix/types/room';
import { selectFile } from '../../lib/dom';
import { getAccountData, getStateEvent } from '../../matrix/room';
import { matchesEnum } from '../../lib/matchesEnum';

/** Where a room pack lives: the room and the state key of its `im.ponies.room_emotes` event. */
type ImagePackAddress = PackAddress;

const readPack = (mx: MatrixClient, address: ImagePackAddress | undefined): PackContent => {
  if (!address) {
    return (
      (getAccountData(mx, AccountDataEvent.PoniesUserEmotes)?.getContent() as PackContent) ?? {}
    );
  }
  const room = mx.getRoom(address.roomId);
  if (!room) return {};
  return (
    getStateEvent(room, StateEvent.PoniesRoomEmotes, address.stateKey)?.getContent<PackContent>() ??
    {}
  );
};

const canEditPack = (mx: MatrixClient, address: ImagePackAddress | undefined): boolean => {
  if (!address) return true;
  const state = mx.getRoom(address.roomId)?.getLiveTimeline().getState(EventTimeline.FORWARDS);
  return !!state?.maySendStateEvent(StateEvent.PoniesRoomEmotes, mx.getSafeUserId());
};

/** Calls `onChange` when the event that holds the pack changes; returns how to stop listening. */
const watchPack = (
  client: MatrixClient,
  address: ImagePackAddress | undefined,
  onChange: () => void
): (() => void) | undefined => {
  if (!address) {
    const onAccountData = (event: MatrixEvent) => {
      if (matchesEnum(event.getType(), AccountDataEvent.PoniesUserEmotes)) onChange();
    };
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }

  const state = client.getRoom(address.roomId)?.getLiveTimeline().getState(EventTimeline.FORWARDS);
  if (!state) return undefined;
  const onStateEvent = (event: MatrixEvent) => {
    const isThisPack =
      matchesEnum(event.getType(), StateEvent.PoniesRoomEmotes) &&
      event.getStateKey() === address.stateKey;
    if (isThisPack) onChange();
  };
  state.on(RoomStateEvent.Events, onStateEvent);
  return () => {
    state.off(RoomStateEvent.Events, onStateEvent);
  };
};

/**
 * The pack as the client has it now. It reads again whenever sync brings a new version of the
 * personal pack (account data) or of this room pack (state event), so applied edits and edits
 * from other devices show up.
 */
const useSavedPack = (mx: MatrixClient, address: ImagePackAddress | undefined): PackContent => {
  const [version, setVersion] = useState(0);

  useEffect(() => watchPack(mx, address, () => setVersion((count) => count + 1)), [mx, address]);

  return useMemo(() => {
    void version;
    return readPack(mx, address);
  }, [mx, address, version]);
};

type ImagePackViewProps = {
  /** A room pack, or undefined for the user's personal pack. */
  address: ImagePackAddress | undefined;
  /** Leaves the pack, back to the list it was opened from. */
  requestClose: () => void;
};

const warning = color.Warning;

/** The bar that sticks below the scrolling title while edits wait to be applied. */
const PENDING_BAR_STYLE: CSSProperties = {
  position: 'sticky',
  top: `calc(${scrollHeaderHeight} + ${config.space.S100})`,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  zIndex: 1,
  borderRadius: config.radii.R400,
  color: warning.OnContainer,
  background: warning.Container,
  border: `${config.borderWidth.B300} solid ${warning.ContainerLine}`,
};

// The same insets as the settings pages beside this view (settings.png).
const HEADER_INSET = { paddingInlineEnd: '1.5rem' };
const CONTENT_INSET = { paddingInlineEnd: '1.75rem' };
const CARD_STYLE = { padding: config.space.S300 };

/**
 * Shows an emoji and sticker pack. Who may edit it changes its name, avatar, attribution and
 * usage, uploads images, and edits or removes each image; the changes wait in a bar until
 * applied, so they go out as one event.
 */
export function ImagePackView({ address, requestClose }: ImagePackViewProps) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const canEdit = canEditPack(client, address);
  const saved = useSavedPack(client, address);
  const alive = useAlive();
  const [draft, setDraft] = useState<PackContent>();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  // An applied pack shows until sync brings the saved one back, so the view never reverts.
  const [applied, setApplied] = useState<PackContent>();
  const [editingImage, setEditingImage] = useState<string>();
  const [editingMeta, setEditingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setApplied(undefined);
  }, [saved]);

  const base = applied ?? saved;
  const current = draft ?? base;
  const images = Object.entries(current.images ?? {});
  const changed = draft !== undefined || removed.size > 0;
  const meta = current.pack ?? {};
  // An unnamed personal pack is the Personal Pack, as the emoji board calls it.
  const packName =
    meta.display_name ||
    (address ? t('sharedUi.packMeta.unknown') : t('sharedUi.emojiBoard.personalPack'));
  // Like the board's rail: the pack's avatar, else its first image.
  const avatarMxc = meta.avatar_url ?? images.find(([, image]) => image.url)?.[1].url;

  const edit = useCallback(
    (change: (pack: PackContent) => PackContent) =>
      setDraft((previous) => change(previous ?? base)),
    [base]
  );

  const reset = () => {
    setDraft(undefined);
    setRemoved(new Set());
    setEditingImage(undefined);
    setEditingMeta(false);
  };

  const setPackUsage = (option: UsageOption) =>
    edit((pack) => ({ ...pack, pack: { ...pack.pack, usage: optionToUsage(option) } }));

  const markRemoved = (shortcode: string, remove: boolean) =>
    setRemoved((previous) => {
      const next = new Set(previous);
      if (remove) next.add(shortcode);
      else next.delete(shortcode);
      return next;
    });

  const isTaken = (shortcode: string) =>
    Object.prototype.hasOwnProperty.call(current.images ?? {}, shortcode);

  const handleUpload = async () => {
    const files = await selectFile('image/*', true);
    if (files.length === 0) return;
    setUploading(true);
    setError(undefined);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const { content_uri: mxc } = await client.uploadContent(file, {
            name: file.name,
            type: file.type,
          });
          return readImagePackUpload({ file, mxc, status: UploadStatus.Success });
        })
      );
      if (!alive()) return;
      edit((pack) =>
        addPackImages(
          pack,
          uploaded.flatMap((image) =>
            image
              ? [
                  {
                    shortcode: image.shortcode,
                    image: { url: image.url, body: image.body, info: image.info },
                  },
                ]
              : []
          )
        )
      );
    } catch {
      if (alive()) setError(t('sharedUi.imagePackContent.uploadFailed'));
    } finally {
      if (alive()) setUploading(false);
    }
  };

  const handleApply = async () => {
    if (!changed) return;
    const content = removePackImages(current, removed);
    setSaving(true);
    setError(undefined);
    try {
      if (address) {
        await client.sendStateEvent(
          address.roomId,
          StateEvent.PoniesRoomEmotes as never,
          content as never,
          address.stateKey
        );
      } else {
        await client.setAccountData(AccountDataEvent.PoniesUserEmotes as never, content as never);
      }
      if (!alive()) return;
      setApplied(content);
      reset();
    } catch {
      if (alive()) setError(t('sharedUi.imagePackContent.failedToApplyChangesPleaseTryAgain'));
    } finally {
      if (alive()) setSaving(false);
    }
  };

  // Back leads to the settings page the pack opened from; phones use their pages' chevron.
  const backLabel = t('sharedUi.imagePackView.back');
  const back = phone ? (
    <PhoneBackButton onBack={requestClose} label={backLabel} />
  ) : (
    <IconButton variant="Surface" onClick={requestClose} aria-label={backLabel}>
      <Icon src={Icons.ArrowLeft} data-directional />
    </IconButton>
  );
  const header = (
    <PageHeader outlined={false} balance={phone} style={phone ? undefined : HEADER_INSET}>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        {back}
        <SettingsBreadcrumb title={t('sharedUi.imagePackView.emojisStickers')} />
      </Box>
    </PageHeader>
  );

  return (
    <Page>
      <PageScroll header={header}>
        <PageContent style={CONTENT_INSET}>
          <Box direction="Column" gap="500">
            {changed && (
              <div style={PENDING_BAR_STYLE}>
                <Box alignItems="Center" gap="200" wrap="Wrap">
                  <Box grow="Yes">
                    <Text size="T300">
                      {t('sharedUi.imagePackContent.changesSavedApplyWhenReady')}
                    </Text>
                  </Box>
                  <Box gap="200">
                    <Button
                      type="button"
                      size="300"
                      variant="Warning"
                      fill="Soft"
                      radii="300"
                      disabled={saving}
                      onClick={reset}
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
                      onClick={() => void handleApply()}
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
              </div>
            )}
            {error && (
              <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
                {error}
              </Text>
            )}
            <Box direction="Column" gap="100">
              <Text size="L400" data-settings-heading="">
                {t('sharedUi.imagePackContent.pack')}
              </Text>
              <SequenceCard direction="Column" gap="400" style={CARD_STYLE}>
                {editingMeta ? (
                  <PackMetaEditor
                    meta={meta}
                    onCancel={() => setEditingMeta(false)}
                    onSave={(changes) => {
                      edit((pack) => changePackMeta(pack, changes));
                      setEditingMeta(false);
                    }}
                  />
                ) : (
                  <Box alignItems="Center" gap="300">
                    <PackAvatar mxc={avatarMxc} name={packName} size="500" />
                    <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
                      <Text size="H5" truncate>
                        {packName}
                      </Text>
                      {meta.attribution && (
                        <Text size="T200" priority="300">
                          {meta.attribution}
                        </Text>
                      )}
                    </Box>
                    {canEdit && (
                      <Button
                        type="button"
                        size="300"
                        radii="300"
                        variant="Secondary"
                        fill="Soft"
                        onClick={() => setEditingMeta(true)}
                      >
                        <Text as="span" size="B300">
                          {t('sharedUi.packMeta.edit')}
                        </Text>
                      </Button>
                    )}
                  </Box>
                )}
                <SettingTile
                  title={t('sharedUi.imagePackContent.imagesUsage')}
                  description={t(
                    'sharedUi.imagePackContent.selectHowTheImagesAreBeingUsedAsEmojisAsStickersOr'
                  )}
                  after={
                    <UsageSelector
                      value={usageToOption(meta.usage)}
                      options={PACK_USAGE_OPTIONS}
                      disabled={!canEdit}
                      onChange={setPackUsage}
                    />
                  }
                />
                {canEdit && (
                  <SettingTile
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
                        onClick={() => void handleUpload()}
                        before={uploading ? <Spinner size="100" variant="Secondary" /> : undefined}
                      >
                        <Text as="span" size="B300">
                          {t('sharedUi.imagePackContent.select')}
                        </Text>
                      </Button>
                    }
                  />
                )}
              </SequenceCard>
            </Box>
            <Box direction="Column" gap="100">
              <Text size="L400" data-settings-heading="">
                {t('sharedUi.imagePackContent.images')}
              </Text>
              <SequenceCard direction="Column" gap="100" style={CARD_STYLE}>
                {images.length === 0 && (
                  <Text size="T300" priority="300">
                    {t('sharedUi.imagePackContent.noImages')}
                  </Text>
                )}
                {images.map(([shortcode, image]) => (
                  <PackImageRow
                    key={shortcode}
                    shortcode={shortcode}
                    image={image}
                    canEdit={canEdit}
                    removed={removed.has(shortcode)}
                    editing={editingImage === shortcode}
                    isTaken={isTaken}
                    onEdit={() => setEditingImage(shortcode)}
                    onCancelEdit={() => setEditingImage(undefined)}
                    onSave={(changes) => {
                      const next = changePackImage(current, shortcode, changes);
                      if (!next) return;
                      setDraft(next);
                      setEditingImage(undefined);
                    }}
                    onRemove={() => markRemoved(shortcode, true)}
                    onUndo={() => markRemoved(shortcode, false)}
                  />
                ))}
              </SequenceCard>
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
