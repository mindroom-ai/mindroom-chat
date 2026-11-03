import React, { ReactNode, useCallback, useEffect, useState } from 'react';
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
import { Modal } from '../../glass/GlassPrimitives';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { saveFile } from '../../../mindroom/native/nativeFileSave';
import { bytesToSize } from '../../../utils/common';
import { getFileNameExt, getMimeTypeBase } from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import type { IFileInfo } from '../../../../types/matrix/common';
import { useAttachmentAction } from '../attachmentDownload';

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
export const isTextFileMimeType = (mimeType: unknown): boolean => {
  if (typeof mimeType !== 'string') return false;
  const base = getMimeTypeBase(mimeType);
  return base.startsWith('text/') || TEXT_MIME_TYPES.has(base);
};

export const isPdfFileMimeType = (mimeType: unknown): boolean =>
  typeof mimeType === 'string' && getMimeTypeBase(mimeType) === 'application/pdf';

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
export const getFileLanguageName = (fileName: string, mimeType: string): string => {
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

function ViewerOverlay({






















              width: 'min(64rem, calc(100vw - 2rem))',
              height: 'min(48rem, calc(100vh - 2rem))',
            }}
          >
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type TriggerProps = ButtonOptions & {
  status: 'idle' | 'loading' | 'error';
  iconOnly?: boolean;
  label: string;
  errorLabel: string;
  /** Accessible names of the icon-only button, which has no visible text. */
  iconLabel: string;
  iconErrorLabel: string;
  onClick: () => void;
};

function AttachmentActionTrigger({
  status,
  iconOnly,
  label,
  errorLabel,
  iconLabel,
  iconErrorLabel,
  buttonText,
  errorButtonText,
  buttonSize = '400',
  onClick,
}: TriggerProps) {
  const failed = status === 'error';
  if (iconOnly) {
    return (
      <IconButton
        size="300"
        radii="300"
        variant={failed ? 'Critical' : 'SurfaceVariant'}
        aria-label={failed ? iconErrorLabel : iconLabel}
        disabled={status === 'loading'}
        onClick={onClick}
      >
        {status === 'loading' ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={failed ? Icons.Warning : Icons.Eye} />
        )}
      </IconButton>
    );
  }
  return (
    <Button
      size={buttonSize}
      radii="300"
      variant={failed ? 'Critical' : 'Secondary'}
      fill="Soft"
      disabled={status === 'loading'}
      before={status === 'loading' ? <Spinner size="100" variant="Secondary" /> : undefined}
      onClick={onClick}
    >
      <Text size="B300">{failed ? errorButtonText ?? errorLabel : buttonText ?? label}</Text>
    </Button>
  );
}

export type TextViewerRenderProps = {
  name: string;
  text: string;
  langName: string;
  requestClose: () => void;
};

type ReadTextFileProps = AttachmentProps &
  ButtonOptions & {
    iconOnly?: boolean;
    renderViewer: (props: TextViewerRenderProps) => ReactNode;
  };

/** Opens a text attachment in a viewer dialog. */
export function ReadTextFile({
  owner,
  body,
  mimeType,
  url,
  encInfo,
  iconOnly,
  renderViewer,
  ...buttonOptions
}: ReadTextFileProps) {
  const { t } = useTranslation();
  const [text, setText] = useState<string>();
  const read = useCallback((blob: Blob) => blob.text(), []);
  const [status, load] = useAttachmentAction({ owner, url, mimeType, encInfo }, read);

  const open = () => {
    load().then(
      (content) => {
        if (content !== undefined) setText(content);
      },
      () => undefined
    );
  };

  return (
    <>
      <AttachmentActionTrigger
        status={status}
        iconOnly={iconOnly}
        label={t('sharedUi.fileContent.open')}
        errorLabel={t('sharedUi.fileContent.retryOpen')}
        iconLabel={t('sharedUi.fileContent.openName', { name: body })}
        iconErrorLabel={t('sharedUi.fileContent.retryOpenName', { name: body })}
        onClick={open}
        {...buttonOptions}
      />
      {text !== undefined && (
        <ViewerOverlay requestClose={() => setText(undefined)}>
          {renderViewer({
            name: body,
            text,
            langName: getFileLanguageName(body, mimeType),
            requestClose: () => setText(undefined),
          })}
        </ViewerOverlay>
      )}
    </>
  );
}

export type PdfViewerRenderProps = {
  name: string;
  src: string;
  requestClose: () => void;
};

type ReadPdfFileProps = AttachmentProps &
  ButtonOptions & {
    iconOnly?: boolean;
    renderViewer: (props: PdfViewerRenderProps) => ReactNode;
  };

/** Opens a PDF attachment in a viewer dialog. */
export function ReadPdfFile({
  owner,
  body,
  mimeType,
  url,
  encInfo,
  iconOnly,
  renderViewer,
  ...buttonOptions
}: ReadPdfFileProps) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string>();
  const toUrl = useCallback(
    async (blob: Blob) => URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })),
    []
  );
  const [status, load] = useAttachmentAction({ owner, url, mimeType, encInfo }, toUrl);

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src]
  );

  const open = () => {
    load().then(
      (objectUrl) => {
        if (objectUrl) setSrc(objectUrl);
      },
      () => undefined
    );
  };

  return (
    <>
      <AttachmentActionTrigger
        status={status}
        iconOnly={iconOnly}
        label={t('sharedUi.fileContent.open')}
        errorLabel={t('sharedUi.fileContent.retryOpen')}
        iconLabel={t('sharedUi.fileContent.openName', { name: body })}
        iconErrorLabel={t('sharedUi.fileContent.retryOpenName', { name: body })}
        onClick={open}
        {...buttonOptions}
      />
      {src && (
        <ViewerOverlay requestClose={() => setSrc(undefined)}>
          {renderViewer({ name: body, src, requestClose: () => setSrc(undefined) })}
        </ViewerOverlay>
      )}
    </>
  );
}

type DownloadFileProps = AttachmentProps &
  ButtonOptions & {
    info?: IFileInfo;
  };

/** Saves an attachment, with its size on the button. */
export function DownloadFile({
  owner,
  body,
  mimeType,
  url,
  encInfo,
  info,
  buttonText,
  errorButtonText,
  buttonSize = '400',
}: DownloadFileProps) {
  const { t } = useTranslation();
  const save = useCallback((blob: Blob) => saveFile(blob, body), [body]);
  const [status, download] = useAttachmentAction({ owner, url, mimeType, encInfo }, save);
  const size = bytesToSize(info?.size ?? 0);
  const failed = status === 'error';

  return (
    <Button
      size={buttonSize}
      radii="300"
      variant={failed ? 'Critical' : 'Secondary'}
      fill="Soft"
      disabled={status === 'loading'}
      before={
        status === 'loading' ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={failed ? Icons.Warning : Icons.Download} />
        )
      }
      onClick={() => {
        download().catch(() => undefined);
      }}
    >
      <Text size="B300">
        {failed
          ? errorButtonText ?? t('sharedUi.fileContent.retryDownloadWithSize', { size })












  children?: ReactNode;
};

/** A file attachment's actions: open (text and PDF files) and whatever the caller adds. */
export function FileContent({
  mimeType,
  renderAsTextFile,
  renderAsPdfFile,
  children,
}: FileContentProps) {
  return (
    <Box alignItems="Center" gap="100" shrink="No">
      {isTextFileMimeType(mimeType) && renderAsTextFile()}
      {isPdfFileMimeType(mimeType) && renderAsPdfFile()}
      {children}
    </Box>
  );
}
