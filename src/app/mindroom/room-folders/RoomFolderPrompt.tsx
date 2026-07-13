import React, { FormEventHandler, useId, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { useTranslation } from 'react-i18next';
import { stopPropagation } from '../../utils/keyboard';

type RoomFolderPromptProps = {
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
};

export function RoomFolderPrompt({ initialName, onSubmit, onCancel }: RoomFolderPromptProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameLabelId = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem('folderName') as HTMLInputElement | null)?.value.trim();
    if (!name || saving) return;

    setSaving(true);
    setFailed(false);
    try {
      await onSubmit(name);
      onCancel();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: !saving,
            escapeDeactivates: saving ? false : stopPropagation,
          }}
        >
          <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} variant="Surface">
            <Header
              style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text id={titleId} size="H4">
                  {initialName ? t('nav.renameRoomFolder') : t('nav.createRoomFolder')}
                </Text>
              </Box>
              <IconButton
                size="300"
                onClick={onCancel}
                radii="300"
                disabled={saving}
                aria-label={t('nav.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              as="form"
              onSubmit={handleSubmit}
              style={{ padding: config.space.S400, paddingTop: 0 }}
              direction="Column"
              gap="400"
            >
              <Box direction="Column" gap="100">
                <Text id={nameLabelId} size="L400">
                  {t('nav.roomFolderName')}
                </Text>
                <Input
                  size="500"
                  autoFocus
                  name="folderName"
                  variant="Background"
                  defaultValue={initialName}
                  maxLength={80}
                  required
                  readOnly={saving}
                  aria-labelledby={nameLabelId}
                />
                {failed && (
                  <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                    {t('nav.roomFolderSaveFailed')}
                  </Text>
                )}
              </Box>
              <Button type="submit" variant="Primary" disabled={saving}>
                {saving && <Spinner size="100" />}
                <Text size="B400">{t('settings.general.dateTime.save')}</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type DeleteRoomFolderPromptProps = {
  folderName: string;
  onDelete: () => Promise<void>;
  onCancel: () => void;
};

export function DeleteRoomFolderPrompt({
  folderName,
  onDelete,
  onCancel,
}: DeleteRoomFolderPromptProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    setFailed(false);
    try {
      await onDelete();
      onCancel();
    } catch {
      setFailed(true);
      setDeleting(false);
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: !deleting,
            escapeDeactivates: deleting ? false : stopPropagation,
          }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            variant="Surface"
          >
            <Header
              style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text id={titleId} size="H4">
                  {t('nav.deleteRoomFolder')}
                </Text>
              </Box>
              <IconButton
                size="300"
                onClick={onCancel}
                radii="300"
                disabled={deleting}
                aria-label={t('nav.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400, paddingTop: 0 }} direction="Column" gap="400">
              <Text id={descriptionId} size="T300">
                {t('nav.deleteRoomFolderDescription', { name: folderName })}
              </Text>
              {failed && (
                <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                  {t('nav.roomFolderSaveFailed')}
                </Text>
              )}
              <Box justifyContent="End" gap="200">
                <Button onClick={onCancel} variant="Secondary" disabled={deleting}>
                  <Text size="B400">{t('nav.cancel')}</Text>
                </Button>
                <Button onClick={handleDelete} variant="Critical" disabled={deleting}>
                  {deleting && <Spinner size="100" />}
                  <Text size="B400">{t('nav.delete')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
