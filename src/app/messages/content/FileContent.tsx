import React, { ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import { Modal } from '../../ui/glass/GlassPrimitives';
import { revealDirectionControls } from '../../ui/directional';
import { useViewerFrame } from './viewerFrame';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { bytesToSize } from '../../lib/common';
import { getFileNameExt, getMimeTypeBase } from '../../lib/mimeTypes';
import { stopPropagation } from '../../lib/keyboard';
import type { IFileInfo } from '../../matrix/types/common';
import {
  type AttachmentActionStatus,
  useAttachmentAction,
  useAttachmentObjectUrl,
  useAttachmentSave,
} from './attachmentDownload';

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-sh',
  'application/toml',
  'application/sql',
]);

/** Whether a file can be shown in the text viewer. */
const isTextFileMimeType = (mimeType: unknown): boolean => {
  if (typeof mimeType !== 'string') return false;
  const base = getMimeTypeBase(mimeType);
  return base.startsWith('text/') || TEXT_MIME_TYPES.has(base);
};

const isPdfFileMimeType = (mimeType: unknown): boolean =>
  typeof mimeType === 'string' && getMimeTypeBase(mimeType) === 'application/pdf';

// The PDF viewer hands the file to the browser's own PDF display. Browsers without one (Android's
// WebView, Chrome on Android) report `navigator.pdfViewerEnabled` as false and would show an empty
// viewer, so there a PDF offers only its download. Browsers that predate the flag keep the viewer.
const browserShowsPdfInline = (): boolean =>
  typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: 'json',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  xml: 'xml',
  css: 'css',
  sh: 'bash',
  sql: 'sql',
  toml: 'toml',
};

/** Highlighting language for the text viewer, from the file name and type. */
const getFileLanguageName = (fileName: string, mimeType: string): string => {
  const fromExtension = LANGUAGE_BY_EXTENSION[getFileNameExt(fileName).toLowerCase()];
  if (fromExtension) return fromExtension;
  const base = getMimeTypeBase(mimeType);
  if (base.endsWith('json')) return 'json';
  if (base.endsWith('xml')) return 'xml';
  if (base.endsWith('yaml')) return 'yaml';
  return 'plaintext';
};

type AttachmentProps = {
  owner?: EventAttachmentOwner;
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
};

type ButtonOptions = {
  buttonText?: string;
  errorButtonText?: string;
  buttonSize?: '300' | '400';
};

type TrapOptions = NonNullable<FocusTrap.Props['focusTrapOptions']>;

// An outside click or Escape closes a viewer; Escape does not reach handlers behind it.
const DISMISSIBLE = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };

type ViewerOverlayProps = {
  /** The dialog's accessible name: the file's name. */
  label: string;
  /** Escape, a click outside, or the viewer closing itself. */
  onClose: () => void;
  children: ReactNode;
};

/** A viewer in a modal over the page, closed by Escape or a click outside. */
export function ViewerOverlay({ label, onClose, children }: ViewerOverlayProps) {
  const trapOptions: TrapOptions = { ...DISMISSIBLE, initialFocus: false, onDeactivate: onClose };
  const { centerStyle, modalStyle } = useViewerFrame();
  return (
    <Overlay backdrop={<OverlayBackdrop />} open>
      <OverlayCenter style={centerStyle}>
        <FocusTrap focusTrapOptions={trapOptions}>
          <Modal
            role="dialog"
            aria-modal="true"
            aria-label={revealDirectionControls(label)}
            size="500"
            style={modalStyle}
            // The message under the viewer has its own context menu; keep right-clicks here.
            onContextMenu={(evt: React.MouseEvent) => evt.stopPropagation()}
          >
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type OpenButtonProps = ButtonOptions & {
  body: string;
  status: AttachmentActionStatus;
  /** The label without `buttonText`, such as "Open File". */
  defaultText: string;
  iconOnly?: boolean;
  onOpen: () => void;
};

/** Opens a viewer; shows a spinner while the file loads and turns red when that failed. */
function OpenButton({
  body,
  status,
  defaultText,
  iconOnly,
  onOpen,
  buttonText,
  errorButtonText,
  buttonSize = '400',
}: OpenButtonProps) {
  const { t } = useTranslation();
  const busy = status === 'loading';
  const failed = status === 'error';
  const icon = busy ? (
    <Spinner size="100" variant="Secondary" />
  ) : (
    <Icon size="100" src={failed ? Icons.Warning : Icons.Eye} />
  );

  if (iconOnly) {
    return (
      <IconButton
        size="300"
        radii="300"
        variant={failed ? 'Critical' : 'SurfaceVariant'}
        aria-label={t('sharedUi.fileContent.openValue1', { value1: revealDirectionControls(body) })}
        disabled={busy}
        onClick={onOpen}
      >
        {icon}
      </IconButton>
    );
  }

  const label = failed
    ? errorButtonText ?? t('sharedUi.fileContent.loadFailed')
    : buttonText ?? defaultText;
  return (
    <Button
      size={buttonSize}
      radii="300"
      variant={failed ? 'Critical' : 'Secondary'}
      fill="Soft"
      before={icon}
      disabled={busy}
      onClick={onOpen}
    >
      <Text size="B300">{label}</Text>
    </Button>
  );
}

/** What a text viewer is rendered with; matches the TextViewer component's props. */
export type RenderTextViewerProps = {
  name: string;
  text: string;
  langName: string;
  requestClose: () => void;
};

type ReadTextFileProps = AttachmentProps &
  ButtonOptions & {
    iconOnly?: boolean;
    renderViewer: (props: RenderTextViewerProps) => ReactNode;
  };

/** Loads a text attachment and shows it in a viewer, with syntax highlighting by file type. */
export function ReadTextFile({
  body,
  mimeType,
  url,
  encInfo,
  owner,
  iconOnly,
  renderViewer,
  ...buttonOptions
}: ReadTextFileProps) {
  const { t } = useTranslation();
  const [text, setText] = useState<string>();
  const readText = useCallback((blob: Blob) => blob.text(), []);
  const [status, read] = useAttachmentAction({ owner, url, mimeType, encInfo }, readText);
  const close = useCallback(() => setText(undefined), []);

  // The file is fetched once; opening it again reads the kept bytes.
  const open = () => {
    read().then(
      (loaded) => {
        if (loaded !== undefined) setText(loaded);
      },
      () => undefined
    );
  };

  return (
    <>
      {text !== undefined && (
        <ViewerOverlay label={body} onClose={close}>
          {renderViewer({
            name: body,
            text,
            langName: getFileLanguageName(body, mimeType),
            requestClose: close,
          })}
        </ViewerOverlay>
      )}
      <OpenButton
        {...buttonOptions}
        body={body}
        status={status}
        defaultText={t('sharedUi.fileContent.openFile')}
        iconOnly={iconOnly}
        onOpen={open}
      />
    </>
  );
}

/** What a PDF viewer is rendered with; matches the PdfViewer component's props. */
type RenderPdfViewerProps = {
  name: string;
  /** A `blob:` URL of the file, typed as PDF. */
  src: string;
  requestClose: () => void;
};

type ReadPdfFileProps = AttachmentProps &
  ButtonOptions & {
    iconOnly?: boolean;
    renderViewer: (props: RenderPdfViewerProps) => ReactNode;
  };

// The viewer's frame page shows the bytes as a PDF whatever type the blob carries, and they are
// typed as PDF here too, whatever type the sender declared, since the viewer also saves this object
// URL: a blob claiming to be HTML would run in this origin if a browser opened it as a page.
const toPdfObjectUrl = async (blob: Blob): Promise<string> =>
  URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));

