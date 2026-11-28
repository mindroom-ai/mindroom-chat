import { useEffect, useEffectEvent, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { MatrixClient } from 'matrix-js-sdk';
import { Icon, Icons, Spinner } from 'folds';
import {
  AttachmentByteLimitError,
  downloadCachedAttachment,
} from '../../event-store/cache/attachmentRepository';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { CodeBlockView } from '../../rich-text/code/CodeBlockView';
import { MAX_TEXT_HIGHLIGHT_LENGTH } from '../../rich-text/code/codeHighlightLimits';
import { revealDirectionControls } from '../../ui/directional';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { TextViewer } from '../viewers/TextViewer';
import { FileContent, ViewerOverlay } from './FileContent';
import { decodeInlinePreviewText, getFileLanguageName } from './fileTextPreview';
import * as css from './FileRow.css';

const MAX_FILE_PREVIEW_BYTES = 1024 * 1024;
const COLLAPSED_LINES = 5;

type InlineFilePreviewProps = {
  client: MatrixClient;
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  size?: number;
  autoPreview: boolean;
  renderRow: (actions: ReactNode) => ReactNode;
  children: ReactNode;
};

type ManualRequest = 'preview' | 'full';

/** A new attachment starts closed or auto-loading, never with the old attachment's text. */
export function InlineFilePreview(props: InlineFilePreviewProps) {
  const { client, url, mimeType, encInfo } = props;
  const key = JSON.stringify([
    client.getHomeserverUrl(),
    client.getUserId(),
    url,
    mimeType,
    encInfo?.v,
    encInfo?.iv,
    encInfo?.key,
    encInfo?.hashes?.sha256,
  ]);
  return <TextFilePreview key={key} {...props} />;
}

function TextFilePreview({
  client,
  body,
  mimeType,
  url,
  encInfo,
  owner,
  size,
  autoPreview,
  renderRow,
  children,
}: InlineFilePreviewProps) {
  const { t } = useTranslation();
  const drawerId = useId();
  const [requested, setRequested] = useState<ManualRequest | null>();
  const [failed, setFailed] = useState<ManualRequest>();
  const [loaded, setLoaded] = useState<{ text: string } | 'binary' | 'oversize'>();
  const [showPreview, setShowPreview] = useState(false);
  const [viewerText, setViewerText] = useState<string>();
  const tooLarge = size !== undefined && size > MAX_FILE_PREVIEW_BYTES;
  const eligible =
    autoPreview && size !== undefined && size > 0 && size <= MAX_TEXT_HIGHLIGHT_LENGTH;
  // Undefined has not attempted a preview yet; null is idle after a click or a settled request.
  const request = requested === undefined && eligible ? 'auto' : requested;

  const load = useEffectEvent(async (intent: ManualRequest | 'auto', signal: AbortSignal) => {
    const source = { owner, mxcUri: url, mimeType, encryptedFile: encInfo && { ...encInfo, url } };
    const maxBytes = intent === 'auto' ? MAX_TEXT_HIGHLIGHT_LENGTH : MAX_FILE_PREVIEW_BYTES;
    const options = intent === 'full' ? { signal } : { signal, maxBytes };
    try {
      const blob = await downloadCachedAttachment(client, source, options).catch(
        (error: unknown) => {
          if (
            intent === 'preview' &&
            !signal.aborted &&
            error instanceof AttachmentByteLimitError
          ) {
            return downloadCachedAttachment(client, source, { signal });
          }
          throw error;
        }
      );
      if (signal.aborted) return;
      const bytes = await blob.arrayBuffer();
      if (signal.aborted) return;
      const text = decodeInlinePreviewText(bytes);
      const fits = blob.size <= MAX_FILE_PREVIEW_BYTES;
      setLoaded(text === undefined ? 'binary' : fits ? { text } : 'oversize');
      if (text !== undefined) {
        if (intent === 'full' || !fits) setViewerText(text);
        else setShowPreview(true);
      }
      setFailed(undefined);
    } catch {
      if (!signal.aborted && intent !== 'auto') setFailed(intent);
    } finally {
      if (!signal.aborted) setRequested(null);
    }
  });

  useEffect(() => {
    if (!request) return undefined;
    const controller = new AbortController();
    void load(request, controller.signal);
    return () => controller.abort();
  }, [client, request]);

  const text = typeof loaded === 'object' ? loaded.text : undefined;
  const canPreview = !tooLarge && typeof loaded !== 'string';
  const drawerOpen = showPreview || request === 'auto' || (request === 'preview' && canPreview);
  const previewLabel = t(
    drawerOpen ? 'sharedUi.fileContent.hidePreview' : 'sharedUi.fileContent.preview'
  );
  const fullViewLabel = t('sharedUi.fileContent.fullView');
  const openLabel = t('sharedUi.fileContent.openValue1', { value1: revealDirectionControls(body) });
  const language = getFileLanguageName(body, mimeType);
  const openViewer = () => {
    if (text !== undefined) setViewerText(text);
    else setRequested('full');
  };
  const closeViewer = () => setViewerText(undefined);

  return (
    <>
      {renderRow(
        <FileContent mimeType={mimeType}>
          {canPreview && (
            <IconButton
              size="300"
              radii="300"
              aria-label={previewLabel}
              aria-expanded={drawerOpen}
              aria-controls={drawerOpen ? drawerId : undefined}
              title={previewLabel}
              variant={!drawerOpen && failed === 'preview' ? 'Critical' : 'SurfaceVariant'}
              disabled={request === 'full'}
              onClick={() => {
                if (drawerOpen) {
                  setRequested(null);
                  setShowPreview(false);
                } else if (text !== undefined) setShowPreview(true);
                else setRequested('preview');
              }}
            >
              <Icon size="100" src={drawerOpen ? Icons.EyeBlind : Icons.Eye} />
            </IconButton>
          )}
          {loaded !== 'binary' && (
            <IconButton
              size="300"
              radii="300"
              title={fullViewLabel}
              aria-label={openLabel}
              aria-description={fullViewLabel}
              variant={!request && failed === 'full' ? 'Critical' : 'SurfaceVariant'}
              disabled={!!request}
              onClick={openViewer}
            >
              {request === 'full' ? (
                <Spinner size="100" variant="Secondary" />
              ) : (
                <Icon size="100" src={Icons.External} />
              )}
            </IconButton>
          )}
          {children}
        </FileContent>
      )}
      {drawerOpen && (
        <div className={css.FilePreview} id={drawerId}>
          {text === undefined ? (
            <div className={css.FilePreviewLoading} aria-busy="true">
              <Spinner size="100" variant="Secondary" />
            </div>
          ) : (
            <CodeBlockView
              source={text}
              language={language}
              label={body}
              collapsedLines={COLLAPSED_LINES}
              longLinesThreshold={COLLAPSED_LINES}
              embedded
              headerExtraActions={
                <IconButton
                  size="300"
                  radii="300"
                  aria-label={fullViewLabel}
                  title={fullViewLabel}
                  onClick={openViewer}
                >
                  <Icon size="100" src={Icons.External} />
                </IconButton>
              }
            />
          )}
        </div>
      )}
      {viewerText !== undefined && (
        <ViewerOverlay label={body} onClose={closeViewer}>
          <TextViewer
            name={body}
            text={viewerText}
            langName={language}
            requestClose={closeViewer}
          />
        </ViewerOverlay>
      )}
    </>
  );
}
