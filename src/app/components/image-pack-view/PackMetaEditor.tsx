import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Box,
  Button,
  Icon,
  Icons,
  Input,
  Spinner,
  Text,
  color,
} from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useAlive } from '../../hooks/useAlive';
import type { PackMeta } from '../../plugins/custom-emoji';
import { mxcUrlToHttp } from '../../utils/matrix';
import { selectFile } from '../../utils/dom';
import type { PackMetaChanges } from './packDraft';

/** The pack's avatar at `size` pixels, or a sticker icon while it has none. */
export function PackAvatar({
  mxc,
  name,
  size,
}: {
  mxc?: string;
  name: string;
  size: '300' | '400' | '500';
}) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const src = mxc
    ? mxcUrlToHttp(client, mxc, authenticated, 96, 96, 'crop') ?? undefined
    : undefined;
  return (
    <Avatar size={size} radii="300">
      {src ? (
        <AvatarImage src={src} alt={name} />
      ) : (
        <AvatarFallback
          style={{ backgroundColor: color.Secondary.Container, color: color.Secondary.OnContainer }}
        >
          <Icon src={Icons.Sticker} />
        </AvatarFallback>
      )}
    </Avatar>
  );
}

type PackMetaEditorProps = {
  meta: PackMeta;
  onSave: (changes: PackMetaChanges) => void;
  onCancel: () => void;
};

/**
 * Edits the pack's name, attribution and avatar. Save puts the changes into the pending edits,
 * which Apply Changes then sends with the rest.
 */
export function PackMetaEditor({ meta, onSave, onCancel }: PackMetaEditorProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [name, setName] = useState(meta.display_name ?? '');
  const [attribution, setAttribution] = useState(meta.attribution ?? '');
  const [avatarUrl, setAvatarUrl] = useState(meta.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);

  const uploadAvatar = async () => {
    const file = await selectFile('image/*');
    if (!file) return;
    setUploading(true);
    setFailed(false);
    try {
      const { content_uri: mxc } = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      });
      if (alive()) setAvatarUrl(mxc);
    } catch {
      if (alive()) setFailed(true);
    } finally {
      if (alive()) setUploading(false);
    }
  };

  const submit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    onSave({ name, attribution, avatarUrl });
  };

  return (
    <Box as="form" direction="Column" gap="400" onSubmit={submit}>
      <Box alignItems="Center" gap="300">
        <PackAvatar mxc={avatarUrl} name={name} size="500" />
        <Box direction="Column" gap="200">
          <Text size="L400">{t('sharedUi.packMeta.packAvatar')}</Text>
          <Box gap="200" wrap="Wrap">
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              disabled={uploading}
              before={uploading ? <Spinner size="100" variant="Secondary" /> : undefined}
              onClick={uploadAvatar}
            >
              <Text as="span" size="B300">
                {t('sharedUi.packMeta.upload')}
              </Text>
            </Button>
            {avatarUrl !== meta.avatar_url && (
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Secondary"
                fill="None"
                onClick={() => setAvatarUrl(meta.avatar_url)}
              >
                <Text as="span" size="B300">
                  {t('sharedUi.packMeta.reset')}
                </Text>
              </Button>
            )}
            {avatarUrl && (
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Critical"
                fill="None"
                onClick={() => setAvatarUrl(undefined)}
              >
                <Text as="span" size="B300">
                  {t('sharedUi.packMeta.remove')}
                </Text>
              </Button>
            )}
          </Box>
        </Box>
      </Box>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('sharedUi.imagePackContent.uploadFailed')}
        </Text>
      )}
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" htmlFor="image-pack-name">
          {t('sharedUi.packMeta.name')}
        </Text>
        <Input
          id="image-pack-name"
          value={name}
          onChange={(evt) => setName(evt.currentTarget.value)}
          variant="Background"
          size="400"
          radii="300"
          autoFocus
        />
      </Box>
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" htmlFor="image-pack-attribution">
          {t('sharedUi.packMeta.attribution')}
        </Text>
        <Input
          id="image-pack-attribution"
          value={attribution}
          onChange={(evt) => setAttribution(evt.currentTarget.value)}
          variant="Background"
          size="400"
          radii="300"
        />
      </Box>
      <Box gap="200" justifyContent="End">
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={onCancel}
        >
          <Text as="span" size="B300">
            {t('sharedUi.packMeta.cancel')}
          </Text>
        </Button>
        <Button type="submit" size="300" radii="300" variant="Success" disabled={uploading}>
          <Text as="span" size="B300">
            {t('sharedUi.packMeta.save')}
          </Text>
        </Button>
      </Box>
    </Box>
  );
}
