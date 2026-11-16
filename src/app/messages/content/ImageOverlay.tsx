import React, { ComponentProps, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { Modal } from '../../ui/glass/GlassPrimitives';
import { revealDirectionControls } from '../../ui/directional';
import { ImageViewer } from '../viewers/ImageViewer';
import { useViewerFrame, viewerTrapOptions } from './viewerFrame';
import { PINCH_SURFACE_ATTRIBUTE } from '../../theme/usePinchToZoom';
import { imageViewerOpenAtom } from '../../navigation/imageViewerState';
import { useLatestRef } from '../../lib/hooks/useLatestRef';

/** Marks the history entry pushed while an image viewer is open, so Back closes the viewer. */
const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';

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
 * not come back to a stale viewer entry. A new `close` each render keeps the same entry.
 */
const useViewerHistoryEntry = (open: boolean, close: () => void) => {
  const closeRef = useLatestRef(close);
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
      closeRef.current();
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
  }, [open, closeRef]);
};

/** While `open`, the edge swipes leave the page alone (navigation/useEdgeSwipe.ts). */
const useImageViewerOpenFlag = (open: boolean) => {
  const setImageViewerOpen = useSetAtom(imageViewerOpenAtom);
  useEffect(() => {
    if (!open) return undefined;
    setImageViewerOpen(true);
    return () => setImageViewerOpen(false);
  }, [open, setImageViewerOpen]);
};

type ImageOverlayProps = ComponentProps<typeof ImageViewer> & {
  /** Opens before `src` is there, with the viewer's spinner; otherwise nothing opens until it is. */
  openWhileLoading?: boolean;
};

const keepContextMenu = (event: React.MouseEvent) => event.stopPropagation();

/**
 * The image viewer in a modal over the page, for message attachments, inline pictures and link
 * previews. Escape, a click outside, Back or the viewer's back button close it; however many
 * pictures it pages through, it holds one history entry. The dialog's name shows the direction
 * controls of `alt`; the viewer gets it as it is, to save the picture under it.
 */
export function ImageOverlay({ openWhileLoading = false, ...viewer }: ImageOverlayProps) {
  const { src, alt, requestClose } = viewer;
  const { centerStyle, modalStyle } = useViewerFrame();
  const open = openWhileLoading || !!src;
  useViewerHistoryEntry(open, requestClose);
  useImageViewerOpenFlag(open);
  if (!open) return null;
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter style={centerStyle}>
        <FocusTrap focusTrapOptions={viewerTrapOptions(requestClose)}>
          <Modal
            {...PINCH_SURFACE}
            role="dialog"
            aria-modal="true"
            aria-label={revealDirectionControls(alt)}
            size="500"
            style={modalStyle}
            onContextMenu={keepContextMenu}
          >
            <ImageViewer {...viewer} />
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
