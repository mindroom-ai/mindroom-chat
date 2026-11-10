import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Chip,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
} from 'folds';
import classNames from 'classnames';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { IEncryptedFile, IImageInfo } from '../../matrix/types/common';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { Modal } from '../../ui/glass/GlassPrimitives';
import { BlurHash, getInfoBlurHash } from '../../ui/media/BlurHash';
import { useViewerFrame } from './viewerFrame';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../lib/hooks/useBlobUrlCleanup';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { canUseServerThumbnail, loadServerScaledPicture } from './serverThumbnail';
import { imageViewerOpenAtom } from '../../navigation/imageViewerState';
import { revealDirectionControls } from '../../ui/directional';
import { getBlobSafeMimeType, FALLBACK_MIMETYPE } from '../../lib/mimeTypes';
import { stopPropagation } from '../../lib/keyboard';
import { PINCH_SURFACE_ATTRIBUTE } from '../../theme/usePinchToZoom';
import * as css from './style.css';

/** Marks the history entry pushed while an image viewer is open, so Back closes the viewer. */
export const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';

// The viewer pinches its own picture: the page zoom leaves pinches over its frame alone, its
// safe-area padding on a phone included (theme/usePinchToZoom.ts).
const PINCH_SURFACE = { [PINCH_SURFACE_ATTRIBUTE]: '' };

type HistoryState = Record<string, unknown> | null | undefined;

const hasViewerMarker = (state: HistoryState): boolean =>
  !!state && typeof state === 'object' && state[IMAGE_VIEWER_HISTORY_MARKER] === true;

const withoutViewerMarker = (state: HistoryState): Record<string, unknown> => {
  const rest = { ...state };
  delete rest[IMAGE_VIEWER_HISTORY_MARKER];
  return rest;
};

/**
 * While `open`, keeps one history entry for the viewer: Back (popstate) closes it, closing it
 * any other way consumes that entry, and leaving the page strips the marker so a reload does
 * not come back to a stale viewer entry.
 */
const useViewerHistoryEntry = (open: boolean, close: () => void) => {
  useEffect(() => {
    if (!open) return undefined;
    const { history } = window;
    history.pushState(
      { ...(history.state as HistoryState), [IMAGE_VIEWER_HISTORY_MARKER]: true },
      ''
    );
    let consumed = false;

    const handlePopState = () => {
      consumed = true;
      close();
    };
    const handlePageHide = () => {
      if (consumed) return;
      consumed = true;
      if (hasViewerMarker(history.state as HistoryState)) {
        history.replaceState(withoutViewerMarker(history.state as HistoryState), '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pagehide', handlePageHide);
      if (!consumed && hasViewerMarker(history.state as HistoryState)) history.back();
    };
  }, [open, close]);
};

type RenderImageContentProps = {
  src: string;
  alt: string;
  title: string;
  tabIndex: number;
  onClick: () => void;
  /** Opens the viewer on Enter, since the image is focusable. */
  onKeyDown: (evt: React.KeyboardEvent<HTMLElement>) => void;
  onLoad: () => void;
  onError: () => void;
};

type RenderImageViewerProps = {
  src: string;
  alt: string;
  requestClose: () => void;
};

type ImageContentProps = {
  body: string;
  mimeType?: string;
  url: string;
  info?: IImageInfo;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  /** Load the image right away instead of on a click. */
  autoPlay?: boolean;
  markedAsSpoiler?: boolean;
  renderImage: (props: RenderImageContentProps) => ReactNode;
  renderViewer: (props: RenderImageViewerProps) => ReactNode;
};

type ImageThumbnail = {
  mxcUri: string;
  mimeType: string;
  encryptedFile?: IEncryptedFile;
};

/** The thumbnail the sender attached (plain or encrypted), if any. */
const getImageThumbnail = (info: IImageInfo | undefined): ImageThumbnail | undefined => {
  const encryptedFile = info?.thumbnail_file;
  const mxcUri = encryptedFile?.url ?? info?.thumbnail_url;
  if (typeof mxcUri !== 'string' || !mxcUri) return undefined;
  const declared = info?.thumbnail_info?.mimetype;
  return {
    mxcUri,
    encryptedFile,
    mimeType: declared ? getBlobSafeMimeType(declared) : FALLBACK_MIMETYPE,
  };
};

/**
 * While `active`, loads the original picture for the viewer and returns its blob URL once it is
 * there; the URL is revoked when the viewer closes. A failed load closes the viewer again.
 */
const useOriginalForViewer = (
  active: boolean,
  loadOriginal: () => Promise<string>,
  onFailure: () => void
): string | undefined => {
  const [original, setOriginal] = useState<string>();
  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    let objectUrl: string | undefined;
    loadOriginal().then(
      (url) => {
        objectUrl = url;
        if (current) setOriginal(url);
        else revokeBlobUrl(url);
      },
      () => {
        if (current) onFailure();
      }
    );
    return () => {
      current = false;
      if (objectUrl) revokeBlobUrl(objectUrl);
      setOriginal(undefined);
    };
  }, [active, loadOriginal, onFailure]);
  return original;
};

