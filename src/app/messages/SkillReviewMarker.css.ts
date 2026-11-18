import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Marker = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  minWidth: 0,
});

// The thread title marker's trigger: a muted line that lights up on hover, focus or open.
export const MarkerTrigger = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  minWidth: 0,
  // The start margin pulls it past the line's start; it may reach the line's end too. In a row
  // of markers sized to their content, plain 100% would wrap the trigger.
  maxWidth: `calc(100% + ${config.space.S100})`,
  border: 0,
  borderRadius: config.radii.R300,
  padding: `${toRem(1)} ${config.space.S100}`,
  marginInlineStart: `calc(-1 * ${config.space.S100})`,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'start',
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  opacity: config.opacity.P300,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
      color: color.Primary.Main,
      background: color.Primary.Container,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

export const Name = style({
  overflowWrap: 'anywhere',
});

export const Details = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  maxWidth: toRem(360),
  overflowWrap: 'anywhere',
});

export const Added = style({ color: color.Success.Main });
export const Removed = style({ color: color.Critical.Main });

export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  alignSelf: 'stretch',
  marginTop: config.space.S100,
  padding: config.space.S200,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  minWidth: 0,
});

export const FileHeader = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: config.space.S100,
  overflowWrap: 'anywhere',
});

export const Diff = style({
  margin: `${config.space.S100} 0 0`,
  maxHeight: toRem(256),
  overflow: 'auto',
  borderRadius: config.radii.R300,
  background: color.Surface.Container,
  fontFamily: "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
  fontSize: toRem(12),
  lineHeight: 1.5,
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

const diffLine = {
  display: 'block',
  minWidth: 'max-content',
  // An empty line (a final-newline change can leave a bare "+" or "-", or nothing) keeps its height.
  minHeight: '1.5em',
  paddingInline: config.space.S100,
  whiteSpace: 'pre',
} as const;

export const DiffLine = style(diffLine);
export const DiffAdded = style({
  ...diffLine,
  background: color.Success.Container,
  color: color.Success.OnContainer,
});
export const DiffRemoved = style({
  ...diffLine,
  background: color.Critical.Container,
  color: color.Critical.OnContainer,
});
export const DiffMeta = style({ ...diffLine, opacity: config.opacity.P300 });
