import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../glass/GlassPrimitives';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import * as css from './PdfViewer.css';

export type PdfViewerProps = {
  name: string;
  /** Object URL (`blob:`) of the PDF. Any other URL is neither shown nor saved. */
  src: string;
  requestClose: () => void;
};

// The frame is not sandboxed (browsers do not run their PDF viewer in one), so only local
// object URLs reach it: never a `javascript:` URL or a server response that could be HTML.






    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const allowed = isBlobUrl(src);

    const handleDownload = async () => {
      if (saving || !allowed) return;
      setSaving(true);
      try {
        await saveFile(src, name);
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }






            <IconButton
              size="300"
              radii="300"
              onClick={requestClose}
              aria-label={t('sharedUi.pdfViewer.close')}
            >
              <Icon size="50" src={Icons.ArrowLeft} />
            </IconButton>
            <Text size="T300" truncate>
              {name}
            </Text>
          </Box>
          <Box shrink="No" alignItems="Center" gap="200">
            <Chip
              variant={saveFailed ? 'Critical' : 'Primary'}
              radii="300"
              disabled={saving || !allowed}
              onClick={() => {
                handleDownload().catch(() => undefined);
              }}
              before={<Icon size="50" src={saveFailed ? Icons.Warning : Icons.Download} />}
            >
              <Text size="B300">
                {saveFailed
                  ? t('sharedUi.pdfViewer.retryDownload')
                  : t('sharedUi.pdfViewer.download')}
              </Text>
            </Chip>
          </Box>
        </Header>
        <Box grow="Yes" className={css.PdfViewerContent}>
          {allowed && (
            <iframe
              title={name}
              src={src}
              style={{ border: 'none', width: '100%', height: '100%', display: 'block' }}
            />
          )}
        </Box>
      </Box>
    );
  }
);
