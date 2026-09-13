import { Badge, Box, Icon, IconButton, Icons, Spinner, Text, as, toRem } from 'folds';
import React, { ReactNode, useCallback, useRef } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { mimeTypeToExt } from '../../utils/mimeTypes';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../utils/matrix';

const badgeStyles = { maxWidth: toRem(100) };

type FileDownloadButtonProps = {
  filename: string;
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};
export function FileDownloadButton({ filename, url, mimeType, encInfo }: FileDownloadButtonProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const downloadedFileRef = useRef<{
    url: string;
    mimeType: string;
    encInfo?: EncryptedAttachmentInfo;
    blob: Blob;
  }>();

  const [downloadState, download] = useAsyncCallback(
    useCallback(async () => {
      const cachedFile = downloadedFileRef.current;
      let fileContent =
        cachedFile?.url === url &&
        cachedFile.mimeType === mimeType &&
        cachedFile.encInfo === encInfo
          ? cachedFile.blob
          : undefined;
      if (!fileContent) {
        const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
        if (!mediaUrl) throw new Error('Invalid media URL');
        fileContent = encInfo
          ? await downloadEncryptedMedia(mediaUrl, (encBuf) =>
              decryptFile(encBuf, mimeType, encInfo)
            )
          : await downloadMedia(mediaUrl);
        downloadedFileRef.current = { url, mimeType, encInfo, blob: fileContent };
      }

      await saveFile(fileContent, filename);
    }, [mx, url, useAuthentication, mimeType, encInfo, filename])
  );
  const downloading = downloadState.status === AsyncStatus.Loading;
  const hasError = downloadState.status === AsyncStatus.Error;
  const handleDownload = () => {
    void download().catch(() => undefined);
  };
  return (
    <IconButton
      disabled={downloading}
      onClick={handleDownload}
      variant={hasError ? 'Critical' : 'SurfaceVariant'}
      size="300"
      radii="300"
      aria-label={`Download ${filename}`}
    >
      {downloading ? (
        <Spinner size="100" variant={hasError ? 'Critical' : 'Secondary'} />
      ) : (
        <Icon size="100" src={Icons.Download} />
      )}
    </IconButton>
  );
}

export type FileHeaderProps = {
  body: string;
  mimeType: string;
  after?: ReactNode;
};
export const FileHeader = as<'div', FileHeaderProps>(({ body, mimeType, after, ...props }, ref) => (
  <Box alignItems="Center" gap="200" grow="Yes" {...props} ref={ref}>
    <Box shrink="No">
      <Badge style={badgeStyles} variant="Secondary" radii="Pill">
        <Text size="O400" truncate>
          {mimeTypeToExt(mimeType)}
        </Text>
      </Badge>
    </Box>
    <Box grow="Yes">
      <Text size="T300" truncate>
        {body}
      </Text>
    </Box>
    {after}
  </Box>
));
