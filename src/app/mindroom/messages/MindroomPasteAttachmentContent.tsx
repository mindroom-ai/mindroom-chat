import React from 'react';
import { Box, Text } from 'folds';
import classNames from 'classnames';
import { DownloadFile, ReadTextFile } from '../../components/message';
import { TextViewer } from '../../components/text-viewer';
import { bytesToSize } from '../../utils/common';
import { FALLBACK_MIMETYPE } from '../../utils/mimeTypes';
import * as css from './MindroomPasteAttachmentContent.css';
import type { MindroomPasteAttachmentFile } from './pasteAttachmentMarker';

type MindroomPasteAttachmentContentProps = {
  attachment: MindroomPasteAttachmentFile;
  outlined?: boolean;
};

const getPasteAttachmentDetail = ({
  chars,
  size,
}: Pick<MindroomPasteAttachmentFile, 'chars' | 'size'>): string | undefined => {
  if (typeof chars === 'number') {
    return `${chars.toLocaleString()} characters`;
  }
  if (typeof size === 'number') {
    return bytesToSize(size);
  }
  return undefined;
};

export function MindroomPasteAttachmentContent({
  attachment,
  outlined,
}: MindroomPasteAttachmentContentProps) {
  const { encryptedFile, fileName, mimeType = FALLBACK_MIMETYPE, mxcUri, size } = attachment;
  const detail = getPasteAttachmentDetail(attachment);
  const fileInfo = {
    mimetype: mimeType,
    ...(typeof size === 'number' ? { size } : {}),
  };

  return (
    <Box className={classNames(css.Card, outlined && css.Outlined)}>
      <Box className={css.Header}>
        <Text className={css.Title} size="T300">
          Pasted text
        </Text>
        {detail && (
          <Text className={css.Meta} size="B300" truncate>
            {detail}
          </Text>
        )}
      </Box>
      <Box className={css.Details}>
        <Text className={css.FileName} title={fileName} size="B300" truncate>
          {fileName}
        </Text>
        <Box className={css.Actions}>
          <ReadTextFile
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            buttonText="Open"
            errorButtonText="Retry"
            buttonSize="300"
            renderViewer={(props) => <TextViewer {...props} />}
          />
          <DownloadFile
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            info={fileInfo}
            buttonText="Download"
            errorButtonText="Retry"
            buttonSize="300"
          />
        </Box>
      </Box>
    </Box>
  );
}
