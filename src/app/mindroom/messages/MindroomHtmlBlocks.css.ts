import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset } from 'folds';
import * as disclosure from './MessageDisclosure.css';

const BlockSpacing = style({
  marginBottom: config.space.S200,
  marginTop: config.space.S200,
  selectors: {
    '&:first-child': {
      marginTop: 0,
    },
    '&:last-child': {
      marginBottom: 0,
    },
  },
});

const BaseCode = style({
  color: color.SurfaceVariant.OnContainer,
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
});

const CodeFont = style({
  fontFamily: 'var(--font-mono)',
});

export const Block = style([DefaultReset, BlockSpacing, disclosure.Surface]);

export const BlockHeader = disclosure.Header;

export const BlockHeaderMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

// The label carries the count; the tool names after it truncate first.
export const BlockLabel = style({ flexShrink: 0 });

export const BlockBody = disclosure.Body;

export const BlockInlineResult = style({
  color: color.SurfaceVariant.OnContainer,
  marginInlineStart: config.space.S200,
});

export const BlockResult = style([
  BaseCode,
  CodeFont,
  {
    marginTop: config.space.S200,
    whiteSpace: 'pre-wrap',
    padding: `${config.space.S100} ${config.space.S200}`,
  },
]);

export const ToolGroupList = style({
  display: 'flex',
  flexDirection: 'column',
});

// Rows share the disclosure's glass; quiet dividers separate them.
export const ToolGroupItem = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: config.space.S200,
  minWidth: 0,
  padding: `${config.space.S200} 0`,
  selectors: {
    '& + &': {
      borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    },
  },
});

export const ToolRowHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const ToolRowIndex = style([CodeFont, { opacity: config.opacity.P400 }]);

export const ToolRowName = style([CodeFont, { fontWeight: config.fontWeight.W600 }]);

export const PasteMarkerBadge = style([
  DefaultReset,
  BaseCode,
  {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: '100%',
    gap: config.space.S100,
    verticalAlign: 'middle',
    padding: `0 ${config.space.S100}`,
    lineHeight: 1.6,
  },
]);

export const PasteMarkerBadgeMeta = style({
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  gap: config.space.S100,
  color: color.SurfaceVariant.OnContainer,
});

export { Chevron as BlockChevron } from './MessageDisclosure.css';
