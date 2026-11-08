import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Icon, IconButton, Icons, Spinner } from 'folds';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { useAttachmentSave } from './attachmentDownload';
import { revealDirectionControls } from '../../ui/directional';

type FileDownloadButtonProps = {
  filename: string;
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  /**
   * Visible text for a menu row: the button then shows it before the icon and takes
   * `className` instead of the icon button look; `data-error` marks a failed save.
   */
  label?: string;
  className?: string;
};

/** Icon button that saves an attachment; turns red when saving failed so it reads as retry. */
export function FileDownloadButton({
  filename,
  url,
  mimeType,
  encInfo,
  owner,
  label,
  className,
}: FileDownloadButtonProps) {
  const { t } = useTranslation();
  const [status, download] = useAttachmentSave({ owner, url, mimeType, encInfo }, filename);
  const buttonProps = {
    'aria-label': t('sharedUi.fileHeader.downloadValue1', {
      value1: revealDirectionControls(filename),
    }),
    disabled: status === 'loading',
    onClick: () => {
      download().catch(() => undefined);
    },
  };
  const icon =
    status === 'loading' ? (
      <Spinner size="100" variant="Secondary" />
    ) : (
      <Icon size="100" src={Icons.Download} />
    );

  if (label !== undefined) {
    return (
      <button
        type="button"
        className={className}
        data-error={status === 'error' || undefined}
        {...buttonProps}
      >
        <span>{label}</span>
        {icon}
      </button>
    );
  }

  return (
    <IconButton
      size="300"
      radii="300"
      variant={status === 'error' ? 'Critical' : 'SurfaceVariant'}
      {...buttonProps}
    >
      {icon}
    </IconButton>
  );
}
