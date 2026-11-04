import { ChangeEventHandler, FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Spinner, Text, color } from 'folds';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAlive } from '../../../hooks/useAlive';
import { useObjectURL } from '../../../hooks/useObjectURL';
import { useServerEmojiRoom } from '../../../mindroom/server-emoji/useServerEmojiRoom';
import { addToServerPack, canAddServerEmoji } from '../../../mindroom/server-emoji/addToServerPack';
import {
  MAX_ANIMATED_EMOJI_BYTES,
  EmojiImageTooLargeError,
  prepareEmojiImage,
} from '../../../plugins/custom-emoji/prepareEmojiImage';
import {
  type PackContent,
  ShortcodeTakenError,
  getRoomImagePacks,
  getUserImagePack,
  packsHaveShortcode,
} from '../../../plugins/custom-emoji';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { loadImageElement } from '../../../utils/dom';
import { getFileNameWithoutExt } from '../../../utils/mimeTypes';
import { getMxIdServer } from '../../../utils/matrix';
import { getAccountData } from '../../../utils/room';
import { mobileOrTablet } from '../../../utils/user-agent';
import * as css from './styles.css';

/** A shortcode from what the user typed: no spaces or colons. */
const toShortcode = (name: string): string => name.trim().replace(/:/g, '').replace(/\s+/g, '-');

const getPersonalPackContent = (client: MatrixClient): PackContent =>
  getAccountData(client, AccountDataEvent.PoniesUserEmotes)?.getContent<PackContent>() ?? {};

/** Whether the pack the emoji would go to (the server room's packs, or the personal pack) has the name. */
const isShortcodeTaken = (
  client: MatrixClient,
  serverRoom: Room | undefined,
  shortcode: string
) => {
  if (serverRoom) return packsHaveShortcode(getRoomImagePacks(serverRoom), shortcode);
  const personal = getUserImagePack(client);
  return personal ? packsHaveShortcode([personal], shortcode) : false;
};

const loadImage = async (file: File): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

type AddCustomEmojiProps = {
  file: File;
  onCancel: () => void;
  /** Called with the uploaded image and the shortcode it was saved under. */
  onAdd: (mxc: string, shortcode: string) => void;
};

/**
 * Adds a picked image as a custom emoji: to the server emoji room when the user may edit it,
 * otherwise to the personal pack. Large still images are drawn at 128 px; GIFs over 256 KB
 * are refused.
 */
export function AddCustomEmoji({ file, onCancel, onAdd }: AddCustomEmojiProps) {
  const client = useMatrixClient();
  const alive = useAlive();
  const { t } = useTranslation();
  const previewUrl = useObjectURL(file);
  const serverRoom = useServerEmojiRoom();
  const [name, setName] = useState(() => toShortcode(getFileNameWithoutExt(file.name)));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [takenShortcode, setTakenShortcode] = useState<string>();

  // The pack this render describes is the one a submit adds to, even if power levels change.
  const targetRoom = serverRoom && canAddServerEmoji(client, serverRoom) ? serverRoom : undefined;
  const targetRef = useRef(targetRoom);
  targetRef.current = targetRoom;

  const shortcode = toShortcode(name);
  const gifTooLarge = file.type === 'image/gif' && file.size > MAX_ANIMATED_EMOJI_BYTES;
  const taken =
    shortcode.length > 0 &&
    (takenShortcode === shortcode || isShortcodeTaken(client, targetRoom, shortcode));
  const canSubmit = !busy && !gifTooLarge && !taken && shortcode.length > 0;
  const server = getMxIdServer(client.getSafeUserId());

  const handleNameChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setName(evt.target.value);
    setFailed(false);
  };

  const handleSubmit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (!canSubmit) return;
    const target = targetRef.current;
    // Another device may have taken the name since this form rendered.
    if (isShortcodeTaken(client, target, shortcode)) {
      setTakenShortcode(shortcode);
      return;
    }

    setBusy(true);
    setFailed(false);
    try {
      const prepared = await prepareEmojiImage(file, await loadImage(file));
      const { content_uri: mxc } = await client.uploadContent(prepared.file, {
        name: prepared.file.name,
        type: prepared.file.type,
      });
      const image = { url: mxc, info: prepared.info };
      if (target) {
        await addToServerPack(client, target, shortcode, image);
      } else {
        const pack = getPersonalPackContent(client);
        await client.setAccountData(
          AccountDataEvent.PoniesUserEmotes as never,
          { ...pack, images: { ...pack.images, [shortcode]: image } } as never
        );
      }
      if (!alive()) return;
      setBusy(false);
      onAdd(mxc, shortcode);
    } catch (error) {
      if (!alive()) return;
      setBusy(false);
      if (error instanceof ShortcodeTakenError) {
        // Until sync brings the other emoji in, keep Add off for this name.
        setTakenShortcode(shortcode);
        return;
      }
      if (error instanceof EmojiImageTooLargeError) return;
      setFailed(true);
    }
  };

  let message: string | undefined;
  let critical = false;
  if (gifTooLarge) {
    message = t('sharedUi.emojiBoard.addCustomEmojiTooLarge', {
      limit: `${MAX_ANIMATED_EMOJI_BYTES / 1024} KB`,
    });
    critical = true;
  } else if (taken) {
    message = t('sharedUi.emojiBoard.addCustomEmojiNameTaken');
    critical = true;
  } else if (failed) {
    message = t('sharedUi.emojiBoard.addCustomEmojiFailed');
    critical = true;
  }

  return (
    <Box
      as="form"
      className={css.AddCustomEmoji}
      onSubmit={(evt: FormEvent<HTMLFormElement>) => void handleSubmit(evt)}
    >
      <Box alignItems="Center" gap="300">
        {previewUrl && <img className={css.AddCustomEmojiPreview} src={previewUrl} alt="" />}
        <Box direction="Column" gap="100" grow="Yes">
          <Text size="H5">{t('sharedUi.emojiBoard.addCustomEmoji')}</Text>
          <Text size="T200" priority="300">
            {targetRoom
              ? t('sharedUi.emojiBoard.addCustomEmojiServerDescription', { server })
              : t('sharedUi.emojiBoard.addCustomEmojiDescription')}
          </Text>
        </Box>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('sharedUi.emojiBoard.addCustomEmojiName')}</Text>
        <Input
          name="shortcodeInput"
          value={name}
          onChange={handleNameChange}
          variant="Background"
          size="400"
          radii="300"
          required
          autoFocus={!mobileOrTablet()}
          readOnly={busy}
          before={
            <Text as="span" size="T300" priority="300">
              :
            </Text>
          }
          after={
            <Text as="span" size="T300" priority="300">
              :
            </Text>
          }
        />
        {message && (
          <Text
            size="T200"
            role={critical ? 'alert' : undefined}
            style={{ color: critical ? color.Critical.Main : undefined }}
          >
            {message}
          </Text>
        )}
      </Box>
      <Box gap="200" justifyContent="End">
        <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={onCancel}>
          <Text size="B300">{t('sharedUi.emojiBoard.cancel')}</Text>
        </Button>
        <Button
          type="submit"
          variant="Primary"
          size="300"
          disabled={!canSubmit}
          before={busy ? <Spinner size="100" variant="Primary" fill="Solid" /> : undefined}
        >
          <Text size="B300">{t('sharedUi.emojiBoard.add')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
