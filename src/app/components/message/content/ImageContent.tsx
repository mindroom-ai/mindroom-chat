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
import type { IImageInfo } from '../../../../types/matrix/common';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { Modal } from '../../glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { downloadCachedAttachment } from '../../../mindroom/messages/attachmentRepository';
import { imageViewerOpenAtom } from '../../../state/imageViewer';
import { getBlobSafeMimeType, FALLBACK_MIMETYPE } from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import * as css from './style.css';

/** Marks the history entry pushed while an image viewer is open, so Back closes the viewer. */
export const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';

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

export type RenderImageContentProps = {
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

export type RenderImageViewerProps = {
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

    const [srcState, loadSrc] = useAsyncCallback(
      useCallback(async () => {
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
      }, [mx, ownerKey, url, encKey, mimeType]),
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

    const closeViewer = useCallback(() => setViewerOpen(false), []);
    useViewerHistoryEntry(viewerOpen, closeViewer);

    useEffect(() => {
      if (!viewerOpen) return undefined;
      setImageViewerOpen(true);
      return () => setImageViewerOpen(false);
    }, [viewerOpen, setImageViewerOpen]);

    const src = srcState.status === AsyncStatus.Success ? srcState.data : undefined;
    const aspectRatio = info?.w && info?.h ? `${info.w} / ${info.h}` : undefined;

    return (
      <Box
        className={classNames(css.RelativeBase, className)}
        style={{ aspectRatio }}
        {...props}
        ref={ref}
      >
        {src && (
          <Overlay open={viewerOpen} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: closeViewer,
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal
                  style={{ width: '90vw', height: '90vh', maxWidth: 'none', maxHeight: 'none' }}
                  size="500"
                  onContextMenu={(evt: React.MouseEvent) => evt.stopPropagation()}
                >
                  {renderViewer({ src, alt: body, requestClose: closeViewer })}
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        {src && (
          <Box className={classNames(css.AbsoluteContainer, !spoilerRevealed && css.Blur)}>





              onClick: () => setViewerOpen(true),
              onKeyDown: (evt) => {
                if (evt.key !== 'Enter') return;
                evt.preventDefault();
                setViewerOpen(true);
              },
              onLoad: () => setLoaded(true),
              onError: () => setFailed(true),
            })}
          </Box>
        )}
        {!spoilerRevealed && src && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <Chip variant="Secondary" radii="Pill" onClick={() => setSpoilerRevealed(true)}>
              <Text size="B300">{t('sharedUi.imageContent.spoiler')}</Text>
            </Chip>
          </Box>
        )}
        {srcState.status === AsyncStatus.Idle && !autoPlay && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <Button variant="Secondary" fill="Solid" radii="300" size="300" onClick={load}>
              <Text size="B300">{t('sharedUi.imageContent.view')}</Text>
            </Button>
          </Box>
        )}
        {(srcState.status === AsyncStatus.Loading || (src && !loaded && !failed)) &&
          (spoilerRevealed || !src) && (
            <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
              <Spinner variant="Secondary" size="400" />
            </Box>
          )}


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
          </Box>
        )}
      </Box>
    );
  }
);