/** A layer over the whole image box that centres what it holds, such as a button or spinner. */
function CenteredLayer({ children }: { children: ReactNode }) {
  return (
    <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
      {children}
    </Box>
  );
}

/**
 * An `m.image` attachment: loads the image (right away, or on "View" without `autoPlay`), keeps
 * a spoiler blurred until it is revealed, and opens the full viewer on click or Enter.
 */
export const ImageContent = as<'div', ImageContentProps>(
  (
    {
      body,
      url,
      mimeType,
      info,
      encInfo,
      owner,
      autoPlay = true,
      markedAsSpoiler = false,
      renderImage,
      renderViewer,
      className,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const setImageViewerOpen = useSetAtom(imageViewerOpenAtom);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [spoilerRevealed, setSpoilerRevealed] = useState(!markedAsSpoiler);

    // Callers rebuild the owner and file objects on each render; the load follows what they
    // identify (the event revision and the file), not their identity.
    const ownerRef = useRef(owner);
    ownerRef.current = owner;
    const encInfoRef = useRef(encInfo);
    encInfoRef.current = encInfo;
    const ownerKey = owner ? `${owner.roomId}|${owner.eventId}|${owner.revisionTs}` : '';
    const encKey = encInfo ? `${encInfo.iv}|${encInfo.hashes?.sha256 ?? ''}` : '';

    // The timeline shows the sender's thumbnail when there is one, else for an unencrypted photo
    // one the homeserver scales; the viewer loads the original.
    const thumbnail = getImageThumbnail(info);
    const serverScaled = !thumbnail && canUseServerThumbnail(mimeType, !!encInfo);
    const thumbnailRef = useRef(thumbnail);
    thumbnailRef.current = thumbnail;
    const thumbnailKey = thumbnail ? `${thumbnail.mxcUri}|${thumbnail.mimeType}` : '';

    const loadOriginal = useCallback(async () => {
      const file = encInfoRef.current;
      const blob = await downloadCachedAttachment(mx, {
        owner: ownerRef.current,
        mxcUri: url,
        encryptedFile: file ? { ...file, url } : undefined,
        // A type the browser would run (SVG) is loaded as plain bytes instead.
        mimeType: getBlobSafeMimeType(mimeType ?? FALLBACK_MIMETYPE),
      });
      return URL.createObjectURL(blob);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mx, ownerKey, url, encKey, mimeType]);

    const [srcState, loadSrc] = useAsyncCallback(
      useCallback(async () => {
        const preview = thumbnailRef.current;
        if (!preview && serverScaled)
          return loadServerScaledPicture(mx, url, loadOriginal, ownerRef.current);
        if (!preview) return loadOriginal();
        const blob = await downloadCachedAttachment(mx, {
          owner: ownerRef.current,
          mxcUri: preview.mxcUri,
          encryptedFile: preview.encryptedFile,
          mimeType: preview.mimeType,
        });
        return URL.createObjectURL(blob);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [mx, ownerKey, thumbnailKey, serverScaled, url, loadOriginal]),
      revokeBlobUrl
    );
    useBlobUrlCleanup(srcState);

    // The failure shows through `srcState`; a replaced request needs nothing.
    const load = useCallback(() => {
      Promise.resolve(loadSrc()).catch(() => undefined);
    }, [loadSrc]);

    useEffect(() => {
      if (autoPlay) load();
    }, [autoPlay, load]);

    const viewerFrame = useViewerFrame();
    const closeViewer = useCallback(() => setViewerOpen(false), []);
    useViewerHistoryEntry(viewerOpen, closeViewer);
    const scaledInTimeline = !!thumbnail || serverScaled;
    const original = useOriginalForViewer(
      viewerOpen && scaledInTimeline,
      loadOriginal,
      closeViewer
    );

    useEffect(() => {
      if (!viewerOpen) return undefined;
      setImageViewerOpen(true);
      return () => setImageViewerOpen(false);
    }, [viewerOpen, setImageViewerOpen]);

    const src = srcState.status === AsyncStatus.Success ? srcState.data : undefined;
    // The viewer saves what it shows, so it waits for the original rather than show the thumbnail.
    const viewerSrc = scaledInTimeline ? original : src;
    const blurHash = getInfoBlurHash(info);
    const aspectRatio = info?.w && info?.h ? `${info.w} / ${info.h}` : undefined;
    // The name shows its direction controls, so `scan<U+202E>gpj.exe` cannot pass for a JPEG; the
    // viewer gets it as it is, to show it the same way and save the file under it.
    const shownName = revealDirectionControls(body);
    const caption = { alt: shownName, title: shownName };
    const showViewer = () => setViewerOpen(true);
    const showViewerOnEnter = (evt: React.KeyboardEvent<HTMLElement>) => {
      if (evt.key !== 'Enter') return;
      evt.preventDefault();
      showViewer();
    };

    return (
      <Box
        className={classNames(css.RelativeBase, className)}
        style={{ aspectRatio }}
        {...props}
        ref={ref}
      >
        {blurHash && !loaded && <BlurHash hash={blurHash} />}
        {viewerSrc && (
          <Overlay open={viewerOpen} backdrop={<OverlayBackdrop />}>
            <OverlayCenter style={viewerFrame.centerStyle}>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: closeViewer,
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal
                  {...PINCH_SURFACE}
                  role="dialog"
                  aria-modal="true"
                  aria-label={shownName}
                  style={viewerFrame.modalStyle}
                  size="500"
                  onContextMenu={(evt: React.MouseEvent) => evt.stopPropagation()}
                >
                  {renderViewer({ src: viewerSrc, alt: body, requestClose: closeViewer })}
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        {src && (
          <Box className={classNames(css.AbsoluteContainer, !spoilerRevealed && css.Blur)}>
            {renderImage({
              src,
              ...caption,
              tabIndex: 0,
              onClick: showViewer,
              onKeyDown: showViewerOnEnter,
              onLoad: () => setLoaded(true),
              onError: () => setFailed(true),
            })}
          </Box>
        )}
        {!spoilerRevealed && src && (
          <CenteredLayer>
            <Chip variant="Secondary" radii="Pill" onClick={() => setSpoilerRevealed(true)}>
              <Text size="B300">{t('sharedUi.imageContent.spoiler')}</Text>
            </Chip>
          </CenteredLayer>
        )}
        {srcState.status === AsyncStatus.Idle && !autoPlay && (
          <CenteredLayer>
            <Button variant="Secondary" fill="Solid" radii="300" size="300" onClick={load}>
              <Text size="B300">{t('sharedUi.imageContent.view')}</Text>
            </Button>
          </CenteredLayer>
        )}
        {(srcState.status === AsyncStatus.Loading ||
          (src && !loaded && !failed) ||
          (viewerOpen && !viewerSrc)) &&
          (spoilerRevealed || !src) && (
            <CenteredLayer>
              <Spinner variant="Secondary" size="400" />
            </CenteredLayer>
          )}
        {(failed || srcState.status === AsyncStatus.Error) && (
          <CenteredLayer>
            <Button
              variant="Critical"
              fill="Soft"
              radii="300"
              size="300"
              onClick={() => {
                setFailed(false);
                setLoaded(false);
                load();
              }}
              before={<Icon size="50" src={Icons.Warning} />}
            >
              <Text size="B300">{t('sharedUi.imageContent.retry')}</Text>
            </Button>
          </CenteredLayer>
        )}
      </Box>
    );
  }
);