/** Loads a PDF attachment into an object URL and shows it in a viewer until it closes. */
export function ReadPdfFile({
  body,
  mimeType,
  url,
  encInfo,
  owner,
  iconOnly,
  renderViewer,
  ...buttonOptions
}: ReadPdfFileProps) {
  const { t } = useTranslation();
  // Each opened URL is released when the viewer closes or the attachment unmounts.
  const {
    status,
    src,
    load: open,
    close,
  } = useAttachmentObjectUrl({ owner, url, mimeType, encInfo }, toPdfObjectUrl);

  return (
    <>
      {src && (
        <ViewerOverlay label={body} onClose={close}>
          {renderViewer({ name: body, src, requestClose: close })}
        </ViewerOverlay>
      )}
      <OpenButton
        {...buttonOptions}
        body={body}
        status={status}
        defaultText={t('sharedUi.fileContent.openPdf')}
        iconOnly={iconOnly}
        onOpen={open}
      />
    </>
  );
}

type DownloadFileProps = AttachmentProps &
  ButtonOptions & {
    /** The event's `info`; its `size` is shown on the button. */
    info: IFileInfo;
  };

/** A labelled save button with the file size; a failed save turns it into a retry. */
export function DownloadFile({
  body,
  mimeType,
  url,
  encInfo,
  owner,
  info,
  buttonText,
  errorButtonText,
  buttonSize = '400',
}: DownloadFileProps) {
  const { t } = useTranslation();
  const [status, save] = useAttachmentSave({ owner, url, mimeType, encInfo }, body);
  const size = bytesToSize(info.size ?? 0);
  const busy = status === 'loading';
  const failed = status === 'error';

  return (
    <Button
      size={buttonSize}
      radii="300"
      variant={failed ? 'Critical' : 'Secondary'}
      fill="Soft"
      before={
        busy ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={failed ? Icons.Warning : Icons.Download} />
        )
      }
      disabled={busy}
      onClick={() => {
        save().catch(() => undefined);
      }}
    >
      <Text size="B300">
        {failed
          ? errorButtonText ?? t('sharedUi.fileContent.retryDownload', { size })
          : buttonText ?? t('sharedUi.fileContent.downloadSize', { size })}
      </Text>
    </Button>
  );
}

/** Renders one open action; FileContent calls it only for the file types it suits. */
type RenderOpenAction = () => ReactNode;

type FileActionsProps = {
  /** The file name; callers pass it on to the actions they render. */
  body: string;
  mimeType: string;
  /** The open action for text files, such as a ReadTextFile. */
  renderAsTextFile: RenderOpenAction;
  /** The open action for PDF files, such as a ReadPdfFile. */
  renderAsPdfFile: RenderOpenAction;
  children?: ReactNode;
};

/** A file attachment's actions: open (text and PDF files) and whatever the caller adds. */
export function FileContent({
  mimeType,
  renderAsTextFile,
  renderAsPdfFile,
  children,
}: FileActionsProps) {
  const opensAsText = isTextFileMimeType(mimeType);
  const opensAsPdf = isPdfFileMimeType(mimeType) && browserShowsPdfInline();
  return (
    <Box alignItems="Center" gap="100" shrink="No">
      {opensAsText && renderAsTextFile()}
      {opensAsPdf && renderAsPdfFile()}
      {children}
    </Box>
  );
}
