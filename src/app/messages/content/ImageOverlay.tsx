import React from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { Modal } from '../../ui/glass/GlassPrimitives';
import { revealDirectionControls } from '../../ui/directional';
import { ImageViewer } from '../viewers/ImageViewer';
import { useViewerFrame, viewerTrapOptions } from './viewerFrame';

type ImageOverlayProps = {
  /** The picture to show; nothing opens until it is there. */
  src?: string;
  alt: string;
  requestClose: () => void;
};

const keepContextMenu = (event: React.MouseEvent) => event.stopPropagation();

/**
 * The image viewer in a modal over the page, for pictures that are not message attachments
 * (link previews). Escape, a click outside or the viewer's back button close it. The dialog's
 * name shows the direction controls of `alt`; the viewer gets it as it is, to save the picture
 * under it.
 */
export function ImageOverlay({ src, alt, requestClose }: ImageOverlayProps) {
  const { centerStyle, modalStyle } = useViewerFrame();
  if (!src) return null;
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter style={centerStyle}>
        <FocusTrap focusTrapOptions={viewerTrapOptions(requestClose)}>
          <Modal
            role="dialog"
            aria-modal="true"
            aria-label={revealDirectionControls(alt)}
            size="500"
            style={modalStyle}
            onContextMenu={keepContextMenu}
          >
            <ImageViewer src={src} alt={alt} requestClose={requestClose} />
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
