import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const SheetBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S400,
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--sp-extra, 0px))',
});

// CINNY-132: see CommandPaletteRenderer — a bottom-docked sheet measured in
// viewport units docks below the visible window while the iOS keyboard is up.
export const SheetContainer = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  minHeight: 'var(--app-height, 100svh)',
  height: 'var(--app-height, 100dvh)',
  width: '100vw',
});
