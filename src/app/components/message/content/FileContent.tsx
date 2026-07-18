import React, { ComponentProps, ReactNode, useCallback, useRef, useState } from 'react';
import {
  Box,
  Button,
  Icon,
  Icons,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  as,
} from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import FocusTrap from 'focus-trap-react';
import { IFileInfo } from '../../../../types/matrix/common';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { bytesToSize } from '../../../utils/common';
import {
  READABLE_EXT_TO_MIME_TYPE,
  READABLE_TEXT_MIME_TYPES,
  getFileNameExt,
  mimeTypeToExt,
} from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import {
  decryptFile,
  downloadEncryptedMedia,
  downloadMedia,
  mxcUrlToHttp,
} from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { saveFile } from '../../../mindroom/native/nativeFileSave';
import { ModalWide } from '../../../styles/Modal.css';

const renderErrorButton = (retry: () => void, text: string) => (
  <TooltipProvider
    tooltip={
      <Tooltip variant="Critical">
        <Text>Failed to load file!</Text>
      </Tooltip>
    }
    position="Top"
    align="Center"
  >
    {(triggerRef) => (
      <Button
        ref={triggerRef}
        size="400"
        variant="Critical"
        fill="Soft"
        outlined
        radii="300"
        onClick={retry}
        before={<Icon size="100" src={Icons.Warning} filled />}
      >
        <Text size="B400" truncate>
          {text}
        </Text>
      </Button>
    )}
  </TooltipProvider>
);

