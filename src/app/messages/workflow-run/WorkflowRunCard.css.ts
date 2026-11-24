import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Card as BaseCard } from '../question/QuestionCard.css';

const { space, radii, borderWidth } = config;

export const Card = style([
  BaseCard,
  { gap: space.S200, width: '100%', maxInlineSize: toRem(540), padding: space.S300 },
]);
export const Row = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: space.S200,
});
export const Title = style({ fontWeight: 600, minInlineSize: 0, overflowWrap: 'anywhere' });

export const Pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingInline: space.S200,
  paddingBlock: toRem(2),
  borderRadius: radii.Pill,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  backgroundColor: color.Surface.Container,
  border: `${borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  color: color.Surface.OnContainer,
  flexShrink: 0,
});

const tone = style([Pill, { border: 'none', fontWeight: 500 }]);
export const StatusPill = styleVariants({
  starting: [tone, { backgroundColor: color.Surface.Container, color: color.Surface.OnContainer }],
  running: [tone, { backgroundColor: color.Primary.Container, color: color.Primary.OnContainer }],
  waiting: [tone, { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer }],
  completed: [tone, { backgroundColor: color.Success.Container, color: color.Success.OnContainer }],
  failed: [tone, { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer }],
  cancelled: [tone, { backgroundColor: color.Surface.Container, color: color.Surface.OnContainer }],
  interrupted: [
    tone,
    { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer },
  ],
});

export const Phases = style([Row, { gap: space.S100, margin: 0, padding: 0, listStyle: 'none' }]);
export const CriticalText = style({ color: color.Critical.Main, fontWeight: 500 });
export const ErrorLine = style({
  paddingInline: space.S200,
  paddingBlock: space.S100,
  borderRadius: radii.R300,
  backgroundColor: color.Critical.Container,
  color: color.Critical.OnContainer,
  overflowWrap: 'anywhere',
});
export const FreeTextInput = style({ flex: '1 1 auto', minInlineSize: 0 });
