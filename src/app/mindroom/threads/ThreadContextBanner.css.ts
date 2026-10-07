import { style } from '@vanilla-extract/css';
import { config, color } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';
import { shortViewport } from './shortViewport';

// Collapsed, and always on short screens, the banner keeps one row: back,
// title and the actions menu, which already offers tags, pinning and resolving.
export const Collapsed = style({});

const BannerLayout = style({
  margin: `${config.space.S200} ${config.space.S300}`,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  flexShrink: 0,
  pointerEvents: 'auto',
  selectors: { [`&${Collapsed}`]: { padding: config.space.S200 } },
  '@media': { [shortViewport]: { padding: config.space.S200 } },
});

export const CompactHidden = style({
  selectors: { [`${Collapsed} &`]: { display: 'none' } },
  '@media': { [shortViewport]: { selectors: { '&&': { display: 'none' } } } },
});

// The collapse toggle has nothing to fold on a short screen.
export const ShortViewportHidden = style({
  '@media': { [shortViewport]: { selectors: { '&&': { display: 'none' } } } },
});

export const Banner = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
]);

// "Thread View" is chrome, not content: it says the same thing on every
// thread the user opens, so it shows only while the thread has no title. It
// uses the same uppercase/12px/W500 treatment the sidebar category headers and
// the SHOW MORE pill already use for that role.
export const ViewLabel = style({
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: config.fontWeight.W500,
  whiteSpace: 'nowrap',
});

// Back, title and actions; narrow screens add the tags as a second row.
export const TitleRow = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: config.space.S300,
  minHeight: '1.5rem',
});

// Holds the eyebrow, the approvals chip and the tags; often none of them.
const eyebrowRowFolded = `:not(:has(> :not(${CompactHidden})))`;
export const EyebrowRow = style({
  flexShrink: 0,
  selectors: {
    '&:empty': { display: 'none' },
    [`${Collapsed} &${eyebrowRowFolded}`]: { display: 'none' },
  },
  '@media': {
    [shortViewport]: { selectors: { [`&${eyebrowRowFolded}`]: { display: 'none' } } },
  },
});

// Compact, the approvals chip that stays in view sits beside the title.
const titleColumnInline = {
  flexDirection: 'row',
  alignItems: 'center',
  columnGap: config.space.S200,
} as const;
export const TitleColumn = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: 0,
  selectors: { [`${Collapsed} &`]: titleColumnInline },
  '@media': { [shortViewport]: titleColumnInline },
});

export const TagsRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  flexWrap: 'nowrap',
  overflow: 'hidden',
});

/**
 * Desktop: tags inline on title row (hidden below).
 * Mobile (<480px): tags hidden on title row, shown in a dedicated row below.
 */
export const DesktopOnlyTags = style({
  '@media': {
    '(max-width: 480px)': {
      display: 'none',
    },
  },
});

export const SubtitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginTop: config.space.S100,
  minWidth: 0,
  flexWrap: 'wrap',
  selectors: {
    [`${EyebrowRow}:empty + &, ${Collapsed} &`]: { marginTop: 0 },
  },
  '@media': {
    [shortViewport]: { marginTop: 0 },
    // Narrow screens move the tags to their own row, which can leave the
    // eyebrow row with nothing showing.
    '(max-width: 480px)': {
      selectors: {
        [`${EyebrowRow}:not(:has(> :not(${DesktopOnlyTags}))) + &`]: { marginTop: 0 },
      },
    },
  },
});

export const ResolveChip = style({
  marginInlineStart: 'auto',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: config.space.S100,
});

export const ResolutionByline = style({
  maxWidth: '10rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '@media': {
    '(max-width: 480px)': {
      maxWidth: '6rem',
    },
  },
});

// The grey this used to hardcode (rgba(128,128,128,0.2)) is the same slab in
// all five themes, so it read as a hole in butter and as a smudge in midnight.
// On the container tokens it tracks the tag pills it sits next to.
export const OverflowChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.65rem',
  fontWeight: config.fontWeight.W500,
  padding: '0.1rem 0.4rem',
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'default',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

export const MobileOnlyTags = style({
  display: 'none',
  gridColumn: '2 / -1',
  '@media': {
    '(max-width: 480px)': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.3rem',
      marginTop: config.space.S100,
    },
  },
});

// The thread title is the one thing in this bar that differs per thread, so
// it carries the weight the "Thread View" eyebrow used to take.
export const SummaryText = style({
  display: 'block',
  fontWeight: config.fontWeight.W500,
  minWidth: 0,
  flex: '1 1 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ScheduledWrap = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
});

export const MetadataDot = style({
  flexShrink: 0,
});

export const ScheduledIndicator = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const BannerResolved = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'Success' }),
  glassFloating,
  { color: color.Success.OnContainer },
]);

export const BannerDisabled = style({
  opacity: 0.6,
  pointerEvents: 'none',
});

export const TagPickerInputContainer = style({
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `0 ${config.space.S100}`,
});

export const TagPickerInput = style({
  width: '100%',
  display: 'block',
  padding: `${config.space.S200} ${config.space.S300}`,
  border: 'none',
  outline: 'none',
  font: 'inherit',
  fontSize: '0.8rem',
  lineHeight: 1.4,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  caretColor: color.SurfaceVariant.OnContainer,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus::placeholder': {
      opacity: '0',
    },
  },
});
