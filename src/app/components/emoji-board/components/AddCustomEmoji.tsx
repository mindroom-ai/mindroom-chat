import { useTranslation } from 'react-i18next';
import React, { ChangeEvent, FormEventHandler, useCallback, useState } from 'react';
import { Box, Button, Input, Spinner, Text, color } from 'folds';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useObjectURL } from '../../../hooks/useObjectURL';
import { useAlive } from '../../../hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { loadImageElement } from '../../../utils/dom';
import { getImageInfo, getMxIdServer } from '../../../utils/matrix';
import { getAccountData } from '../../../utils/room';
import { getFileNameWithoutExt } from '../../../utils/mimeTypes';
import { mobileOrTablet } from '../../../utils/user-agent';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { addEmoticonToPackContent, PackContent, PackImage } from '../../../plugins/custom-emoji';
import { addToServerPack, canAddServerEmoji } from '../../../mindroom/server-emoji/addToServerPack';
import { useServerEmojiRoom } from '../../../mindroom/server-emoji/useServerEmojiRoom';
import * as css from './styles.css';

const toShortcode = (name: string): string => name.trim().replace(/[\s:]+/g, '-');

type AddCustomEmojiProps = {
  file: File;
  onCancel: () => void;
  onAdd: (mxc: string, shortcode: string) => void;
};

// Adds the picked image to the server's shared pack when the user may, otherwise
// to their personal pack; every room's emoji board shows both.
export function AddCustomEmoji({ file, onCancel, onAdd }: AddCustomEmojiProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const serverRoom = useServerEmojiRoom();
  // Decided once per render, so the description and the submit agree on the target.
  const serverPackRoom = serverRoom && canAddServerEmoji(mx, serverRoom) ? serverRoom : undefined;
  const previewUrl = useObjectURL(file);
  const [name, setName] = useState(() => toShortcode(getFileNameWithoutExt(file.name)));
  const shortcode = toShortcode(name);

  const [addState, addEmoji] = useAsyncCallback(
    useCallback(async () => {
      const img = await loadImageElement(previewUrl ?? '');
      const { content_uri: mxc } = await mx.uploadContent(file, {
        name: file.name,
        type: file.type,
      });
      const image: PackImage = { url: mxc, info: getImageInfo(img, file) };
      if (serverPackRoom) {
        return { mxc, shortcode: await addToServerPack(mx, serverPackRoom, shortcode, image) };
      }
      // Read the pack only now, so an edit made meanwhile is kept.
      const pack = getAccountData(mx, AccountDataEvent.PoniesUserEmotes)?.getContent<PackContent>();
      const added = addEmoticonToPackContent(pack, shortcode, image);
      await mx.setAccountData(AccountDataEvent.PoniesUserEmotes as any, added.content as any);
      return { mxc, shortcode: added.shortcode };
    }, [mx, file, previewUrl, shortcode, serverPackRoom])
  );
  const adding = addState.status === AsyncStatus.Loading;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    // The board can sit inside another form (power tags), which would also get this submit.
    evt.stopPropagation();
    if (!shortcode || adding) return;
    addEmoji().then(
      (added) => {
        if (alive()) onAdd(added.mxc, added.shortcode);
      },
      () => undefined
    );
  };

  return (
    <Box
      as="form"
      className={css.AddCustomEmoji}
      grow="Yes"
      direction="Column"
      gap="400"
      onSubmit={handleSubmit}
    >
      <Text size="T300" priority="300">
        {serverPackRoom
          ? t('sharedUi.emojiBoard.addCustomEmojiServerDescription', {
              server: getMxIdServer(mx.getSafeUserId()),
            })
          : t('sharedUi.emojiBoard.addCustomEmojiDescription')}
      </Text>
      <Box alignItems="Center" gap="300">
        <img className={css.AddCustomEmojiPreview} src={previewUrl} alt="" />
        <Box grow="Yes" direction="Column">
          <Input
            before={<Text size="L400">{t('sharedUi.imageTile.shortcode')}</Text>}
            value={name}
            onChange={(evt: ChangeEvent<HTMLInputElement>) => setName(evt.target.value)}
            variant="SurfaceVariant"
            size="400"
            radii="300"
            maxLength={100}
            required
            autoFocus={!mobileOrTablet()}
          />
        </Box>
      </Box>
      {addState.status === AsyncStatus.Error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('sharedUi.emojiBoard.addCustomEmojiFailed')}
        </Text>
      )}
      <Box justifyContent="End" gap="200">
        <Button
          type="button"
          variant="Secondary"
          fill="Soft"
          size="300"
          radii="300"
          disabled={adding}
          onClick={onCancel}
        >
          <Text size="B300">{t('sharedUi.imageTile.cancel')}</Text>
        </Button>
        <Button
          type="submit"
          variant="Primary"
          size="300"
          radii="300"
          disabled={!shortcode || adding}
          before={adding && <Spinner variant="Primary" fill="Solid" size="100" />}
        >
          <Text size="B300">{t('sharedUi.emojiBoard.add')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
