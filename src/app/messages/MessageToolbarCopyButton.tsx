import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, type IconSrc } from 'folds';
import { IconTooltip } from '../ui/IconTooltip';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { copyToClipboard } from '../lib/dom';
import { getCachedLongTextContent, type LongTextSource } from '../matrix/protocol/longText';
import { hydrateCachedLongText } from '../event-store/cache/attachmentRepository';
import {
  getMessageCopyTexts,
  getMessageCopyTextSource,
  scanToolMarkerLines,
} from './messageCopyText';
import * as css from './styles.css';

export const COPIED_FEEDBACK_MS = 1200;

/** Two overlapping rounded squares, matching CodeBlockIcons's CopyIcon for Folds `<Icon>`. */
export const CopyIconSrc: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </g>
);

export const resolveMessageCopyTexts = (
  content: Record<string, unknown>,
  originalContent: Record<string, unknown>,
  resolvedContent: Record<string, unknown> | undefined,
  toolRows: boolean
) => {
  const source = getMessageCopyTextSource(content, originalContent, resolvedContent);
  if (!source) return undefined;
  const scan = scanToolMarkerLines(
    source.body,
    source.formattedBody,
    source.plainBodyFallback,
    toolRows
  );
  return getMessageCopyTexts(source, scan);
};

const writeAsyncCopy = (textPromise: Promise<string>): Promise<boolean> => {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    // Start the clipboard write synchronously inside the click gesture so WebKit preserves user
    // activation while the long-text sidecar hydrates.
    const blobPromise = textPromise.then((text) => new Blob([text], { type: 'text/plain' }));
    blobPromise.catch(() => undefined);
    try {
      const written = clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
      return Promise.all([textPromise, written]).then(
        () => true,
        () => false
      );
    } catch {
      // Fall back to copyToClipboard when Promise-backed ClipboardItem is unsupported.
    }
  }
  return textPromise.then(
    (text) => copyToClipboard(text),
    () => false
  );
};

/**
 * One-click Copy Text button on the message hover toolbar. Copies normal and cached long-text
 * messages synchronously, and hydrates uncached long-text sidecars lazily on click (never on
 * hover) using a promise-backed ClipboardItem to keep WebKit's user gesture alive.
 */
export function MessageToolbarCopyButton({
  content,
  originalContent,
  longTextSource,
  resolvedLongTextContent,
  toolRows,
}: {
  content: Record<string, unknown>;
  originalContent: Record<string, unknown>;
  longTextSource?: LongTextSource;
  resolvedLongTextContent?: Record<string, unknown>;
  toolRows: boolean;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copyBusyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const showCopied = (ok: boolean) => {
    if (!ok || !mountedRef.current) return;
    setCopied(true);
    if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = undefined;
      if (mountedRef.current) setCopied(false);
    }, COPIED_FEEDBACK_MS);
  };

  const handleClick = () => {
    if (copyBusyRef.current) return;
    const cachedResolved =
      resolvedLongTextContent ??
      (longTextSource ? getCachedLongTextContent(longTextSource, client) : undefined);

    if (!longTextSource || cachedResolved) {
      const text = resolveMessageCopyTexts(
        content,
        originalContent,
        cachedResolved,
        toolRows
      )?.text;
      if (text === undefined) return;
      void copyToClipboard(text).then(showCopied);
      return;
    }

    copyBusyRef.current = true;
    const textPromise = (async () => {
      const hydrated = await hydrateCachedLongText(client, longTextSource);
      // hydrateLongTextSource falls back to source.previewContent on download/parse errors; reject
      // so we never overwrite the clipboard with a truncated preview or flash a false check mark.
      if (hydrated === longTextSource.previewContent) {
        throw new Error('Long text hydration fell back to preview');
      }
      const text = resolveMessageCopyTexts(content, originalContent, hydrated, toolRows)?.text;
      if (text === undefined) throw new Error('No message text to copy');
      return text;
    })();

    void writeAsyncCopy(textPromise)
      .then(showCopied)
      .finally(() => {
        copyBusyRef.current = false;
      });
  };

  const label = copied
    ? t('messageCodeBlock.copied')
    : t('mindroomUi.messages.messageCopyActions.copyText');

  return (
    <IconTooltip label={label} position="Top">
      {(tooltipRef) => (
        <IconButton
          ref={tooltipRef}
          className={css.MessageToolbarButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={label}
          onClick={handleClick}
        >
          <Icon
            src={copied ? Icons.Check : CopyIconSrc}
            size="50"
            className={copied ? css.MessageToolbarCopiedIcon : undefined}
          />
        </IconButton>
      )}
    </IconTooltip>
  );
}
