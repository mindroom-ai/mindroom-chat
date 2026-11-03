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
const isBlobUrl = (src: string) => src.startsWith('blob:');







    const [progress, setProgress] = useState<SaveProgress>({ pending: false, failed: false });
    const savable = isBlobUrl(src);
    const { pending, failed } = progress;

    // A failed attempt keeps its warning until the next attempt settles.
    const startSave = () => {
      if (pending || !savable) return;
      setProgress((previous) => ({ ...previous, pending: true }));
      saveFile(src, name).then(
        () => setProgress({ pending: false, failed: false }),
        () => setProgress({ pending: false, failed: true })
      );
    };

    const frameStyle = { display: 'block', width: '100%', height: '100%', border: 'none' };

    return (
      <Box direction="Column" className={classNames(css.PdfViewer, className)} {...props} ref={ref}>
        {/* The header's own gap spaces back button, title and download. */}
        <Header size="400" className={css.PdfViewerHeader}>
          <IconButton
            aria-label={t('sharedUi.pdfViewer.close')}
            onClick={requestClose}
            radii="300"
            size="300"
          >
            <Icon src={Icons.ArrowLeft} size="50" />
          </IconButton>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text truncate size="T300">
              {name}
            </Text>
          </Box>
          <Chip
            before={<Icon src={failed ? Icons.Warning : Icons.Download} size="50" />}
            disabled={pending || !savable}
            onClick={startSave}
            radii="300"
            variant={failed ? 'Critical' : 'Primary'}
            style={{ flexShrink: 0 }}
          >
            <Text size="B300">
              {t(failed ? 'sharedUi.pdfViewer.retryDownload' : 'sharedUi.pdfViewer.download')}
            </Text>
          </Chip>
        </Header>
        <Box className={css.PdfViewerContent} grow="Yes">
          {savable ? <iframe src={src} title={name} style={frameStyle} /> : null}
        </Box>
      </Box>
    );
  }
);
