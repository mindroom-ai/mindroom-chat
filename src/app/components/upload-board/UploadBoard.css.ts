import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

// The staged-uploads panel floats above the composer. Its anchor takes no clicks, so the
// timeline under the empty area stays usable; only the panel itself (below) takes them.
export const UploadBoardBase = style([
  DefaultReset,
  { pointerEvents: 'none', position: 'relative' },
]);

/** Spans the anchor's width S200 above it and pushes the panel to the end edge. */
export const UploadBoardContainer = style([
  DefaultReset,
  {
    display: 'flex',
    justifyContent: 'flex-end',
    position: 'absolute',
    insetInline: 0,
    bottom: config.space.S200,
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
