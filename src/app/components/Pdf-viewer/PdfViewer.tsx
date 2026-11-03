import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../glass/GlassPrimitives';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import * as css from './PdfViewer.css';












    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);

    const handleDownload = async () => {
      if (saving) return;
      setSaving(true);
      try {
        await saveFile(src, name);
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
      } finally {
        setSaving(false);
      }























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
          <iframe
            title={name}
            src={src}
            style={{ border: 'none', width: '100%', height: '100%', display: 'block' }}
          />
        </Box>
      </Box>
    );
  }
);
