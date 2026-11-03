import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Icon, IconButton, Icons, Spinner } from 'folds';
import type { EventAttachmentOwner } from '../../mindroom/messages/eventAttachments';
import { useAttachmentSave } from './attachmentDownload';

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
  const [status, download] = useAttachmentSave({ owner, url, mimeType, encInfo }, filename);

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
