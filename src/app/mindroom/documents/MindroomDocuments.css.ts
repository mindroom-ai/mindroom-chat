import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

export const Card = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S200,
    alignSelf: 'flex-start',
    width: 'fit-content',
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(520)})`,
    padding: config.space.S300,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const Header = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minWidth: 0,
});

export const FileBadge = style({
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  width: toRem(34),
  height: toRem(40),
  borderRadius: config.radii.R300,
  backgroundColor: '#107c41',
  color: '#ffffff',
  fontWeight: 800,
  fontSize: toRem(12),
});

export const Title = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

export const Name = style({
  fontWeight: 700,
  overflowWrap: 'anywhere',
});

export const Muted = style({
  opacity: config.opacity.P400,
  overflowWrap: 'anywhere',
});

export const Change = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Background.Container,
});

export const StatusRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: `${toRem(2)} ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  fontSize: toRem(12),
  fontWeight: 600,
});

export const Pill = styleVariants({
  good: [pill, { backgroundColor: color.Success.Container, color: color.Success.OnContainer }],
  warn: [pill, { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer }],
  bad: [pill, { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer }],
});

export const OutcomeList = style({
  margin: 0,
  paddingInlineStart: config.space.S400,
  fontSize: toRem(13),
});

export const Mono = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12.5),
  overflowWrap: 'anywhere',
});

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S200,
});

export const Action = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: `${config.space.S100} ${config.space.S300}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  color: 'inherit',
  fontSize: toRem(13),
  fontWeight: 600,
  textDecoration: 'none',
  ':hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: toRem(2) },
});

export const PrimaryAction = style([
  Action,
  {
    backgroundColor: '#107c41',
    borderColor: '#107c41',
    color: '#ffffff',
    ':hover': { backgroundColor: '#0c6634' },
  },
]);

export const Review = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  minWidth: 0,
});

export const ReviewEdit = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  minWidth: 0,
  overflowX: 'auto',
});

export const DiffTable = style({
  borderCollapse: 'collapse',
  fontSize: toRem(13),
  minWidth: '100%',
});

export const DiffHead = style({
  textAlign: 'start',
  fontWeight: 600,
  opacity: config.opacity.P400,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const DiffCell = style({
  padding: `${config.space.S100} ${config.space.S200}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  verticalAlign: 'top',
  overflowWrap: 'anywhere',
  maxWidth: toRem(220),
});

export const Old = style({
  color: color.Critical.Main,
  textDecoration: 'line-through',
});

export const New = style({
  color: color.Success.Main,
  fontWeight: 600,
});

export const Redacted = style({
  fontStyle: 'italic',
  opacity: config.opacity.P400,
});
