import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { glassFloating, glassOutline, glassSurface } from '../../ui/styles/Glass.css';

// A small pill in a notice place (ui/noticeSlots.tsx), centred there. The places take no clicks
// themselves, so the pill asks for its own.
export const Pill = style([
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  glassOutline,
  {
    flexShrink: 0,
    alignSelf: 'center',
    maxInlineSize: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    borderRadius: config.radii.Pill,
    paddingBlock: config.space.S100,
    paddingInlineStart: config.space.S300,
    paddingInlineEnd: config.space.S100,
    color: color.SurfaceVariant.OnContainer,
    pointerEvents: 'auto',
  },
]);

// The status region that says the recording's state; read out, not shown.
export const Announcement = style({
  position: 'absolute',
  inlineSize: 1,
  blockSize: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
});

// Red while the microphone records, dimmed while it is paused.
export const Dot = recipe({
  base: {
    flex: 'none',
    inlineSize: toRem(10),
    blockSize: toRem(10),
    borderRadius: '50%',
    backgroundColor: color.Critical.Main,
  },
  variants: { paused: { true: { opacity: 0.4 }, false: {} } },
});

// Digits of equal width keep the pill from changing width as the time counts up.
export const Label = style({ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' });
