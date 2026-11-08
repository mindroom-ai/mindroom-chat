import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { saveFile } from '../../native/nativeFileSave';
import { appUrl } from '../../lib/basePath';
import { revealDirectionControls } from '../../ui/directional';
import * as css from './PdfViewer.css';

type PdfViewerProps = {
  name: string;
  /** Object URL (`blob:`) of the PDF. Any other URL is neither shown nor saved. */
  src: string;
  requestClose: () => void;
};

// The frame is not sandboxed (browsers do not run their PDF viewer in one), so only local
// object URLs reach it: never a `javascript:` URL or a server response that could be HTML.
const isBlobUrl = (src: string) => src.startsWith('blob:');

// The app's frame-src policy (index.html) refuses blob: frames, so the PDF opens in the app's own
// frame page, which hands the object URL named after its # sign to the browser's viewer.
const pdfFrameUrl = (src: string): string =>
  `${appUrl('pdf-frame.html')}#${encodeURIComponent(src)}`;

/** Whether a save is running, and whether the last one failed. */
type SaveProgress = { pending: boolean; failed: boolean };

export const PdfViewer = as<'div', PdfViewerProps>(
  ({ name, src, requestClose, className, ...props }, ref) => {
    const { t } = useTranslation();
    const [progress, setProgress] = useState<SaveProgress>({ pending: false, failed: false });
    const savable = isBlobUrl(src);
    const { pending, failed } = progress;
    const shownName = revealDirectionControls(name);

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
            <Icon src={Icons.ArrowLeft} size="50" data-directional />
          </IconButton>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text truncate size="T300">
              {shownName}
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
          {savable ? <iframe src={pdfFrameUrl(src)} title={shownName} style={frameStyle} /> : null}
        </Box>
      </Box>
    );
  }
);
