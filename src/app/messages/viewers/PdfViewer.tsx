import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { openNativeFile, saveFile } from '../../native/nativeFileSave';
import { revealDirectionControls } from '../../ui/directional';
import * as css from './PdfViewer.css';
import { pdfFrameUrl } from './pdfFrame';

type PdfViewerProps = {
  name: string;
  /** Object URL (`blob:`) of the PDF. Any other URL is neither shown nor saved. */
  src: string;
  requestClose: () => void;
};

/** Whether a save or open action is running, and whether the last one failed. */
type ActionProgress = { pending: boolean; failed: boolean };

const isNativeAndroid = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const PdfViewer = as<'div', PdfViewerProps>(
  ({ name, src, requestClose, className, ...props }, ref) => {
    const { t } = useTranslation();
    const [progress, setProgress] = useState<ActionProgress>({ pending: false, failed: false });
    const [openProgress, setOpenProgress] = useState<ActionProgress>({
      pending: false,
      failed: false,
    });
    // Only an object URL is shown, and only what is shown is opened or saved.
    const frameUrl = pdfFrameUrl(src);
    const savable = frameUrl !== undefined;
    const busy = progress.pending || openProgress.pending;
    const { failed } = progress;
    const shownName = revealDirectionControls(name);
    const androidNative = isNativeAndroid();

    // A failed attempt keeps its warning until the next attempt settles.
    const startSave = () => {
      if (busy || !savable) return;
      setProgress((previous) => ({ ...previous, pending: true }));
      saveFile(src, name).then(
        () => setProgress({ pending: false, failed: false }),
        () => setProgress({ pending: false, failed: true })
      );
    };

    const startOpen = () => {
      if (busy || !savable) return;
      setOpenProgress((previous) => ({ ...previous, pending: true }));
      openNativeFile(src, name, 'application/pdf')
        .then((opened) => (opened ? true : saveFile(src, name)))
        .then(
          () => setOpenProgress({ pending: false, failed: false }),
          () => setOpenProgress({ pending: false, failed: true })
        );
    };

    const frameStyle = { display: 'block', width: '100%', height: '100%', border: 'none' };

    return (
      <Box direction="Column" className={classNames(css.PdfViewer, className)} {...props} ref={ref}>
        {/* The header's own gap spaces back button, title and download. */}
        <Header size="400" appearance="inherit" className={css.PdfViewerHeader}>
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
            disabled={busy || !savable}
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
          {frameUrl ? (
            androidNative ? (
              <Box
                direction="Column"
                alignItems="Center"
                justifyContent="Center"
                className={css.PdfViewerFallback}
              >
                <Box
                  direction="Column"
                  alignItems="Center"
                  gap="400"
                  className={css.PdfViewerFallbackCard}
                >
                  <Icon src={Icons.File} size="500" />
                  <Text size="T400" style={{ textAlign: 'center', wordBreak: 'break-word' }}>
                    {shownName}
                  </Text>
                  <Box gap="200" wrap="Wrap" justifyContent="Center">
                    <Button
                      variant={openProgress.failed ? 'Critical' : 'Primary'}
                      radii="300"
                      size="400"
                      before={
                        <Icon src={openProgress.failed ? Icons.Warning : Icons.Eye} size="100" />
                      }
                      disabled={busy || !savable}
                      onClick={startOpen}
                    >
                      <Text size="B300">{t('sharedUi.fileContent.openPdf')}</Text>
                    </Button>
                    <Button
                      variant={failed ? 'Critical' : 'Secondary'}
                      fill="Soft"
                      radii="300"
                      size="400"
                      before={<Icon src={failed ? Icons.Warning : Icons.Download} size="100" />}
                      disabled={busy || !savable}
                      onClick={startSave}
                    >
                      <Text size="B300">
                        {t(
                          failed
                            ? 'sharedUi.pdfViewer.retryDownload'
                            : 'sharedUi.pdfViewer.download'
                        )}
                      </Text>
                    </Button>
                  </Box>
                </Box>
              </Box>
            ) : (
              <iframe src={frameUrl} title={shownName} style={frameStyle} />
            )
          ) : null}
        </Box>
      </Box>
    );
  }
);
