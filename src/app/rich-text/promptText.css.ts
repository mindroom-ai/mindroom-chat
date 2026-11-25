import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const InlineCode = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  fontFamily: monoFont,
  fontSize: '0.9em',
  paddingBlock: toRem(1),
  paddingInline: toRem(4),
  borderRadius: config.radii.R300,
  backgroundColor: `color-mix(in srgb, ${color.Surface.OnContainer} 8%, transparent)`,
  color: color.Surface.OnContainer,
});

export const PromptMention = style({
  color: color.Primary.OnContainer,
  backgroundColor: color.Primary.Container,
  borderRadius: config.radii.R300,
  paddingInline: toRem(3),
  fontWeight: config.fontWeight.W500,
});
