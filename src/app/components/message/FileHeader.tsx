import React, { ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Box, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import type { EventAttachmentOwner } from '../../mindroom/messages/eventAttachments';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import { useAttachmentAction } from './attachmentDownload';

type FileHeaderProps = {
  body: string;
  mimeType: string;
  after?: ReactNode;
};

/** File name line above a file's actions. */
export function FileHeader({ body, mimeType, after }: FileHeaderProps) {
  return (
    <Box alignItems="Center" gap="200" style={{ minWidth: 0 }} title={mimeType}>
      <Icon size="100" src={Icons.File} />
      <Text size="T300" truncate style={{ flexGrow: 1, minWidth: 0 }}>
        {body}
      </Text>
      {after}
    </Box>
  );
}

type FileDownloadButtonProps = {
  filename: string;
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
};

/** Icon button that saves an attachment; turns red when saving failed so it reads as retry. */
export function FileDownloadButton({
  filename,
  url,
  mimeType,
  encInfo,
  owner,
}: FileDownloadButtonProps) {
  const { t } = useTranslation();
  const save = useCallback((blob: Blob) => saveFile(blob, filename), [filename]);
  const [status, download] = useAttachmentAction({ owner, url, mimeType, encInfo }, save);

  return (
    <IconButton
      size="300"
      radii="300"
      variant={status === 'error' ? 'Critical' : 'SurfaceVariant'}
      aria-label={t('sharedUi.fileHeader.downloadValue1', { value1: filename })}
      disabled={status === 'loading'}
      onClick={() => {
        download().catch(() => undefined);
      }}
    >
      {status === 'loading' ? (
        <Spinner size="100" variant="Secondary" />
      ) : (
        <Icon size="100" src={Icons.Download} />
      )}
    </IconButton>
  );
}
