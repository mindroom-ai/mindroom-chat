import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../ui/styles/Glass.css';

/** An agent's question in its reply: the glass card of the approval and secret request cards. */
export const Card = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S200,
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(520)})`,
    marginBlock: config.space.S100,
    paddingBlock: config.space.S300,
    paddingInline: config.space.S300,
    color: color.SurfaceVariant.OnContainer,
    borderRadius: config.radii.R400,
    overflowWrap: 'anywhere',
  },
]);

export const Header = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const Kind = style({ fontWeight: config.fontWeight.W600 });

export const Status = style({
  marginInlineStart: 'auto',
  flexShrink: 0,
  paddingBlock: toRem(2),
  paddingInline: toRem(10),
  borderRadius: config.radii.Pill,
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.4,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const StatusWaiting = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});

export const Question = style({
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'pre-wrap',
});

export const Options = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(6),
});

/** One option: a full-width row with its emoji, label and, once chosen, who chose it. */
export const Option = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: toRem(10),
  width: '100%',
  minHeight: toRem(40),
  paddingBlock: toRem(9),
  paddingInline: toRem(12),
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  lineHeight: 1.4,
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': {
      backgroundColor: color.Primary.Container,
      color: color.Primary.OnContainer,
    },
    '&:focus-visible': {
      outline: `${toRem(2)} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
    '&:disabled': { cursor: 'default' },
  },
});

export const OptionChosen = style({
  borderColor: color.Primary.Main,
  selectors: {
    '&&': { backgroundColor: color.Primary.Container, color: color.Primary.OnContainer },
  },
});

export const OptionMuted = style({ opacity: config.opacity.P300 });

export const Emoji = style({ flexShrink: 0, width: toRem(20), textAlign: 'center' });

export const Label = style({ flexGrow: 1, minWidth: 0 });

export const Chosen = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(4),
  flexShrink: 0,
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.65,
});
