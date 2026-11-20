import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { glassFloating, glassOutline, glassSurface } from '../../ui/styles/Glass.css';

// A small pill floating over the foot of whatever page shows, centred, clear of the home
// indicator: above the pages, below folds' dialogs, menus and tooltips in their own layer.
export const Pill = style([
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  glassOutline,
  {
    position: 'fixed',
    zIndex: 1000,
    insetInline: 0,
    insetBlockEnd: `calc(env(safe-area-inset-bottom, 0px) + ${config.space.S400})`,
    marginInline: 'auto',
    inlineSize: 'fit-content',
    maxInlineSize: `calc(100vw - 2 * ${config.space.S400})`,
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S200,
    borderRadius: config.radii.Pill,
    paddingBlock: config.space.S100,
    paddingInlineStart: config.space.S300,
    paddingInlineEnd: config.space.S100,
    color: color.SurfaceVariant.OnContainer,
  },
]);

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