type RenderTextViewerProps = {
  name: string;
  text: string;
  langName: string;
  requestClose: () => void;
};
type FileActionButtonSize = ComponentProps<typeof Button>['size'];
type ReadTextFileProps = {
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
  renderViewer: (props: RenderTextViewerProps) => ReactNode;
  buttonText?: string;
  errorButtonText?: string;
  buttonSize?: FileActionButtonSize;
};
export function ReadTextFile({
  body,
  mimeType,
  url,
  encInfo,
  renderViewer,
  buttonText = 'Open File',
  errorButtonText = buttonText,
  buttonSize = '400',
}: ReadTextFileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [textViewer, setTextViewer] = useState(false);

  const [textState, loadText] = useAsyncCallback(
    useCallback(async () => {
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);

      const text = fileContent.text();
      setTextViewer(true);
      return text;
    }, [mx, useAuthentication, mimeType, encInfo, url])
  );

  return (
    <>
      {textState.status === AsyncStatus.Success && (
        <Overlay open={textViewer} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setTextViewer(false),
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal
                className={ModalWide}
                size="500"
                onContextMenu={(evt: any) => evt.stopPropagation()}
              >
                {renderViewer({
                  name: body,
                  text: textState.data,
                  langName: READABLE_TEXT_MIME_TYPES.includes(mimeType)
                    ? mimeTypeToExt(mimeType)
                    : mimeTypeToExt(READABLE_EXT_TO_MIME_TYPE[getFileNameExt(body)] ?? mimeType),
                  requestClose: () => setTextViewer(false),
                })}
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
      {textState.status === AsyncStatus.Error ? (
        renderErrorButton(loadText, errorButtonText)
      ) : (
        <Button
          variant="Secondary"
          fill="Solid"
          radii="300"
          size={buttonSize}
          onClick={() =>
            textState.status === AsyncStatus.Success ? setTextViewer(true) : loadText()
          }
          disabled={textState.status === AsyncStatus.Loading}
          before={
            textState.status === AsyncStatus.Loading ? (
              <Spinner fill="Solid" size="100" variant="Secondary" />
            ) : (
              <Icon size="100" src={Icons.ArrowRight} filled />
            )
          }
        >
          <Text size="B400" truncate>
            {buttonText}
          </Text>
        </Button>
      )}
    </>
  );
}

type RenderPdfViewerProps = {
  name: string;
  src: string;
  requestClose: () => void;
};
export type ReadPdfFileProps = {
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
  renderViewer: (props: RenderPdfViewerProps) => ReactNode;
};
export function ReadPdfFile({ body, mimeType, url, encInfo, renderViewer }: ReadPdfFileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [pdfViewer, setPdfViewer] = useState(false);

  const [pdfState, loadPdf] = useAsyncCallback(
    useCallback(async () => {
      const mediaUrl = mxcUrlToHttp(mx, url, useAuthentication);
      if (!mediaUrl) throw new Error('Invalid media URL');
      const fileContent = encInfo
        ? await downloadEncryptedMedia(mediaUrl, (encBuf) => decryptFile(encBuf, mimeType, encInfo))
        : await downloadMedia(mediaUrl);
      setPdfViewer(true);
      return URL.createObjectURL(fileContent);
    }, [mx, url, useAuthentication, mimeType, encInfo]),
    revokeBlobUrl
  );
  useBlobUrlCleanup(pdfState);

  return (
    <>
      {pdfState.status === AsyncStatus.Success && (
        <Overlay open={pdfViewer} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setPdfViewer(false),
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal
                className={ModalWide}
                size="500"
                onContextMenu={(evt: any) => evt.stopPropagation()}
              >
                {renderViewer({
                  name: body,
                  src: pdfState.data,
                  requestClose: () => setPdfViewer(false),
                })}
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
      {pdfState.status === AsyncStatus.Error ? (
        renderErrorButton(loadPdf, 'Open PDF')
      ) : (
        <Button
          variant="Secondary"
          fill="Solid"
          radii="300"
          size="400"
          onClick={() => (pdfState.status === AsyncStatus.Success ? setPdfViewer(true) : loadPdf())}
          disabled={pdfState.status === AsyncStatus.Loading}
          before={
            pdfState.status === AsyncStatus.Loading ? (
              <Spinner fill="Solid" size="100" variant="Secondary" />
            ) : (
              <Icon size="100" src={Icons.ArrowRight} filled />
            )
          }
        >
          <Text size="B400" truncate>
            Open PDF
          </Text>
        </Button>
      )}
    </>
  );
}

export type DownloadFileProps = {
  body: string;
  mimeType: string;
  url: string;
  info: IFileInfo;
  encInfo?: EncryptedAttachmentInfo;
  buttonText?: string;
  errorButtonText?: string;
  buttonSize?: FileActionButtonSize;
};
export function DownloadFile({
  body,
  mimeType,
  url,
  info,
  encInfo,
  buttonText,
  errorButtonText,
  buttonSize = '400',
}: DownloadFileProps) {
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

      await saveFile(fileContent, body);
      return fileContent;
    }, [mx, url, useAuthentication, mimeType, encInfo, body])
  );
  const handleDownload = () => {
    void download().catch(() => undefined);
  };
  return downloadState.status === AsyncStatus.Error ? (
    renderErrorButton(
      handleDownload,
      errorButtonText ?? `Retry Download (${bytesToSize(info.size ?? 0)})`
    )
  ) : (
    <Button
      variant="Secondary"
      fill="Soft"
      radii="300"
      size={buttonSize}
      onClick={handleDownload}
      disabled={downloadState.status === AsyncStatus.Loading}
      before={
        downloadState.status === AsyncStatus.Loading ? (
          <Spinner fill="Soft" size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={Icons.Download} filled />
        )
      }
    >
      <Text size="B400" truncate>
        {buttonText ?? `Download (${bytesToSize(info.size ?? 0)})`}
      </Text>
    </Button>
  );
}

type FileContentProps = {
  body: string;
  mimeType: string;
  renderAsTextFile: () => ReactNode;
  renderAsPdfFile: () => ReactNode;
};
export const FileContent = as<'div', FileContentProps>(
  ({ body, mimeType, renderAsTextFile, renderAsPdfFile, children, ...props }, ref) => (
    <Box direction="Column" gap="300" {...props} ref={ref}>
      {(READABLE_TEXT_MIME_TYPES.includes(mimeType) ||
        READABLE_EXT_TO_MIME_TYPE[getFileNameExt(body)]) &&
        renderAsTextFile()}
      {mimeType === 'application/pdf' && renderAsPdfFile()}
      {children}
    </Box>
  )
);
