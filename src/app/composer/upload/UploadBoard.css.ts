import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { glassFloating, glassSurface } from '../../ui/styles/Glass.css';

// The staged-uploads panel floats above the composer. Its anchor takes no clicks, so the
// timeline under the empty area stays usable; only the panel itself (below) takes them.
export const UploadBoardBase = style([
  DefaultReset,
  { pointerEvents: 'none', position: 'relative' },
]);

// In a room view the approvals and background jobs dock floats between the timeline and the
// composer; its height is the footer inset minus the composer's (MindroomRoomView). The panel
// rises above the dock, so neither covers the other's controls.
const dockHeight = 'calc(var(--room-footer-height, 0px) - var(--room-composer-height, 0px))';

/** Spans the anchor's width S200 above it (and above the dock) and pushes the panel to the end. */
export const UploadBoardContainer = style([
  DefaultReset,
  {
    display: 'flex',
    justifyContent: 'flex-end',
    position: 'absolute',
    insetInline: 0,
    bottom: `calc(${config.space.S200} + ${dockHeight})`,
  },
]);

export const UploadBoard = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {
    width: '100%',
    // As wide as a folds dialog (size.DialogWidth, 23.75rem); at most half the viewport tall,
    // so the newest messages stay visible above it while files upload.
    maxWidth: config.size.DialogWidth,
    maxHeight: '50vh',
    display: 'flex',
    borderRadius: config.radii.R400,
    flexFlow: 'column',
    overflow: 'hidden',
    color: color.Surface.OnContainer,
    // The anchor passes clicks through; the panel takes them again.
    pointerEvents: 'auto',
  },
]);

/** The header row: the file count toggle on the start side, Remove All at the end. */
export const UploadBoardHeaderContent = style({
  minWidth: 0,
  height: '100%',
  gap: config.space.S200,
  paddingInline: config.space.S300,
});

/** The file cards; this part scrolls when the board reaches its height limit. */
export const UploadBoardContent = style({
  minHeight: 0,
  flexGrow: 1,
  padding: `0 ${config.space.S300} ${config.space.S300}`,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});
