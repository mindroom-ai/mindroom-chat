import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;

export const Card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
  maxInlineSize: toRem(540),
  marginBlock: space.S100,
  padding: space.S300,
  borderRadius: radii.R400,
  border: `${borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const Header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: space.S200,
});

export const TitleGroup = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: space.S100,
  minInlineSize: 0,
  flex: '1 1 auto',
});

export const Title = style({
  fontWeight: 600,
  minInlineSize: 0,
  overflowWrap: 'anywhere',
});

export const MetaBadge = style({
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
});

const statusBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: space.S100,
  paddingInline: space.S200,
  paddingBlock: toRem(2),
  borderRadius: radii.Pill,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  fontWeight: 500,
  flexShrink: 0,
});

export const StatusPill = styleVariants({
  starting: [statusBase, { backgroundColor: color.Surface.Container, color: color.Surface.OnContainer }],
  running: [statusBase, { backgroundColor: color.Primary.Container, color: color.Primary.OnContainer }],
  waiting: [statusBase, { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer }],
  completed: [statusBase, { backgroundColor: color.Success.Container, color: color.Success.OnContainer }],
  failed: [statusBase, { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer }],
  cancelled: [statusBase, { backgroundColor: color.Surface.Container, color: color.Surface.OnContainer }],
  interrupted: [statusBase, { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer }],
});

export const Phases = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: space.S100,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const PhaseChip = style({
  paddingInline: space.S200,
  paddingBlock: toRem(2),
  borderRadius: radii.R300,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  backgroundColor: color.Surface.Container,
  border: `${borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const Metrics = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.S300,
  rowGap: space.S100,
});

export const FailedBadge = style({
  color: color.Critical.Main,
  fontWeight: 500,
});

export const ErrorLine = style({
  paddingInline: space.S200,
  paddingBlock: space.S100,
  borderRadius: radii.R300,
  backgroundColor: color.Critical.Container,
  color: color.Critical.OnContainer,
  overflowWrap: 'anywhere',
});

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: space.S200,
  paddingBlockStart: space.S100,
});

export const Alert = style({
  color: color.Critical.Main,
});

export const FreeTextForm = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  paddingBlockStart: space.S100,
});

export const FreeTextInput = style({
  flex: '1 1 auto',
  minInlineSize: 0,
});

export const QuestionNote = style({
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});

export const QuestionClosed = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  fontWeight: 500,
});

export const LiveStatus = style({
  position: 'absolute',
  inlineSize: 1,
  blockSize: 1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});
