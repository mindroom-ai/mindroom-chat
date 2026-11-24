import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import * as modelCss from './ModelChangeMarker.css';

export { Marker, Trigger, Title, Model as Summary } from './ModelChangeMarker.css';

export const Panel = style([
  modelCss.Panel,
  {
    gap: config.space.S100,
    alignSelf: 'stretch',
  },
]);

export const Prompt = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const Payload = style({
  margin: 0,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  maxHeight: toRem(280),
  overflow: 'auto',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12),
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  textAlign: 'start',
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});
