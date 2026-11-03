import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const control = {



  font: 'inherit',
  cursor: 'pointer',
} as const;

// The desktop popover above the composer's model trigger.
export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  width: toRem(360),
  maxWidth: 'calc(100vw - 2rem)',
  height: `min(${toRem(480)}, 70vh)`,
  borderRadius: config.radii.R500,
  overflow: 'hidden',
  boxShadow: config.shadow.E300,
});

// On phones the panel fills the bottom sheet instead of floating.
export const MobilePanel = style({
  width: '100%',
  maxWidth: '100%',
  height: '100%',
  maxHeight: '100%',
  borderRadius: 0,
  boxShadow: 'none',
});

export const MobileContainer = style({
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: `${config.space.S400} 0 0`,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  pointerEvents: 'none',
});

globalStyle(`${MobileContainer} > *`, { pointerEvents: 'auto', maxHeight: '85vh', width: '100%' });

export const Controls = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',



  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const Header = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
});

export const HeaderText = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
  gap: config.space.S100,
});

export const Title = style({
  fontSize: config.fontSize.H6,
  fontWeight: config.fontWeight.W600,
  lineHeight: config.lineHeight.H6,
});

export const Subtitle = style({
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  opacity: config.opacity.P400,
});

export const IconButton = style([
  control,
  {




    width: toRem(28),
    height: toRem(28),
    borderRadius: config.radii.R300,
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': { outline: `2px solid ${color.Primary.Main}` },
    },
  },
]);

export const SearchRow = style({
  display: 'flex',







  selectors: {
    '&:focus-within': { borderColor: color.Primary.Main },
  },
});

export const SearchInput = style({
  flex: '1 1 auto',
  minWidth: 0,




  font: 'inherit',
  fontSize: config.fontSize.T300,
  padding: `${config.space.S100} 0`,
});

export const RuntimeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  fontSize: config.fontSize.T200,
});

export const RuntimeLabel = style({
  flexShrink: 0,
  opacity: config.opacity.P400,
});

export const RuntimeSelect = style({
  flex: '1 1 auto',
  minWidth: 0,
  font: 'inherit',





});

export const StatusRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  fontSize: config.fontSize.T200,
  opacity: config.opacity.P400,
});

export const Error = style({
  display: 'flex',






  fontSize: config.fontSize.T200,
});

export const ErrorActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
});

export const TextButton = style([
  control,
  {



    selectors: {
      '&:hover': { backgroundColor: color.Critical.ContainerHover },
      '&:focus-visible': { outline: `2px solid ${color.Critical.Main}` },
    },
  },
]);

export const Results = style({
  padding: config.space.S200,
});

export const Group = style({
  display: 'flex',
  flexDirection: 'column',
  selectors: { '& + &': { marginTop: config.space.S200 } },
});

export const GroupTitle = style({
  padding: `${config.space.S200} ${config.space.S200} ${config.space.S100}`,
  fontSize: config.fontSize.O400,
  fontWeight: config.fontWeight.W500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  opacity: config.opacity.P400,
});

export const Option = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  padding: `${config.space.S200} ${config.space.S200}`,
  borderRadius: config.radii.R400,
  cursor: 'pointer',
  selectors: {
    '&[data-active="true"]': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&[aria-selected="true"]': { color: color.Primary.Main },
    '&[aria-disabled="true"]': { cursor: 'default', opacity: config.opacity.Disabled },
  },
});

export const OptionIcon = style({




  width: toRem(28),




});

export const IconImage = style({
  display: 'block',
  objectFit: 'contain',
  borderRadius: config.radii.R300,
});

export const OptionText = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
});

export const OptionTitle = style({
  fontSize: config.fontSize.T300,




});

export const OptionDetail = style({
  fontSize: config.fontSize.T200,




});

export const Check = style({
  flexShrink: 0,
  color: color.Primary.Main,
});

export const Empty = style({
  padding: config.space.S400,
  textAlign: 'center',
  fontSize: config.fontSize.T300,






  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const FooterText = style({
  fontSize: config.fontSize.T200,
  opacity: config.opacity.P400,
});

// The composer's row above the editor that names the thread's model.
export const ComposerRow = style({
  display: 'flex',




});

export const ScopeLabel = style({
  flexShrink: 0,
  fontSize: config.fontSize.T200,
  opacity: config.opacity.P400,
});

export const Trigger = style([
  control,
  {











    fontSize: config.fontSize.T200,
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 1 },
      '&[aria-expanded="true"]': { backgroundColor: color.SurfaceVariant.ContainerActive },
    },
  },
]);

export const TriggerIcon = style({
  flexShrink: 0,
});

export const TriggerLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
