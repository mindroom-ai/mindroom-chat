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
import { bytesToSize } from '../../../utils/common';
import { getFileNameExt, getMimeTypeBase } from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import type { IFileInfo } from '../../../../types/matrix/common';
import { useAttachmentAction, useAttachmentSave } from '../attachmentDownload';

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






































































































































































































































































    >
      <Text size="B300">
        {failed
          ? errorButtonText ?? t('sharedUi.fileContent.retryDownload', { size })












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
