import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box, Text } from 'folds';
import classNames from 'classnames';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { DownloadFile, ReadTextFile } from './FileContent';
import { TextViewer } from '../viewers/TextViewer';
import { bytesToSize } from '../../lib/common';
import { FALLBACK_MIMETYPE } from '../../lib/mimeTypes';
import * as css from './PasteAttachmentContent.css';
import type { PasteAttachmentFile } from '../../matrix/protocol/pasteAttachmentMarker';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useGlassHighlight } from '../../ui/glass/liquid/useLiquidGlass';

type PasteAttachmentContentProps = {
  owner?: EventAttachmentOwner;
  attachment: PasteAttachmentFile;
  outlined?: boolean;
};

const getPasteAttachmentDetail = (
  { chars, size }: Pick<PasteAttachmentFile, 'chars' | 'size'>,
  t: TFunction,
  locale: string
): string | undefined => {
  if (typeof chars === 'number') {
    return t('mindroomUi.messages.mindroomPasteAttachmentContent.characterCount', {
      count: chars,
      formattedCount: chars.toLocaleString(locale),
    });
  }
  if (typeof size === 'number') {
    return bytesToSize(size);
  }
  return undefined;
};

export function PasteAttachmentContent({
  owner,
  attachment,
  outlined,
}: PasteAttachmentContentProps) {
  const glassRef = useGlassHighlight<HTMLDivElement>();
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { encryptedFile, fileName, mimeType = FALLBACK_MIMETYPE, mxcUri, size } = attachment;
  const detail = getPasteAttachmentDetail(attachment, t, language);
  const fileInfo = {
    mimetype: mimeType,
    ...(typeof size === 'number' ? { size } : {}),
  };

  return (
    <Box ref={glassRef} className={classNames(css.Card, outlined && css.Outlined)}>
      <Box className={css.Header}>
        <Text className={css.Title} size="T300">
          {t('mindroomUi.messages.mindroomPasteAttachmentContent.pastedText')}
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
            owner={owner}
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            buttonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.open')}
            errorButtonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.retry')}
            buttonSize="300"
            renderViewer={(props) => <TextViewer {...props} />}
          />
          <DownloadFile
            owner={owner}
            body={fileName}
            mimeType={mimeType}
            url={mxcUri}
            encInfo={encryptedFile}
            info={fileInfo}
            buttonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.download')}
            errorButtonText={t('mindroomUi.messages.mindroomPasteAttachmentContent.retry')}
            buttonSize="300"
          />
        </Box>
      </Box>
    </Box>
  );
}
