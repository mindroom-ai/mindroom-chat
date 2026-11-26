import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { AuthenticatedImage } from '../../avatars/AuthenticatedImage';
import type { AvatarMediaClient } from '../../avatars/avatarMedia';
import { useAvatarImage, useSyncReconnectCount } from '../../avatars/useAvatarImage';
import { revokeBlobUrl } from '../../lib/hooks/useBlobUrlCleanup';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import type { InlineMediaEntry, InlineMediaMap } from '../../matrix/protocol/inlineMedia';
import * as css from '../../rich-text/CustomHtml.css';
import { revealDirectionControls } from '../../ui/directional';
import { ImageOverlay } from '../content/ImageOverlay';
import { loadImageOriginal, type LoadedImageOriginal } from '../content/imageOriginal';

export type InlineImageKind = 'standalone' | 'linked' | 'emoticon';

export type InlineMediaContextValue = { entries: InlineMediaMap; owner?: EventAttachmentOwner };

export const InlineMediaContext = createContext<InlineMediaContextValue | undefined>(undefined);

const displayAlt = (alt: string, kind: InlineImageKind): string =>
  kind === 'emoticon' ? alt : revealDirectionControls(alt);

const inlineImageClassName = (kind: InlineImageKind): string =>
  kind === 'emoticon' ? css.Emoticon() : css.InlineImage;

function InlineImageButton(props: {
  alt: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  viewerSrc: string | undefined;
  downloadBlob?: Blob;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const label = props.alt || t('sharedUi.imageContent.view');
  return (
    <>
      <button
        type="button"
        className={css.InlineImageButton}
        aria-label={revealDirectionControls(label)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onToggle(true);
        }}
      >
        {props.children}
      </button>
      {props.open && (
        <ImageOverlay
          src={props.viewerSrc}
          downloadBlob={props.downloadBlob}
          alt={label}
          requestClose={() => props.onToggle(false)}
        />
      )}
    </>
  );
}

function EncryptedInlineImage({
  alt = '',
  client,
  entry,
  owner,
  kind,
  onError,
  src: _plainSrc,
  ...props
}: ComponentPropsWithoutRef<'img'> & {
  client: MatrixClient;
  entry: InlineMediaEntry;
  owner?: EventAttachmentOwner;
  kind: InlineImageKind;
}) {
  const [viewerSrc, setViewerSrc] = useState<string>();
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    loaded?: LoadedImageOriginal;
    failedAt?: number;
  }>();
  const reconnectCount = useSyncReconnectCount(client);
  const latestRef = useLatestRef({ entry, owner, reconnectCount });
  const { file, mimeType } = entry;
  const entryKey = `${file.url}|${file.iv}|${file.hashes.sha256}|${file.key.k}|${mimeType ?? ''}`;

  if (
    result?.key === entryKey &&
    result.failedAt !== undefined &&
    result.failedAt < reconnectCount
  ) {
    setResult(undefined);
    setRetryCount((n) => n + 1);
  }

  useEffect(() => {
    const { entry: cur, owner: curOwner } = latestRef.current;
    const controller = new AbortController();
    let createdUrl: string | undefined;
    loadImageOriginal(client, {
      url: cur.file.url,
      mimeType: cur.mimeType,
      encInfo: cur.file,
      owner: curOwner,
      signal: controller.signal,
    }).then(
      (loaded) => {
        if (controller.signal.aborted) revokeBlobUrl(loaded.src);
        else {
          createdUrl = loaded.src;
          setResult({ key: entryKey, loaded });
        }
      },
      () =>
        !controller.signal.aborted &&
        setResult({ key: entryKey, failedAt: latestRef.current.reconnectCount })
    );
    return () => {
      controller.abort();
      if (createdUrl) revokeBlobUrl(createdUrl);
    };
  }, [client, entryKey, latestRef, retryCount]);

  const current = result?.key === entryKey ? result : undefined;
  const loaded = current?.loaded;
  const shownAlt = displayAlt(alt, kind);
  if (!loaded) return current || kind === 'linked' ? <>{shownAlt}</> : null;
  const img = (
    <img
      {...props}
      src={loaded.src}
      alt={shownAlt}
      className={inlineImageClassName(kind)}
      loading="lazy"
      onError={(event) => {
        setResult({ key: entryKey });
        onError?.(event);
      }}
    />
  );
  if (kind !== 'standalone') return img;
  return (
    <InlineImageButton
      alt={alt}
      open={viewerSrc === loaded.src}
      onToggle={(open) => setViewerSrc(open ? loaded.src : undefined)}
      viewerSrc={loaded.src}
      downloadBlob={loaded.downloadBlob}
    >
      {img}
    </InlineImageButton>
  );
}

function PlainInlineImage({
  alt = '',
  client,
  src,
  ...props
}: ComponentPropsWithoutRef<'img'> & { client?: AvatarMediaClient }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  // Resolve a live URL on open so an inline image whose cached blob was evicted still opens.
  const viewer = useAvatarImage(viewerOpen ? src : undefined, client);
  const shownAlt = displayAlt(alt, 'standalone');
  return (
    <InlineImageButton
      alt={alt}
      open={viewerOpen}
      onToggle={setViewerOpen}
      viewerSrc={viewer.imageSrc}
    >
      <AuthenticatedImage
        {...props}
        client={client}
        src={src}
        alt={shownAlt}
        fallback={alt ? shownAlt : null}
        className={css.InlineImage}
        loading="lazy"
      />
    </InlineImageButton>
  );
}

/** An inline homeserver image opens the same full-size viewer as link preview pictures. */
export function InlineImage({
  mxcUri,
  client,
  alt = '',
  kind = 'standalone',
  ...props
}: ComponentPropsWithoutRef<'img'> & {
  client: MatrixClient;
  mxcUri: string;
  kind?: InlineImageKind;
}) {
  const inlineMedia = useContext(InlineMediaContext);
  const shownAlt = displayAlt(alt, kind);
  const entry = inlineMedia?.entries.get(mxcUri);
  if (entry === null) return <>{shownAlt}</>;
  if (entry) {
    return (
      <EncryptedInlineImage
        {...props}
        client={client}
        entry={entry}
        owner={inlineMedia?.owner}
        alt={alt}
        kind={kind}
      />
    );
  }
  if (kind !== 'standalone') {
    return (
      <AuthenticatedImage
        {...props}
        client={client}
        alt={shownAlt}
        fallback={shownAlt}
        showFallbackWhileLoading={kind === 'linked'}
        className={inlineImageClassName(kind)}
        loading="lazy"
      />
    );
  }
  return <PlainInlineImage {...props} client={client} alt={alt} />;
}
