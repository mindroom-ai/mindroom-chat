import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Input, Text, color, config, toRem } from 'folds';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import type { PackImage } from '../custom/types';
import { mxcUrlToHttp } from '../../matrix/matrix';
import {
  isValidShortcode,
  type PackImageChanges,
  type UsageOption,
  usageToOption,
} from './packDraft';
import { IMAGE_USAGE_OPTIONS, UsageSelector } from './UsageSelector';

type ImageUsageChoice = (typeof IMAGE_USAGE_OPTIONS)[number];

function PackImagePreview({
  url,
  shortcode,
  size,
}: {
  url: string;
  shortcode: string;
  size: number;
}) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  return (
    <img
      src={mxcUrlToHttp(client, url, authenticated, 96, 96, 'scale') ?? undefined}
      alt={shortcode}
      style={{ width: toRem(size), height: toRem(size), objectFit: 'contain', flexShrink: 0 }}
      loading="lazy"
    />
  );
}

type ImageEditFormProps = {
  shortcode: string;
  image: PackImage;
  /** Whether another image already has the shortcode. */
  isTaken: (shortcode: string) => boolean;
  onSave: (changes: PackImageChanges) => void;
  onCancel: () => void;
};

/** Shortcode, description and usage of one image; Save puts them into the pending edits. */
function ImageEditForm({ shortcode, image, isTaken, onSave, onCancel }: ImageEditFormProps) {
  const { t } = useTranslation();
  const [nextShortcode, setNextShortcode] = useState(shortcode);
  const [body, setBody] = useState(image.body ?? '');
  const [usage, setUsage] = useState<ImageUsageChoice>(
    image.usage ? usageToOption(image.usage) : 'inherit'
  );
  const trimmed = nextShortcode.trim();
  let problem: string | undefined;
  if (!isValidShortcode(trimmed)) problem = t('sharedUi.imageTile.shortcodeInvalid');
  else if (trimmed !== shortcode && isTaken(trimmed))
    problem = t('sharedUi.imageTile.shortcodeTaken');
  const fieldId = `pack-image-${shortcode}`;

  const submit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (problem) return;
    onSave({
      shortcode: trimmed,
      body,
      usage: usage === 'inherit' ? undefined : usage,
    });
  };

  return (
    <Box
      as="form"
      gap="300"
      alignItems="Start"
      style={{ paddingBlock: config.space.S200 }}
      onSubmit={submit}
    >
      <PackImagePreview url={image.url} shortcode={shortcode} size={48} />
      <Box grow="Yes" direction="Column" gap="300" style={{ minWidth: 0 }}>
        <Box direction="Column" gap="100">
          <Text as="label" size="L400" htmlFor={`${fieldId}-shortcode`}>
            {t('sharedUi.imageTile.shortcode')}
          </Text>
          <Input
            id={`${fieldId}-shortcode`}
            value={nextShortcode}
            onChange={(evt) => setNextShortcode(evt.currentTarget.value)}
            variant="Background"
            size="300"
            radii="300"
            autoFocus
            aria-invalid={!!problem}
          />
          {problem && (
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {problem}
            </Text>
          )}
        </Box>
        <Box direction="Column" gap="100">
          <Text as="label" size="L400" htmlFor={`${fieldId}-body`}>
            {t('sharedUi.imageTile.body')}
          </Text>
          <Input
            id={`${fieldId}-body`}
            value={body}
            onChange={(evt) => setBody(evt.currentTarget.value)}
            variant="Background"
            size="300"
            radii="300"
          />
        </Box>
        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200" wrap="Wrap">
          <Box alignItems="Center" gap="200">
            <Text size="L400">{t('sharedUi.imageTile.usage')}</Text>
            <UsageSelector value={usage} options={IMAGE_USAGE_OPTIONS} onChange={setUsage} />
          </Box>
          <Box gap="200">
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={onCancel}
            >
              <Text as="span" size="B300">
                {t('sharedUi.imageTile.cancel')}
              </Text>
            </Button>
            <Button type="submit" size="300" radii="300" variant="Success" disabled={!!problem}>
              <Text as="span" size="B300">
                {t('sharedUi.imageTile.save')}
              </Text>
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

type PackImageRowProps = {
  shortcode: string;
  image: PackImage;
  canEdit: boolean;
  /** Marked for removal: shown faded with Undo until the changes are applied or reset. */
  removed: boolean;
  editing: boolean;
  isTaken: (shortcode: string) => boolean;
  onEdit: () => void;
  onSave: (changes: PackImageChanges) => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onUndo: () => void;
};

/** One image of the pack: its picture, `:shortcode:` and description, with Edit and Remove. */
export function PackImageRow(props: PackImageRowProps) {
  const { shortcode, image, canEdit, removed, editing, isTaken } = props;
  const { t } = useTranslation();
  if (editing) {
    return (
      <ImageEditForm
        shortcode={shortcode}
        image={image}
        isTaken={isTaken}
        onSave={props.onSave}
        onCancel={props.onCancelEdit}
      />
    );
  }

  const ownUsage = image.usage ? usageToOption(image.usage) : undefined;
  const usageLabels: Record<UsageOption, string> = {
    emoticon: t('sharedUi.imageUsage.emoji'),
    sticker: t('sharedUi.imageUsage.sticker'),
    both: t('sharedUi.imageUsage.both'),
  };
  let detail: string | undefined;
  if (removed) detail = t('sharedUi.imageTile.removedOnApply');
  else if (image.body && image.body !== shortcode) detail = image.body;

  return (
    <Box
      alignItems="Center"
      gap="300"
      style={{ minHeight: toRem(48), paddingBlock: config.space.S100, opacity: removed ? 0.6 : 1 }}
    >
      <PackImagePreview url={image.url} shortcode={shortcode} size={32} />
      <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
        <Text
          size="T300"
          truncate
          style={removed ? { textDecoration: 'line-through' } : undefined}
        >{`:${shortcode}:`}</Text>
        {detail && (
          <Text size="T200" priority="300" truncate>
            {detail}
          </Text>
        )}
      </Box>
      {ownUsage && !removed && (
        <Text size="T200" priority="300">
          {usageLabels[ownUsage]}
        </Text>
      )}
      {canEdit && removed && (
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          aria-label={t('sharedUi.imageTile.keepImage', { shortcode })}
          onClick={props.onUndo}
        >
          <Text as="span" size="B300">
            {t('sharedUi.imageTile.undo')}
          </Text>
        </Button>
      )}
      {canEdit && !removed && (
        <Box gap="100" shrink="No">
          <IconButton
            size="300"
            radii="300"
            onClick={props.onEdit}
            aria-label={t('sharedUi.imageTile.editImage', { shortcode })}
            title={t('sharedUi.imageTile.edit')}
          >
            <Icon size="50" src={Icons.Pencil} />
          </IconButton>
          <IconButton
            size="300"
            radii="300"
            variant="Critical"
            onClick={props.onRemove}
            aria-label={t('sharedUi.imageTile.removeImage', { shortcode })}
            title={t('sharedUi.imageTile.remove')}
          >
            <Icon size="50" src={Icons.Delete} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
